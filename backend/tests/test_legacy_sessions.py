"""Ownerless (pre-ownership) sessions must stay invisible and unclaimable.

A session written before ownership existed has no ``owner`` field. It must not
be listed for anyone and must not be adoptable by whoever opens it first; only
an explicit operator action may assign it.
"""
from __future__ import annotations

import pandas as pd
from fastapi.testclient import TestClient

from app import main, store


def _csv() -> bytes:
    return pd.DataFrame(
        {
            "customer_id": [1, 2, 3],
            "amount": [10, 20, 30],
            "converted": ["yes", "no", "yes"],
        }
    ).to_csv(index=False).encode("utf-8")


def _legacy_session() -> str:
    return store.create_session([], "legacy upload", owner=None)["id"]


def _upload(client: TestClient, name: str) -> str:
    response = client.post("/api/upload", files=[("files", (name, _csv(), "text/csv"))])
    assert response.status_code == 200, response.text
    return response.json()["session"]["id"]


def test_ownerless_session_is_hidden_from_every_browser(client):
    legacy = _legacy_session()
    alice = TestClient(main.app)
    bob = TestClient(main.app)

    alice_session = _upload(alice, "alice.csv")
    bob_session = _upload(bob, "bob.csv")

    assert legacy not in [item["id"] for item in alice.get("/api/history").json()]
    assert legacy not in [item["id"] for item in bob.get("/api/history").json()]
    assert [item["id"] for item in alice.get("/api/history").json()] == [alice_session]
    assert [item["id"] for item in bob.get("/api/history").json()] == [bob_session]


def test_ownerless_session_cannot_be_adopted_by_opening_it(client):
    legacy = _legacy_session()
    alice = TestClient(main.app)
    bob = TestClient(main.app)

    assert alice.get(f"/api/session/{legacy}").status_code == 404
    assert bob.get(f"/api/session/{legacy}").status_code == 404
    # Neither visit wrote an owner: the session still belongs to nobody.
    assert store.load_meta(legacy).get("owner") is None


def test_ownerless_session_is_blocked_on_data_routes(client):
    legacy = _legacy_session()
    store.save_job(
        {
            "id": "legacyjob01",
            "session_id": legacy,
            "state": "done",
            "progress": 100,
            "stages": [],
            "created_at": store.now_iso(),
        }
    )
    browser = TestClient(main.app)

    assert browser.get(f"/api/session/{legacy}/clean").status_code == 404
    assert browser.get(f"/api/session/{legacy}/combine").status_code == 404
    assert browser.get(f"/api/session/{legacy}/analyse").status_code == 404
    assert browser.get(f"/api/session/{legacy}/charts").status_code == 404
    assert browser.get(f"/api/session/{legacy}/model").status_code == 404
    assert browser.get(f"/api/session/{legacy}/fused/download").status_code == 404
    assert browser.get(f"/api/session/{legacy}/clean/customers-1/download").status_code == 404
    assert browser.get(f"/api/session/{legacy}/predictions/p.csv/download").status_code == 404
    assert browser.get(f"/api/reports/{legacy}/abc123/download").status_code == 404
    assert browser.get("/api/fuse/legacyjob01/status").status_code == 404
    assert browser.post("/api/fuse", json={"session_id": legacy}).status_code == 404
    assert browser.post("/api/report", json={"session_id": legacy}).status_code == 404
    assert browser.delete(f"/api/history/{legacy}").status_code == 404
    assert browser.get("/api/reports").json() == []


def test_explicit_migration_is_required_and_then_grants_access(client):
    legacy = _legacy_session()
    token = "d" * 48
    owner = main._owner_digest(token)

    assert store.claim_legacy_sessions(owner, session_ids=[legacy], dry_run=True) == [legacy]
    assert store.load_meta(legacy).get("owner") is None, "dry run must not write"

    assert store.claim_legacy_sessions(owner, session_ids=[legacy], dry_run=False) == [legacy]
    assert store.load_meta(legacy)["owner"] == owner

    owner_browser = TestClient(main.app)
    assert (
        owner_browser.get(f"/api/session/{legacy}", headers={"X-DF-Owner": token}).status_code
        == 200
    )

    stranger = TestClient(main.app)
    assert (
        stranger.get(f"/api/session/{legacy}", headers={"X-DF-Owner": "e" * 48}).status_code == 404
    )


def test_owning_browser_still_sees_its_own_sessions(client):
    browser = TestClient(main.app)
    first = _upload(browser, "first.csv")
    second = _upload(browser, "second.csv")

    assert {item["id"] for item in browser.get("/api/history").json()} == {first, second}
    assert browser.get(f"/api/session/{first}").status_code == 200
    assert browser.get(f"/api/session/{second}").status_code == 200
