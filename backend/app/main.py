"""DataFusion AI REST API."""
from __future__ import annotations

import asyncio
import hashlib
import json
import shutil
import threading
from pathlib import Path
from typing import Any, Literal

import pandas as pd
from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field

from . import ai_service, analysis, ingest, jobs, modeling, reporting
from .pipeline import run_pipeline
from .store import (
    DATA_DIR,
    create_session,
    delete_session,
    ensure_dirs,
    list_all_reports,
    list_sessions,
    latest_job_for_session,
    load_meta,
    save_meta,
    session_dir,
    now_iso,
)

ensure_dirs()

app = FastAPI(title="DataFusion AI API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class FuseRequest(BaseModel):
    session_id: str
    join_keys: dict[str, dict[str, str]] | None = None
    target: str | None = None


class ConfirmRequest(BaseModel):
    join_keys: dict[str, dict[str, str]] | None = None
    target: str | None = None


class TrainRequest(BaseModel):
    session_id: str
    target: str
    test_size: float = Field(default=0.25, ge=0.1, le=0.4)
    cv_folds: int = Field(default=5, ge=3, le=10)
    task: Literal["classification", "regression"] | None = None


class PredictRequest(BaseModel):
    session_id: str
    values: dict[str, Any]


class ReportRequest(BaseModel):
    session_id: str
class AIInsightsRequest(BaseModel):
    question: str | None = Field(
        default=None,
        max_length=1000,
        description="Optional question about the analysis results.",
    )

# --------------------------------------------------------------- helpers

def _public_file(file_info: dict[str, Any]) -> dict[str, Any]:
    keys = ("id", "name", "format", "size", "rows", "cols", "columns", "preview", "warnings", "source")
    return {key: file_info.get(key) for key in keys}


MAX_SESSION_FILES = 10


def _digest(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def _known_hashes(meta: dict[str, Any]) -> dict[str, str]:
    """sha256 → filename for every file already stored in this session."""
    folder = session_dir(meta["id"])
    hashes: dict[str, str] = {}
    for info in meta.get("files", []):
        digest = info.get("sha256")
        if not digest:
            try:
                digest = _digest((folder / info["path"]).read_bytes())
            except OSError:
                continue
            info["sha256"] = digest
        hashes[digest] = info.get("name") or info.get("id")
    return hashes


async def _read_uploads(files: list[UploadFile]) -> tuple[list[tuple[str, bytes, str]], list[dict[str, str]]]:
    """Validate a multipart batch; unsupported files are reported, not stored."""
    validated: list[tuple[str, bytes, str]] = []
    errors: list[dict[str, str]] = []
    for upload_file in files:
        filename = upload_file.filename or "unnamed"
        raw = await upload_file.read()
        try:
            fmt = ingest.validate_upload(filename, len(raw))
            validated.append((filename, raw, fmt))
        except ingest.IngestError as exc:
            errors.append({"file": filename, "message": str(exc)})
    return validated, errors


def _store_files(meta: dict[str, Any], validated: list[tuple[str, bytes, str]]) -> list[dict[str, Any]]:
    """Parse and persist new raw files for a session. Rolls back on failure."""
    folder = session_dir(meta["id"])
    (folder / "raw").mkdir(parents=True, exist_ok=True)
    existing = list(meta.get("files", []))
    used_sources = {info.get("source") for info in existing}
    taken_ids = {info.get("id") for info in existing}
    entries: list[dict[str, Any]] = []
    written: list[Path] = []
    start = len(existing)

    try:
        for offset, (filename, raw, fmt) in enumerate(validated):
            index = start + offset + 1
            base_id = f"{ingest.source_stem(filename)[:16]}-{index}"
            file_id = base_id
            suffix = 2
            while file_id in taken_ids:
                file_id = f"{base_id}-{suffix}"
                suffix += 1
            taken_ids.add(file_id)

            safe = ingest.safe_filename(filename)
            stored_name = f"{file_id}_{safe}"
            path = folder / "raw" / stored_name
            path.write_bytes(raw)
            written.append(path)

            frame = ingest.read_frame(path, filename)
            frame, warnings = ingest.prepare_frame(frame)

            source = ingest.source_stem(filename)
            base_source = source
            counter = 2
            while source in used_sources:
                source = f"{base_source}_{counter}"
                counter += 1
            used_sources.add(source)

            entries.append(
                {
                    "id": file_id,
                    "name": filename,
                    "path": f"raw/{stored_name}",
                    "source": source,
                    "size": len(raw),
                    "format": fmt,
                    "rows": int(len(frame)),
                    "cols": int(frame.shape[1]),
                    "columns": [str(c) for c in frame.columns],
                    "preview": ingest.preview_rows(frame),
                    "warnings": warnings,
                    "sha256": _digest(raw),
                }
            )
    except Exception:
        for path in written:
            path.unlink(missing_ok=True)
        raise
    return entries


def _clear_derived(meta: dict[str, Any]) -> None:
    """Drop fused data / model when the source set changes."""
    meta["fusion"] = None
    meta["model"] = None
    meta["status"] = "uploaded"
    meta["job_id"] = None
    folder = session_dir(meta["id"])
    (folder / "fused.pkl").unlink(missing_ok=True)
    shutil.rmtree(folder / "model", ignore_errors=True)


def _report_urls(session_id: str, report: dict[str, Any]) -> dict[str, str]:
    return {
        "pdf": f"/api/reports/{session_id}/{report['id']}/download?kind=pdf",
        "csv": f"/api/reports/{session_id}/{report['id']}/download?kind=csv",
        "xlsx": f"/api/reports/{session_id}/{report['id']}/download?kind=xlsx",
    }


def _target_info(meta: dict[str, Any]) -> dict[str, Any] | None:
    model = meta.get("model")
    if model and model.get("target"):
        return {
            "column": model["target"],
            "task": model.get("task", "classification"),
            "reason": "Target used by the trained model.",
            "confidence": 1.0,
        }
    return (meta.get("fusion") or {}).get("target_suggestion")


def _session_public(meta: dict[str, Any], include_files: bool = True) -> dict[str, Any]:
    fusion = meta.get("fusion") or {}
    model = meta.get("model") or {}
    reports = [
        {**report, "downloads": _report_urls(meta["id"], report)}
        for report in meta.get("reports", [])
    ]
    payload: dict[str, Any] = {
        "id": meta["id"],
        "name": meta.get("name"),
        "created_at": meta.get("created_at"),
        "updated_at": meta.get("updated_at"),
        "status": meta.get("status", "uploaded"),
        "file_count": len(meta.get("files", [])),
        "job_id": meta.get("job_id"),
        "files": [_public_file(file_info) for file_info in meta.get("files", [])] if include_files else [],
        "fusion": fusion,
        "target": _target_info(meta),
        "model": (
            {
                "task": model.get("task"),
                "target": model.get("target"),
                "best_model": model.get("best_model"),
                "best_metrics": model.get("best_metrics"),
                "reason": model.get("reason"),
                "trained_at": model.get("trained_at"),
                "schema": model.get("schema", []),
            }
            if model
            else None
        ),
        "has_model": bool(meta.get("model")),
        "reports": reports,
    }
    return analysis.json_safe(payload)


def _load_session(session_id: str) -> dict[str, Any]:
    try:
        return load_meta(session_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Session not found. It may have been deleted.") from exc


def _load_fused(session_id: str) -> pd.DataFrame:
    path = session_dir(session_id) / "fused.pkl"
    if not path.exists():
        raise HTTPException(status_code=409, detail="Fusion has not finished for this session yet.")
    return pd.read_pickle(path)


# ------------------------------------------------------------------ meta

@app.get("/api/health")
def health() -> dict[str, Any]:
    return {"status": "ok", "service": "DataFusion AI", "time": now_iso()}


@app.get("/api/history")
def history() -> list[dict[str, Any]]:
    items = []
    for meta in list_sessions():
        fusion = meta.get("fusion") or {}
        model = meta.get("model") or {}
        items.append(
            {
                "id": meta["id"],
                "name": meta.get("name"),
                "created_at": meta.get("created_at"),
                "status": meta.get("status", "uploaded"),
                "file_count": len(meta.get("files", [])),
                "rows": fusion.get("final_rows"),
                "features": fusion.get("final_columns"),
                "target": model.get("target") or (fusion.get("target_suggestion") or {}).get("column"),
                "best_model": model.get("best_model"),
                "reports": len(meta.get("reports", [])),
            }
        )
    return analysis.json_safe(items)


@app.get("/api/session/{session_id}")
def get_session(session_id: str) -> dict[str, Any]:
    return _session_public(_load_session(session_id))


@app.delete("/api/history/{session_id}")
def delete_history(session_id: str) -> dict[str, Any]:
    _load_session(session_id)
    delete_session(session_id)
    return {"deleted": True, "session_id": session_id}


# ---------------------------------------------------------------- upload

@app.post("/api/upload")
async def upload(files: list[UploadFile] = File(...)) -> dict[str, Any]:
    if not files:
        raise HTTPException(status_code=400, detail="Choose at least one file to upload.")
    if len(files) > MAX_SESSION_FILES:
        raise HTTPException(status_code=400, detail=f"Upload at most {MAX_SESSION_FILES} files in one session.")

    validated, errors = await _read_uploads(files)
    if errors:
        raise HTTPException(
            status_code=400,
            detail={"message": "Some files were rejected. Nothing was uploaded.", "errors": errors},
        )

    meta = create_session([], " + ".join(name for name, _, _ in validated))
    try:
        file_entries = _store_files(meta, validated)
        meta["files"] = file_entries
        meta["name"] = " + ".join(file_info["name"] for file_info in file_entries)
        save_meta(meta)
    except ingest.IngestError as exc:
        delete_session(meta["id"])
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        delete_session(meta["id"])
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {
        "session": _session_public(load_meta(meta["id"])),
        "files": [_public_file(file_info) for file_info in file_entries],
        "warning": "One file is enough for cleaning and analysis, but fusion needs at least two sources."
        if len(file_entries) == 1
        else None,
    }


@app.post("/api/session/{session_id}/files")
async def add_files(session_id: str, files: list[UploadFile] = File(...)) -> dict[str, Any]:
    """Add more sources to an existing session without dropping the earlier ones."""
    meta = _load_session(session_id)
    if not files:
        raise HTTPException(status_code=400, detail="Choose at least one file to add.")
    if meta.get("status") == "fusing":
        raise HTTPException(
            status_code=409,
            detail="Fusion is still running for this session. Wait for it to finish, then add files.",
        )

    existing = list(meta.get("files", []))
    if len(existing) + len(files) > MAX_SESSION_FILES:
        raise HTTPException(
            status_code=400,
            detail=(
                f"This session already holds {len(existing)} file(s). "
                f"A session accepts at most {MAX_SESSION_FILES} sources."
            ),
        )

    validated, errors = await _read_uploads(files)
    seen = _known_hashes(meta)
    accepted: list[tuple[str, bytes, str]] = []
    for filename, raw, fmt in validated:
        digest = _digest(raw)
        if digest in seen:
            errors.append(
                {"file": filename, "message": f"Already uploaded in this session as “{seen[digest]}”."}
            )
            continue
        seen[digest] = filename
        accepted.append((filename, raw, fmt))

    if errors:
        save_meta(meta)  # keep any freshly computed hashes
        raise HTTPException(
            status_code=400,
            detail={"message": "Some files were rejected. Nothing was added.", "errors": errors},
        )

    was_ready = meta.get("status") == "ready" or bool(meta.get("fusion"))
    try:
        entries = _store_files(meta, accepted)
    except ingest.IngestError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    meta["files"] = existing + entries
    meta["name"] = " + ".join(file_info["name"] for file_info in meta["files"])
    if was_ready:
        _clear_derived(meta)
    save_meta(meta)

    warnings: list[str] = []
    if was_ready:
        warnings.append("New sources were added, so the previous fusion and model were reset. Run Start Fusion again.")
    if len(meta["files"]) == 1:
        warnings.append("One file is enough for cleaning and analysis, but fusion needs at least two sources.")

    return {
        "session": _session_public(load_meta(meta["id"])),
        "files": [_public_file(file_info) for file_info in entries],
        "warning": " ".join(warnings) or None,
    }


@app.get("/api/files/{session_id}/preview")
def file_preview(session_id: str, file_id: str = Query(...)) -> dict[str, Any]:
    meta = _load_session(session_id)
    file_info = next((f for f in meta["files"] if f["id"] == file_id), None)
    if not file_info:
        raise HTTPException(status_code=404, detail="That file is not part of this session.")
    return analysis.json_safe(
        {
            "file": _public_file(file_info),
            "preview": file_info.get("preview", []),
            "columns": file_info.get("columns", []),
        }
    )


@app.delete("/api/session/{session_id}/files/{file_id}")
def remove_file(session_id: str, file_id: str) -> dict[str, Any]:
    meta = _load_session(session_id)
    file_info = next((f for f in meta["files"] if f["id"] == file_id), None)
    if not file_info:
        raise HTTPException(status_code=404, detail="That file is not part of this session.")
    path = session_dir(session_id) / file_info["path"]
    path.unlink(missing_ok=True)
    meta["files"] = [f for f in meta["files"] if f["id"] != file_id]
    meta["fusion"] = None
    meta["model"] = None
    meta["status"] = "uploaded"
    meta["name"] = " + ".join(f["name"] for f in meta["files"]) or "Empty session"
    for stale in ("fused.pkl",):
        (session_dir(session_id) / stale).unlink(missing_ok=True)
    shutil.rmtree(session_dir(session_id) / "model", ignore_errors=True)
    save_meta(meta)
    return {"session": _session_public(meta), "files": [_public_file(f) for f in meta["files"]]}


# ----------------------------------------------------------------- fusion

@app.post("/api/fuse")
def start_fusion(payload: FuseRequest) -> dict[str, Any]:
    meta = _load_session(payload.session_id)
    if not meta.get("files"):
        raise HTTPException(status_code=400, detail="Upload at least one dataset before fusing.")
    existing = latest_job_for_session(meta["id"])
    if existing and existing.get("state") in ("running", "awaiting_confirmation"):
        return {"job_id": existing["id"], "state": existing["state"], "resumed": True}

    options = {"join_keys": payload.join_keys or {}, "target": payload.target}
    job = jobs.FusionJob(meta["id"], options=options)
    jobs.register(job)
    meta["status"] = "fusing"
    meta["job_id"] = job.id
    save_meta(meta)
    thread = threading.Thread(
        target=run_pipeline, args=(job, meta["id"], options), daemon=True, name=f"fusion-{job.id}"
    )
    thread.start()
    return {"job_id": job.id, "state": job.state, "progress": job.progress}


@app.get("/api/fuse/{job_id}/status")
def job_status(job_id: str) -> dict[str, Any]:
    snapshot = jobs.snapshot(job_id)
    if snapshot is None:
        raise HTTPException(status_code=404, detail="Fusion job not found.")
    snapshot["live"] = jobs.is_live(job_id)
    return analysis.json_safe(snapshot)


@app.get("/api/fuse/{job_id}/stream")
async def job_stream(job_id: str) -> StreamingResponse:
    if jobs.snapshot(job_id) is None:
        raise HTTPException(status_code=404, detail="Fusion job not found.")

    async def generator():
        while True:
            snapshot = jobs.snapshot(job_id)
            if snapshot is None:
                yield "event: error\ndata: {\"error\": \"job missing\"}\n\n"
                break
            snapshot["live"] = jobs.is_live(job_id)
            yield f"data: {json.dumps(analysis.json_safe(snapshot))}\n\n"
            if snapshot["state"] in ("done", "error"):
                break
            await asyncio.sleep(1.0)

    return StreamingResponse(
        generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/api/fuse/{job_id}/confirm")
def confirm_keys(job_id: str, payload: ConfirmRequest) -> dict[str, Any]:
    if not jobs.is_live(job_id):
        raise HTTPException(status_code=409, detail="This job is no longer running. Start fusion again.")
    job = jobs.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Fusion job not found.")
    if job.state != "awaiting_confirmation":
        raise HTTPException(status_code=409, detail="This job is not waiting for confirmation.")
    job.confirm({"join_keys": payload.join_keys or {}, "target": payload.target})
    return {"ok": True, "state": job.state}


# --------------------------------------------------------------- workspace

@app.get("/api/session/{session_id}/clean")
def clean_data(session_id: str) -> dict[str, Any]:
    meta = _load_session(session_id)
    reports = meta.get("clean")
    if not reports:
        raise HTTPException(status_code=409, detail="Cleaning has not run yet. Finish fusion first.")
    return analysis.json_safe(
        {
            "session_id": session_id,
            "reports": reports,
            "downloads": {
                report["source"]: f"/api/session/{session_id}/clean/{file_info['id']}/download"
                for report in reports
                for file_info in meta["files"]
                if file_info["source"] == report["source"]
            },
            "totals": {
                "rows_before": sum(r["before"]["rows"] for r in reports),
                "rows_after": sum(r["after"]["rows"] for r in reports),
                "duplicates_removed": sum(r["duplicates_removed"] for r in reports),
                "missing_filled": sum(r["missing_filled"] for r in reports),
                "outlier_columns": sum(len(r["outliers"]) for r in reports),
                "numeric_fixed": sum(len(r["numeric_converted"]) for r in reports),
                "dates_fixed": sum(len(r["dates_parsed"]) for r in reports),
            },
        }
    )


@app.get("/api/session/{session_id}/clean/{file_id}/download")
def download_clean(session_id: str, file_id: str) -> FileResponse:
    meta = _load_session(session_id)
    file_info = next((f for f in meta["files"] if f["id"] == file_id), None)
    if not file_info:
        raise HTTPException(status_code=404, detail="Source file not found.")
    path = session_dir(session_id) / "processed" / f"{file_info['source']}_clean.csv"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Cleaned file is not available yet.")
    return FileResponse(path, media_type="text/csv", filename=f"{file_info['source']}_cleaned.csv")


@app.get("/api/session/{session_id}/combine")
def combine_data(
    session_id: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=5, le=200),
    search: str = "",
    sort: str | None = None,
    direction: str = Query("asc", pattern="^(asc|desc)$"),
) -> dict[str, Any]:
    meta = _load_session(session_id)
    stats = meta.get("fusion")
    if not stats:
        raise HTTPException(status_code=409, detail="Fusion has not finished for this session.")
    fused = _load_fused(session_id)
    table = analysis.paginate(fused, page, page_size, search, sort, direction)
    return analysis.json_safe(
        {
            "stats": stats,
            "table": table,
            "target": _target_info(meta),
            "download": f"/api/session/{session_id}/fused/download",
        }
    )


@app.get("/api/session/{session_id}/fused/download")
def download_fused(session_id: str) -> FileResponse:
    _load_session(session_id)
    path = session_dir(session_id) / "processed" / "fused_dataset.csv"
    if not path.exists():
        raise HTTPException(status_code=409, detail="Fused dataset is not ready yet.")
    return FileResponse(path, media_type="text/csv", filename="fused_dataset.csv")


@app.get("/api/session/{session_id}/analyse")
def analyse_data(session_id: str) -> dict[str, Any]:
    meta = _load_session(session_id)
    fused = _load_fused(session_id)
    target = _target_info(meta)
    result = analysis.analyse_frame(fused, target)
    meta["insights"] = result["insights"]
    save_meta(meta)
    return analysis.json_safe(result)
@app.post("/api/session/{session_id}/ai-insights")
def generate_ai_insights(
    session_id: str,
    payload: AIInsightsRequest,
) -> dict[str, Any]:

    meta = _load_session(session_id)
    fused = _load_fused(session_id)

    target = _target_info(meta)

    # Use actual computed analysis results.
    analysis_result = analysis.analyse_frame(fused, target)

    # Send aggregate analysis information, not the raw dataset.
    context = {
        "analysis": analysis.json_safe(analysis_result),
        "model": meta.get("model"),
    }

    prompt = (
        "Analyze the following computed data analysis results.\n"
        "Explain important patterns, data quality issues, "
        "correlations, and practical recommendations.\n"
        "Do not invent statistics or claim that a prediction "
        "was made unless the supplied results confirm it.\n\n"
        f"Computed results:\n"
        f"{json.dumps(context, default=str)[:12000]}"
    )

    if payload.question:
        prompt += f"\n\nUser question: {payload.question}"

    try:
        result = ai_service.generate_text(
            prompt=prompt,
            system_prompt=(
                "You are DataFusion AI, an expert data analysis assistant. "
                "Explain computed results accurately and clearly. "
                "Never invent statistics."
            ),
        )

    except RuntimeError as exc:
        raise HTTPException(
            status_code=502,
            detail=str(exc),
        ) from exc

    meta["ai_insights"] = {
        "response": result["response"],
        "provider": result["provider"],
        "model": result["model"],
        "input_tokens": result["input_tokens"],
        "output_tokens": result["output_tokens"],
        "fallback_used": result["fallback_used"],
        "generated_at": now_iso(),
    }

    save_meta(meta)

    return analysis.json_safe(meta["ai_insights"])
@app.get("/api/ai/usage")
def ai_usage_summary() -> dict[str, Any]:
    return ai_service.get_usage_summary()


@app.get("/api/ai/history")
def ai_usage_history(
    limit: int = Query(default=100, ge=1, le=1000)
) -> dict[str, Any]:
    return {"records": ai_service.get_usage_history(limit)}


@app.get("/api/ai/providers")
def ai_provider_status() -> dict[str, Any]:
    return ai_service.get_provider_status()

@app.get("/api/session/{session_id}/charts")
def chart_data(session_id: str) -> dict[str, Any]:
    meta = _load_session(session_id)
    fused = _load_fused(session_id)
    target = _target_info(meta)
    return analysis.json_safe(analysis.build_charts(fused, target, meta.get("model")))


# -------------------------------------------------------------------- ML

@app.post("/api/train")
def train(payload: TrainRequest) -> dict[str, Any]:
    meta = _load_session(payload.session_id)
    fused = _load_fused(payload.session_id)
    if payload.target not in fused.columns:
        raise HTTPException(status_code=400, detail=f"'{payload.target}' is not a column in the fused dataset.")
    try:
        result = modeling.train_models(
            fused, payload.target, payload.test_size, payload.cv_folds, payload.task
        )
    except modeling.ModelingError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Training failed: {exc}") from exc

    evaluation = result["evaluation"]
    modeling.save_model(payload.session_id, result["bundle"], evaluation)
    model_meta = {
        "task": evaluation["task"],
        "target": evaluation["target"],
        "best_model": evaluation["best_model"],
        "best_metrics": evaluation["best_metrics"],
        "metrics_table": evaluation["metrics_table"],
        "reason": evaluation["reason"],
        "trained_at": evaluation["trained_at"],
        "features": evaluation["features"],
        "cv_folds": evaluation["cv_folds"],
        "test_size": evaluation["test_size"],
        "n_train": evaluation["n_train"],
        "n_test": evaluation["n_test"],
        "evaluation": evaluation,
        "confusion_matrix": evaluation.get("confusion_matrix"),
        "feature_importance": evaluation.get("feature_importance"),
        "schema": modeling.predict_schema(fused, payload.target),
    }
    meta["model"] = analysis.json_safe(model_meta)
    save_meta(meta)
    return analysis.json_safe({"model": meta["model"]})


@app.get("/api/session/{session_id}/model")
def get_model(session_id: str) -> dict[str, Any]:
    meta = _load_session(session_id)
    if not meta.get("model"):
        raise HTTPException(status_code=404, detail="No model has been trained for this session yet.")
    return analysis.json_safe({"model": meta["model"]})


@app.post("/api/predict")
def predict(payload: PredictRequest) -> dict[str, Any]:
    meta = _load_session(payload.session_id)
    if not meta.get("model"):
        raise HTTPException(status_code=409, detail="Train a model before making predictions.")
    try:
        bundle = modeling.load_bundle(payload.session_id)
        result = modeling.predict_rows(bundle, [payload.values])
    except (modeling.ModelingError, Exception) as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return analysis.json_safe(result)


@app.post("/api/predict/batch")
async def predict_batch(session_id: str = Query(...), file: UploadFile = File(...)) -> dict[str, Any]:
    meta = _load_session(session_id)
    if not meta.get("model"):
        raise HTTPException(status_code=409, detail="Train a model before making predictions.")
    filename = file.filename or "batch.csv"
    if Path(filename).suffix.lower() not in (".csv", ".tsv"):
        raise HTTPException(status_code=400, detail="Batch predictions accept a CSV or TSV file.")
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="The batch file is empty.")
    try:
        frame = ingest.read_frame_bytes(raw, filename)
        bundle = modeling.load_bundle(session_id)
        missing = [feature for feature in bundle["features"] if feature not in frame.columns]
        if missing:
            raise HTTPException(
                status_code=400,
                detail=f"The batch file is missing required feature column(s): {', '.join(missing)}",
            )
        if len(frame) > 5000:
            raise HTTPException(status_code=400, detail="Batch prediction is limited to 5,000 rows.")
        records = frame.to_dict(orient="records")
        result = modeling.predict_rows(bundle, records)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Batch prediction failed: {exc}") from exc

    output = frame.copy()
    output["prediction"] = [row["prediction"] for row in result["predictions"]]
    if result["task"] == "classification":
        output["confidence"] = [row.get("confidence") for row in result["predictions"]]
        classes = sorted({key for row in result["predictions"] for key in (row.get("probabilities") or {})})
        for label in classes:
            output[f"probability_{label}"] = [
                (row.get("probabilities") or {}).get(label) for row in result["predictions"]
            ]
    folder = session_dir(session_id) / "predictions"
    folder.mkdir(exist_ok=True)
    out_name = f"predictions_{now_iso().replace(':', '-')[:19]}.csv"
    out_path = folder / out_name
    output.to_csv(out_path, index=False)
    return analysis.json_safe(
        {
            **result,
            "total": int(len(output)),
            "preview": output.head(200).to_dict(orient="records"),
            "download": f"/api/session/{session_id}/predictions/{out_name}/download",
        }
    )


@app.get("/api/session/{session_id}/predictions/{filename}/download")
def download_predictions(session_id: str, filename: str) -> FileResponse:
    _load_session(session_id)
    path = (session_dir(session_id) / "predictions" / Path(filename).name).resolve()
    allowed = (session_dir(session_id) / "predictions").resolve()
    if not str(path).startswith(str(allowed)) or not path.exists():
        raise HTTPException(status_code=404, detail="Prediction file not found.")
    return FileResponse(path, media_type="text/csv", filename="predictions.csv")


# --------------------------------------------------------------- reports

@app.post("/api/report")
def create_report(payload: ReportRequest) -> dict[str, Any]:
    meta = _load_session(payload.session_id)
    try:
        report = reporting.generate_report(payload.session_id)
    except reporting.ReportError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Report generation failed: {exc}") from exc
    return analysis.json_safe({**report, "downloads": _report_urls(payload.session_id, report)})


@app.get("/api/reports")
def reports() -> list[dict[str, Any]]:
    items = []
    for report in list_all_reports():
        items.append(
            {
                **report,
                "downloads": _report_urls(report["session_id"], report),
            }
        )
    return analysis.json_safe(items)


@app.get("/api/reports/{session_id}/{report_id}/download")
def download_report(session_id: str, report_id: str, kind: str = Query("pdf", pattern="^(pdf|csv|xlsx)$")) -> FileResponse:
    meta = _load_session(session_id)
    report = next((r for r in meta.get("reports", []) if r["id"] == report_id), None)
    if not report:
        raise HTTPException(status_code=404, detail="Report not found.")
    relative = (report.get("files") or {}).get(kind)
    if not relative:
        raise HTTPException(status_code=404, detail="That report format is not available.")
    path = (session_dir(session_id) / relative).resolve()
    base = session_dir(session_id).resolve()
    if not str(path).startswith(str(base)) or not path.exists():
        raise HTTPException(status_code=404, detail="Report file is missing on disk.")
    media = {
        "pdf": "application/pdf",
        "csv": "text/csv",
        "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }[kind]
    return FileResponse(path, media_type=media, filename=path.name)


@app.get("/")
def root() -> dict[str, Any]:
    return {
        "name": "DataFusion AI API",
        "docs": "/docs",
        "data_dir": str(DATA_DIR),
        "endpoints": ["/api/upload", "/api/fuse", "/api/session/{id}/combine", "/api/train", "/api/report"],
    }
