# DataFusion AI — Multi-Source Data Fusion Engine

A complete, runnable data-mining workspace for a **Data Mining & Wrangling** course. Upload two or more related datasets and the app cleans, reconciles and fuses them, explores the result, trains four models, scores new records and exports a real report.

Every number, chart and metric is computed from the files you upload. There is no demo fallback, no seeded placeholder table and no external API — ingestion, fuzzy matching, EDA, modelling and PDF/XLSX generation all run locally. Random state is fixed at `42`, so the same inputs produce identical metrics on every run.

The interface follows the supplied Dribbble reference **“SDN.io — FUSION”** in both light and dark mode: warm off-white paper, near-black and galaxy surfaces, terracotta accents, glass cards, pill actions, a live 3D fusion core and a sticky navigation bar.

---

## What it does

1. **Collect** — drag in CSV, TSV, XLSX, XLS or JSON files (25 MB / 200,000 rows each). Each file is validated and parsed by the backend, then previewed with its real rows × columns. At least two files unlock fusion; one file is allowed with a warning.
2. **Clean** — per-source profiling removes duplicate rows, fills safe gaps, normalises numbers/dates/currency/casing, flags outliers, and logs every action with before/after counts. Identifier columns are never imputed. Cleaned files are downloadable.
3. **Combine** — shared keys are detected by name and value overlap, with an optional `rapidfuzz` pass for near-identical keys. Fuzzy matches are flagged. Ambiguous or missing keys pause the job for manual confirmation instead of guessing. Conflicts follow **non-null → most recent → majority**, with alternatives logged.
4. **Analyse** — dataset overview, per-column statistical summary with IQR whiskers, target suggestion, and rule-based key insights. Numeric and categorical features are profiled on the fused data only.
5. **View Charts** — correlation heatmap, target class distribution, feature importance, actual vs predicted, confusion matrix (classification) or residuals, plus numeric distributions and boxplots. Every figure is PNG-downloadable.
6. **Train Models** — Random Forest, Decision Tree, Logistic Regression and SVM (RBF) with a fixed train/test split and k-fold cross-validation. Task type is inferred from the target and can be overridden. The best model is selected on held-out weighted F1 (classification) or R² (regression), persisted on disk and explained with a plain-language reason.
7. **Predict** — score one record from schema-aware inputs (numeric medians and categorical modes pre-filled) or upload a CSV for batch predictions. Results include class probabilities where the estimator supports them, and are downloadable.
8. **Reports** — generate a multi-page PDF (title, sources, wrangling log, fusion plan, EDA, insights, embedded charts, model comparison, best model, limitations), the fused CSV and a styled Excel workbook. History and reports survive refreshes and server restarts.

The workspace sidebar exposes exactly: **Dashboard, Clean Data, Combine Data, Analyse Data, View Charts, Train Models, Predict, Reports**. Before fusion only Dashboard is unlocked; the other sections show lock states instead of dead links. There are no decorative connector lines between steps.

---

## Architecture

```
Browser (React + Vite + TypeScript + Tailwind + Framer Motion + Recharts + Three.js)
        │  fetch /api/*  (Vite dev proxy → 127.0.0.1:8000)
        ▼
FastAPI
  ├─ ingest.py      validation, CSV/TSV/XLSX/XLS/JSON parsing, previews
  ├─ cleaning.py    dedupe, safe fills, type/format normalisation, outliers
  ├─ fusion.py      key detection, rapidfuzz matching, conflict rules
  ├─ analysis.py    overview, summary, target suggestion, insights, charts
  ├─ modeling.py    four estimators, CV, metrics, importance, save/load
  ├─ reporting.py   PDF (ReportLab), XLSX (openpyxl), CSV
  ├─ pipeline.py    seven logged stages with real timings
  ├─ jobs.py        background thread, progress, confirmation pause
  └─ store.py       disk-persisted sessions, jobs and artefacts
        │
        ▼
backend/data/sessions/<id>/   meta, sources, clean/, fused, models, charts, reports
```

Long-running work is a backend job. The fusion page polls the job every 900 ms (an SSE endpoint is also available) and renders the server's real stage list, durations and log lines. Nothing on the progress page is client-simulated.

### Project structure

```
Data Fusion/
├─ backend/
│  ├─ app/
│  │  ├─ main.py            FastAPI routes
│  │  ├─ pipeline.py        seven-stage orchestration + logging
│  │  ├─ ingest.py          upload validation and parsing
│  │  ├─ cleaning.py        wrangling per source
│  │  ├─ fusion.py          key plan, fuzzy matching, reconciliation
│  │  ├─ analysis.py        EDA, target suggestion, chart data
│  │  ├─ modeling.py        four models, CV, metrics, importance
│  │  ├─ reporting.py       PDF / XLSX / CSV artefacts
│  │  ├─ jobs.py            job runner, pause/resume, progress
│  │  ├─ store.py           disk session store
│  │  └─ utils.py           dates, JSON safety, naming helpers
│  └─ requirements.txt
├─ frontend/
│  ├─ src/
│  │  ├─ pages/             Dashboard, Upload, FusionProcess, History,
│  │  │                     FusionReports, Workspace + 8 workspace tabs
│  │  ├─ components/        Navbar, Logo, FusionScene3D, UI kit, charts
│  │  ├─ lib/               API client, types, theme, session, toast, format
│  │  ├─ index.css          design tokens for both themes
│  │  └─ App.tsx            routes and scroll handling
│  ├─ package.json
│  └─ vite.config.ts        dev proxy → FastAPI
├─ run.py                   one-command local runner (installs deps once)
├─ .gitignore
└─ README.md
```

Generated sessions, models, charts and reports live under `backend/data/` and are intentionally ignored by Git.

---

## Requirements

- Python **3.10+**
- Node.js **18+** with npm
- No database server, cloud account or API key is required.

---

## Quick start (one command)

```bash
python run.py
```

On first run the script creates `.venv`, installs `backend/requirements.txt`, runs `npm install`, then starts FastAPI on `127.0.0.1:8000` and Vite on `127.0.0.1:5173`, and opens the app. Logs stream to `backend-server.log` and `frontend-dev.log`.

Options:

```bash
python run.py --no-browser
python run.py --backend-port 8001 --frontend-port 5174
```

Press `Ctrl+C` to stop both servers. Only the processes started by the runner are terminated.

## Manual setup

**Backend** (from the project root):

```bash
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS / Linux
source .venv/bin/activate

pip install -r backend/requirements.txt
cd backend
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

API docs: <http://127.0.0.1:8000/docs>

**Frontend** (second terminal):

```bash
cd frontend
npm install
npm run dev -- --host 127.0.0.1 --port 5173
```

Open <http://127.0.0.1:5173>. Use `127.0.0.1` rather than `localhost` if your environment resolves `localhost` to IPv6, because both servers bind IPv4 explicitly.

Production build check:

```bash
cd frontend
npm run build
```

---

## Walkthrough with your own data

No datasets ship with this project and none are downloaded. The app starts with empty history and empty reports, and it has no fallback data: if nothing is uploaded, there is nothing to analyse.

1. Open **Explore** and press **Upload Datasets**.
2. Drop two or more related files of your own (CSV, TSV, XLSX, XLS or JSON), or click to browse.
3. Inspect the real previews and press **Start Fusion**. Watch the seven stages complete with real timings and logs.
4. On the workspace **Dashboard**, open **Combine Data** to see the detected keys, fuzzy links and conflicts with their chosen values and alternatives.
5. Open **Analyse Data** for missingness, distributions, the suggested target and rule-based insights.
6. Open **View Charts** and download any figure as PNG.
7. Open **Train Models**, keep or change the suggested target and press **Train four models**. Inspect the comparison, CV spread and feature importance.
8. Open **Predict**, fill in a record or upload a batch CSV whose columns match the trained features, and score it.
9. Open **Reports**, generate the report, then download the PDF, fused CSV and Excel workbook. Refresh the page to confirm history and reports persist.

Every value on screen comes from those uploads. Messy input (mixed date formats, currency strings, duplicate rows, missing keys, conflicting values, outliers) exercises more of the wrangling and reconciliation paths and produces a more informative report.

---

## API overview

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Readiness probe |
| `POST` | `/api/upload` | Upload and parse files into a session |
| `GET` | `/api/session/{id}` | Session detail (sources, stats, model, reports) |
| `POST` | `/api/fuse` | Start the fusion job |
| `GET` | `/api/fuse/{job_id}/status` | Job status, stages, logs, progress |
| `GET` | `/api/fuse/{job_id}/stream` | SSE stream of the same state |
| `POST` | `/api/fuse/{job_id}/confirm` | Supply join keys and resume a paused job |
| `GET` | `/api/session/{id}/clean` | Wrangling report and cleaned previews |
| `GET` | `/api/session/{id}/combine` | Join plan, conflicts and fused preview pages |
| `GET` | `/api/session/{id}/clean/{file_id}/download` | Download a cleaned source |
| `GET` | `/api/session/{id}/fused` | Fused data pages for the preview table |
| `GET` | `/api/session/{id}/fused/download` | Download the fused CSV |
| `GET` | `/api/session/{id}/analyse` | Overview, summaries, target, insights |
| `GET` | `/api/session/{id}/charts` | Chart series and PNG exports |
| `POST` | `/api/train` | Train and cross-validate four models |
| `GET` | `/api/session/{id}/model` | Full persisted model bundle |
| `POST` | `/api/predict` | Score one JSON record |
| `POST` | `/api/predict/batch?session_id=…` | Score an uploaded CSV |
| `GET` | `/api/session/{id}/predictions/{filename}/download` | Download batch predictions |
| `POST` | `/api/report` | Generate PDF, CSV and XLSX |
| `GET` | `/api/reports/{session_id}/{report_id}/download?kind=pdf` | Download a report artefact |
| `GET` | `/api/history` | All sessions |
| `DELETE` | `/api/history/{id}` | Delete a session and its artefacts |
| `GET` | `/api/reports` | All generated reports across sessions |

Uploads are capped at 25 MB per file and 200,000 rows. The report and chart endpoints return generated files from the session folder; deleting a session removes them.

---

## Design system

Tokens are defined once in `frontend/src/index.css` and consumed by Tailwind.

| Token | Value |
| --- | --- |
| `--bg` | `#F4F0EA` light / `#0B0A09` dark |
| `--surface` | `#FBF8F3` light / `#12100D` dark |
| `--ink` | `#191512` light / `#F0EBE3` dark |
| `--muted` | `#7F756B` light / `#A69B8D` dark |
| `--line` | `#DED6CA` light / `#2C2620` dark |
| `--accent` | `#AA592F` |
| `--accent-soft` | pale terracotta |
| `--accent-2` | `#908779` |

Typography is a display sans for headlines, a neutral sans for body copy and a monospace face for numbers, keys and logs. The hero centres on a live 3D fusion core: a rotating wireframe icosahedron inside an instanced 140-node shell with computed links and two orbit rings, rendered with Three.js and React Three Fiber. It follows the pointer, respects `prefers-reduced-motion`, recolours with the theme, and is lazy-loaded as its own chunk behind an error boundary. Glass feature cards and an accent glow complete the dark hero; the light mode keeps the same geometry on warm paper. The theme toggle and avatar share a fixed 40 px row, and the chosen theme is persisted in `localStorage` and applied before first paint.

Accessibility: semantic landmarks, labelled navigation and form controls, visible focus rings, keyboard-operable file inputs and collapsible sections, `aria-live` job status, reduced-motion handling and colour combinations checked for contrast in both themes. Tables scroll horizontally on narrow screens; the sidebar becomes a labelled drawer below `lg`.

---

## Determinism and data integrity

- All estimators use `random_state=42`; train/test split is fixed (75/25 by default) and CV uses shuffled folds with the same seed.
- Best-model selection is metric-driven, not random: weighted F1 for classification, R² for regression; tie-breaks fall back to CV mean.
- Metrics are computed on the held-out split; CV mean and standard deviation are reported separately.
- No chart, KPI or report value is hard-coded. UI copy such as stage names and model descriptions is static; every figure is derived from the session.
- Fusion is logged per source: key chosen, matched/unmatched counts, added columns, conflicts and selected values.
- Missing identifiers are never imputed, and rows without a usable target are excluded from training and counted in the notes.

---

## Edge cases handled

- Unsupported extension, empty file, malformed JSON/CSV → HTTP 400 with a specific message.
- One source only → fusion completes without joins and warns that the result is not a fusion.
- No shared or detectable key → job pauses as `awaiting_confirmation`; the UI asks for keys and resumes.
- All-empty columns → dropped before analysis; all-empty dataset → rejected.
- Tiny datasets → training is refused with a request to add rows rather than reporting misleading metrics.
- Constant or non-numeric regression targets → rejected with a clear message.
- Missing target column, missing model or missing report → specific 400/404 responses, rendered as inline panels in the UI.

---

## Verification performed

- End-to-end HTTP runs with temporary multi-source fixtures used only for testing (not shipped with the project): the largest produced 90 fused rows × 24 columns, 16 conflicts resolved and 5 fuzzy matches, with all 7 stages logged.
- A second identical run produced byte-for-byte equal metric values, confirming determinism.
- Classification run: Logistic Regression selected, held-out weighted F1 0.8585, 5-fold CV F1 0.8729, confusion matrix `[[7, 1], [2, 11]]`.
- Regression run on `amount`: R² 0.7523, MAE 793.25, RMSE 1420.01, confusion matrix correctly omitted.
- Reports opened and checked: PDF begins with `%PDF-` (six pages, embedded charts), fused CSV and XLSX (seven sheets) parse correctly.
- Edge cases exercised: unsupported format, empty upload, all-null column, 5-row training, single-source fusion, and ambiguous-key pause + manual confirm.
- Frontend `npm run build` (TypeScript + Vite) passes. Manually reviewed light/dark desktop, the eight workspace tabs, upload, live fusion, mobile layout and the sidebar drawer in Chromium.
- PNG export exercised on the correlation heatmap: produced a 1,828 × 806 `data:image/png` file with the correct `correlation-heatmap.png` filename and success toast. All chart cards share this exporter.
- Upload → fusion was also exercised through the running UI with injected CSV files, not only with API calls.

Not covered: automated cross-browser/a11y test suites; `.xls` (legacy binary Excel) was read through the generic `xlrd` path but was not covered by an end-to-end fixture. No test fixtures are included in the project; your metrics will differ with your files.

---

## Notes

- The PDF uses ReportLab's built-in Helvetica, so arrows and symbols are transliterated to ASCII (`→` becomes `->`, `≈` becomes `~`, `²` becomes `^2`).
- Charts are returned as data for Recharts, so tooltips and PNG downloads stay interactive; PNG export uses `html2canvas` and was verified end to end.
- The frontend is a single-page React app with client-side routing. Direct navigation to a workspace URL works with Vite's history fallback; production hosting must also rewrite unknown paths to `index.html`.
- Sessions are stored on local disk and are not user-authenticated. This is a course/demo build; do not expose it on an untrusted network without adding authentication and access control.
- The visual direction adapts the supplied **“SDN.io — FUSION”** Dribbble reference. All implementation, copy and data are original.
