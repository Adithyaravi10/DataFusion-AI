"""Regression tests for the cleaning fixes from the audit.

Covers three data-integrity bugs: targets being imputed, blanks creating fake
duplicates, and identifiers hidden by normalised column names.
"""
from __future__ import annotations

from typing import Any

import pandas as pd
import pytest

from app import cleaning, ingest, modeling
from app.utils import snake_case


def _target_frame(rows: int = 20) -> pd.DataFrame:
    labels: list[Any] = [1 if index % 2 == 0 else 0 for index in range(rows)]
    labels[2] = None
    labels[7] = None
    return pd.DataFrame(
        {
            "customer_id": list(range(1, rows + 1)),
            "age": [20 + index if index != 3 else None for index in range(rows)],
            "converted": labels,
        }
    )


def test_target_column_is_never_imputed_while_features_are():
    frame = _target_frame()
    cleaned, report = cleaning.clean_frame(frame, "customers.csv", protect_columns={"converted"})

    assert int(cleaned["converted"].isna().sum()) == 2
    assert int(cleaned["age"].isna().sum()) == 0, "genuine features must still be imputed"
    entry = next(item for item in report["missing"] if item["column"] == "converted")
    assert entry["method"].startswith("left blank")
    assert entry["after"] == 2
    assert report["protected_columns"] == ["converted"]


def test_fabricated_target_labels_never_enter_training():
    frame = _target_frame()
    cleaned, _ = cleaning.clean_frame(frame, "customers.csv", protect_columns={"converted"})
    assert int(cleaned["converted"].isna().sum()) == 2

    result = modeling.train_models(cleaned, "converted")
    evaluation = result["evaluation"]

    assert evaluation["dropped_missing_target"] == 2
    assert evaluation["rows_used"] == 18
    assert evaluation["rows_available"] == 20
    assert any("excluded" in note.lower() for note in evaluation["notes"])

    # No prediction may be trained on a row whose label was blank.
    assert evaluation["n_train"] + evaluation["n_test"] == 18


def test_unprotected_target_is_reported_when_cleaning_already_filled_it():
    """A user-chosen target different from the suggestion is surfaced, not hidden."""
    frame = _target_frame()
    cleaned, report = cleaning.clean_frame(frame, "customers.csv")
    assert int(cleaned["converted"].isna().sum()) == 0
    entry = next(item for item in report["missing"] if item["column"] == "converted")
    assert not entry["method"].startswith("left blank")


def test_blank_values_do_not_create_duplicates():
    frame = pd.DataFrame({"a": [1, 1, 1, 2], "b": [None, "x", "x", "y"], "c": [5, 5, 5, 6]})
    cleaned, report = cleaning.clean_frame(frame, "dupes.csv")

    # Only the genuinely repeated row is dropped; the blank row is a distinct
    # record even though imputation gave it the same value.
    assert len(cleaned) == 3
    assert report["duplicates_removed"] == 1
    assert report["after"]["rows"] == 3


def test_true_duplicates_are_still_removed_and_counted():
    frame = pd.DataFrame({"x": [1, 1, 2], "y": ["a", "a", "b"]})
    cleaned, report = cleaning.clean_frame(frame, "dupes.csv")
    assert len(cleaned) == 2
    assert report["duplicates_removed"] == 1


@pytest.mark.parametrize(
    "column",
    [
        "customer_id",
        "CustomerID",
        "email_address",
        "order_ref",
        "transaction_key",
        "phone_number",
        "UUID",
    ],
)
def test_identifier_columns_are_never_imputed(column: str):
    numeric = column in {"customer_id", "CustomerID"}
    values: list[Any] = [101 + index if numeric else f"value-{index}" for index in range(6)]
    values[2] = None
    frame = pd.DataFrame({column: values, "amount": [10, 20, 30, 40, 50, 60]})

    cleaned, report = cleaning.clean_frame(frame, "records.csv")

    assert int(cleaned[column].isna().sum()) == 1, f"{column} must not be imputed"
    assert int(cleaned["amount"].isna().sum()) == 0
    entry = next(item for item in report["missing"] if item["column"] == column)
    assert entry["method"].startswith("left blank")


def test_rolled_up_identifier_names_are_recognised():
    """Names normalised before camel-splitting existed still look like keys."""
    frame = pd.DataFrame(
        {
            "customerid": [1, 2, None, 4, 5, 6],
            "orderref": ["r1", "r2", None, "r4", "r5", "r6"],
            "paid": [10, 20, None, 40, 50, 60],
        }
    )
    cleaned, report = cleaning.clean_frame(frame, "legacy.csv")

    assert int(cleaned["customerid"].isna().sum()) == 1
    assert int(cleaned["orderref"].isna().sum()) == 1
    assert int(cleaned["paid"].isna().sum()) == 0, "'paid' is a measure, not an id"


def test_ingest_preserves_identifier_word_boundaries():
    frame = ingest.read_frame_bytes(
        b"CustomerID,TransactionKey,amount\n1,k1,10\n2,k2,20\n", "records.csv"
    )
    prepared, _ = ingest.prepare_frame(frame)
    assert list(prepared.columns) == ["customer_id", "transaction_key", "amount"]
    assert snake_case("HTTPStatus") == "http_status"
