"""Disk-backed session and job storage.

Everything the UI later reports lives in a session folder under backend/data:
raw uploads, cleaned parquet/pickle caches, the fused dataset, the trained
model, generated reports and a metadata JSON document.
"""
from __future__ import annotations

import json
import os
import shutil
import threading
import uuid
from datetime import datetime, timedelta, timezone, tzinfo
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
SESSIONS_DIR = DATA_DIR / "sessions"
JOBS_DIR = DATA_DIR / "jobs"

_lock = threading.RLock()


def now_iso() -> str:
    """Storage timestamp (UTC). Kept in UTC so ordering is unambiguous."""
    return datetime.now(timezone.utc).isoformat()


# Human-facing times (dashboard activity and processing logs) are shown in one
# fixed zone, whatever timezone the server or the browser happens to use.
DISPLAY_TIMEZONE_NAME = os.getenv("APP_TIMEZONE", "").strip() or "Asia/Kolkata"


def _resolve_timezone(name: str) -> tzinfo:
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError, OSError):
        pass
    if name in {"Asia/Kolkata", "Asia/Calcutta"}:
        # Windows and slim containers can ship without the IANA database. IST
        # has no daylight saving, so a fixed offset is exact.
        return timezone(timedelta(hours=5, minutes=30), "IST")
    return timezone.utc


DISPLAY_TIMEZONE = _resolve_timezone(DISPLAY_TIMEZONE_NAME)


def now_local() -> datetime:
    """Current wall-clock time in the display timezone (IST by default)."""
    return datetime.now(DISPLAY_TIMEZONE)


def local_timestamp(moment: datetime | None = None) -> dict[str, str]:
    """A log stamp in the display timezone: clock time plus a full ISO value."""
    at = now_local() if moment is None else moment.astimezone(DISPLAY_TIMEZONE)
    return {"at": at.strftime("%H:%M:%S"), "at_iso": at.isoformat(timespec="seconds")}


def new_id() -> str:
    return uuid.uuid4().hex[:12]


def ensure_dirs() -> None:
    SESSIONS_DIR.mkdir(parents=True, exist_ok=True)
    JOBS_DIR.mkdir(parents=True, exist_ok=True)


def session_dir(session_id: str) -> Path:
    return SESSIONS_DIR / session_id


def meta_path(session_id: str) -> Path:
    return session_dir(session_id) / "meta.json"


def load_meta(session_id: str) -> dict[str, Any]:
    path = meta_path(session_id)
    if not path.exists():
        raise FileNotFoundError(f"Session {session_id} not found")
    with _lock:
        return json.loads(path.read_text(encoding="utf-8"))


def save_meta(meta: dict[str, Any]) -> None:
    meta["updated_at"] = now_iso()
    path = meta_path(meta["id"])
    path.parent.mkdir(parents=True, exist_ok=True)
    with _lock:
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(meta, indent=2, default=str), encoding="utf-8")
        tmp.replace(path)


def create_session(files: list[dict[str, Any]], name: str) -> dict[str, Any]:
    ensure_dirs()
    session_id = new_id()
    folder = session_dir(session_id)
    (folder / "raw").mkdir(parents=True, exist_ok=True)
    (folder / "processed").mkdir(parents=True, exist_ok=True)
    (folder / "reports").mkdir(parents=True, exist_ok=True)
    meta = {
        "id": session_id,
        "name": name,
        "created_at": now_iso(),
        "updated_at": now_iso(),
        "status": "uploaded",
        "files": files,
        "fusion": None,
        "model": None,
        "reports": [],
        "job_id": None,
    }
    save_meta(meta)
    return meta


def list_sessions() -> list[dict[str, Any]]:
    ensure_dirs()
    sessions: list[dict[str, Any]] = []
    for folder in SESSIONS_DIR.iterdir():
        if not folder.is_dir():
            continue
        try:
            sessions.append(load_meta(folder.name))
        except (FileNotFoundError, json.JSONDecodeError):
            continue
    return sorted(sessions, key=lambda s: s.get("created_at", ""), reverse=True)


def delete_session(session_id: str) -> None:
    folder = session_dir(session_id)
    if folder.exists():
        shutil.rmtree(folder, ignore_errors=True)
    ensure_dirs()
    for job_file in JOBS_DIR.glob("*.json"):
        try:
            job = json.loads(job_file.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        if job.get("session_id") == session_id:
            job_file.unlink(missing_ok=True)


def list_all_reports() -> list[dict[str, Any]]:
    reports: list[dict[str, Any]] = []
    for meta in list_sessions():
        for report in meta.get("reports", []):
            reports.append({**report, "session_id": meta["id"], "session_name": meta.get("name")})
    return sorted(reports, key=lambda r: r.get("created_at", ""), reverse=True)


# ---------------------------------------------------------------- jobs

def save_job(job: dict[str, Any]) -> None:
    ensure_dirs()
    path = JOBS_DIR / f"{job['id']}.json"
    with _lock:
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(job, indent=2, default=str), encoding="utf-8")
        tmp.replace(path)


def load_job(job_id: str) -> dict[str, Any] | None:
    path = JOBS_DIR / f"{job_id}.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None


def latest_job_for_session(session_id: str) -> dict[str, Any] | None:
    ensure_dirs()
    best = None
    for path in JOBS_DIR.glob("*.json"):
        try:
            job = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        if job.get("session_id") != session_id:
            continue
        if best is None or job.get("created_at", "") > best.get("created_at", ""):
            best = job
    return best
