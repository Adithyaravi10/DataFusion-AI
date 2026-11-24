from __future__ import annotations

import pandas as pd

from app import main


def test_invalid_ids_are_rejected(client):
    assert client.get("/api/session/..%2F..%2Fetc").status_code == 404
    assert client.get("/api/fuse/..%2F..%2Fstatus").status_code == 404


def test_full_session_flow(client, fused):
    session_id = fused["session_id"]

    session = client.get(f"/api/session/{session_id}").json()
    assert session["status"] == "ready"
    assert len(session["files"]) == 2
    assert session["fusion"]["final_rows"] > 0
    assert session["fusion"]["final_columns"] > 0

    clean = client.get(f"/api/session/{session_id}/clean")
    assert clean.status_code == 200
    assert clean.json()["totals"]["rows_after"] > 0

    combine = client.get(f"/api/session/{session_id}/combine?page=1&page_size=10")
    assert combine.status_code == 200
    assert combine.json()["table"]["total"] > 0

    analyse = client.get(f"/api/session/{session_id}/analyse")
    assert analyse.status_code == 200
    assert analyse.json()["overview"]

    charts = client.get(f"/api/session/{session_id}/charts")
    assert charts.status_code == 200
    payload = charts.json()
    assert payload["correlation"] is not None
    assert payload["boxplots"]

    trained = client.post(
        "/api/train",
        json={"session_id": session_id, "target": "churned", "test_size": 0.25, "cv_folds": 5},
    )
    assert trained.status_code == 200, trained.text
    model = trained.json()["model"]
    assert model["target"] == "churned"
    assert model["task"] == "classification"
    assert model["metrics_table"]

    schema = model["schema"]
    assert schema
    values = {
        field["name"]: field["median"] if field["kind"] == "numeric" else (field.get("options") or [""])[0]
        for field in schema
    }
    prediction = client.post("/api/predict", json={"session_id": session_id, "values": values})
    assert prediction.status_code == 200, prediction.text
    assert prediction.json()["predictions"][0]["prediction"] in {"yes", "no"}

    batch_frame = pd.DataFrame([values])
    batch = client.post(
        f"/api/predict/batch?session_id={session_id}",
        files={"file": ("batch.csv", batch_frame.to_csv(index=False).encode("utf-8"), "text/csv")},
    )
    assert batch.status_code == 200, batch.text
    assert batch.json()["total"] == 1

    predictions_csv = client.get(batch.json()["download"])
    assert predictions_csv.status_code == 200
    assert "predictions.csv" in predictions_csv.headers.get("content-disposition", "")

    report = client.post("/api/report", json={"session_id": session_id})
    assert report.status_code == 200, report.text
    downloads = report.json()["downloads"]

    pdf = client.get(downloads["pdf"])
    assert pdf.status_code == 200
    assert pdf.content.startswith(b"%PDF")

    workbook = client.get(downloads["xlsx"])
    assert workbook.status_code == 200
    assert workbook.content[:2] == b"PK"

    fused_csv = client.get(downloads["csv"])
    assert fused_csv.status_code == 200
    assert b"churned" in fused_csv.content.lower()

    assert client.get(f"/api/session/{session_id}/model").status_code == 200
    assert client.get("/api/history").status_code == 200
    assert client.get("/api/reports").status_code == 200


def test_ai_endpoints_use_computed_context(client, fused, monkeypatch):
    session_id = fused["session_id"]
    captured: dict = {}

    def fake_generate(**kwargs):
        captured.update(kwargs)
        return {
            "response": "The strongest computed correlation is reported above.",
            "provider": "groq",
            "model": "test-model",
            "input_tokens": 12,
            "output_tokens": 7,
            "fallback_used": False,
            "fallback_history": [],
        }

    monkeypatch.setattr(main.ai_service, "generate_text", fake_generate)

    response = client.post(
        f"/api/session/{session_id}/ai-insights",
        json={"question": "What matters most?"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["provider"] == "groq"
    assert body["input_tokens"] == 12

    prompt = captured["prompt"]
    assert "Computed results" in prompt
    assert "churned" in prompt
    assert "What matters most?" in prompt

    cached = client.get(f"/api/session/{session_id}/ai-insights")
    assert cached.status_code == 200
    assert cached.json()["insights"]["response"].startswith("The strongest")

    providers = client.get("/api/ai/providers").json()
    assert set(providers["providers"]) == {"groq", "gemini", "openrouter"}
    assert client.get("/api/ai/usage").status_code == 200
    assert client.get("/api/ai/history?limit=5").status_code == 200


def test_ai_failure_is_reported_as_bad_gateway(client, fused, monkeypatch):
    session_id = fused["session_id"]

    def fail(**kwargs):
        raise RuntimeError("All configured AI providers failed. groq: down")

    monkeypatch.setattr(main.ai_service, "generate_text", fail)

    response = client.post(f"/api/session/{session_id}/ai-insights", json={})
    assert response.status_code == 502
    assert "All configured AI providers failed" in response.json()["detail"]
