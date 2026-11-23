"""Multi-source fusion: key detection, fuzzy linking and reconciliation."""
from __future__ import annotations

from typing import Any, Callable

import numpy as np
import pandas as pd
from rapidfuzz import fuzz, process, utils as fuzz_utils

from .utils import json_safe, snake_case

LogFn = Callable[[str], None]

FUZZY_THRESHOLD = 88
NUMERIC_SUM_HINT = ("count", "qty", "quantity", "pages", "visits", "sessions", "orders", "units")
ID_LIKE = ("id", "uuid", "key", "code")


class KeyPlanningError(ValueError):
    def __init__(self, message: str, details: dict[str, Any] | None = None):
        super().__init__(message)
        self.details = details or {}


def key_token(value: Any) -> str | None:
    """Canonical comparison token so 1, 1.0 and ' 1 ' match the same key."""
    if value is None or value is pd.NaT:
        return None
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    if isinstance(value, (int, np.integer)):
        return str(int(value))
    if isinstance(value, (float, np.floating)):
        number = float(value)
        if not np.isfinite(number):
            return None
        return str(int(number)) if number.is_integer() else f"{number:.10g}"
    text = str(value).strip()
    if not text or text.lower() in {"nan", "none", "null", "na"}:
        return None
    try:
        number = float(text.replace(",", ""))
        if number.is_integer():
            return str(int(number))
        return f"{number:.10g}"
    except ValueError:
        return text.lower()


def _unique_tokens(series: pd.Series, cap: int = 30000) -> set[str]:
    tokens = {key_token(v) for v in series.tolist()}
    tokens.discard(None)
    if len(tokens) > cap:
        tokens = set(sorted(tokens)[:cap])
    return tokens


def _is_id_like(name: str) -> bool:
    normalized = snake_case(name)
    return any(normalized == part or normalized.endswith("_" + part) for part in ID_LIKE)


def _source_freshness(frame: pd.DataFrame) -> pd.Timestamp | None:
    best: pd.Timestamp | None = None
    for col in frame.columns:
        if pd.api.types.is_datetime64_any_dtype(frame[col]):
            value = frame[col].max()
            if pd.notna(value) and (best is None or value > best):
                best = value
    return best


def detect_candidates(frames: dict[str, pd.DataFrame]) -> list[dict[str, Any]]:
    """Compare every column pair across sources and keep plausible join keys."""
    candidates: list[dict[str, Any]] = []
    names = list(frames)
    for i, left_name in enumerate(names):
        for right_name in names[i + 1 :]:
            left, right = frames[left_name], frames[right_name]
            for lcol in left.columns:
                if pd.api.types.is_datetime64_any_dtype(left[lcol]):
                    continue
                lset = _unique_tokens(left[lcol])
                if len(lset) < 2:
                    continue
                for rcol in right.columns:
                    if pd.api.types.is_datetime64_any_dtype(right[rcol]):
                        continue
                    name_sim = fuzz.ratio(snake_case(lcol), snake_case(rcol)) / 100
                    exact_name = snake_case(lcol) == snake_case(rcol)
                    if name_sim < 0.82 and not exact_name:
                        continue
                    rset = _unique_tokens(right[rcol])
                    if len(rset) < 2:
                        continue
                    overlap = len(lset & rset)
                    if overlap < 2:
                        continue
                    lcov, rcov = overlap / len(lset), overlap / len(rset)
                    if min(lcov, rcov) < 0.2:
                        continue
                    luniq = 1 - float(left[lcol].duplicated().mean())
                    runiq = 1 - float(right[rcol].duplicated().mean())
                    id_bonus = 1.15 if (_is_id_like(str(lcol)) or _is_id_like(str(rcol))) else 1.0
                    score = ((lcov + rcov) / 2) * (0.55 + 0.45 * max(luniq, runiq)) * (0.75 + 0.25 * name_sim) * id_bonus
                    candidates.append(
                        {
                            "left_source": left_name,
                            "left_column": str(lcol),
                            "right_source": right_name,
                            "right_column": str(rcol),
                            "overlap": int(overlap),
                            "left_coverage": round(lcov, 4),
                            "right_coverage": round(rcov, 4),
                            "left_unique": round(luniq, 3),
                            "right_unique": round(runiq, 3),
                            "name_similarity": round(name_sim, 3),
                            "score": round(score, 4),
                        }
                    )
    return sorted(candidates, key=lambda c: c["score"], reverse=True)


def build_plan(
    frames: dict[str, pd.DataFrame],
    overrides: dict[str, dict[str, str]] | None = None,
) -> dict[str, Any]:
    """Decide a merge order, one join key per source.

    Raises KeyPlanningError when a source cannot be linked, so the UI can
    pause the job and ask the user to pick the key manually.
    """
    if len(frames) < 1:
        raise KeyPlanningError("No cleaned sources are available.")
    overrides = overrides or {}
    candidates = detect_candidates(frames)
    # The richest table (most columns, then most rows) becomes the base so
    # detail columns are preserved rather than aggregated into prefixed ones.
    base = max(frames, key=lambda k: (frames[k].shape[1], len(frames[k])))
    merged_sources = [base]
    remaining = [name for name in frames if name != base]
    steps: list[dict[str, Any]] = []

    while remaining:
        best: dict[str, Any] | None = None
        for source in remaining:
            manual = overrides.get(source)
            if manual:
                left_key = manual.get("left")
                right_key = manual.get("right") or left_key
                if left_key in frames[base].columns or any(left_key in frames[m].columns for m in merged_sources):
                    if right_key in frames[source].columns:
                        manual_candidate = {
                            "left_source": next(m for m in merged_sources if left_key in frames[m].columns),
                            "left_column": left_key,
                            "right_source": source,
                            "right_column": right_key,
                            "overlap": 0,
                            "left_coverage": 1.0,
                            "right_coverage": 1.0,
                            "score": 99.0,
                            "manual": True,
                        }
                        if best is None or manual_candidate["score"] > best["score"]:
                            best = manual_candidate
                        continue
            for candidate in candidates:
                pair = {candidate["left_source"], candidate["right_source"]}
                if source not in pair:
                    continue
                other = candidate["right_source"] if candidate["left_source"] == source else candidate["left_source"]
                if other not in merged_sources:
                    continue
                if best is None or candidate["score"] > best["score"]:
                    best = candidate

        if best is None:
            available = {
                source: {
                    "columns": [str(c) for c in frames[source].columns[:40]],
                    "merged_columns": sorted({str(c) for m in merged_sources for c in frames[m].columns}),
                }
                for source in remaining
            }
            raise KeyPlanningError(
                "No shared key could be detected for " + ", ".join(remaining) + ".",
                {"sources": available, "candidates": candidates[:25]},
            )

        source = best["right_source"] if best["left_source"] in merged_sources else best["left_source"]
        if source not in remaining:  # candidate points at the merged side
            source = best["left_source"] if best["right_source"] in merged_sources else source
        if source not in remaining:
            raise KeyPlanningError("Could not order the sources for merging.")
        left_key = best["left_column"] if best["left_source"] in merged_sources else best["right_column"]
        right_key = best["right_column"] if best["right_source"] == source else best["left_column"]
        steps.append(
            {
                "source": source,
                "left_key": left_key,
                "right_key": right_key,
                "candidate": best,
                "coverage": round(float(best.get("right_coverage", 0)), 3),
            }
        )
        remaining.remove(source)
        merged_sources.append(source)

    ambiguous = False
    weak = [step["source"] for step in steps if not step["candidate"].get("manual") and step["coverage"] < 0.4]
    if weak:
        ambiguous = True
    return {
        "base": base,
        "steps": steps,
        "candidates": candidates,
        "ambiguous": ambiguous,
        "weak_sources": weak,
        "overrides": overrides,
    }


def _aggregate_to_key(frame: pd.DataFrame, key: str, stem: str, log: LogFn) -> tuple[pd.DataFrame, int, int]:
    """Collapse a many-rows-per-key source before joining to avoid row explosion."""
    working = frame.copy()
    working["__join_key"] = working[key].map(key_token)
    working = working[working["__join_key"].notna()]
    source_rows = len(working)
    grouped = working.groupby("__join_key", dropna=False, sort=False)
    output = pd.DataFrame(index=grouped.size().index)
    output.index.name = "__join_key"
    dropped_cols: list[str] = []
    for col in working.columns:
        if col in (key, "__join_key"):
            continue
        series = working[col]
        lowered = str(col).lower()
        if pd.api.types.is_numeric_dtype(series) and not pd.api.types.is_bool_dtype(series):
            agg = "sum" if any(word in lowered for word in NUMERIC_SUM_HINT) else "mean"
            values = grouped[col].agg(agg)
            output[f"{stem}_{col}_{agg}"] = values
        elif pd.api.types.is_datetime64_any_dtype(series):
            output[f"{stem}_{col}_latest"] = grouped[col].max()
        elif series.astype(str).nunique() / max(1, len(series)) > 0.5:
            dropped_cols.append(str(col))
        else:
            values = grouped[col].agg(lambda s: s.mode().iloc[0] if not s.mode().empty else None)
            output[f"{stem}_{col}_mode"] = values
    output = output.reset_index()
    if dropped_cols:
        log(
            f"Dropped per-session identifiers before aggregation ({', '.join(dropped_cols[:4])})."
        )
    log(
        f"Aggregated {source_rows} {stem} rows into {len(output)} per-key rows "
        f"(sum for counts, mean for measures, mode for categories, latest date)."
    )
    return output, source_rows, len(output)


def _prefer_majority(values: list[Any]) -> tuple[Any, str] | None:
    cleaned = [v for v in values if v is not None and not (isinstance(v, float) and np.isnan(v))]
    if len(cleaned) < 3:
        return None
    counts: dict[str, tuple[Any, int]] = {}
    for value in cleaned:
        token = str(value).strip().lower()
        if token in counts:
            counts[token] = (counts[token][0], counts[token][1] + 1)
        else:
            counts[token] = (value, 1)
    ordered = sorted(counts.values(), key=lambda t: t[1], reverse=True)
    if len(ordered) >= 2 and ordered[0][1] >= 2 and ordered[0][1] > ordered[1][1]:
        return ordered[0][0], f"majority ({ordered[0][1]} of {len(cleaned)} sources)"
    return None


def _fill_from_fuzzy(
    merged: pd.DataFrame,
    right: pd.DataFrame,
    right_key: str,
    stem: str,
    unmatched_mask: pd.Series,
    source_columns: list[str],
    log: LogFn,
) -> tuple[pd.DataFrame, int, list[str]]:
    left_name_col = next(
        (c for c in ("customer_name", "full_name", "name", "contact_name") if c in merged.columns),
        None,
    )
    right_name_col = next(
        (c for c in ("name", "customer_name", "full_name", "contact_name") if c in right.columns),
        None,
    )
    if not left_name_col or not right_name_col:
        return merged, 0, []
    pool_columns = [right_name_col] + [
        column for column in dict.fromkeys(source_columns) if column != right_name_col
    ]
    pool = (
        right[pool_columns]
        .dropna(subset=[right_name_col])
        .drop_duplicates(subset=[right_name_col])
    )
    if pool.empty:
        return merged, 0, []
    choices = pool[right_name_col].astype(str).tolist()
    matches = 0
    examples: list[str] = []
    for idx in merged.index[unmatched_mask]:
        query = merged.at[idx, left_name_col]
        if pd.isna(query) or not str(query).strip():
            continue
        result = process.extractOne(
            str(query),
            choices,
            scorer=fuzz.token_sort_ratio,
            score_cutoff=FUZZY_THRESHOLD,
            processor=fuzz_utils.default_process,
        )
        if not result:
            continue
        _, score, position = result
        row = pool.iloc[position]
        for col in source_columns:
            target_col = col if col in merged.columns else f"{col}__{stem}"
            if target_col not in merged.columns or col == right_key:
                continue
            if pd.isna(merged.at[idx, target_col]) and pd.notna(row[col]):
                merged.at[idx, target_col] = row[col]
        matches += 1
        if len(examples) < 3:
            examples.append(f"'{query}' ≈ '{row[right_name_col]}' ({int(score)})")
    if matches:
        log(
            f"Fuzzy-matched {matches} unmatched rows on their name column "
            f"(token-sort ratio ≥ {FUZZY_THRESHOLD}); e.g. " + "; ".join(examples)
        )
    return merged, matches, examples


def fuse_sources(
    frames: dict[str, pd.DataFrame],
    plan: dict[str, Any],
    log: LogFn,
) -> tuple[pd.DataFrame, dict[str, Any]]:
    base_name = plan["base"]
    merged = frames[base_name].copy().reset_index(drop=True)
    merged_sources = [base_name]
    merged_freshness = _source_freshness(frames[base_name])
    stats: dict[str, Any] = {
        "base_source": base_name,
        "steps": [],
        "join_keys": [],
        "conflicts_total": 0,
        "fuzzy_total": 0,
        "duplicates_removed": 0,
    }
    log(f"Base table: {base_name} ({len(merged)} rows, {merged.shape[1]} columns).")

    for step in plan["steps"]:
        source = step["source"]
        right_original = frames[source].copy()
        stem = snake_case(source)
        left_key, right_key = step["left_key"], step["right_key"]
        if left_key not in merged.columns:
            raise KeyPlanningError(f"Join column '{left_key}' is missing from the merged table.")
        if right_key not in right_original.columns:
            raise KeyPlanningError(f"Join column '{right_key}' is missing from {source}.")
        rows_before = len(merged)
        log(f"Joining {source} on {base_name}.{left_key} = {source}.{right_key}.")

        right = right_original.copy()
        right["__join_key"] = right[right_key].map(key_token)
        right_freshness = _source_freshness(right_original)
        duplicates_in_key = bool(right["__join_key"].duplicated().dropna().any())
        aggregated_from = None
        aggregated_to = None
        skipped_name_columns: list[str] = []

        if duplicates_in_key:
            right, aggregated_from, aggregated_to = _aggregate_to_key(right_original, right_key, stem, log)
        else:
            right = right.drop(columns=[right_key], errors="ignore")
            right = right[right["__join_key"].notna()]

        merged["__join_key"] = merged[left_key].map(key_token)
        overlap_cols = [
            c for c in right.columns if c != "__join_key" and c in merged.columns and c != left_key
        ]
        indicator = "__merge_" + stem
        merged = merged.merge(
            right,
            on="__join_key",
            how="left",
            suffixes=("", f"__{stem}"),
            indicator=indicator,
        )

        exact_matches = int((merged[indicator] == "both").sum())
        unmatched = int((merged[indicator] == "left_only").sum())
        match_rate = round(100 * exact_matches / max(1, rows_before), 1)
        log(
            f"Matched {exact_matches} of {rows_before} rows ({match_rate}%) exactly; "
            f"{unmatched} unmatched."
        )

        # Conflict resolution for columns that exist on both sides.
        conflicts: list[dict[str, Any]] = []
        for col in overlap_cols:
            alt = f"{col}__{stem}"
            if alt not in merged.columns:
                continue
            left_values = merged[col]
            right_values = merged[alt]
            both = left_values.notna() & right_values.notna()
            differing = both & (left_values.astype(str) != right_values.astype(str))
            count = int(differing.sum())
            resolved = left_values.where(left_values.notna(), right_values)
            if count:
                alt_cols = [c for c in merged.columns if c.startswith(f"{col}__")]
                for idx in merged.index[differing]:
                    candidates_values = [merged.at[idx, col]] + [
                        merged.at[idx, c] for c in alt_cols if c in merged.columns
                    ]
                    picked = _prefer_majority(candidates_values)
                    if picked is not None:
                        value, rule = picked
                    elif right_freshness is not None and (
                        merged_freshness is None or right_freshness > merged_freshness
                    ):
                        value, rule = right_values.at[idx], "fresher source"
                    else:
                        value, rule = left_values.at[idx], "primary/fresher source"
                    resolved.at[idx] = value
                examples = []
                for idx in merged.index[differing][:3]:
                    examples.append(
                        {
                            "left": json_safe(left_values.at[idx]),
                            "right": json_safe(right_values.at[idx]),
                            "kept": json_safe(resolved.at[idx]),
                        }
                    )
                conflicts.append(
                    {
                        "column": str(col),
                        "rows": count,
                        "rule": "non-null → most recent source → majority value",
                        "examples": examples,
                    }
                )
                stats["conflicts_total"] += count
                log(
                    f"Resolved {count} conflicting '{col}' value(s) using non-null → recent → majority; "
                    f"alternate values kept in {alt}."
                )
            merged[col] = resolved
            if not count:
                merged = merged.drop(columns=[alt], errors="ignore")

        # Similarity-based fill for rows the exact key could not reach.
        fuzzy_mask = merged[indicator].ne("both") | merged[indicator].isna()
        source_columns = [c for c in right_original.columns if c != right_key]
        merged, fuzzy_matches, fuzzy_examples = _fill_from_fuzzy(
            merged, right_original, right_key, stem, fuzzy_mask, source_columns, log
        )
        stats["fuzzy_total"] += fuzzy_matches

        merged = merged.drop(columns=[indicator, "__join_key"], errors="ignore")
        if right_freshness is not None and (merged_freshness is None or right_freshness > merged_freshness):
            merged_freshness = right_freshness
        merged_sources.append(source)

        step_stats = {
            "source": source,
            "left_source": base_name,
            "left_key": str(left_key),
            "right_key": str(right_key),
            "rows_before": rows_before,
            "rows_after": int(len(merged)),
            "exact_matches": exact_matches,
            "fuzzy_matches": int(fuzzy_matches),
            "fuzzy_examples": fuzzy_examples,
            "unmatched": unmatched,
            "match_rate": match_rate,
            "aggregated_from": aggregated_from,
            "aggregated_to": aggregated_to,
            "conflicts": conflicts,
            "columns_added": len([c for c in merged.columns if c not in frames[base_name].columns]),
        }
        stats["steps"].append(step_stats)
        stats["join_keys"].append(
            {"source": source, "left": f"{base_name}.{left_key}", "right": f"{source}.{right_key}"}
        )

    stats["duplicates_removed"] = int(merged.duplicated().sum())
    if stats["duplicates_removed"]:
        merged = merged.drop_duplicates(keep="first")
        log(f"Removed {stats['duplicates_removed']} fully duplicated fused rows.")
    merged = merged.reset_index(drop=True)
    stats["final_rows"] = int(len(merged))
    stats["final_columns"] = int(merged.shape[1])
    stats["sources_used"] = merged_sources
    log(
        f"Fusion complete: {stats['final_rows']} rows × {stats['final_columns']} columns "
        f"from {len(merged_sources)} sources."
    )
    return merged, stats
