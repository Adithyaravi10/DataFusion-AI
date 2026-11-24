"""Downloads must keep their real filenames and extensions.

The SPA saves downloads from a blob, so the filename now comes from the
Content-Disposition response header. These tests pin the header the frontend
parses and confirm it is exposed to cross-origin JavaScript.
"""
from __future__ import annotations

import pytest


@pytest.fixture()
def report(client, fused):
    response = client.post("/api/report", json={"session_id": fused["session_id"]})
    assert response.status_code == 200, response.text
    return response.json()


def test_report_downloads_keep_their_extensions(client, report):
    expected = {
        "pdf": "DataFusion_Report.pdf",
        "csv": "fused_dataset.csv",
        "xlsx": "fusion_summary.xlsx",
    }
    for kind, name in expected.items():
        response = client.get(report["downloads"][kind])
        assert response.status_code == 200
        disposition = response.headers.get("content-disposition", "")
        assert name in disposition, f"{kind} download lost its filename: {disposition}"


def test_fused_dataset_download_keeps_its_filename(client, fused):
    response = client.get(f"/api/session/{fused['session_id']}/fused/download")
    assert response.status_code == 200
    assert "fused_dataset.csv" in response.headers.get("content-disposition", "")


def test_cleaned_downloads_keep_the_source_filename(client, fused):
    clean = client.get(f"/api/session/{fused['session_id']}/clean").json()
    urls = list(clean["downloads"].values())
    assert urls, "cleaning produced no downloadable sources"
    for url in urls:
        response = client.get(url)
        assert response.status_code == 200
        disposition = response.headers.get("content-disposition", "")
        assert disposition.endswith('_cleaned.csv"'), disposition


def test_content_disposition_is_readable_cross_origin(client, fused):
    response = client.get(
        f"/api/session/{fused['session_id']}/fused/download",
        headers={"Origin": "http://localhost:5173"},
    )
    assert response.status_code == 200
    exposed = response.headers.get("access-control-expose-headers", "").lower()
    assert "content-disposition" in exposed, exposed
