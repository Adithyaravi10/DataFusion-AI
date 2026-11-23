"""Fusion job state shared between the background pipeline and the API."""
from __future__ import annotations

import threading
from datetime import datetime, timezone
from typing import Any

from .store import load_job, new_id, now_iso, save_job

STAGE_DEFINITIONS = [
    ("reading", "Reading files"),
    ("profiling", "Profiling"),
    ("cleaning", "Cleaning"),
    ("preprocessing", "Preprocessing"),
    ("key_matching", "Key detection & matching"),
    ("merging", "Merging & reconciliation"),
    ("validation", "Final validation"),
]

_registry: dict[str, "FusionJob"] = {}
_registry_lock = threading.Lock()


class FusionJob:
    def __init__(self, session_id: str, options: dict[str, Any] | None = None, job_id: str | None = None):
        self.id = job_id or new_id()
        self.session_id = session_id
        self.options = options or {}
        self.created_at = now_iso()
        self.state = "running"  # running | awaiting_confirmation | done | error
        self.error: str | None = None
        self.needs: dict[str, Any] | None = None
        self.summary: dict[str, Any] | None = None
        self.progress = 0
        self.cache: dict[str, Any] = {}
        self.stages = [
            {
                "key": key,
                "label": label,
                "status": "pending",
                "started_at": None,
                "finished_at": None,
                "duration_ms": None,
                "logs": [],
            }
            for key, label in STAGE_DEFINITIONS
        ]
        self._confirm = threading.Event()
        self._confirmed_payload: dict[str, Any] | None = None
        self._lock = threading.Lock()

    # ---------------------------------------------------------------- stages
    def stage(self, key: str) -> dict[str, Any]:
        for stage in self.stages:
            if stage["key"] == key:
                return stage
        raise KeyError(key)

    def start(self, key: str) -> None:
        stage = self.stage(key)
        stage["status"] = "running"
        stage["started_at"] = now_iso()
        self._recompute()
        self.save()

    def log(self, key: str, message: str) -> None:
        stage = self.stage(key)
        stage["logs"].append({"at": datetime.now(timezone.utc).strftime("%H:%M:%S"), "message": message})
        self.save()

    def finish(self, key: str) -> None:
        stage = self.stage(key)
        if stage["status"] != "running":
            stage["status"] = "running"
        now = datetime.now(timezone.utc)
        stage["status"] = "done"
        stage["finished_at"] = now.isoformat()
        started = stage.get("started_at")
        if started:
            try:
                delta = now - datetime.fromisoformat(started)
                stage["duration_ms"] = int(delta.total_seconds() * 1000)
            except ValueError:
                stage["duration_ms"] = 0
        self._recompute()
        self.save()

    def fail(self, key: str, message: str) -> None:
        stage = self.stage(key)
        stage["status"] = "error"
        stage["finished_at"] = now_iso()
        stage["logs"].append({"at": datetime.now(timezone.utc).strftime("%H:%M:%S"), "message": message})
        self.state = "error"
        self.error = message
        self.needs = None
        self._recompute()
        self.save()

    def _recompute(self) -> None:
        done = sum(1 for stage in self.stages if stage["status"] == "done")
        if self.state == "done":
            self.progress = 100
        else:
            self.progress = int(round(done / len(self.stages) * 100))

    # ---------------------------------------------------------- confirmation
    def request_confirmation(self, payload: dict[str, Any]) -> None:
        self.state = "awaiting_confirmation"
        self.needs = payload
        self._confirm.clear()
        self.save()

    def wait_for_confirmation(self, timeout_seconds: int = 1800) -> dict[str, Any]:
        if not self._confirm.wait(timeout=timeout_seconds):
            raise TimeoutError("Timed out waiting for join-key confirmation.")
        payload = self._confirmed_payload or {}
        self._confirmed_payload = None
        return payload

    def confirm(self, payload: dict[str, Any]) -> None:
        self._confirmed_payload = payload
        self.state = "running"
        self.needs = None
        self._confirm.set()
        self.save()

    # -------------------------------------------------------------- snapshot
    def snapshot(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "session_id": self.session_id,
            "created_at": self.created_at,
            "state": self.state,
            "progress": self.progress,
            "error": self.error,
            "needs": self.needs,
            "summary": self.summary,
            "stages": self.stages,
        }

    def save(self) -> None:
        with self._lock:
            save_job(self.snapshot())

    def finish_job(self, summary: dict[str, Any]) -> None:
        self.summary = summary
        self.state = "done"
        self.progress = 100
        self.needs = None
        self.save()


def register(job: FusionJob) -> FusionJob:
    with _registry_lock:
        _registry[job.id] = job
    job.save()
    return job


def get_job(job_id: str) -> FusionJob | None:
    with _registry_lock:
        if job_id in _registry:
            return _registry[job_id]
    stored = load_job(job_id)
    if stored is None:
        return None
    job = FusionJob(stored["session_id"], job_id=job_id)
    job.state = stored.get("state", "error")
    job.progress = stored.get("progress", 0)
    job.error = stored.get("error")
    job.needs = stored.get("needs")
    job.summary = stored.get("summary")
    job.stages = stored.get("stages", job.stages)
    if job.state in ("running", "awaiting_confirmation"):
        job.state = "error"
        job.error = "The backend restarted before this job finished. Start a new fusion."
    return job


def is_live(job_id: str) -> bool:
    with _registry_lock:
        return job_id in _registry


def snapshot(job_id: str) -> dict[str, Any] | None:
    job = get_job(job_id)
    return job.snapshot() if job else None
