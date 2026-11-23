from __future__ import annotations

import pandas as pd
import pytest

from app import cleaning, ingest


def test_rejects_unsupported_and_empty_files():
    with pytest.raises(ingest.IngestError):
        ingest.validate_upload("notes.txt", 20)
    with pytest.raises(ingest.IngestError):
        ingest.validate_upload("empty.csv", 0)


def test_reads_csv_with_mixed_types_and_currency():
    raw = (
        b"id,name,amount,joined\n"
        b"1,Ada,\"$1,299.00\",2026-01-05\n"
        b"2,Bo,$40.50,2026-01-06\n"
        b"3,Cy,\"$7.00\",2026-01-07\n"
    )
    frame = ingest.read_frame_bytes(raw, "customers.csv")
    prepared, warnings = ingest.prepare_frame(frame)
    cleaned, report = cleaning.clean_frame(prepared, "customers.csv")

    assert list(cleaned.columns) == ["id", "name", "amount", "joined"]
    assert pd.api.types.is_numeric_dtype(cleaned["amount"])
    assert cleaned["amount"].tolist() == [1299.0, 40.5, 7.0]
    assert pd.api.types.is_datetime64_any_dtype(cleaned["joined"])
    assert any("Fewer than 5 rows" in warning for warning in warnings)
    assert report["before"]["rows"] == 3


def test_identifiers_are_never_imputed_even_when_numeric():
    frame = pd.DataFrame(
        {
            "customer_id": [1, 2, None, 4, 5, 6],
            "age": [20, 30, None, 40, 50, 60],
            "segment": ["a", "b", None, "a", "b", "a"],
        }
    )
    cleaned, report = cleaning.clean_frame(frame, "customers.csv")

    assert cleaned["customer_id"].isna().sum() == 1
    assert cleaned["age"].isna().sum() == 0
    entry = next(item for item in report["missing"] if item["column"] == "customer_id")
    assert entry["method"].startswith("left blank")


def test_duplicate_rows_are_removed_and_counted():
    frame = pd.DataFrame({"x": [1, 1, 2], "y": ["a", "a", "b"]})
    cleaned, report = cleaning.clean_frame(frame, "dupes.csv")
    assert len(cleaned) == 2
    assert report["duplicates_removed"] == 1
