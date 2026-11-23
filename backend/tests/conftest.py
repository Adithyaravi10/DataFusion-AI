from __future__ import annotations

import time

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app import ai_service, main, store


@pytest.fixture()
def client(tmp_path, monkeypatch):
    """A TestClient with every storage location redirected into tmp_path."""
    data = tmp_path / "data"
    monkeypatch.setattr(store, "DATA_DIR", data)
    monkeypatch.setattr(store, "SESSIONS_DIR", data / "sessions")
    monkeypatch.setattr(store, "JOBS_DIR", data / "jobs")
    monkeypatch.setattr(ai_service, "DATA_DIR", data)
    monkeypatch.setattr(ai_service, "USAGE_FILE", data / "ai_usage.json")
    store.ensure_dirs()
    with TestClient(main.app) as test_client:
        yield test_client


def _csv(frame: pd.DataFrame) -> bytes:
    return frame.to_csv(index=False).encode("utf-8")


def customer_frame() -> pd.DataFrame:
    return pd.DataFrame(
        {
            "customer_id": list(range(1, 31)),
            "name": [f"Customer {index:02d}" for index in range(1, 31)],
            "segment": ["Gold" if index % 3 == 0 else "Silver" for index in range(1, 31)],
            "age": [20 + index for index in range(1, 31)],
            "churned": ["yes" if index % 2 == 0 else "no" for index in range(1, 31)],
        }
    )


def order_frame() -> pd.DataFrame:
    rows = []
    for index in range(1, 31):
        for line in range(2):
            rows.append(
                {
                    "order_id": 1000 + index * 10 + line,
                    "customer_id": index,
                    "amount": f"${(index * 37 + line * 11):,}.50",
                    "quantity": 1 + line,
                    "order_date": "2026-01-05",
                }
            )
    return pd.DataFrame(rows)


@pytest.fixture()
def fused(client):
    """Upload two related sources and wait for a real fusion job to finish."""
    response = client.post(
        "/api/upload",
        files=[
            ("files", ("customers.csv", _csv(customer_frame()), "text/csv")),
            ("files", ("orders.csv", _csv(order_frame()), "text/csv")),
        ],
    )
    assert response.status_code == 200, response.text
    session_id = response.json()["session"]["id"]

    started = client.post("/api/fuse", json={"session_id": session_id})
    assert started.status_code == 200, started.text
    job_id = started.json()["job_id"]

    status: dict = {}
    for _ in range(400):
        status = client.get(f"/api/fuse/{job_id}/status").json()
        if status.get("state") in ("done", "error"):
            break
        time.sleep(0.05)

    assert status.get("state") == "done", status
    return {"session_id": session_id, "job_id": job_id, "status": status}
