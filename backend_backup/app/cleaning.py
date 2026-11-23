"""Data wrangling: formats, missing values, duplicates, outliers."""
from __future__ import annotations

import re
import warnings as pywarnings
from typing import Any

import numpy as np
import pandas as pd

from .utils import json_safe

NUMERIC_HINT = re.compile(
    r"(age|qty|quantity|price|amount|score|count|pages|duration|rate|total|cost|revenue|"
    r"units?|visits?|sessions?|bounce|discount|salary|income|weight|height|tips?|fare)",
    re.I,
)
DATE_HINT = re.compile(r"(date|time|timestamp|_at$|day|month|year)", re.I)
CATEGORICAL_HINT = re.compile(
    r"(segment|city|channel|device|status|product|category|region|country|source|"
    r"gender|type|method|converted|class|label|outcome)",
    re.I,
)
ID_HINT = re.compile(r"(^|_)(id|uuid|key|code|number|no)$", re.I)
DATE_TOKEN = re.compile(
    r"(?:\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4})|(?::)|(?:\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b)",
    re.I,
)


def _snapshot(frame: pd.DataFrame) -> dict[str, Any]:
    return {
        "rows": int(len(frame)),
        "columns": int(frame.shape[1]),
        "missing_cells": int(frame.isna().sum().sum()),
        "duplicate_rows": int(frame.duplicated().sum()),
        "missing_pct": round(float(frame.isna().to_numpy().mean() * 100), 2) if frame.size else 0.0,
    }


def _key_like(name: str) -> bool:
    return bool(ID_HINT.search(name))


def _numeric_parse(series: pd.Series) -> pd.Series:
    cleaned = (
        series.astype(str)
        .str.replace(r"[$€£₹,%]", "", regex=True)
        .str.replace(r"\s+", "", regex=True)
        .replace({"": np.nan, "nan": np.nan, "None": np.nan, "-": np.nan})
    )
    return pd.to_numeric(cleaned, errors="coerce")


def _looks_like_dates(series: pd.Series) -> bool:
    sample = series.dropna().astype(str).head(60)
    if sample.empty:
        return False
    hits = sample.str.contains(DATE_TOKEN, regex=True).mean()
    return bool(hits >= 0.6)


def clean_frame(frame: pd.DataFrame, source_name: str) -> tuple[pd.DataFrame, dict[str, Any]]:
    """Clean one source and return it with a fully traceable report."""
    frame = frame.copy()
    frame.columns = [str(c) for c in frame.columns]

    report: dict[str, Any] = {
        "source": source_name,
        "before": _snapshot(frame),
        "renamed_columns": [],
        "dropped_all_null": [],
        "whitespace_fixed": 0,
        "numeric_converted": [],
        "dates_parsed": [],
        "casing_fixed": [],
        "missing": [],
        "outliers": [],
        "constant_columns": [],
        "duplicates_removed": 0,
        "notes": [],
    }

    # All-null columns cannot carry information.
    all_null = frame.columns[frame.isna().all()].tolist()
    if all_null:
        frame = frame.drop(columns=all_null)
        report["dropped_all_null"] = [str(c) for c in all_null]
        report["notes"].append(f"Dropped {len(all_null)} all-null column(s).")
    if frame.shape[1] == 0:
        raise ValueError("This file has no usable columns after removing empty ones.")

    # Trim / collapse whitespace in textual columns.
    fixed_cells = 0
    for col in frame.select_dtypes(include=["object"]).columns:
        original = frame[col]
        textual = original.where(original.isna(), original.astype(str).str.replace(r"\s+", " ", regex=True).str.strip())
        fixed_cells += int((original.fillna("__na__") != textual.fillna("__na__")).sum())
        frame[col] = textual
    report["whitespace_fixed"] = fixed_cells

    # Numeric strings such as "$1,299.00" or " 34 ".
    for col in list(frame.select_dtypes(include=["object"]).columns):
        series = frame[col]
        non_null = series.dropna()
        if len(non_null) < 3:
            continue
        stripped = non_null.astype(str).str.replace(r"[$€£₹,%]", "", regex=True).str.replace(r"\s+", "", regex=True)
        ratio = pd.to_numeric(stripped, errors="coerce").notna().mean()
        hinted = bool(NUMERIC_HINT.search(str(col)))
        if ratio >= 0.8 and (hinted or ratio >= 0.97) and not DATE_HINT.search(str(col)):
            converted = _numeric_parse(series)
            new_values = int(converted.notna().sum())
            if new_values:
                frame[col] = converted
                report["numeric_converted"].append(
                    {
                        "column": str(col),
                        "values": new_values,
                        "examples": non_null.astype(str).head(2).tolist(),
                    }
                )

    # Dates, including mixed formats in the same column.
    for col in list(frame.select_dtypes(include=["object"]).columns):
        series = frame[col]
        if series.dropna().empty:
            continue
        hinted = bool(DATE_HINT.search(str(col)))
        if not hinted and not _looks_like_dates(series):
            continue
        with pywarnings.catch_warnings():
            pywarnings.simplefilter("ignore")
            parsed = pd.to_datetime(series, errors="coerce", format="mixed")
        success = int(parsed.notna().sum())
        valid_ratio = success / max(1, int(series.notna().sum()))
        if success >= 2 and valid_ratio >= 0.6:
            frame[col] = parsed
            report["dates_parsed"].append(
                {
                    "column": str(col),
                    "parsed": success,
                    "failed": int(series.notna().sum()) - success,
                }
            )

    # Consistent casing for low-cardinality categories.
    for col in list(frame.select_dtypes(include=["object"]).columns):
        series = frame[col]
        uniques = series.dropna().astype(str).unique()
        if not (0 < len(uniques) <= 30) or not CATEGORICAL_HINT.search(str(col)):
            continue
        if len(uniques) > max(8, len(series) * 0.6):
            continue
        normalized = series.where(
            series.isna(), series.astype(str).str.replace(r"\s+", " ", regex=True).str.strip().str.title()
        )
        changed = int((series.dropna().astype(str) != normalized.dropna().astype(str)).sum())
        if changed:
            report["casing_fixed"].append(
                {"column": str(col), "values": changed, "before": uniques[:4].tolist()}
            )
            frame[col] = normalized

    # Missing values, with the method recorded for every column.
    for col in frame.columns:
        missing = int(frame[col].isna().sum())
        if not missing:
            continue
        series = frame[col]
        identifier_like = _key_like(str(col)) or bool(
            re.search(r"(email|phone|mobile|name)$", str(col), re.I)
        )
        if identifier_like and not pd.api.types.is_numeric_dtype(series):
            report["missing"].append(
                {
                    "column": str(col),
                    "before": missing,
                    "after": missing,
                    "method": "left blank (identifier — never imputed)",
                }
            )
            continue
        if pd.api.types.is_numeric_dtype(series):
            value = series.median()
            if pd.isna(value):
                value = 0
            frame[col] = series.fillna(value)
            method = f"median ({value:g})"
        elif pd.api.types.is_datetime64_any_dtype(series):
            filled = series.ffill().bfill()
            frame[col] = filled
            still = int(frame[col].isna().sum())
            method = "forward/backward fill" if still == 0 else f"forward fill ({still} left blank)"
        else:
            mode = series.mode(dropna=True)
            if not mode.empty:
                frame[col] = series.fillna(mode.iloc[0])
                method = f"mode ('{mode.iloc[0]}')"
            else:
                frame[col] = series.fillna("Unknown")
                method = "constant ('Unknown')"
        report["missing"].append(
            {
                "column": str(col),
                "before": missing,
                "after": int(frame[col].isna().sum()),
                "method": method,
            }
        )

    # Constant columns are recorded (they cannot help the model).
    constants = [str(c) for c in frame.columns if frame[c].nunique(dropna=True) <= 1]
    report["constant_columns"] = constants

    # IQR outlier capping on meaningful numeric columns.
    for col in frame.select_dtypes(include=[np.number]).columns:
        series = frame[col]
        if _key_like(str(col)) or series.notna().sum() < 8 or series.nunique() < 5:
            continue
        q1, q3 = series.quantile(0.25), series.quantile(0.75)
        iqr = q3 - q1
        if not np.isfinite(iqr) or iqr <= 0:
            continue
        lower, upper = float(q1 - 1.5 * iqr), float(q3 + 1.5 * iqr)
        mask = (series < lower) | (series > upper)
        count = int(mask.sum())
        if count:
            frame[col] = series.clip(lower=lower, upper=upper)
            report["outliers"].append(
                {
                    "column": str(col),
                    "count": count,
                    "lower": round(lower, 3),
                    "upper": round(upper, 3),
                    "examples": [json_safe(v) for v in series[mask].head(3).tolist()],
                }
            )

    # Exact duplicate rows.
    duplicates = int(frame.duplicated().sum())
    if duplicates:
        frame = frame.drop_duplicates(keep="first").reset_index(drop=True)
    report["duplicates_removed"] = duplicates
    report["after"] = _snapshot(frame)
    report["rows_removed"] = report["before"]["rows"] - report["after"]["rows"]
    report["missing_filled"] = int(
        report["before"]["missing_cells"] - report["after"]["missing_cells"]
    )
    return frame, report
