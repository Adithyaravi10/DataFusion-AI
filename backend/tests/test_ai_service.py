from __future__ import annotations

import json

import pytest

from app import ai_service


class FakeResponse:
    def __init__(self, payload=None, status_code=200, headers=None, text=""):
        self._payload = payload
        self.status_code = status_code
        self.headers = headers or {}
        self.text = text

    def json(self):
        if self._payload is None:
            raise ValueError("no json body")
        return self._payload


def test_openai_style_response_extraction():
    response = FakeResponse(
        {
            "choices": [{"message": {"content": "hello"}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 3, "completion_tokens": 4},
        }
    )
    assert ai_service._extract_openai_response(response) == ("hello", 3, 4)


def test_gemini_uses_generate_content_shape(monkeypatch):
    captured: dict = {}

    def fake_post(url, headers=None, json=None, timeout=None):
        captured.update(url=url, headers=headers, body=json)
        return FakeResponse(
            {
                "candidates": [{"content": {"parts": [{"text": "line one"}, {"text": "line two"}]}}],
                "usageMetadata": {"promptTokenCount": 5, "candidatesTokenCount": 6},
            }
        )

    monkeypatch.setattr(ai_service.requests, "post", fake_post)
    monkeypatch.setitem(ai_service.PROVIDERS["gemini"], "model", "gemini-test")

    text, input_tokens, output_tokens = ai_service._call_gemini("hi", "system", 512, 0.2)

    assert captured["url"].endswith("models/gemini-test:generateContent")
    assert captured["body"]["contents"][0]["parts"][0]["text"] == "hi"
    assert captured["body"]["systemInstruction"]["parts"][0]["text"] == "system"
    assert captured["headers"]["x-goog-api-key"] == ai_service.PROVIDERS["gemini"]["api_key"]
    assert (text, input_tokens, output_tokens) == ("line one\nline two", 5, 6)


def test_transient_error_is_retried(monkeypatch):
    calls = {"count": 0}

    def fake_post(*args, **kwargs):
        calls["count"] += 1
        if calls["count"] == 1:
            return FakeResponse({"error": {"message": "busy"}}, status_code=503)
        return FakeResponse({"choices": [{"message": {"content": "recovered"}}], "usage": {}})

    monkeypatch.setattr(ai_service.requests, "post", fake_post)
    monkeypatch.setattr(ai_service, "MAX_RETRIES", 1)
    monkeypatch.setattr(ai_service.time, "sleep", lambda *_: None)

    text, _, _ = ai_service._call_groq("prompt", "system", 512, 0.1)

    assert text == "recovered"
    assert calls["count"] == 2


def test_fallback_logs_every_attempt(monkeypatch, tmp_path):
    usage_file = tmp_path / "usage.json"
    monkeypatch.setattr(ai_service, "USAGE_FILE", usage_file)
    monkeypatch.setattr(ai_service, "PROVIDER_ORDER", ["groq", "openrouter"])
    monkeypatch.setitem(ai_service.PROVIDERS["groq"], "api_key", "test-key")
    monkeypatch.setitem(ai_service.PROVIDERS["groq"], "model", "groq-test")
    monkeypatch.setitem(ai_service.PROVIDERS["openrouter"], "api_key", "test-key")
    monkeypatch.setitem(ai_service.PROVIDERS["openrouter"], "model", "openrouter-test")

    def fail(*args, **kwargs):
        raise RuntimeError("provider down")

    monkeypatch.setitem(ai_service.PROVIDER_FUNCTIONS, "groq", fail)
    monkeypatch.setitem(ai_service.PROVIDER_FUNCTIONS, "openrouter", lambda *a, **k: ("fallback ok", 10, 4))

    result = ai_service.generate_text("prompt")

    assert result["provider"] == "openrouter"
    assert result["fallback_used"] is True
    assert result["fallback_history"] == [{"provider": "groq", "error": "provider down"}]

    records = json.loads(usage_file.read_text(encoding="utf-8"))
    assert [(record["provider"], record["status"]) for record in records] == [
        ("groq", "failed"),
        ("openrouter", "success"),
    ]
    summary = ai_service.get_usage_summary()
    assert summary["total_input_tokens"] == 10
    assert summary["total_output_tokens"] == 4


def test_unconfigured_provider_is_skipped(monkeypatch):
    monkeypatch.setattr(ai_service, "PROVIDER_ORDER", ["groq"])
    monkeypatch.setitem(ai_service.PROVIDERS["groq"], "api_key", "")
    monkeypatch.setitem(ai_service.PROVIDERS["groq"], "model", "")

    with pytest.raises(RuntimeError, match="No AI provider is configured"):
        ai_service.generate_text("prompt")
