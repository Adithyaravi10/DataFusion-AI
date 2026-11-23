from __future__ import annotations

import numpy as np
import pandas as pd

from app import fusion, modeling


def test_plan_detects_shared_key_and_fuses_rows():
    customers = pd.DataFrame(
        {
            "customer_id": [1, 2, 3],
            "name": ["Ada", "Bo", "Cy"],
            "segment": ["Gold", "Silver", "Gold"],
        }
    )
    orders = pd.DataFrame(
        {
            "order_id": [10, 11, 12, 13],
            "customer_id": [1, 1, 2, 3],
            "amount": [100.0, 50.0, 75.0, 25.0],
        }
    )
    plan = fusion.build_plan({"customers": customers, "orders": orders})
    assert plan["steps"][0]["right_key"] == "customer_id"

    fused, stats = fusion.fuse_sources(
        {"customers": customers, "orders": orders}, plan, lambda message: None
    )
    assert stats["final_rows"] == len(fused) > 0
    assert "amount" in fused.columns
    assert fused["amount"].notna().sum() >= 3


def test_regression_target_infers_regression_task():
    series = pd.Series(np.linspace(1, 100, 50))
    assert modeling.infer_task(series) == "regression"


def test_model_selection_uses_cross_validation_not_test_score():
    rng = np.random.default_rng(7)
    n = 160
    frame = pd.DataFrame(
        {
            "f1": rng.normal(size=n),
            "f2": rng.normal(size=n),
            "f3": rng.normal(size=n),
            "label": rng.choice(["yes", "no"], size=n, p=[0.6, 0.4]),
        }
    )
    result = modeling.train_models(frame, "label", test_size=0.25, cv_folds=5)
    evaluation = result["evaluation"]
    table = evaluation["metrics_table"]

    best = next(row for row in table if row["model"] == evaluation["best_model"])
    assert best["cv_primary"] == max(row["cv_primary"] for row in table)
    assert "CV" in evaluation["reason"]
    assert evaluation["confusion_matrix"]["labels"]

    bundle = result["bundle"]
    prediction = modeling.predict_rows(bundle, [{feature: frame[feature].iloc[0] for feature in bundle["features"]}])
    assert prediction["predictions"][0]["prediction"] in {"yes", "no"}
    assert 0 <= prediction["predictions"][0]["confidence"] <= 1
