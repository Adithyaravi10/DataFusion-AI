"""
Multi-provider AI service for DataFusion AI.

Provider order: Groq -> Google Gemini -> OpenRouter.
The AI service explains computed results; it never performs fusion or ML.
"""

from __future__ import annotations

import json
import os
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

import requests
from dotenv import load_dotenv

# ---------------------------------------------------------
# Configuration
# ---------------------------------------------------------

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
USAGE_FILE = DATA_DIR / "ai_usage.json"

load_dotenv(BASE_DIR / ".env")


def _env_int(name: str, default: int, minimum: int = 0) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default
    return max(minimum, value)


TIMEOUT = _env_int("AI_REQUEST_TIMEOUT", 30, minimum=5)
MAX_RETRIES = _env_int("AI_MAX_RETRIES", 2, minimum=0)
RETRY_BACKOFF_SECONDS = 0.8

PROVIDER_ORDER = [
    provider.strip().lower()
    for provider in os.getenv("AI_PROVIDER_ORDER", "groq,gemini,openrouter").split(",")
    if provider.strip()
]

GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models"

PROVIDERS = {
    "groq": {
        "api_key": os.getenv("GROQ_API_KEY", ""),
        "model": os.getenv("GROQ_MODEL", ""),
        "url": "https://api.groq.com/openai/v1/chat/completions",
    },
    "gemini": {
        "api_key": os.getenv("GEMINI_API_KEY", ""),
        "model": os.getenv("GEMINI_MODEL", ""),
        "url": f"{GEMINI_BASE_URL}/{{model}}:generateContent",
    },
    "openrouter": {
        "api_key": os.getenv("OPENROUTER_API_KEY", ""),
        "model": os.getenv("OPENROUTER_MODEL", ""),
        "url": "https://openrouter.ai/api/v1/chat/completions",
    },
}

_lock = threading.RLock()


# ---------------------------------------------------------
# Usage tracking
# ---------------------------------------------------------

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _save_usage(entry: dict[str, Any]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    with _lock:
        records = []

        if USAGE_FILE.exists():
            try:
                records = json.loads(USAGE_FILE.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                records = []

        records.append(entry)
        records = records[-5000:]

        temp_file = USAGE_FILE.with_suffix(".tmp")
        temp_file.write_text(json.dumps(records, indent=2, default=str), encoding="utf-8")
        temp_file.replace(USAGE_FILE)


def get_usage_history(limit: int = 100) -> list[dict[str, Any]]:
    if not USAGE_FILE.exists():
        return []

    with _lock:
        try:
            records = json.loads(USAGE_FILE.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return []

    recent = records[-max(1, min(limit, 1000)):][::-1]
    # Older records (from before the current implementation) could contain a
    # full provider payload in the error field. Never expose more than a short
    # message; new records are already bounded at write time.
    trimmed: list[dict[str, Any]] = []
    for record in recent:
        item = dict(record)
        if item.get("error"):
            item["error"] = str(item["error"])[:300]
        if item.get("fallback_reason"):
            item["fallback_reason"] = str(item["fallback_reason"])[:300]
        trimmed.append(item)
    return trimmed


def get_usage_summary() -> dict[str, Any]:
    records = get_usage_history(5000)

    summary = {
        "total_requests": len(records),
        "successful_requests": 0,
        "failed_requests": 0,
        "total_input_tokens": 0,
        "total_output_tokens": 0,
        "providers": {},
    }

    for item in records:
        provider = item.get("provider", "unknown")

        provider_stats = summary["providers"].setdefault(
            provider,
            {
                "requests": 0,
                "successes": 0,
                "failures": 0,
                "input_tokens": 0,
                "output_tokens": 0,
            },
        )

        provider_stats["requests"] += 1

        if item.get("status") == "success":
            summary["successful_requests"] += 1
            provider_stats["successes"] += 1
        else:
            summary["failed_requests"] += 1
            provider_stats["failures"] += 1

        input_tokens = int(item.get("input_tokens", 0) or 0)
        output_tokens = int(item.get("output_tokens", 0) or 0)

        summary["total_input_tokens"] += input_tokens
        summary["total_output_tokens"] += output_tokens

        provider_stats["input_tokens"] += input_tokens
        provider_stats["output_tokens"] += output_tokens

    return summary


# ---------------------------------------------------------
# Provider configuration
# ---------------------------------------------------------

def get_provider_status() -> dict[str, Any]:
    return {
        "order": PROVIDER_ORDER,
        "providers": {
            name: {
                "configured": bool(config["api_key"]),
                "enabled": bool(config["api_key"] and config["model"]),
                "model": config["model"],
                "position": PROVIDER_ORDER.index(name) + 1 if name in PROVIDER_ORDER else None,
            }
            for name, config in PROVIDERS.items()
        },
    }


# ---------------------------------------------------------
# HTTP helper
# ---------------------------------------------------------

def _error_snippet(response: requests.Response, limit: int = 300) -> str:
    """Readable provider error without echoing credentials or the full body."""
    try:
        payload = response.json()
    except ValueError:
        return (response.text or "").strip()[:limit]

    if isinstance(payload, dict):
        error = payload.get("error")
        if isinstance(error, dict):
            message = error.get("message") or error.get("status") or ""
            return str(message)[:limit]
        if isinstance(error, str):
            return error[:limit]
    return json.dumps(payload, default=str)[:limit]


def _post_with_retries(
    url: str,
    *,
    headers: dict[str, str],
    body: dict[str, Any],
    provider: str,
) -> requests.Response:
    """POST once and retry transient failures (429 / 5xx / network) only."""
    last_error: Exception | None = None
    attempts = MAX_RETRIES + 1

    for attempt in range(attempts):
        try:
            response = requests.post(url, headers=headers, json=body, timeout=TIMEOUT)
        except requests.RequestException as exc:
            last_error = exc
            if attempt + 1 < attempts:
                time.sleep(RETRY_BACKOFF_SECONDS * (attempt + 1))
                continue
            raise

        if response.status_code == 429 or response.status_code >= 500:
            last_error = RuntimeError(
                f"{provider} returned HTTP {response.status_code}: {_error_snippet(response)}"
            )
            if attempt + 1 < attempts:
                retry_after = response.headers.get("retry-after")
                delay = RETRY_BACKOFF_SECONDS * (attempt + 1)
                if retry_after:
                    try:
                        delay = min(10.0, max(delay, float(retry_after)))
                    except ValueError:
                        pass
                time.sleep(delay)
                continue
            raise last_error

        if response.status_code >= 400:
            raise RuntimeError(
                f"{provider} returned HTTP {response.status_code}: {_error_snippet(response)}"
            )
        return response

    raise last_error or RuntimeError(f"{provider} request failed without a response.")


# ---------------------------------------------------------
# Common response helpers
# ---------------------------------------------------------

def _text_from_content(content: Any) -> str:
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts = [
            part.get("text", "")
            for part in content
            if isinstance(part, dict) and part.get("type", "text") == "text"
        ]
        return "\n".join(part for part in parts if part).strip()
    return ""


def _extract_openai_response(response: requests.Response) -> tuple[str, int, int]:
    data = response.json()
    choices = data.get("choices") or []

    if not choices:
        raise RuntimeError("Provider returned no choices.")

    choice = choices[0] or {}
    content = _text_from_content((choice.get("message") or {}).get("content"))
    if not content:
        content = _text_from_content(choice.get("text"))

    if not content:
        finish_reason = choice.get("finish_reason")
        suffix = f" (finish reason: {finish_reason})" if finish_reason else ""
        raise RuntimeError(f"Provider returned an empty message{suffix}.")

    usage = data.get("usage") or {}
    return (
        content,
        int(usage.get("prompt_tokens", 0) or 0),
        int(usage.get("completion_tokens", 0) or 0),
    )


# ---------------------------------------------------------
# Groq
# ---------------------------------------------------------

def _call_groq(
    prompt: str,
    system_prompt: str,
    max_tokens: int,
    temperature: float,
) -> tuple[str, int, int]:
    config = PROVIDERS["groq"]
    response = _post_with_retries(
        config["url"],
        headers={
            "Authorization": f"Bearer {config['api_key']}",
            "Content-Type": "application/json",
        },
        body={
            "model": config["model"],
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": prompt},
            ],
            "max_completion_tokens": max(1024, max_tokens),
            "temperature": temperature,
        },
        provider="groq",
    )
    return _extract_openai_response(response)


# ---------------------------------------------------------
# Gemini - generateContent
# ---------------------------------------------------------

def _call_gemini(
    prompt: str,
    system_prompt: str,
    max_tokens: int,
    temperature: float,
) -> tuple[str, int, int]:
    config = PROVIDERS["gemini"]
    url = config["url"].format(model=config["model"])

    response = _post_with_retries(
        url,
        headers={
            "x-goog-api-key": config["api_key"],
            "Content-Type": "application/json",
        },
        body={
            "systemInstruction": {"parts": [{"text": system_prompt}]},
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {
                "maxOutputTokens": max(512, max_tokens),
                "temperature": temperature,
            },
        },
        provider="gemini",
    )

    data = response.json()
    candidates = data.get("candidates") or []

    if not candidates:
        feedback = data.get("promptFeedback") or {}
        reason = feedback.get("blockReason") or "no candidates returned"
        raise RuntimeError(f"Gemini returned no content ({reason}).")

    parts = ((candidates[0] or {}).get("content") or {}).get("parts") or []
    content = "\n".join(
        str(part.get("text", ""))
        for part in parts
        if isinstance(part, dict) and part.get("text")
    ).strip()

    if not content:
        finish_reason = (candidates[0] or {}).get("finishReason") or "unknown"
        raise RuntimeError(f"Gemini returned an empty response (finish reason: {finish_reason}).")

    usage = data.get("usageMetadata") or {}
    return (
        content,
        int(usage.get("promptTokenCount", 0) or 0),
        int(usage.get("candidatesTokenCount", 0) or 0),
    )


# ---------------------------------------------------------
# OpenRouter
# ---------------------------------------------------------

def _call_openrouter(
    prompt: str,
    system_prompt: str,
    max_tokens: int,
    temperature: float,
) -> tuple[str, int, int]:
    config = PROVIDERS["openrouter"]
    response = _post_with_retries(
        config["url"],
        headers={
            "Authorization": f"Bearer {config['api_key']}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://datafusion.local",
            "X-Title": "DataFusion AI",
        },
        body={
            "model": config["model"],
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": prompt},
            ],
            "max_tokens": max(1024, max_tokens),
            "temperature": temperature,
        },
        provider="openrouter",
    )
    return _extract_openai_response(response)


# ---------------------------------------------------------
# Dispatch
# ---------------------------------------------------------

PROVIDER_FUNCTIONS: dict[str, Callable[[str, str, int, float], tuple[str, int, int]]] = {
    "groq": _call_groq,
    "gemini": _call_gemini,
    "openrouter": _call_openrouter,
}


def configured_providers() -> list[str]:
    """Providers that can be attempted, in the configured order."""
    enabled: list[str] = []
    for provider in PROVIDER_ORDER:
        if provider not in PROVIDER_FUNCTIONS:
            continue
        config = PROVIDERS.get(provider) or {}
        if config.get("api_key") and config.get("model"):
            enabled.append(provider)
    return enabled


def generate_text(
    prompt: str,
    system_prompt: str = (
        "You are DataFusion AI, an expert data analysis assistant. "
        "Explain results accurately. Never invent statistics."
    ),
    max_tokens: int = 1200,
    temperature: float = 0.3,
) -> dict[str, Any]:
    if not prompt.strip():
        raise ValueError("AI prompt cannot be empty.")

    candidates = configured_providers()
    if not candidates:
        raise RuntimeError(
            "No AI provider is configured. Set GROQ_API_KEY/GROQ_MODEL, "
            "GEMINI_API_KEY/GEMINI_MODEL or OPENROUTER_API_KEY/OPENROUTER_MODEL "
            "in backend/.env."
        )

    failures: list[dict[str, str]] = []

    for provider in candidates:
        config = PROVIDERS[provider]
        started_at = _now()

        try:
            content, input_tokens, output_tokens = PROVIDER_FUNCTIONS[provider](
                prompt,
                system_prompt,
                max_tokens,
                temperature,
            )
        except Exception as exc:  # noqa: BLE001 - report every failure, then fall back
            error = str(exc) or exc.__class__.__name__
            failures.append({"provider": provider, "error": error[:500]})
            _save_usage(
                {
                    "timestamp": _now(),
                    "provider": provider,
                    "model": config["model"],
                    "status": "failed",
                    "input_tokens": 0,
                    "output_tokens": 0,
                    "fallback_used": False,
                    "error": error[:500],
                }
            )
            continue

        _save_usage(
            {
                "timestamp": _now(),
                "provider": provider,
                "model": config["model"],
                "status": "success",
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "fallback_used": bool(failures),
                "fallback_reason": failures[-1]["error"] if failures else None,
                "error": None,
            }
        )

        return {
            "success": True,
            "response": content,
            "provider": provider,
            "model": config["model"],
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "fallback_used": bool(failures),
            "fallback_history": failures,
            "timestamp": started_at,
        }

    raise RuntimeError(
        "All configured AI providers failed. "
        + " | ".join(f"{item['provider']}: {item['error']}" for item in failures)
    )
