"""Persistent storage configuration and restart behaviour."""
from __future__ import annotations

import pandas as pd

from app import jobs, store


def _csv() -> bytes:
    return pd.DataFrame(
        {"customer_id": [1, 2, 3], "amount": [10, 20, 30], "converted": ["yes", "no", "yes"]}
    ).to_csv(index=False).encode("utf-8")


def test_data_dir_defaults_to_backend_data(monkeypatch):
    monkeypatch.delenv("DATA_DIR", raising=False)
    assert store._resolve_data_dir() == store.BASE_DIR / "data"


def test_data_dir_honours_an_absolute_mount(monkeypatch, tmp_path):
    mount = tmp_path / "volume"
    monkeypatch.setenv("DATA_DIR", str(mount))
    assert store._resolve_data_dir() == mount


def test_data_dir_resolves_relative_paths_against_the_backend(monkeypatch):
    monkeypatch.setenv("DATA_DIR", "storage")
    assert store._resolve_data_dir() == (store.BASE_DIR / "storage").resolve()


def test_storage_status_describes_the_active_directory(client):
    status = client.get("/api/health").json()["storage"]
    assert status["data_dir"] == str(store.DATA_DIR)
    assert status["sessions_dir"] == str(store.SESSIONS_DIR)
    assert status["writable"] is True
    assert isinstance(status["configured"], bool)


def test_session_artifacts_are_written_to_disk_and_survive_a_restart(client):
    response = client.post("/api/upload", files=[("files", ("customers.csv", _csv(), "text/csv"))])
    assert response.status_code == 200, response.text
    session_id = response.json()["session"]["id"]

    folder = store.SESSIONS_DIR / session_id
    assert (folder / "meta.json").is_file()
    assert (folder / "raw").is_dir()

    meta = store.load_meta(session_id)
    assert meta.get("owner"), "the session must record its owner"

    # A backend restart only loses in-process state; disk state is the source
    # of truth, so the workspace must still load.
    jobs._registry.clear()
    assert client.get(f"/api/session/{session_id}").status_code == 200
    assert any(item["id"] == session_id for item in client.get("/api/history").json())
