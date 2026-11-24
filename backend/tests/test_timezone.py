"""Display timestamps: stored in UTC, shown in IST (Asia/Kolkata)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app import jobs, store

IST = timedelta(hours=5, minutes=30)


def test_display_timezone_is_ist():
    assert store.DISPLAY_TIMEZONE_NAME == "Asia/Kolkata"
    assert store.now_local().utcoffset() == IST


def test_storage_timestamps_stay_utc():
    # Ordering and existing session files rely on UTC; only display changed.
    assert store.now_iso().endswith("+00:00")


def test_local_timestamp_carries_the_ist_offset():
    stamp = store.local_timestamp()
    parsed = datetime.fromisoformat(stamp["at_iso"])

    assert stamp["at_iso"].endswith("+05:30")
    assert parsed.utcoffset() == IST
    assert stamp["at"] == parsed.strftime("%H:%M:%S")


def test_local_timestamp_converts_an_aware_moment():
    moment = datetime(2026, 11, 24, 16, 13, 29, tzinfo=timezone.utc)
    assert store.local_timestamp(moment) == {
        "at": "21:43:29",
        "at_iso": "2026-11-24T21:43:29+05:30",
    }


def test_unknown_timezone_falls_back_to_utc():
    assert store._resolve_timezone("Not/AZone") is timezone.utc


def test_ist_timezone_resolves_without_iana_data(monkeypatch):
    """Windows/slim containers may lack tzdata; IST must still resolve."""

    def _missing(name: str):
        raise store.ZoneInfoNotFoundError(name)

    monkeypatch.setattr(store, "ZoneInfo", _missing)
    assert store._resolve_timezone("Asia/Kolkata").utcoffset(None) == IST


@pytest.fixture()
def isolated_job_storage(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "DATA_DIR", tmp_path / "data")
    monkeypatch.setattr(store, "SESSIONS_DIR", tmp_path / "data" / "sessions")
    monkeypatch.setattr(store, "JOBS_DIR", tmp_path / "data" / "jobs")
    store.ensure_dirs()
    return tmp_path


def test_job_log_stamp_is_the_actual_execution_time(isolated_job_storage, monkeypatch):
    fixed = datetime(2026, 11, 24, 21, 44, 5, tzinfo=store.DISPLAY_TIMEZONE)
    monkeypatch.setattr(store, "now_local", lambda: fixed)

    job = jobs.FusionJob("abcdef123456")
    job.log("reading", "Reading 2 uploaded file(s) from session storage.")

    entry = job.stage("reading")["logs"][0]
    assert entry["at"] == "21:44:05"
    assert entry["at_iso"] == "2026-11-24T21:44:05+05:30"
    assert entry["message"] == "Reading 2 uploaded file(s) from session storage."


def test_job_log_stamps_advance_and_stay_ordered(isolated_job_storage, monkeypatch):
    moments = iter(
        datetime(2026, 11, 24, 21, 44, second, tzinfo=store.DISPLAY_TIMEZONE)
        for second in range(3)
    )
    monkeypatch.setattr(store, "now_local", lambda: next(moments))

    job = jobs.FusionJob("abcdef123456")
    job.log("reading", "first")
    job.log("reading", "second")
    job.log("profiling", "third")

    stamps = [entry["at_iso"] for entry in job.stage("reading")["logs"]]
    stamps += [entry["at_iso"] for entry in job.stage("profiling")["logs"]]
    parsed = [datetime.fromisoformat(value) for value in stamps]

    assert [entry["at"] for entry in job.stage("reading")["logs"]] == ["21:44:00", "21:44:01"]
    assert parsed == sorted(parsed)


def test_every_stage_log_from_a_real_job_is_ist_and_chronological(fused):
    stages = fused["status"]["stages"]
    assert {stage["key"] for stage in stages} == {
        "reading",
        "profiling",
        "cleaning",
        "preprocessing",
        "key_matching",
        "merging",
        "validation",
    }

    parsed: list[datetime] = []
    for stage in stages:
        assert stage["logs"], stage["key"]
        for entry in stage["logs"]:
            moment = datetime.fromisoformat(entry["at_iso"])
            assert moment.utcoffset() == IST
            assert entry["at"] == moment.strftime("%H:%M:%S")
            parsed.append(moment)

    assert parsed == sorted(parsed)
