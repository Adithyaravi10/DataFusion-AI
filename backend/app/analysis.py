"""Exploratory analysis and chart data — every value computed from the session."""
from __future__ import annotations

import math
from typing import Any

import numpy as np
import pandas as pd

from .utils import json_safe, snake_case

TARGET_HINTS = (
    "target", "label", "class", "outcome", "result", "converted", "conversion", "churn",
    "status", "default", "success", "purchased", "clicked", "response", "fraud", "sentiment",
    "sales", "revenue", "profit", "price", "rating",
)
ID_TOKENS = ("id", "uuid", "key", "code", "email", "name")


def _is_id_like(name: str) -> bool:
    normalized = snake_case(name)
    return any(normalized == token or normalized.endswith("_" + token) for token in ID_TOKENS)


def column_kind(series: pd.Series) -> str:
    if pd.api.types.is_bool_dtype(series):
        return "Boolean"
    if pd.api.types.is_datetime64_any_dtype(series):
        return "Date"
    if pd.api.types.is_numeric_dtype(series):
        return "Numeric"
    return "Text"


def numeric_columns(frame: pd.DataFrame, exclude: list[str] | None = None) -> list[str]:
    exclude = set(exclude or [])
    return [
        str(c)
        for c in frame.select_dtypes(include=[np.number]).columns
        if c not in exclude and not _is_id_like(str(c))
    ]


def feature_candidates(frame: pd.DataFrame, target: str | None) -> list[str]:
    """Columns that can safely become model features."""
    features: list[str] = []
    n = max(1, len(frame))
    for col in frame.columns:
        if target and col == target:
            continue
        name = str(col)
        if name.startswith("__") or "__" in name:
            continue
        if _is_id_like(name):
            continue
        series = frame[col]
        if series.isna().all() or series.nunique(dropna=True) <= 1:
            continue
        if pd.api.types.is_datetime64_any_dtype(series):
            continue
        kind = column_kind(series)
        if kind == "Text" and series.nunique(dropna=True) > min(60, max(12, 0.4 * n)):
            continue
        features.append(name)
    return features


def suggest_target(frame: pd.DataFrame) -> dict[str, Any] | None:
    best: dict[str, Any] | None = None
    total = max(1, len(frame))
    for col in frame.columns:
        series = frame[col].dropna()
        if series.empty:
            continue
        name = str(col)
        lowered = name.lower()
        missing_ratio = 1 - len(series) / total
        if missing_ratio > 0.5:
            continue
        unique = int(series.nunique())
        if unique < 2 or unique == len(frame):
            continue
        if _is_id_like(name):
            continue
        hint = any(word in lowered for word in TARGET_HINTS)
        if pd.api.types.is_bool_dtype(series):
            task = "classification"
            counts = series.value_counts(normalize=True)
            balance = float(counts.min()) if len(counts) else 0.0
            score = 1.6 + 0.7 * balance + (0.9 if hint else 0)
            reason = "Boolean column with two outcomes"
        elif pd.api.types.is_numeric_dtype(series):
            if unique <= 10:
                task = "classification"
                counts = series.value_counts(normalize=True)
                balance = float(counts.min()) if len(counts) else 0.0
                score = 1.2 + 0.6 * balance + (1.0 if hint else 0)
                reason = f"Numeric column with {unique} distinct classes"
            else:
                task = "regression"
                spread = float(series.std()) if len(series) > 1 else 0.0
                score = 1.0 + (1.0 if hint else 0) + min(0.3, spread / (abs(float(series.mean())) + 1e-9))
                reason = "Continuous numeric column"
        else:
            if unique > 20:
                continue
            task = "classification"
            counts = series.value_counts(normalize=True)
            balance = float(counts.min()) if len(counts) else 0.0
            score = 1.3 + 0.8 * balance + (1.1 if hint else 0)
            reason = f"Categorical column with {unique} classes"
        score += 0.3 if missing_ratio < 0.15 else 0
        if best is None or score > best["score"]:
            preview = series.astype(str).value_counts().head(4)
            best = {
                "column": name,
                "task": task,
                "confidence": round(min(0.97, 0.45 + score / 6), 2),
                "reason": reason + (" and a target-like name" if hint else ""),
                "classes": [str(v) for v in preview.index.tolist()] if task == "classification" else [],
                "missing_pct": round(missing_ratio * 100, 1),
                "score": score,
            }
    if best:
        best.pop("score", None)
    return best


def infer_task(series: pd.Series) -> str:
    if pd.api.types.is_bool_dtype(series):
        return "classification"
    if pd.api.types.is_numeric_dtype(series):
        non_null = series.dropna()
        unique = non_null.nunique()
        if unique <= 10:
            return "classification"
        fractional = bool((non_null % 1 != 0).any()) if len(non_null) else False
        return "regression" if unique > 15 or fractional else "classification"
    return "classification"


def _overview(frame: pd.DataFrame) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    total = max(1, len(frame))
    for col in frame.columns:
        series = frame[col]
        kind = column_kind(series)
        row: dict[str, Any] = {
            "feature": str(col),
            "type": kind,
            "missing_pct": round(float(series.isna().sum()) / total * 100, 2),
            "unique": int(series.nunique(dropna=True)),
        }
        if kind == "Numeric":
            non_null = series.dropna()
            row["min"] = json_safe(non_null.min()) if len(non_null) else None
            row["max"] = json_safe(non_null.max()) if len(non_null) else None
            row["mean"] = json_safe(non_null.mean()) if len(non_null) else None
        elif kind == "Date":
            non_null = series.dropna()
            row["min"] = json_safe(non_null.min()) if len(non_null) else None
            row["max"] = json_safe(non_null.max()) if len(non_null) else None
        else:
            counts = series.dropna().astype(str).value_counts()
            row["top"] = str(counts.index[0]) if len(counts) else None
            row["top_count"] = int(counts.iloc[0]) if len(counts) else 0
        rows.append(row)
    return rows


def _correlation(frame: pd.DataFrame) -> dict[str, Any] | None:
    columns = numeric_columns(frame)[:10]
    if len(columns) < 2:
        return None
    corr = frame[columns].corr(numeric_only=True).fillna(0)
    return {
        "columns": columns,
        "matrix": [[round(float(corr.iloc[i, j]), 3) for j in range(len(columns))] for i in range(len(columns))],
    }


def _insights(frame: pd.DataFrame, target: dict[str, Any] | None) -> list[dict[str, Any]]:
    insights: list[dict[str, Any]] = []
    total = max(1, len(frame))
    duplicates = int(frame.duplicated().sum())
    if duplicates:
        insights.append(
            {
                "kind": "warning",
                "title": "Duplicate rows remain",
                "text": f"{duplicates} fully duplicated rows ({duplicates / total * 100:.1f}%) survived fusion.",
            }
        )
    missing = frame.isna().sum().sort_values(ascending=False)
    for col, count in missing.head(3).items():
        if count:
            insights.append(
                {
                    "kind": "warning" if count / total > 0.2 else "info",
                    "title": f"{col} has missing values",
                    "text": f"{int(count)} of {total} cells ({count / total * 100:.1f}%) are empty; "
                    "these rows were not linked by a shared key or had no value in any source.",
                }
            )
    numeric = frame.select_dtypes(include=[np.number])
    if numeric.shape[1] >= 2:
        corr = numeric.corr(numeric_only=True)
        pairs = []
        cols = list(corr.columns)
        for i in range(len(cols)):
            for j in range(i + 1, len(cols)):
                value = float(corr.iloc[i, j])
                if not math.isnan(value) and abs(value) >= 0.7:
                    pairs.append((abs(value), value, cols[i], cols[j]))
        pairs.sort(reverse=True)
        for _, value, a, b in pairs[:2]:
            direction = "positively" if value > 0 else "negatively"
            insights.append(
                {
                    "kind": "pattern",
                    "title": f"{a} and {b} move together",
                    "text": f"Strong {direction} correlation (r = {value:.2f}) between {a} and {b}.",
                }
            )
        skewed = numeric.skew(numeric_only=True).abs().sort_values(ascending=False)
        for col, value in skewed.head(1).items():
            if value and value > 1.5:
                insights.append(
                    {
                        "kind": "info",
                        "title": f"{col} is skewed",
                        "text": f"Skewness is {float(value):.2f}; most values sit low with a long tail.",
                    }
                )
    if target and target.get("task") == "classification" and target.get("column") in frame.columns:
        counts = frame[target["column"]].dropna().astype(str).value_counts(normalize=True)
        if len(counts) >= 2:
            top_share = float(counts.iloc[0])
            insights.append(
                {
                    "kind": "warning" if top_share > 0.7 else "info",
                    "title": f"Target distribution: {target['column']}",
                    "text": f"{counts.index[0]} is {top_share * 100:.1f}% of the labelled rows"
                    + (" — an imbalanced target, so F1 matters more than raw accuracy." if top_share > 0.7 else "."),
                }
            )
    high_card = [
        (str(c), int(frame[c].nunique()))
        for c in frame.columns
        if not pd.api.types.is_numeric_dtype(frame[c])
        and not pd.api.types.is_datetime64_any_dtype(frame[c])
        and not pd.api.types.is_bool_dtype(frame[c])
        and frame[c].nunique() > 30
    ]
    for col, unique in high_card[:1]:
        insights.append(
            {
                "kind": "info",
                "title": f"{col} is high-cardinality",
                "text": f"{unique} distinct values; it is excluded from model features to avoid noisy one-hot encoding.",
            }
        )
    if len(frame) < 100:
        insights.append(
            {
                "kind": "warning",
                "title": "Small fused dataset",
                "text": f"Only {len(frame)} rows are available, so cross-validation folds are adjusted and metrics are optimistic.",
            }
        )
    if not insights:
        insights.append(
            {
                "kind": "info",
                "title": "No major quality issues detected",
                "text": "The fused dataset has no missing cells, no duplicate rows and no strong correlations.",
            }
        )
    return insights


def analyse_frame(frame: pd.DataFrame, target: dict[str, Any] | None) -> dict[str, Any]:
    numeric_cols = [str(c) for c in frame.select_dtypes(include=[np.number]).columns]
    summary = []
    for col in numeric_cols[:12]:
        series = frame[col].dropna()
        if series.empty:
            continue
        summary.append(
            {
                "column": col,
                "min": round(float(series.min()), 3),
                "q1": round(float(series.quantile(0.25)), 3),
                "median": round(float(series.median()), 3),
                "q3": round(float(series.quantile(0.75)), 3),
                "max": round(float(series.max()), 3),
                "mean": round(float(series.mean()), 3),
            }
        )
    total = max(1, len(frame))
    return {
        "stats": {
            "total_records": int(len(frame)),
            "features": int(frame.shape[1]),
            "missing_pct": round(float(frame.isna().to_numpy().mean()) * 100, 2) if frame.size else 0.0,
            "duplicates": int(frame.duplicated().sum()),
            "numeric_columns": len(numeric_cols),
            "categorical_columns": int(
                len([c for c in frame.columns if column_kind(frame[c]) in ("Text", "Boolean")])
            ),
        },
        "overview": _overview(frame),
        "summary": summary,
        "insights": _insights(frame, target),
        "correlation": _correlation(frame),
        "target": target,
    }


def build_charts(
    frame: pd.DataFrame,
    target: dict[str, Any] | None,
    model: dict[str, Any] | None,
) -> dict[str, Any]:
    charts: dict[str, Any] = {"correlation": _correlation(frame)}

    target_col = target.get("column") if target else None
    task = target.get("task") if target else None
    if target_col and target_col in frame.columns:
        series = frame[target_col].dropna()
        if task == "classification" or not pd.api.types.is_numeric_dtype(series):
            counts = series.astype(str).value_counts()
            charts["classDistribution"] = {
                "column": target_col,
                "type": "categorical",
                "data": [{"label": str(k), "value": int(v)} for k, v in counts.head(15).items()],
            }
        else:
            values = series.astype(float)
            counts, edges = np.histogram(values, bins=min(12, max(4, int(np.sqrt(len(values))))))
            charts["classDistribution"] = {
                "column": target_col,
                "type": "numeric",
                "data": [
                    {
                        "label": f"{edges[i]:.2f}–{edges[i + 1]:.2f}",
                        "value": int(counts[i]),
                    }
                    for i in range(len(counts))
                ],
            }
    else:
        charts["classDistribution"] = None

    histograms = []
    for col in numeric_columns(frame, exclude=[target_col] if target_col else [])[:6]:
        series = frame[col].dropna().astype(float)
        if series.empty:
            continue
        counts, edges = np.histogram(series, bins=min(15, max(5, int(np.sqrt(len(series))))))
        histograms.append(
            {
                "column": col,
                "bins": [
                    {
                        "label": f"{edges[i]:.2f}–{edges[i + 1]:.2f}",
                        "value": int(counts[i]),
                    }
                    for i in range(len(counts))
                ],
            }
        )
    charts["histograms"] = histograms

    boxplots = []
    for col in numeric_columns(frame, exclude=[target_col] if target_col else [])[:6]:
        series = frame[col].dropna().astype(float)
        if series.empty:
            continue
        q1, q3 = float(series.quantile(0.25)), float(series.quantile(0.75))
        iqr = q3 - q1
        lower, upper = q1 - 1.5 * iqr, q3 + 1.5 * iqr
        outliers = series[(series < lower) | (series > upper)]
        boxplots.append(
            {
                "column": col,
                "min": round(float(series.min()), 3),
                "q1": round(q1, 3),
                "median": round(float(series.median()), 3),
                "q3": round(q3, 3),
                "max": round(float(series.max()), 3),
                "lower": round(lower, 3),
                "upper": round(upper, 3),
                "outlier_count": int(len(outliers)),
            }
        )
    charts["boxplots"] = boxplots

    evaluation = (model or {}).get("evaluation") or {}
    charts["featureImportance"] = evaluation.get("feature_importance", [])
    charts["confusionMatrix"] = evaluation.get("confusion_matrix")
    charts["actualVsPredicted"] = evaluation.get("actual_vs_predicted", [])
    charts["model"] = (
        {
            "name": (model or {}).get("best_model"),
            "task": (model or {}).get("task"),
            "target": (model or {}).get("target"),
            "metrics": (model or {}).get("best_metrics"),
        }
        if model
        else None
    )
    return charts


def paginate(
    frame: pd.DataFrame,
    page: int = 1,
    page_size: int = 20,
    search: str = "",
    sort: str | None = None,
    direction: str = "asc",
) -> dict[str, Any]:
    working = frame
    if search and search.strip():
        needle = search.strip().lower()
        mask = working.astype(str).apply(
            lambda col: col.str.lower().str.contains(needle, regex=False, na=False)
        )
        working = working[mask.any(axis=1)]
    if sort and sort in working.columns:
        working = working.sort_values(by=sort, ascending=(direction != "desc"), kind="mergesort", na_position="last")
    total = int(len(working))
    page_size = max(5, min(200, int(page_size)))
    pages = max(1, math.ceil(total / page_size))
    page = max(1, min(page, pages))
    start = (page - 1) * page_size
    slice_df = working.iloc[start : start + page_size]
    rows = []
    for record in slice_df.to_dict(orient="records"):
        rows.append({str(k): json_safe(v) for k, v in record.items()})
    columns = [{"name": str(c), "type": column_kind(frame[c])} for c in frame.columns]
    return {
        "columns": columns,
        "rows": rows,
        "total": total,
        "page": page,
        "pages": pages,
        "page_size": page_size,
    }
