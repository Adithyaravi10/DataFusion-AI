"""Session ownership: one browser must never reach another browser's data."""
from __future__ import annotations

import time

import pandas as pd
from fastapi.testclient import TestClient

from app import main


def _wait_for_job(client: TestClient, job_id: str, timeout: float = 20.0) -> dict:
    """Leave no background pipeline thread running between tests."""
    deadline = time.time() + timeout
    status: dict = {}
    while time.time() < deadline:
        status = client.get(f"/api/fuse/{job_id}/status").json()
        if status.get("state") in ("done", "error"):
            return status
        time.sleep(0.05)
    return status


def _csv(rows: int = 6) -> bytes:
    frame = pd.DataFrame(
        {
            "customer_id": list(range(1, rows + 1)),
            "amount": [10 * index for index in range(1, rows + 1)],
            "converted": ["yes" if index % 2 else "no" for index in range(rows)],
        }
    )
    return frame.to_csv(index=False).encode("utf-8")


def _upload(client: TestClient, name: str = "customers.csv", headers: dict | None = None) -> str:
    response = client.post(
        "/api/upload",
        files=[("files", (name, _csv(), "text/csv"))],
        headers=headers or {},
    )
    assert response.status_code == 200, response.text
    return response.json()["session"]["id"]


def test_owner_cookie_is_http_only(client):
    response = client.post("/api/upload", files=[("files", ("a.csv", _csv(), "text/csv"))])
    assert response.status_code == 200
    cookie_header = response.headers.get("set-cookie", "")
    assert "df_owner=" in cookie_header
    assert "HttpOnly" in cookie_header
    assert "Path=/" in cookie_header


def test_one_browser_cannot_read_another_browsers_session(client):
    alice = TestClient(main.app)
    bob = TestClient(main.app)

    alice_session = _upload(alice, "alice.csv")
    bob_session = _upload(bob, "bob.csv")
    assert alice_session != bob_session

    assert alice.get(f"/api/session/{alice_session}").status_code == 200
    assert bob.get(f"/api/session/{alice_session}").status_code == 404
    assert alice.get(f"/api/session/{bob_session}").status_code == 404

    # History and reports list only the caller's own work.
    assert [item["id"] for item in alice.get("/api/history").json()] == [alice_session]
    assert [item["id"] for item in bob.get("/api/history").json()] == [bob_session]
    assert alice.get("/api/reports").json() == []
    assert bob.get("/api/reports").json() == []

    # Deletion of a foreign session is refused and the data survives.
    assert bob.delete(f"/api/history/{alice_session}").status_code == 404
    assert alice.get(f"/api/session/{alice_session}").status_code == 200


def test_foreign_session_is_blocked_on_every_endpoint(client):
    alice = TestClient(main.app)
    bob = TestClient(main.app)
    session_id = _upload(alice, "alice.csv")
    bob.get("/api/history")  # give bob his own token

    protected = [
        ("get", f"/api/session/{session_id}", None),
        ("get", f"/api/files/{session_id}/preview?file_id=customers-1", None),
        ("get", f"/api/session/{session_id}/clean", None),
        ("get", f"/api/session/{session_id}/combine", None),
        ("get", f"/api/session/{session_id}/analyse", None),
        ("get", f"/api/session/{session_id}/charts", None),
        ("get", f"/api/session/{session_id}/model", None),
        ("get", f"/api/session/{session_id}/ai-insights", None),
        ("get", f"/api/session/{session_id}/fused/download", None),
        ("get", f"/api/session/{session_id}/predictions/p.csv/download", None),
        ("post", "/api/fuse", {"session_id": session_id}),
        ("post", "/api/train", {"session_id": session_id, "target": "converted"}),
        ("post", "/api/predict", {"session_id": session_id, "values": {}}),
        ("post", "/api/report", {"session_id": session_id}),
        ("post", f"/api/session/{session_id}/ai-insights", {}),
        ("delete", f"/api/session/{session_id}/files/customers-1", None),
        ("delete", f"/api/history/{session_id}", None),
    ]
    for method, path, payload in protected:
        if method == "get":
            response = bob.get(path)
        elif method == "post":
            response = bob.post(path, json=payload)
        else:
            response = bob.delete(path)
        assert response.status_code == 404, f"{method.upper()} {path} leaked: {response.status_code}"
        assert "not found" in response.json()["detail"].lower()


def test_header_token_restores_a_session_when_cookies_are_unavailable(client):
    """A browser that blocks third-party cookies still keeps its workspace."""
    token_a = "a" * 48
    token_b = "b" * 48
    writer = TestClient(main.app)
    session_id = _upload(writer, "alice.csv", headers={"X-DF-Owner": token_a})

    reader = TestClient(main.app)
    restored = reader.get(f"/api/session/{session_id}", headers={"X-DF-Owner": token_a})
    assert restored.status_code == 200
    assert restored.json()["id"] == session_id

    intruder = TestClient(main.app)
    assert intruder.get(f"/api/session/{session_id}", headers={"X-DF-Owner": token_b}).status_code == 404


def test_job_status_is_owner_scoped(client):
    alice = TestClient(main.app)
    bob = TestClient(main.app)
    session_id = _upload(alice, "alice.csv")

    started = alice.post("/api/fuse", json={"session_id": session_id})
    assert started.status_code == 200, started.text
    job_id = started.json()["job_id"]

    assert alice.get(f"/api/fuse/{job_id}/status").status_code == 200
    assert bob.get(f"/api/fuse/{job_id}/status").status_code == 404
    assert bob.post(f"/api/fuse/{job_id}/confirm", json={}).status_code == 404

    assert _wait_for_job(alice, job_id).get("state") in ("done", "error")
