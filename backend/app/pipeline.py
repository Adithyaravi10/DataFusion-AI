"""The real Collect → Wrangle → Preprocess → Fuse → Validate pipeline."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd

from . import analysis, cleaning, fusion, ingest
from .jobs import FusionJob
from .store import load_meta, save_meta, session_dir


class PipelineError(RuntimeError):
    pass


def _human_size(size: int) -> str:
    if size >= 1024 * 1024:
        return f"{size / (1024 * 1024):.1f} MB"
    if size >= 1024:
        return f"{size / 1024:.1f} KB"
    return f"{size} B"


def _load_cleaned_sources(meta: dict[str, Any]) -> tuple[dict[str, pd.DataFrame], dict[str, dict[str, Any]]]:
    frames: dict[str, pd.DataFrame] = {}
    reports: dict[str, dict[str, Any]] = {}
    folder = session_dir(meta["id"])
    for file_info in meta["files"]:
        path = folder / file_info["path"]
        raw = ingest.read_frame(path, file_info["name"])
        frame, report = cleaning.clean_frame(raw, file_info["name"])
        frames[file_info["source"]] = frame
        reports[file_info["source"]] = report
    return frames, reports


def run_pipeline(job: FusionJob, session_id: str, options: dict[str, Any]) -> None:
    """Executed in a daemon thread. Mutates the job with real stage facts."""
    meta = load_meta(session_id)
    mode = "full" if len(meta["files"]) >= 2 else "single"
    overrides: dict[str, dict[str, str]] = options.get("join_keys") or {}
    requested_target = options.get("target")

    try:
        # ---------------------------------------------------------- reading
        job.start("reading")
        job.log("reading", f"Reading {len(meta['files'])} uploaded file(s) from session storage.")
        folder = session_dir(session_id)
        raw_frames: dict[str, pd.DataFrame] = {}
        for file_info in meta["files"]:
            path = folder / file_info["path"]
            frame = ingest.read_frame(path, file_info["name"])
            raw_frames[file_info["source"]] = frame
            job.log(
                "reading",
                f"{file_info['name']}: {len(frame):,} rows × {frame.shape[1]} columns "
                f"({_human_size(file_info['size'])}).",
            )
        job.finish("reading")

        # -------------------------------------------------------- profiling
        job.start("profiling")
        for source, frame in raw_frames.items():
            missing = int(frame.isna().sum().sum())
            duplicates = int(frame.duplicated().sum())
            job.log(
                "profiling",
                f"{source}: {missing:,} missing cells, {duplicates} duplicate rows, "
                f"{frame.shape[1]} columns profiled.",
            )
        job.log("profiling", "Column types inferred; quality issues queued for wrangling.")
        job.finish("profiling")

        # --------------------------------------------------------- cleaning
        job.start("cleaning")
        cleaned: dict[str, pd.DataFrame] = {}
        clean_reports: list[dict[str, Any]] = []
        # The model target keeps its blanks: imputing a label would train the
        # model on values that were never observed.
        protected_columns: set[str] = set()
        all_columns = {str(column) for frame in raw_frames.values() for column in frame.columns}
        if requested_target and str(requested_target) in all_columns:
            protected_columns.add(str(requested_target))
        sample_frame = pd.concat(
            [frame.head(200) for frame in raw_frames.values()], ignore_index=True
        )
        suggested = analysis.suggest_target(sample_frame)
        if suggested and suggested.get("column"):
            protected_columns.add(str(suggested["column"]))
        if protected_columns:
            job.log(
                "cleaning",
                f"Preserving missing values in {', '.join(sorted(protected_columns))} "
                "(model target — never imputed).",
            )
        for file_info in meta["files"]:
            source = file_info["source"]
            frame, report = cleaning.clean_frame(
                raw_frames[source], file_info["name"], protect_columns=protected_columns
            )
            cleaned[source] = frame
            clean_reports.append(report)
            frame.to_pickle(folder / "processed" / f"{source}_clean.pkl")
            frame.to_csv(folder / "processed" / f"{source}_clean.csv", index=False)
            job.log(
                "cleaning",
                f"{file_info['name']}: {report['before']['rows']} → {report['after']['rows']} rows "
                                    f"({report['duplicates_removed']} duplicate rows removed, "
                    f"{report['missing_filled']} cell{'s' if report['missing_filled'] != 1 else ''} filled, "
                f"{len(report['numeric_converted'])} numeric and {len(report['dates_parsed'])} date column(s) normalised).",
            )
        (folder / "processed" / "clean_reports.json").write_text(
            json.dumps(clean_reports, indent=2, default=str), encoding="utf-8"
        )
        meta["clean"] = clean_reports
        for file_info in meta["files"]:
            source = file_info["source"]
            file_info["rows"] = int(len(cleaned[source]))
            file_info["cols"] = int(cleaned[source].shape[1])
        save_meta(meta)
        job.finish("cleaning")

        # ----------------------------------------------------- preprocessing
        job.start("preprocessing")
        total_filled = sum(report["missing_filled"] for report in clean_reports)
        total_outliers = sum(len(report["outliers"]) for report in clean_reports)
        job.log("preprocessing", f"Filled {total_filled:,} missing cells using per-column methods.")
        job.log(
            "preprocessing",
            f"Handled outliers in {total_outliers} column(s); categoricals prepared for encoding.",
        )

        if mode == "single":
            job.log("preprocessing", "Single source supplied — fusion will clean and analyse only.")
            job.finish("preprocessing")
            job.start("key_matching")
            job.log("key_matching", "Skipped: a single source has no cross-source keys.")
            job.finish("key_matching")
            job.start("merging")
            fused = cleaned[next(iter(cleaned))].copy()
            stats = {
                "base_source": next(iter(cleaned)),
                "steps": [],
                "join_keys": [],
                "conflicts_total": 0,
                "fuzzy_total": 0,
                "duplicates_removed": 0,
                "final_rows": int(len(fused)),
                "final_columns": int(fused.shape[1]),
                "sources_used": [next(iter(cleaned))],
                "single_source": True,
            }
            job.log("merging", "Single source: no alignment or reconciliation required.")
            job.finish("merging")
        else:
            sample_target = analysis.suggest_target(
                pd.concat([frame.head(5) for frame in cleaned.values()], ignore_index=True)
            )
            job.log(
                "preprocessing",
                f"Detected {sum(len(f) for f in cleaned.values()):,} total records across "
                f"{len(cleaned)} fusion-ready sources.",
            )
            if sample_target:
                job.log("preprocessing", f"Target hint: '{sample_target['column']}' ({sample_target['task']}).")
            job.finish("preprocessing")

            # ------------------------------------------------ key detection
            job.start("key_matching")
            current_overrides = dict(overrides)
            for _attempt in range(3):
                try:
                    plan = fusion.build_plan(cleaned, current_overrides)
                    break
                except fusion.KeyPlanningError as exc:
                    details = exc.details
                    payload = {
                        "type": "join_keys",
                        "message": str(exc),
                        "sources": details.get("sources", {}),
                        "candidates": details.get("candidates", []),
                    }
                    job.log("key_matching", f"Needs your input: {exc}")
                    job.request_confirmation(payload)
                    answer = job.wait_for_confirmation()
                    current_overrides.update(answer.get("join_keys") or {})
                    if answer.get("target"):
                        requested_target = answer["target"]
                    job.start("key_matching")
            else:
                raise PipelineError("No usable join plan could be built from the selected keys.")

            if plan.get("ambiguous"):
                payload = {
                    "type": "confirm_keys",
                    "message": "The best join key is uncertain. Confirm the detected keys before merging.",
                    "plan": [
                        {
                            "source": step["source"],
                            "left_key": step["left_key"],
                            "right_key": step["right_key"],
                            "coverage": step["coverage"],
                        }
                        for step in plan["steps"]
                    ],
                    "candidates": plan["candidates"][:25],
                    "columns": {name: [str(c) for c in frame.columns] for name, frame in cleaned.items()},
                }
                job.log("key_matching", "Low key coverage detected; waiting for confirmation.")
                job.request_confirmation(payload)
                answer = job.wait_for_confirmation()
                if answer.get("join_keys"):
                    current_overrides.update(answer["join_keys"])
                    plan = fusion.build_plan(cleaned, current_overrides)
                if answer.get("target"):
                    requested_target = answer["target"]
                job.start("key_matching")

            for step in plan["steps"]:
                job.log(
                    "key_matching",
                    f"{step['source']} joins on {step['left_key']} = {step['right_key']} "
                    f"(coverage {step['coverage'] * 100:.0f}%).",
                )
            job.log("key_matching", f"Chosen base table: {plan['base']}.")
            job.finish("key_matching")

            # ------------------------------------------------------- merging
            job.start("merging")
            fused, stats = fusion.fuse_sources(cleaned, plan, lambda message: job.log("merging", message))
            job.finish("merging")

        # ------------------------------------------------------- validation
        job.start("validation")
        if fused.empty:
            raise PipelineError("Fusion produced an empty dataset. Check the join keys.")
        duplicate_columns = fused.columns[fused.columns.duplicated()].tolist()
        if duplicate_columns:
            fused = fused.loc[:, ~fused.columns.duplicated()]
            job.log("validation", f"Removed duplicated column names: {duplicate_columns}")

        target_info = analysis.suggest_target(fused)
        if requested_target:
            if requested_target in fused.columns:
                task = analysis.infer_task(fused[requested_target])
                target_info = {
                    "column": requested_target,
                    "task": task,
                    "confidence": 1.0,
                    "reason": "Selected by the user",
                    "classes": [],
                    "missing_pct": round(float(fused[requested_target].isna().mean()) * 100, 1),
                }
            else:
                job.log("validation", f"The requested target '{requested_target}' is not in the fused data.")
        missing_cells = int(fused.isna().sum().sum())
        job.log(
            "validation",
            f"Validated {len(fused):,} rows × {fused.shape[1]} columns; "
            f"{missing_cells:,} cells remain empty after fusion.",
        )
        if target_info:
            job.log(
                "validation",
                f"Suggested target: {target_info['column']} ({target_info['task']}). You can override it before training.",
            )
        else:
            job.log("validation", "No obvious target column — choose one manually on the Train Models page.")
        fused.reset_index(drop=True).to_pickle(folder / "fused.pkl")
        fused.to_csv(folder / "processed" / "fused_dataset.csv", index=False)

        stats = {
            **stats,
            "remaining_missing": missing_cells,
            "protected_columns": sorted(protected_columns),
            "target_suggestion": target_info,
            "completed_at": datetime.now(timezone.utc).isoformat(),
            "source_files": [f["name"] for f in meta["files"]],
        }
        meta = load_meta(session_id)
        meta["status"] = "ready"
        meta["fusion"] = stats
        meta["job_id"] = job.id
        meta["name"] = " + ".join(f["name"] for f in meta["files"])
        save_meta(meta)
        job.log("validation", "Session unlocked: cleaning, fusion, EDA, modelling and reports are available.")
        job.finish("validation")
        job.finish_job(
            {
                "rows": int(len(fused)),
                "columns": int(fused.shape[1]),
                "target": target_info,
                "conflicts": stats.get("conflicts_total", 0),
                "fuzzy_matches": stats.get("fuzzy_total", 0),
                "sources": len(stats.get("sources_used", [])),
            }
        )
    except Exception as exc:  # noqa: BLE001 - surfaced to the UI
        message = str(exc) or exc.__class__.__name__
        current = next((s["key"] for s in job.stages if s["status"] == "running"), "validation")
        job.fail(current, message)
