"""
Multi-provider AI service for DataFusion AI.

Provider order:
1. Groq
2. Google Gemini
3. OpenRouter

The AI service explains computed results.
It does not perform data cleaning, fusion, or ML predictions.
"""

from __future__ import annotations

import json
import os
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv


# ---------------------------------------------------------
# Configuration
# ---------------------------------------------------------

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
USAGE_FILE = DATA_DIR / "ai_usage.json"

load_dotenv(BASE_DIR / ".env")

TIMEOUT = int(os.getenv("AI_REQUEST_TIMEOUT", "30"))

PROVIDER_ORDER = [
    provider.strip().lower()
    for provider in os.getenv(
        "AI_PROVIDER_ORDER",
        "groq,gemini,openrouter"
    ).split(",")
    if provider.strip()
]

PROVIDERS = {
    "groq": {
        "api_key": os.getenv("GROQ_API_KEY", ""),
        "model": os.getenv("GROQ_MODEL", ""),
        "url": "https://api.groq.com/openai/v1/chat/completions",
    },
    "gemini": {
        "api_key": os.getenv("GEMINI_API_KEY", ""),
        "model": os.getenv("GEMINI_MODEL", ""),
        "url": "https://generativelanguage.googleapis.com/v1beta/interactions",
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
                records = json.loads(
                    USAGE_FILE.read_text(encoding="utf-8")
                )
            except (json.JSONDecodeError, OSError):
                records = []

        records.append(entry)

        # Keep the latest 5000 records.
        records = records[-5000:]

        temp_file = USAGE_FILE.with_suffix(".tmp")

        temp_file.write_text(
            json.dumps(records, indent=2, default=str),
            encoding="utf-8",
        )

        temp_file.replace(USAGE_FILE)


def get_usage_history(limit: int = 100) -> list[dict[str, Any]]:
    if not USAGE_FILE.exists():
        return []

    with _lock:
        try:
            records = json.loads(
                USAGE_FILE.read_text(encoding="utf-8")
            )
        except (json.JSONDecodeError, OSError):
            return []

    return records[-max(1, min(limit, 1000)):][::-1]


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
        name: {
            "configured": bool(config["api_key"]),
            "model": config["model"],
            "enabled": bool(config["api_key"] and config["model"]),
        }
        for name, config in PROVIDERS.items()
    }


# ---------------------------------------------------------
# Common response helpers
# ---------------------------------------------------------

def _extract_openai_response(
    response: requests.Response,
) -> tuple[str, int, int]:
    
    data = response.json()

    print("\n========== AI PROVIDER RAW RESPONSE ==========")
    print(data)
    print("==============================================\n")

    choices = data.get("choices") or []

    if not choices:
        raise RuntimeError(
            f"Provider returned no choices. Response: {data}"
        )

    message = choices[0].get("message") or {}
    content = message.get("content")

    if isinstance(content, list):
        content = "\n".join(
            part.get("text", "")
            for part in content
            if isinstance(part, dict)
        )

    if not isinstance(content, str) or not content.strip():
        raise RuntimeError(
            f"Provider returned empty content. Response: {data}"
        )

    usage = data.get("usage") or {}

    return (
        content.strip(),
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

    response = requests.post(
        config["url"],
        headers={
            "Authorization": f"Bearer {config['api_key']}",
            "Content-Type": "application/json",
        },
        json={
            "model": config["model"],
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": prompt},
            ],
            "max_completion_tokens": max(max_tokens, 4096),
            "temperature": temperature,
            "reasoning_effort": "low",
            "include_reasoning": False,
        },
        timeout=TIMEOUT,
    )

    response.raise_for_status()

    return _extract_openai_response(response)


# ---------------------------------------------------------
# Gemini - Interactions API
# ---------------------------------------------------------

def _call_gemini(
    prompt: str,
    system_prompt: str,
    max_tokens: int,
    temperature: float,
) -> tuple[str, int, int]:

    config = PROVIDERS["gemini"]

    response = requests.post(
        config["url"],
        headers={
            "x-goog-api-key": config["api_key"],
            "Content-Type": "application/json",
        },
        json={
            "model": config["model"],
            "system_instruction": system_prompt,
            "input": prompt,
            "generation_config": {
                "max_output_tokens": max_tokens,
                "temperature": temperature,
            },
        },
        timeout=TIMEOUT,
    )

    response.raise_for_status()

    data = response.json()

    output_parts = []

    for step in data.get("steps", []):
        if step.get("type") != "model_output":
            continue

        for part in step.get("content", []):
            if part.get("type") == "text":
                output_parts.append(part.get("text", ""))

    content = "\n".join(output_parts).strip()

    if not content:
        raise RuntimeError("Gemini returned an empty response.")

    usage = data.get("usage") or {}

    return (
        content,
        int(usage.get("total_input_tokens", 0) or 0),
        int(usage.get("total_output_tokens", 0) or 0),
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

    response = requests.post(
        config["url"],
        headers={
            "Authorization": f"Bearer {config['api_key']}",
            "Content-Type": "application/json",
            "X-Title": "DataFusion AI",
        },
        json={
            "model": config["model"],
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": prompt},
            ],
            "max_tokens": max(max_tokens, 4096),
            "temperature": temperature,
            "reasoning": {
                "effort": "low",
                "exclude": True,
            },
        },
        timeout=TIMEOUT,
    )

    response.raise_for_status()

    return _extract_openai_response(response)



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

    failures = []

    for provider in PROVIDER_ORDER:

        if provider not in PROVIDER_FUNCTIONS:
            continue

        config = PROVIDERS[provider]

        if not config["api_key"] or not config["model"]:
            continue

        started_at = _now()

        try:
            content, input_tokens, output_tokens = (
                PROVIDER_FUNCTIONS[provider](
                    prompt,
                    system_prompt,
                    max_tokens,
                    temperature,
                )
            )

            entry = {
                "timestamp": _now(),
                "provider": provider,
                "model": config["model"],
                "status": "success",
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "fallback_used": bool(failures),
                "fallback_reason": failures[-1] if failures else None,
                "error": None,
            }

            _save_usage(entry)

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

        except requests.RequestException as exc:
            error = str(exc)

        except (ValueError, RuntimeError, KeyError, IndexError) as exc:
            error = str(exc)

        failures.append({
            "provider": provider,
            "error": error[:500],
        })

        _save_usage({
            "timestamp": _now(),
            "provider": provider,
            "model": config["model"],
            "status": "failed",
            "input_tokens": 0,
            "output_tokens": 0,
            "fallback_used": False,
            "error": error[:500],
        })

    raise RuntimeError(
        "All configured AI providers failed. "
        f"Provider errors: {failures}"
    )