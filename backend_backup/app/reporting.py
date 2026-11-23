"""Generate downloadable reports from the actual fused session."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from xml.sax.saxutils import escape

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import seaborn as sns
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import Image, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from . import analysis
from .store import load_meta, new_id, now_iso, save_meta, session_dir

INK = "#0B0A09"
ACCENT = "#AA592F"
STONE = "#908779"
PAPER = "#F4F0E9"
GRID = "#CFC7BB"


class ReportError(ValueError):
    pass


def _load_fused(session_id: str) -> pd.DataFrame:
    path = session_dir(session_id) / "fused.pkl"
    if not path.exists():
        raise ReportError("This session has not finished fusion yet.")
    return pd.read_pickle(path)


def _chart_style() -> None:
    plt.rcParams.update(
        {
            "figure.facecolor": PAPER,
            "axes.facecolor": PAPER,
            "savefig.facecolor": PAPER,
            "font.family": "DejaVu Sans",
            "text.color": INK,
            "axes.labelcolor": INK,
            "xtick.color": STONE,
            "ytick.color": STONE,
            "axes.edgecolor": GRID,
        }
    )


def _correlation_chart(frame: pd.DataFrame, path: Path) -> bool:
    numeric = [c for c in frame.select_dtypes(include=[np.number]).columns if frame[c].nunique() > 1][:10]
    if len(numeric) < 2:
        return False
    corr = frame[numeric].corr()
    fig, ax = plt.subplots(figsize=(7.2, 5.2))
    sns.heatmap(
        corr, annot=True, fmt=".2f", cmap=sns.diverging_palette(20, 30, as_cmap=True),
        center=0, linewidths=0.6, linecolor=PAPER, cbar_kws={"shrink": 0.8}, ax=ax,
    )
    ax.set_title("Correlation heatmap", loc="left", fontsize=11, fontweight="bold", pad=12)
    fig.tight_layout()
    fig.savefig(path, dpi=150)
    plt.close(fig)
    return True


def _target_chart(frame: pd.DataFrame, target: dict[str, Any] | None, path: Path) -> bool:
    if not target or target.get("column") not in frame.columns:
        return False
    column = target["column"]
    series = frame[column].dropna()
    if series.empty:
        return False
    fig, ax = plt.subplots(figsize=(7.2, 3.8))
    if target.get("task") == "classification" or series.dtype == object:
        counts = series.astype(str).value_counts().head(12)
        ax.bar(counts.index.astype(str), counts.values, color=ACCENT, width=0.6)
        ax.set_ylabel("Rows")
        ax.tick_params(axis="x", rotation=25)
    else:
        ax.hist(series.astype(float), bins=min(14, max(4, int(np.sqrt(len(series))))), color=ACCENT, edgecolor=PAPER)
        ax.set_ylabel("Rows")
    ax.set_title(f"Distribution of {column}", loc="left", fontsize=11, fontweight="bold", pad=12)
    for spine in ("top", "right"):
        ax.spines[spine].set_visible(False)
    fig.tight_layout()
    fig.savefig(path, dpi=150)
    plt.close(fig)
    return True


def _model_chart(model: dict[str, Any], path: Path) -> bool:
    table = model.get("metrics_table") or []
    if not table:
        return False
    task = model.get("task")
    metric = "f1" if task == "classification" else "r2"
    labels = [row["model"] for row in table]
    values = [row.get(metric, 0) for row in table]
    fig, ax = plt.subplots(figsize=(7.2, 3.8))
    bars = ax.barh(labels[::-1], values[::-1], color=STONE, height=0.55)
    best_index = len(labels) - 1 - labels.index(model.get("best_model"))
    bars[best_index].set_color(ACCENT)
    ax.set_xlim(0, 1)
    ax.set_xlabel("Weighted F1 (test)" if task == "classification" else "R² (test)")
    ax.set_title("Model comparison", loc="left", fontsize=11, fontweight="bold", pad=12)
    for spine in ("top", "right"):
        ax.spines[spine].set_visible(False)
    fig.tight_layout()
    fig.savefig(path, dpi=150)
    plt.close(fig)
    return True


def _confusion_chart(model: dict[str, Any], path: Path) -> bool:
    info = model.get("evaluation", {}).get("confusion_matrix") or model.get("confusion_matrix")
    if not info or not info.get("labels") or not info.get("matrix"):
        return False
    labels = info["labels"]
    matrix = np.array(info["matrix"])
    fig, ax = plt.subplots(figsize=(5.4, 4.4))
    sns.heatmap(
        matrix, annot=True, fmt="d", cmap="Oranges", cbar=False,
        xticklabels=labels, yticklabels=labels, ax=ax,
        linewidths=1, linecolor=PAPER,
    )
    ax.set_xlabel("Predicted")
    ax.set_ylabel("Actual")
    ax.set_title("Confusion matrix (best model)", loc="left", fontsize=11, fontweight="bold", pad=12)
    fig.tight_layout()
    fig.savefig(path, dpi=150)
    plt.close(fig)
    return True


def _importance_chart(model: dict[str, Any], path: Path) -> bool:
    importance = (model.get("evaluation") or {}).get("feature_importance") or model.get("feature_importance") or []
    if not importance:
        return False
    entries = importance[:10][::-1]
    fig, ax = plt.subplots(figsize=(7.2, 3.9))
    ax.barh([e["feature"][:38] for e in entries], [e["importance"] for e in entries], color=ACCENT, height=0.6)
    ax.set_xlabel("Relative importance")
    ax.set_title("What drives the best model", loc="left", fontsize=11, fontweight="bold", pad=12)
    for spine in ("top", "right"):
        ax.spines[spine].set_visible(False)
    fig.tight_layout()
    fig.savefig(path, dpi=150)
    plt.close(fig)
    return True


def _styles() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle("TitleDF", parent=base["Title"], fontName="Helvetica-Bold", fontSize=25, leading=29, textColor=colors.HexColor(INK), spaceAfter=8),
        "subtitle": ParagraphStyle("SubDF", parent=base["Normal"], fontName="Helvetica", fontSize=10.5, leading=15, textColor=colors.HexColor(STONE), spaceAfter=16),
        "h1": ParagraphStyle("H1DF", parent=base["Heading1"], fontName="Helvetica-Bold", fontSize=15, leading=19, textColor=colors.HexColor(INK), spaceBefore=14, spaceAfter=7),
        "h2": ParagraphStyle("H2DF", parent=base["Heading2"], fontName="Helvetica-Bold", fontSize=11.5, leading=15, textColor=colors.HexColor(ACCENT), spaceBefore=10, spaceAfter=4),
        "body": ParagraphStyle("BodyDF", parent=base["BodyText"], fontName="Helvetica", fontSize=9.4, leading=13.6, textColor=colors.HexColor("#2B2723"), alignment=TA_LEFT),
        "small": ParagraphStyle("SmallDF", parent=base["BodyText"], fontName="Helvetica", fontSize=8, leading=11, textColor=colors.HexColor(STONE)),
    }


def _para(text: Any, style: ParagraphStyle) -> Paragraph:
    cleaned = str(text)
    for source_char, replacement in (
        ("→", "->"),
        ("←", "<-"),
        ("≈", "~"),
        ("×", "x"),
        ("—", "-"),
        ("–", "-"),
        ("·", "|"),
        ("²", "2"),
        ("≥", ">="),
        ("≤", "<="),
    ):
        cleaned = cleaned.replace(source_char, replacement)
    return Paragraph(escape(cleaned).replace("\n", "<br/>"), style)


def _table(rows: list[list[Any]], widths: list[float] | None = None, header: bool = True) -> Table:
    styles = _styles()
    data = [[_para(cell, styles["small"]) for cell in row] for row in rows]
    table = Table(data, colWidths=widths, hAlign="LEFT", repeatRows=1 if header else 0)
    commands = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor(GRID)),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]
    if header:
        commands += [
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#E8E1D6")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor(INK)),
        ]
    table.setStyle(TableStyle(commands))
    return table


def _metric_rows(model: dict[str, Any]) -> list[list[str]]:
    table = model.get("metrics_table") or []
    if not table:
        return []
    if model.get("task") == "classification":
        rows = [["Model", "Accuracy", "Precision", "Recall", "F1", "CV F1"]]
        for row in table:
            rows.append([
                row["model"], f"{row.get('accuracy', 0):.3f}", f"{row.get('precision', 0):.3f}",
                f"{row.get('recall', 0):.3f}", f"{row.get('f1', 0):.3f}",
                f"{row.get('cv_f1_mean', 0):.3f} ± {row.get('cv_f1_std', 0):.3f}",
            ])
        return rows
    rows = [["Model", "R²", "MAE", "RMSE", "CV R²"]]
    for row in table:
        rows.append([
            row["model"], f"{row.get('r2', 0):.3f}", f"{row.get('mae', 0):.3f}",
            f"{row.get('rmse', 0):.3f}", f"{row.get('cv_r2_mean', 0):.3f} ± {row.get('cv_r2_std', 0):.3f}",
        ])
    return rows


def generate_report(session_id: str) -> dict[str, Any]:
    meta = load_meta(session_id)
    fused = _load_fused(session_id)
    stats = meta.get("fusion") or {}
    if not stats:
        raise ReportError("Fusion statistics are missing for this session.")
    report_id = new_id()
    folder = session_dir(session_id) / "reports" / report_id
    folder.mkdir(parents=True, exist_ok=True)
    charts_dir = folder / "charts"
    charts_dir.mkdir(exist_ok=True)
    _chart_style()

    chart_files: dict[str, Path] = {}
    if _correlation_chart(fused, charts_dir / "correlation.png"):
        chart_files["correlation"] = charts_dir / "correlation.png"
    target = stats.get("target_suggestion")
    model = meta.get("model")
    eda = analysis.analyse_frame(fused, target)
    meta["insights"] = eda["insights"]
    if _target_chart(fused, target or ({"column": model["target"], "task": model["task"]} if model else None), charts_dir / "target.png"):
        chart_files["target"] = charts_dir / "target.png"
    if model:
        if _model_chart(model, charts_dir / "models.png"):
            chart_files["models"] = charts_dir / "models.png"
        if model.get("task") == "classification" and _confusion_chart(model, charts_dir / "confusion.png"):
            chart_files["confusion"] = charts_dir / "confusion.png"
        if _importance_chart(model, charts_dir / "importance.png"):
            chart_files["importance"] = charts_dir / "importance.png"

    csv_path = folder / "fused_dataset.csv"
    fused.to_csv(csv_path, index=False)

    xlsx_path = folder / "fusion_summary.xlsx"
    _write_excel(xlsx_path, meta, fused, stats, model)

    pdf_path = folder / "DataFusion_Report.pdf"
    _write_pdf(pdf_path, meta, fused, stats, model, chart_files)

    created = now_iso()
    report = {
        "id": report_id,
        "created_at": created,
        "title": "Fusion report",
        "session_id": session_id,
        "session_name": meta.get("name"),
        "rows": int(len(fused)),
        "features": int(fused.shape[1]),
        "target": (model or {}).get("target") or (target or {}).get("column"),
        "best_model": (model or {}).get("best_model"),
        "metrics": (model or {}).get("best_metrics"),
        "files": {
            "pdf": f"reports/{report_id}/DataFusion_Report.pdf",
            "csv": f"reports/{report_id}/fused_dataset.csv",
            "xlsx": f"reports/{report_id}/fusion_summary.xlsx",
        },
        "chart_files": [str(p.relative_to(session_dir(session_id))) for p in chart_files.values()],
    }
    meta.setdefault("reports", []).append(report)
    save_meta(meta)
    return report


def _write_excel(path: Path, meta: dict[str, Any], fused: pd.DataFrame, stats: dict[str, Any], model: dict[str, Any] | None) -> None:
    target = stats.get("target_suggestion")
    with pd.ExcelWriter(path, engine="openpyxl") as writer:
        summary = pd.DataFrame(
            {
                "Metric": ["Session", "Sources", "Fused rows", "Fused columns", "Conflicts resolved", "Fuzzy matches", "Remaining missing cells", "Target", "Task", "Best model"],
                "Value": [
                    meta.get("name"),
                    ", ".join(f["name"] for f in meta.get("files", [])),
                    len(fused),
                    fused.shape[1],
                    stats.get("conflicts_total", 0),
                    stats.get("fuzzy_total", 0),
                    int(fused.isna().sum().sum()),
                    (model or {}).get("target") or (target or {}).get("column") or "Not selected",
                    (model or {}).get("task") or (target or {}).get("task") or "Not selected",
                    (model or {}).get("best_model") or "No model trained",
                ],
            }
        )
        summary.to_excel(writer, sheet_name="Summary", index=False)

        clean_rows = []
        for report in meta.get("clean", []) or []:
            clean_rows.append(
                {
                    "Source": report["source"],
                    "Rows before": report["before"]["rows"],
                    "Rows after": report["after"]["rows"],
                    "Duplicates removed": report["duplicates_removed"],
                    "Missing cells filled": report["missing_filled"],
                    "Numeric columns fixed": len(report["numeric_converted"]),
                    "Date columns fixed": len(report["dates_parsed"]),
                    "Outlier columns": len(report["outliers"]),
                }
            )
        pd.DataFrame(clean_rows).to_excel(writer, sheet_name="Cleaning", index=False)

        steps = pd.DataFrame(stats.get("steps", []))
        if not steps.empty:
            step_rows = steps[
                ["source", "left_key", "right_key", "rows_before", "exact_matches", "fuzzy_matches", "match_rate"]
            ].rename(columns={"source": "Source", "left_key": "Left key", "right_key": "Right key", "rows_before": "Rows before", "exact_matches": "Exact matches", "fuzzy_matches": "Fuzzy matches", "match_rate": "Match rate %"})
            step_rows.to_excel(writer, sheet_name="Fusion", index=False)
        else:
            pd.DataFrame([{"Source": stats.get("base_source"), "Note": "Single source — no joins"}]).to_excel(writer, sheet_name="Fusion", index=False)

        if model and model.get("metrics_table"):
            pd.DataFrame(model["metrics_table"]).to_excel(writer, sheet_name="Models", index=False)
        if model and (model.get("evaluation") or {}).get("feature_importance"):
            pd.DataFrame(model["evaluation"]["feature_importance"]).to_excel(writer, sheet_name="Feature Importance", index=False)

        insights = pd.DataFrame(meta.get("insights") or [])
        if not insights.empty:
            insights.to_excel(writer, sheet_name="Insights", index=False)
        fused.head(500).to_excel(writer, sheet_name="Fused Preview", index=False)

        for sheet in writer.sheets.values():
            for column_cells in sheet.columns:
                length = max((len(str(cell.value or "")) for cell in column_cells), default=10)
                sheet.column_dimensions[column_cells[0].column_letter].width = min(44, max(12, length + 2))


def _write_pdf(path: Path, meta: dict[str, Any], fused: pd.DataFrame, stats: dict[str, Any], model: dict[str, Any] | None, charts: dict[str, Path]) -> None:
    styles = _styles()
    doc = SimpleDocTemplate(
        str(path), pagesize=A4,
        leftMargin=1.8 * cm, rightMargin=1.8 * cm, topMargin=1.7 * cm, bottomMargin=1.6 * cm,
        title="DataFusion AI — Fusion Report", author="DataFusion AI",
    )
    story: list[Any] = []
    target = stats.get("target_suggestion")
    created = datetime.now(timezone.utc).strftime("%d %B %Y, %H:%M UTC")

    story.append(Paragraph("DataFusion AI", styles["subtitle"]))
    story.append(Paragraph("Multi-Source Data Fusion Report", styles["title"]))
    story.append(
        _para(
            f"Generated {created} · {len(meta.get('files', []))} source file(s) · "
            f"{len(fused):,} fused records · {fused.shape[1]} columns",
            styles["body"],
        )
    )
    story.append(Spacer(1, 12))

    story.append(Paragraph("1. Data sources", styles["h1"]))
    rows = [["File", "Format", "Rows", "Columns", "Size (KB)"]]
    for file_info in meta.get("files", []):
        rows.append([
            file_info["name"], file_info["format"], file_info["rows"],
            file_info["cols"], f"{file_info['size'] / 1024:.0f}",
        ])
    story.append(_table(rows, [6.6 * cm, 2.2 * cm, 2.2 * cm, 2.2 * cm, 2.4 * cm]))
    story.append(Spacer(1, 6))

    story.append(Paragraph("2. Wrangling summary", styles["h1"]))
    clean_rows = [["Source", "Rows before → after", "Duplicates", "Missing filled", "Formats fixed", "Outliers"]]
    for report in meta.get("clean", []) or []:
        clean_rows.append([
            report["source"],
            f"{report['before']['rows']} → {report['after']['rows']}",
            report["duplicates_removed"],
            report["missing_filled"],
            len(report["numeric_converted"]) + len(report["dates_parsed"]),
            len(report["outliers"]),
        ])
    story.append(_table(clean_rows, [4.6 * cm, 3.6 * cm, 2.2 * cm, 2.4 * cm, 2.6 * cm, 2.0 * cm]))
    all_notes = []
    for report in meta.get("clean", []) or []:
        for entry in report.get("missing", []):
            all_notes.append(f"{report['source']} · {entry['column']}: filled {entry['before']} missing with {entry['method']}.")
        for entry in report.get("dates_parsed", []):
            all_notes.append(f"{report['source']} · {entry['column']}: parsed {entry['parsed']} mixed date values.")
    for note in all_notes[:12]:
        story.append(_para("• " + note, styles["small"]))
    if len(all_notes) > 12:
        story.append(_para(f"…and {len(all_notes) - 12} more wrangling actions recorded in the Excel summary.", styles["small"]))

    story.append(Paragraph("3. Fusion summary", styles["h1"]))
    story.append(
        _para(
            f"Base table: {stats.get('base_source')}. Join keys: "
            + (", ".join(f"{j['left']} = {j['right']}" for j in stats.get("join_keys", [])) or "single source, no joins")
            + f". {stats.get('conflicts_total', 0)} conflicting values were resolved by preferring non-null values, "
            "then the most recent source, then the majority value; alternate values are retained in the fused CSV.",
            styles["body"],
        )
    )
    if stats.get("steps"):
        rows = [["Source", "Key", "Rows in", "Exact", "Fuzzy", "Match rate"]]
        for step in stats["steps"]:
            rows.append([
                step["source"], f"{step['left_key']} = {step['right_key']}", step["rows_before"],
                step["exact_matches"], step["fuzzy_matches"], f"{step['match_rate']}%",
            ])
        story.append(Spacer(1, 4))
        story.append(_table(rows, [3.4 * cm, 4.6 * cm, 2.0 * cm, 1.8 * cm, 1.8 * cm, 2.4 * cm]))

    story.append(Paragraph("4. Exploratory findings", styles["h1"]))
    for insight in meta.get("insights", []) or []:
        story.append(Paragraph("• " + escape(insight.get("title", "")) + " — " + escape(insight.get("text", "")), styles["body"]))
    if "correlation" in charts:
        story.append(Spacer(1, 8))
        story.append(Image(str(charts["correlation"]), width=16.4 * cm, height=11.8 * cm))
    if "target" in charts:
        story.append(Image(str(charts["target"]), width=16.4 * cm, height=8.6 * cm))

    story.append(PageBreak())
    story.append(Paragraph("5. Machine learning", styles["h1"]))
    if model:
        story.append(
            _para(
                f"Task: {model.get('task')} · target: {model.get('target')} · "
                f"train/test split {int((1 - (model.get('evaluation') or {}).get('test_size', 0.25)) * 100)}/"
                f"{int((model.get('evaluation') or {}).get('test_size', 0.25) * 100)} (seed 42) · "
                f"{(model.get('evaluation') or {}).get('cv_folds')}-fold cross-validation.",
                styles["body"],
            )
        )
        story.append(Spacer(1, 6))
        metric_rows = _metric_rows(model)
        if metric_rows:
            story.append(_table(metric_rows, [4.0 * cm, 2.6 * cm, 2.7 * cm, 2.5 * cm, 2.5 * cm, 3.4 * cm]))
        story.append(Paragraph(f"Selected model: {model.get('best_model')}", styles["h2"]))
        story.append(_para(model.get("reason", ""), styles["body"]))
        if "models" in charts:
            story.append(Image(str(charts["models"]), width=16.4 * cm, height=8.6 * cm))
        if "confusion" in charts:
            story.append(Image(str(charts["confusion"]), width=10.5 * cm, height=8.5 * cm))
        if "importance" in charts:
            story.append(Image(str(charts["importance"]), width=16.4 * cm, height=8.8 * cm))
    else:
        story.append(
            _para(
                "No model was trained for this session at the time the report was generated. "
                "Open Train Models to compare Random Forest, Decision Tree, Logistic Regression and SVM.",
                styles["body"],
            )
        )

    story.append(Paragraph("6. Limitations", styles["h1"]))
    limitations = [
        f"Metrics are computed from {len(fused):,} fused records; they describe this dataset, not future data.",
        "Fuzzy matching links names with a token-sort ratio of at least 88; uncertain pairs are intentionally left unmatched.",
        f"{int(fused.isna().sum().sum()):,} cells remain empty after reconciliation; models impute them with median/mode values.",
        "Models are trained on the training split; no production model refit is performed for the reported metrics.",
    ]
    if model and model.get("evaluation", {}).get("notes"):
        limitations.extend(model["evaluation"]["notes"])
    for item in limitations:
        story.append(_para("• " + item, styles["small"]))
    story.append(Spacer(1, 14))
    story.append(_para("Generated by DataFusion AI — every number in this report was computed from the uploaded files.", styles["small"]))
    doc.build(story)
