"""Prediction input validation and batch upload limits."""
from __future__ import annotations

import pandas as pd
import pytest

from app import main


def _train(client, session_id: str) -> dict:
    response = client.post(
        "/api/train",
        json={"session_id": session_id, "target": "churned", "test_size": 0.25, "cv_folds": 3},
    )
    assert response.status_code == 200, response.text
    return response.json()["model"]


def _values(schema: list[dict]) -> dict:
    return {
        field["name"]: field["median"] if field["kind"] == "numeric" else (field.get("options") or [""])[0]
        for field in schema
    }


@pytest.fixture()
def trained(client, fused):
    model = _train(client, fused["session_id"])
    return {"session_id": fused["session_id"], "model": model, "values": _values(model["schema"])}


def test_valid_prediction_still_works(client, trained):
    response = client.post(
        "/api/predict",
        json={"session_id": trained["session_id"], "values": trained["values"]},
    )
    assert response.status_code == 200, response.text
    assert response.json()["predictions"][0]["prediction"] in {"yes", "no"}


def test_missing_feature_is_rejected(client, trained):
    values = dict(trained["values"])
    dropped = next(iter(values))
    values.pop(dropped)
    response = client.post(
        "/api/predict", json={"session_id": trained["session_id"], "values": values}
    )
    assert response.status_code == 400
    assert "missing feature" in response.json()["detail"]
    assert dropped in response.json()["detail"]


def test_unexpected_feature_is_rejected(client, trained):
    values = {**trained["values"], "typo_column": 1}
    response = client.post(
        "/api/predict", json={"session_id": trained["session_id"], "values": values}
    )
    assert response.status_code == 400
    assert "unknown feature" in response.json()["detail"]
    assert "typo_column" in response.json()["detail"]


def test_invalid_numeric_value_is_rejected(client, trained):
    numeric = next(field for field in trained["model"]["schema"] if field["kind"] == "numeric")
    values = {**trained["values"], numeric["name"]: "not-a-number"}
    response = client.post(
        "/api/predict", json={"session_id": trained["session_id"], "values": values}
    )
    assert response.status_code == 400
    assert "is not a number" in response.json()["detail"]


def test_blank_numeric_value_is_rejected_for_single_prediction(client, trained):
    numeric = next(field for field in trained["model"]["schema"] if field["kind"] == "numeric")
    values = {**trained["values"], numeric["name"]: ""}
    response = client.post(
        "/api/predict", json={"session_id": trained["session_id"], "values": values}
    )
    assert response.status_code == 400
    assert "must be a number" in response.json()["detail"]


def test_batch_prediction_still_works(client, trained):
    frame = pd.DataFrame([trained["values"]])
    response = client.post(
        f"/api/predict/batch?session_id={trained['session_id']}",
        files={"file": ("batch.csv", frame.to_csv(index=False).encode("utf-8"), "text/csv")},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["total"] == 1
    assert body["download"].endswith("/download")


def test_batch_missing_column_is_rejected(client, trained):
    frame = pd.DataFrame([trained["values"]]).drop(columns=[next(iter(trained["values"]))])
    response = client.post(
        f"/api/predict/batch?session_id={trained['session_id']}",
        files={"file": ("batch.csv", frame.to_csv(index=False).encode("utf-8"), "text/csv")},
    )
    assert response.status_code == 400
    assert "missing required feature column" in response.json()["detail"]


def test_batch_row_limit_is_enforced(client, trained):
    frame = pd.DataFrame([trained["values"]] * 5001)
    response = client.post(
        f"/api/predict/batch?session_id={trained['session_id']}",
        files={"file": ("batch.csv", frame.to_csv(index=False).encode("utf-8"), "text/csv")},
    )
    assert response.status_code == 400
    assert "5,000 rows" in response.json()["detail"]


def test_batch_rejects_invalid_numeric_values(client, trained):
    numeric = next(field for field in trained["model"]["schema"] if field["kind"] == "numeric")
    frame = pd.DataFrame([{**trained["values"], numeric["name"]: "abc"}])
    response = client.post(
        f"/api/predict/batch?session_id={trained['session_id']}",
        files={"file": ("batch.csv", frame.to_csv(index=False).encode("utf-8"), "text/csv")},
    )
    assert response.status_code == 400
    assert "is not a number" in response.json()["detail"]


def test_batch_upload_size_is_limited_before_reading(client, trained, monkeypatch):
    monkeypatch.setattr(main.ingest, "MAX_BYTES", 256)
    frame = pd.DataFrame([trained["values"]] * 200)
    response = client.post(
        f"/api/predict/batch?session_id={trained['session_id']}",
        files={"file": ("batch.csv", frame.to_csv(index=False).encode("utf-8"), "text/csv")},
    )
    assert response.status_code == 400
    assert "limit is" in response.json()["detail"]
