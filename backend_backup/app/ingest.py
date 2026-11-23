"""Reading uploaded files with friendly validation."""
from __future__ import annotations

import csv
import io
import json
import re
from pathlib import Path
from typing import Any

import pandas as pd

from .utils import json_safe, snake_case, unique_names

ALLOWED = {
    ".csv": "CSV",
    ".tsv": "TSV",
    ".xlsx": "XLSX",
    ".xls": "XLS",
    ".json": "JSON",
}
MAX_BYTES = 25 * 1024 * 1024
MAX_ROWS = 200_000


class IngestError(ValueError):
    """A user-facing validation problem with an uploaded file."""


def extension_of(filename: str) -> str:
    return Path(filename).suffix.lower()


def validate_upload(filename: str, size: int) -> str:
    ext = extension_of(filename)
    if ext not in ALLOWED:
        raise IngestError(
            f"'{filename}' is not a supported format. Upload CSV, TSV, XLSX, XLS or JSON."
        )
    if size == 0:
        raise IngestError(f"'{filename}' is empty (0 bytes). Export the data again and retry.")
    if size > MAX_BYTES:
        raise IngestError(
            f"'{filename}' is {size / (1024 * 1024):.1f} MB — the limit is 25 MB per file."
        )
    return ALLOWED[ext]


def _detect_separator(raw: bytes) -> str:
    sample = raw[:8192].decode("utf-8", errors="replace")
    try:
        return csv.Sniffer().sniff(sample, delimiters=",;\t|").delimiter
    except csv.Error:
        return ","


def _read_csv_bytes(raw: bytes, sep: str | None) -> pd.DataFrame:
    last_error: Exception | None = None
    for encoding in ("utf-8-sig", "utf-8", "latin-1"):
        try:
            buffer = io.BytesIO(raw)
            return pd.read_csv(
                buffer,
                sep=sep if sep is not None else _detect_separator(raw),
                encoding=encoding,
                engine="python",
                skip_blank_lines=True,
                on_bad_lines="skip",
            )
        except Exception as exc:  # noqa: BLE001 - try the next encoding
            last_error = exc
    raise IngestError(f"Could not parse the delimited file: {last_error}")


def _read_json_bytes(raw: bytes) -> pd.DataFrame:
    text = raw.decode("utf-8-sig", errors="replace")
    payload: Any
    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        try:
            return pd.read_json(io.StringIO(text), lines=True)
        except Exception as exc:  # noqa: BLE001
            raise IngestError(f"Invalid JSON: {exc}") from exc

    if isinstance(payload, list):
        try:
            return pd.json_normalize(payload)
        except Exception as exc:  # noqa: BLE001
            raise IngestError(f"Could not flatten the JSON array: {exc}") from exc
    if isinstance(payload, dict):
        for value in payload.values():
            if isinstance(value, list) and value and isinstance(value[0], dict):
                return pd.json_normalize(value)
        return pd.json_normalize([payload])
    raise IngestError("JSON must contain an array of objects or an object with an array of records.")


def read_frame_bytes(raw: bytes, filename: str) -> pd.DataFrame:
    ext = extension_of(filename)
    try:
        if ext == ".csv":
            frame = _read_csv_bytes(raw, None)
        elif ext == ".tsv":
            frame = _read_csv_bytes(raw, "\t")
        elif ext in (".xlsx", ".xls"):
            frame = pd.read_excel(io.BytesIO(raw))
        elif ext == ".json":
            frame = _read_json_bytes(raw)
        else:  # pragma: no cover - guarded by validate_upload
            raise IngestError(f"Unsupported format '{ext}'")
    except IngestError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise IngestError(f"Could not read '{filename}': {exc}") from exc

    if frame is None or frame.empty:
        raise IngestError(f"'{filename}' has no data rows. At least one data row is required.")
    if frame.shape[1] == 0:
        raise IngestError(f"'{filename}' has no columns.")
    if len(frame) > MAX_ROWS:
        raise IngestError(
            f"'{filename}' has {len(frame):,} rows; this build accepts up to {MAX_ROWS:,}."
        )
    return frame


def read_frame(path: Path, filename: str) -> pd.DataFrame:
    return read_frame_bytes(path.read_bytes(), filename)


def prepare_frame(frame: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    """Normalise column names and report data-quality warnings."""
    warnings: list[str] = []
    frame = frame.copy()
    frame.columns = unique_names([str(c) for c in frame.columns])
    frame = frame.dropna(how="all").dropna(axis=1, how="all")
    if frame.empty or frame.shape[1] == 0:
        raise IngestError("Every row and column in this file is empty.")

    missing_ratio = float(frame.isna().to_numpy().mean()) if frame.size else 0.0
    if missing_ratio > 0.5:
        warnings.append(f"{missing_ratio * 100:.0f}% of cells are empty — cleaning will fill what it can.")
    if len(frame) < 5:
        warnings.append("Fewer than 5 rows: machine learning will be unreliable.")
    duplicate_cols = frame.columns[frame.columns.duplicated()].tolist()
    if duplicate_cols:
        warnings.append(f"Duplicate column names were renamed: {', '.join(duplicate_cols)}")
    return frame, warnings


def preview_rows(frame: pd.DataFrame, limit: int = 5) -> list[dict[str, Any]]:
    head = frame.head(limit)
    rows: list[dict[str, Any]] = []
    for record in head.to_dict(orient="records"):
        rows.append({str(k): json_safe(v) for k, v in record.items()})
    return rows


def column_profile(frame: pd.DataFrame) -> list[dict[str, Any]]:
    out = []
    for col in frame.columns:
        series = frame[col]
        sample = series.dropna().astype(str).head(3).tolist()
        out.append(
            {
                "name": str(col),
                "dtype": str(series.dtype),
                "missing": int(series.isna().sum()),
                "unique": int(series.nunique(dropna=True)),
                "sample": sample,
            }
        )
    return out


def source_stem(filename: str) -> str:
    stem = Path(filename).stem.lower()
    stem = re.sub(r"[^a-z0-9]+", "_", stem).strip("_")
    return stem or "source"


def safe_filename(filename: str) -> str:
    name = Path(filename).name
    return re.sub(r"[^A-Za-z0-9._ -]", "_", name)
