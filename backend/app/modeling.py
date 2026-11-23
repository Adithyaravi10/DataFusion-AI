"""Model training: Random Forest, Decision Tree, Logistic Regression, SVM.

All splits, CV folds and model seeds use random_state=42 so the same dataset
always produces identical numbers.
"""
from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Any

import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.inspection import permutation_importance
from sklearn.linear_model import LinearRegression, LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    f1_score,
    mean_absolute_error,
    mean_squared_error,
    precision_score,
    r2_score,
    recall_score,
)
from sklearn.model_selection import KFold, StratifiedKFold, cross_validate, train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sklearn.svm import SVC, SVR
from sklearn.tree import DecisionTreeClassifier, DecisionTreeRegressor

from .analysis import feature_candidates, infer_task
from .store import session_dir
from .utils import json_safe

RANDOM_STATE = 42
MAX_TRAIN_ROWS = 8000


class ModelingError(ValueError):
    pass


def _is_numeric(series: pd.Series) -> bool:
    return bool(pd.api.types.is_numeric_dtype(series) and not pd.api.types.is_bool_dtype(series))


def build_preprocessor(feature_frame: pd.DataFrame) -> ColumnTransformer:
    numeric = [str(c) for c in feature_frame.columns if _is_numeric(feature_frame[c])]
    categorical = [str(c) for c in feature_frame.columns if str(c) not in numeric]
    numeric_pipe = Pipeline(
        [
            ("impute", SimpleImputer(strategy="median")),
            ("scale", StandardScaler()),
        ]
    )
    categorical_pipe = Pipeline(
        [
            ("impute", SimpleImputer(strategy="most_frequent")),
            (
                "encode",
                OneHotEncoder(handle_unknown="ignore", sparse_output=True, min_frequency=1),
            ),
        ]
    )
    transformers = []
    if numeric:
        transformers.append(("num", numeric_pipe, numeric))
    if categorical:
        transformers.append(("cat", categorical_pipe, categorical))
    return ColumnTransformer(transformers, remainder="drop", sparse_threshold=0.3)


def _model_set(task: str) -> list[dict[str, Any]]:
    if task == "regression":
        return [
            {"key": "random_forest", "label": "Random Forest", "model": RandomForestRegressor(n_estimators=250, random_state=RANDOM_STATE, n_jobs=-1)},
            {"key": "decision_tree", "label": "Decision Tree", "model": DecisionTreeRegressor(random_state=RANDOM_STATE)},
            {"key": "linear_regression", "label": "Linear Regression", "model": LinearRegression()},
            {"key": "svm", "label": "SVM (RBF)", "model": SVR(kernel="rbf", C=10.0)},
        ]
    return [
        {"key": "random_forest", "label": "Random Forest", "model": RandomForestClassifier(n_estimators=250, random_state=RANDOM_STATE, n_jobs=-1, class_weight="balanced")},
        {"key": "decision_tree", "label": "Decision Tree", "model": DecisionTreeClassifier(random_state=RANDOM_STATE, class_weight="balanced")},
        {"key": "logistic_regression", "label": "Logistic Regression", "model": LogisticRegression(max_iter=4000, random_state=RANDOM_STATE, class_weight="balanced")},
        {"key": "svm", "label": "SVM (RBF)", "model": SVC(kernel="rbf", probability=True, random_state=RANDOM_STATE, class_weight="balanced")},
    ]


def _clean_feature_name(name: str) -> str:
    for prefix in ("num__", "cat__"):
        if name.startswith(prefix):
            name = name[len(prefix):]
    return name


def _extract_importance(pipeline: Pipeline, X_test: pd.DataFrame, y_test: pd.Series, task: str) -> list[dict[str, Any]]:
    preprocessor: ColumnTransformer = pipeline.named_steps["preprocess"]
    model = pipeline.named_steps["model"]
    names = [_clean_feature_name(n) for n in preprocessor.get_feature_names_out()]
    values: np.ndarray | None = None
    if hasattr(model, "feature_importances_"):
        values = np.asarray(model.feature_importances_, dtype=float)
    elif hasattr(model, "coef_"):
        coef = np.asarray(model.coef_, dtype=float)
        values = np.abs(coef).mean(axis=0) if coef.ndim > 1 else np.abs(coef)
    if values is None or len(values) != len(names) or float(values.sum()) <= 0:
        try:
            sample_n = min(400, len(X_test))
            result = permutation_importance(
                pipeline, X_test.iloc[:sample_n], y_test.iloc[:sample_n],
                n_repeats=3, random_state=RANDOM_STATE, scoring="accuracy" if task == "classification" else "r2",
            )
            # permutation importance is by input column, not encoded feature
            entries = [
                {"feature": str(col), "importance": round(float(max(0.0, v)), 4)}
                for col, v in zip(X_test.columns, result.importances_mean)
            ]
            entries.sort(key=lambda e: e["importance"], reverse=True)
            return entries[:15]
        except Exception:  # noqa: BLE001 - optional diagnostic
            return []
    total = float(np.sum(values))
    if total > 0:
        values = values / total
    entries = [
        {"feature": clean, "importance": round(float(value), 4)}
        for clean, value in zip(names, values)
    ]
    entries.sort(key=lambda e: e["importance"], reverse=True)
    return entries[:15]


def train_models(
    frame: pd.DataFrame,
    target: str,
    test_size: float = 0.25,
    cv_folds: int = 5,
    task_override: str | None = None,
) -> dict[str, Any]:
    if target not in frame.columns:
        raise ModelingError(f"Target column '{target}' is not in the fused dataset.")
    if len(frame) < 12:
        raise ModelingError(
            f"Only {len(frame)} fused rows are available; at least 12 are needed to train and validate models."
        )
    working = frame.copy()
    working = working[working[target].notna()]
    if len(working) < 12:
        raise ModelingError(
            f"Only {len(working)} rows have a value for '{target}'; at least 12 labelled rows are required."
        )
    task = task_override or infer_task(working[target])
    if task == "classification":
        class_counts = working[target].value_counts()
        if len(class_counts) > 30:
            raise ModelingError(
                f"'{target}' has {len(class_counts)} distinct values — that is a regression target, "
                "not a classification target."
            )
        if len(class_counts) < 2:
            raise ModelingError(
                f"'{target}' contains only one class, so classification cannot be trained."
            )
        if int(class_counts.min()) < 2:
            raise ModelingError(
                f"'{target}' has a class with a single row; at least 2 rows per class are needed."
            )
    else:
        working[target] = pd.to_numeric(working[target], errors="coerce")
        working = working[working[target].notna()]
        if len(working) < 12:
            raise ModelingError(
                f"'{target}' cannot be used for regression: fewer than 12 numeric values remain. "
                "Choose a categorical target or a numeric column with enough values."
            )
        if working[target].nunique() < 2:
            raise ModelingError(f"'{target}' has only one distinct numeric value, so a regression model cannot be trained.")

    notes: list[str] = []
    if len(working) > MAX_TRAIN_ROWS:
        working = working.sample(n=MAX_TRAIN_ROWS, random_state=RANDOM_STATE).sort_index()
        notes.append(
            f"Training sampled {MAX_TRAIN_ROWS:,} rows (seed 42) from {len(frame):,} for runtime; metrics reflect that sample."
        )

    features = feature_candidates(working, target)
    if not features:
        raise ModelingError(
            "No usable feature columns remain after removing identifiers, empty and constant columns."
        )
    X = working[features]
    y = working[target]

    test_size = float(min(0.4, max(0.1, test_size)))
    stratify = y if task == "classification" else None
    min_class = int(y.value_counts().min()) if task == "classification" else len(y)
    n_splits = max(2, min(int(cv_folds), 10, min_class if task == "classification" else 10, len(working) - 1))
    if n_splits < int(cv_folds):
        notes.append(f"Cross-validation folds reduced to {n_splits} to fit the available rows.")
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=test_size, random_state=RANDOM_STATE, stratify=stratify
    )
    if len(X_test) < 2:
        raise ModelingError("The test split would contain fewer than 2 rows; add more data.")

    splitter = (
        StratifiedKFold(n_splits=n_splits, shuffle=True, random_state=RANDOM_STATE)
        if task == "classification"
        else KFold(n_splits=n_splits, shuffle=True, random_state=RANDOM_STATE)
    )

    rows: list[dict[str, Any]] = []
    fitted: dict[str, Pipeline] = {}
    for entry in _model_set(task):
        pipeline = Pipeline([("preprocess", build_preprocessor(X)), ("model", entry["model"])])
        started = time.perf_counter()
        pipeline.fit(X_train, y_train)
        duration = round(time.perf_counter() - started, 2)
        predictions = pipeline.predict(X_test)
        scoring = (
            {"accuracy": "accuracy", "f1": "f1_weighted"}
            if task == "classification"
            else {"r2": "r2", "mae": "neg_mean_absolute_error", "rmse": "neg_root_mean_squared_error"}
        )
        cv = cross_validate(
            pipeline, X_train, y_train, cv=splitter, scoring=scoring, n_jobs=-1, error_score=np.nan
        )
        row: dict[str, Any] = {
            "model": entry["label"],
            "key": entry["key"],
            "duration_s": duration,
        }
        if task == "classification":
            row.update(
                {
                    "accuracy": round(float(accuracy_score(y_test, predictions)), 4),
                    "precision": round(float(precision_score(y_test, predictions, average="weighted", zero_division=0)), 4),
                    "recall": round(float(recall_score(y_test, predictions, average="weighted", zero_division=0)), 4),
                    "f1": round(float(f1_score(y_test, predictions, average="weighted", zero_division=0)), 4),
                }
            )
            row["cv_accuracy_mean"] = round(float(np.nanmean(cv["test_accuracy"])), 4)
            row["cv_accuracy_std"] = round(float(np.nanstd(cv["test_accuracy"])), 4)
            row["cv_f1_mean"] = round(float(np.nanmean(cv["test_f1"])), 4)
            row["cv_f1_std"] = round(float(np.nanstd(cv["test_f1"])), 4)
            row["primary"] = row["f1"]
            row["cv_primary"] = row["cv_f1_mean"]
        else:
            rmse = float(np.sqrt(mean_squared_error(y_test, predictions)))
            row.update(
                {
                    "r2": round(float(r2_score(y_test, predictions)), 4),
                    "mae": round(float(mean_absolute_error(y_test, predictions)), 4),
                    "rmse": round(rmse, 4),
                }
            )
            row["cv_r2_mean"] = round(float(np.nanmean(cv["test_r2"])), 4)
            row["cv_r2_std"] = round(float(np.nanstd(cv["test_r2"])), 4)
            row["cv_rmse_mean"] = round(float(np.nanmean(-cv["test_rmse"])), 4)
            row["cv_rmse_std"] = round(float(np.nanstd(-cv["test_rmse"])), 4)
            row["primary"] = row["r2"]
            row["cv_primary"] = row["cv_r2_mean"]
        rows.append(row)
        fitted[entry["key"]] = pipeline

    # Select on cross-validated performance, then report the held-out test
    # score. Picking the winner by its test score and reporting that same score
    # would be an optimistic, selection-biased estimate.
    best_row = max(rows, key=lambda r: (r["cv_primary"], r["primary"]))
    best_pipeline = fitted[best_row["key"]]
    best_predictions = best_pipeline.predict(X_test)

    labels: list[str] = []
    matrix: list[list[int]] | None = None
    actual_vs_predicted: list[dict[str, Any]] = []
    if task == "classification":
        labels = [str(v) for v in sorted(pd.unique(y_test.astype(str)))]
        raw = confusion_matrix(y_test.astype(str), pd.Series(best_predictions).astype(str), labels=labels)
        matrix = [[int(v) for v in row] for row in raw]
        for position, (actual, predicted) in enumerate(zip(y_test.astype(str).tolist(), pd.Series(best_predictions).astype(str).tolist())):
            if position >= 60:
                break
            actual_vs_predicted.append(
                {
                    "index": position + 1,
                    "actual": actual,
                    "predicted": predicted,
                    "actual_value": labels.index(actual) if actual in labels else 0,
                    "predicted_value": labels.index(predicted) if predicted in labels else 0,
                }
            )
    else:
        for position, (actual, predicted) in enumerate(zip(y_test.tolist(), best_predictions.tolist())):
            if position >= 60:
                break
            actual_vs_predicted.append(
                {
                    "index": position + 1,
                    "actual": round(float(actual), 4),
                    "predicted": round(float(predicted), 4),
                }
            )

    importance = _extract_importance(best_pipeline, X_test, y_test, task)
    metric_label = "weighted F1" if task == "classification" else "R²"
    reason = (
        f"Highest {n_splits}-fold CV {metric_label} mean ({best_row['cv_primary']:.3f} ± "
        f"{best_row.get('cv_f1_std', best_row.get('cv_r2_std', 0)):.3f}); "
        f"held-out test {metric_label} is {best_row['primary']:.3f}."
    )

    evaluation = {
        "task": task,
        "target": target,
        "n_train": int(len(X_train)),
        "n_test": int(len(X_test)),
        "test_size": test_size,
        "cv_folds": n_splits,
        "features": features,
        "metrics_table": rows,
        "best_model": best_row["model"],
        "best_key": best_row["key"],
        "best_metrics": {k: v for k, v in best_row.items() if k not in ("model", "key", "primary", "cv_primary")},
        "reason": reason,
        "confusion_matrix": {"labels": labels, "matrix": matrix} if matrix is not None else None,
        "actual_vs_predicted": actual_vs_predicted,
        "feature_importance": importance,
        "class_labels": labels,
        "notes": notes,
        "trained_at": datetime.now(timezone.utc).isoformat(),
    }

    numeric_features = [feature for feature in features if _is_numeric(X[feature])]
    bundle = {
        "pipeline": best_pipeline,
        "task": task,
        "target": target,
        "features": features,
        "numeric_features": numeric_features,
        "classes": labels,
    }
    evaluation["duration_note"] = "Timings above are measured wall-clock fit durations, not estimates."
    return {"bundle": bundle, "evaluation": json_safe(evaluation)}


def save_model(session_id: str, bundle: dict[str, Any], evaluation: dict[str, Any]) -> str:
    folder = session_dir(session_id) / "model"
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / "model.joblib"
    joblib.dump(bundle, path)
    joblib.dump(evaluation, folder / "evaluation.joblib")
    return str(path)


def load_bundle(session_id: str) -> dict[str, Any]:
    path = session_dir(session_id) / "model" / "model.joblib"
    if not path.exists():
        raise ModelingError("No trained model is available for this session. Train a model first.")
    return joblib.load(path)


def predict_schema(frame: pd.DataFrame, target: str | None) -> list[dict[str, Any]]:
    schema: list[dict[str, Any]] = []
    for col in feature_candidates(frame, target):
        series = frame[col]
        if pd.api.types.is_numeric_dtype(series) and not pd.api.types.is_bool_dtype(series):
            numeric = pd.to_numeric(series, errors="coerce").dropna()
            if numeric.empty:
                continue
            schema.append(
                {
                    "name": col,
                    "kind": "numeric",
                    "min": round(float(numeric.min()), 4),
                    "max": round(float(numeric.max()), 4),
                    "median": round(float(numeric.median()), 4),
                    "step": 0.1 if bool((numeric % 1 != 0).any()) else 1,
                }
            )
        else:
            options = [str(v) for v in series.dropna().astype(str).value_counts().head(40).index.tolist()]
            schema.append({"name": col, "kind": "categorical", "options": options})
    return schema


def predict_rows(bundle: dict[str, Any], records: list[dict[str, Any]]) -> dict[str, Any]:
    if not records:
        raise ModelingError("No input rows were supplied.")
    features = bundle["features"]
    numeric = set(bundle.get("numeric_features", []))
    frame = pd.DataFrame([{feature: record.get(feature) for feature in features} for record in records])
    for feature in features:
        frame[feature] = frame[feature].replace({"": np.nan, None: np.nan})
        if feature in numeric:
            frame[feature] = pd.to_numeric(frame[feature], errors="coerce")
    pipeline: Pipeline = bundle["pipeline"]
    predictions = pipeline.predict(frame)
    probabilities: list[dict[str, float] | None] = [None] * len(records)
    if bundle["task"] == "classification" and hasattr(pipeline.named_steps["model"], "predict_proba"):
        proba = pipeline.predict_proba(frame)
        classes = [str(c) for c in pipeline.named_steps["model"].classes_]
        probabilities = [
            {classes[i]: round(float(value), 4) for i, value in enumerate(row)} for row in proba
        ]
    output = []
    for index, prediction in enumerate(predictions):
        row: dict[str, Any] = {"row": index + 1, "prediction": json_safe(prediction)}
        if probabilities[index] is not None:
            row["probabilities"] = probabilities[index]
            row["confidence"] = max(probabilities[index].values())
        output.append(row)
    return {
        "task": bundle["task"],
        "target": bundle["target"],
        "predictions": output,
        "features": features,
    }
