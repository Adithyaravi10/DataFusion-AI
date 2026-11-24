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
import time
import uuid
from datetime import datetime, timedelta, timezone, tzinfo
from pathlib import Path
from typing import Any, Iterator
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

BASE_DIR = Path(__file__).resolve().parent.parent


def _resolve_data_dir() -> Path:
    """Storage root: ``DATA_DIR`` when set, otherwise ``backend/data``.

    On hosts with an ephemeral filesystem (Railway without a volume) the
    default disappears on every restart, so ``DATA_DIR`` exists to point at a
    mounted volume. Relative values resolve against ``backend/``.
    """
    configured = os.getenv("DATA_DIR", "").strip()
    if not configured:
        return BASE_DIR / "data"
    path = Path(configured).expanduser()
    return path if path.is_absolute() else (BASE_DIR / path).resolve()


DATA_DIR = _resolve_data_dir()
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


def _atomic_write(path: Path, text: str) -> None:
    """Write via a temp file and rename, retrying briefly.

    On Windows a concurrent reader keeps the destination open, which makes
    the rename fail transiently; the payload is already durable, so retrying
    is safe and avoids losing a job update.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(text, encoding="utf-8")
    last_error: OSError | None = None
    for attempt in range(20):
        try:
            tmp.replace(path)
            return
        except OSError as exc:  # pragma: no cover - platform specific
            last_error = exc
            time.sleep(0.01 * (attempt + 1))
    tmp.unlink(missing_ok=True)
    if last_error is not None:
        raise last_error


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
        _atomic_write(path, json.dumps(meta, indent=2, default=str))


def create_session(files: list[dict[str, Any]], name: str, owner: str | None = None) -> dict[str, Any]:
    ensure_dirs()
    session_id = new_id()
    folder = session_dir(session_id)
    (folder / "raw").mkdir(parents=True, exist_ok=True)
    (folder / "processed").mkdir(parents=True, exist_ok=True)
    (folder / "reports").mkdir(parents=True, exist_ok=True)
    meta = {
        "id": session_id,
        "owner": owner,
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


def _iter_session_metas() -> Iterator[dict[str, Any]]:
    """Yield every readable session document (unreadable ones are skipped)."""
    ensure_dirs()
    for folder in SESSIONS_DIR.iterdir():
        if not folder.is_dir():
            continue
        try:
            yield load_meta(folder.name)
        except (FileNotFoundError, json.JSONDecodeError):
            continue


def list_sessions(owner: str | None = None) -> list[dict[str, Any]]:
    """All sessions, or only the exact owner's when one is supplied.

    Sessions created before ownership existed have no owner and are never
    listed for a browser: they belong to nobody until an operator assigns
    them explicitly (see ``claim_legacy_sessions``).
    """
    sessions = [
        meta for meta in _iter_session_metas() if owner is None or meta.get("owner") == owner
    ]
    return sorted(sessions, key=lambda s: s.get("created_at", ""), reverse=True)


def list_legacy_sessions() -> list[dict[str, Any]]:
    """Sessions with no owner yet (pre-ownership data)."""
    sessions = [meta for meta in _iter_session_metas() if meta.get("owner") is None]
    return sorted(sessions, key=lambda s: s.get("created_at", ""), reverse=True)


def claim_legacy_sessions(
    owner: str,
    session_ids: list[str] | None = None,
    dry_run: bool = True,
) -> list[str]:
    """Explicitly bind ownerless sessions to one owner hash.

    Deliberately manual: no request path calls this, so a visitor can never
    adopt another person's pre-ownership session. Only sessions that currently
    have ``owner is None`` are touched; files are never deleted.
    """
    if not owner:
        raise ValueError("An owner hash is required to claim legacy sessions.")
    claimed: list[str] = []
    for meta in list_legacy_sessions():
        if session_ids and meta["id"] not in session_ids:
            continue
        claimed.append(meta["id"])
        if not dry_run:
            meta["owner"] = owner
            save_meta(meta)
    return claimed


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


def list_all_reports(owner: str | None = None) -> list[dict[str, Any]]:
    reports: list[dict[str, Any]] = []
    for meta in list_sessions(owner):
        for report in meta.get("reports", []):
            reports.append({**report, "session_id": meta["id"], "session_name": meta.get("name")})
    return sorted(reports, key=lambda r: r.get("created_at", ""), reverse=True)


# ---------------------------------------------------------------- jobs

def save_job(job: dict[str, Any]) -> None:
    ensure_dirs()
    path = JOBS_DIR / f"{job['id']}.json"
    with _lock:
        _atomic_write(path, json.dumps(job, indent=2, default=str))


def load_job(job_id: str) -> dict[str, Any] | None:
    path = JOBS_DIR / f"{job_id}.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None


def storage_status() -> dict[str, Any]:
    """Where artefacts are stored and whether that location is configurable."""
    ensure_dirs()
    configured = os.getenv("DATA_DIR", "").strip()
    writable = False
    try:
        probe = DATA_DIR / ".write-probe"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink(missing_ok=True)
        writable = True
    except OSError:
        writable = False
    return {
        "data_dir": str(DATA_DIR),
        "sessions_dir": str(SESSIONS_DIR),
        "configured": bool(configured),
        "writable": writable,
    }


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
