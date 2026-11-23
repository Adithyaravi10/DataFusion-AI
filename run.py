#!/usr/bin/env python3
"""Start DataFusion AI (FastAPI + Vite) with one command.

Usage:
    python run.py                 # installs deps if needed, then opens the app
    python run.py --no-browser
    python run.py --backend-port 8001 --frontend-port 5174
"""
from __future__ import annotations

import argparse
import os
import shutil
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
import venv
import webbrowser
from pathlib import Path

for stream in (sys.stdout, sys.stderr):
    if hasattr(stream, "reconfigure"):
        stream.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent
VENV = ROOT / ".venv"
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"


def venv_python() -> Path:
    return VENV / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


def run_checked(command: list[str], cwd: Path | None = None) -> None:
    print(f"> {' '.join(command)}", flush=True)
    result = subprocess.run(command, cwd=cwd)
    if result.returncode != 0:
        raise SystemExit(f"Command failed with exit code {result.returncode}: {' '.join(command)}")


def ensure_python() -> Path:
    python = venv_python()
    if not python.exists():
        print("Creating .venv and installing backend dependencies (first run only)...", flush=True)
        venv.create(VENV, with_pip=True)
        run_checked([str(python), "-m", "pip", "install", "--upgrade", "pip", "-q"])
        run_checked([str(python), "-m", "pip", "install", "-r", str(BACKEND / "requirements.txt")])
    elif not subprocess.run(
        [str(python), "-c", "import fastapi, pandas, sklearn, rapidfuzz, reportlab, openpyxl"],
        capture_output=True,
    ).returncode == 0:
        print("Backend dependencies are missing - installing requirements...", flush=True)
        run_checked([str(python), "-m", "pip", "install", "-r", str(BACKEND / "requirements.txt")])
    return python


def npm_command() -> str:
    npm = shutil.which("npm") or shutil.which("npm.cmd")
    if not npm:
        raise SystemExit("Node.js/npm was not found. Install Node 18+ from https://nodejs.org and retry.")
    return npm


def ensure_node() -> str:
    npm = npm_command()
    if not (FRONTEND / "node_modules" / ".bin" / "vite").exists():
        print("Installing frontend dependencies (first run only)...", flush=True)
        run_checked([npm, "install", "--no-fund", "--no-audit"], cwd=FRONTEND)
    return npm


def wait_for(url: str, label: str, timeout: float = 90.0) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2):
                print(f"[ok] {label} ready: {url}", flush=True)
                return
        except (urllib.error.URLError, ConnectionError, TimeoutError):
            time.sleep(0.6)
    raise SystemExit(f"{label} did not answer at {url} within {timeout:.0f}s.")


def tail_log(path: Path, lines: int = 25) -> None:
    if not path.exists():
        return
    content = path.read_text(encoding="utf-8", errors="replace").splitlines()
    print("\n".join(content[-lines:]))


def stop(process: subprocess.Popen[bytes] | None) -> None:
    if process is None or process.poll() is not None:
        return
    try:
        if os.name == "nt":
            subprocess.run(
                ["taskkill", "/PID", str(process.pid), "/T", "/F"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        else:
            process.terminate()
            try:
                process.wait(timeout=8)
            except subprocess.TimeoutExpired:
                process.kill()
    except OSError:
        pass


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the DataFusion AI development stack.")
    parser.add_argument("--backend-port", type=int, default=8000)
    parser.add_argument("--frontend-port", type=int, default=5173)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()

    python = ensure_python()
    npm = ensure_node()

    backend_log = ROOT / "backend-server.log"
    frontend_log = ROOT / "frontend-dev.log"
    backend_log.write_text("", encoding="utf-8")
    frontend_log.write_text("", encoding="utf-8")

    backend: subprocess.Popen[bytes] | None = None
    frontend: subprocess.Popen[bytes] | None = None
    try:
        with backend_log.open("ab") as backend_out, frontend_log.open("ab") as frontend_out:
            backend = subprocess.Popen(
                [
                    str(python), "-m", "uvicorn", "app.main:app",
                    "--host", "127.0.0.1", "--port", str(args.backend_port),
                ],
                cwd=BACKEND,
                stdout=backend_out,
                stderr=subprocess.STDOUT,
                creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0,
            )
            wait_for(f"http://127.0.0.1:{args.backend_port}/api/health", "FastAPI")

            frontend = subprocess.Popen(
                [
                    npm, "run", "dev", "--",
                    "--host", "127.0.0.1", "--port", str(args.frontend_port),
                ],
                cwd=FRONTEND,
                stdout=frontend_out,
                stderr=subprocess.STDOUT,
                env={**os.environ, "DATAFUSION_API": f"http://127.0.0.1:{args.backend_port}"},
                creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0,
            )
            wait_for(f"http://127.0.0.1:{args.frontend_port}/", "Vite")

        url = f"http://127.0.0.1:{args.frontend_port}/"
        print("\nDataFusion AI is running.")
        print(f"  App:      {url}")
        print(f"  API docs: http://127.0.0.1:{args.backend_port}/docs")
        print("  Logs:     backend-server.log / frontend-dev.log")
        print("  Press Ctrl+C to stop both servers.\n")
        if not args.no_browser:
            webbrowser.open(url)

        while True:
            time.sleep(1)
            if backend.poll() is not None:
                print("Backend stopped unexpectedly:")
                tail_log(backend_log)
                return 1
            if frontend.poll() is not None:
                print("Frontend stopped unexpectedly:")
                tail_log(frontend_log)
                return 1
    except KeyboardInterrupt:
        print("\nStopping DataFusion AI...", flush=True)
        return 0
    except SystemExit as exc:
        print(f"\n{exc}")
        tail_log(backend_log)
        tail_log(frontend_log)
        return 1
    finally:
        stop(frontend)
        stop(backend)


if __name__ == "__main__":
    sys.exit(main())
