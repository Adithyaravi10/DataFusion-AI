#!/usr/bin/env python3
"""Assign pre-ownership sessions to one browser, explicitly.

Sessions created before session ownership existed have no ``owner`` field.
They are hidden from every browser and cannot be opened by anyone; nothing is
adopted automatically. This script is the only way to give them an owner.

Usage (run from the ``backend`` directory, with the same DATA_DIR as the app):

    python scripts/claim_legacy_sessions.py --list
    python scripts/claim_legacy_sessions.py --token <df-owner token> --dry-run
    python scripts/claim_legacy_sessions.py --token <df-owner token> --apply
    python scripts/claim_legacy_sessions.py --token <token> --session 6e4421269975 --apply

The token is the value of the browser's ``df-owner`` localStorage entry
(DevTools -> Application -> Local Storage) or its HttpOnly ``df_owner`` cookie.
Only the SHA-256 hash is stored; the token itself is never written or printed.
"""

from __future__ import annotations

import argparse
import hashlib
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import store  # noqa: E402  (path set above for direct execution)


def _owner_digest(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser(description="Assign ownerless sessions to one browser.")
    parser.add_argument("--list", action="store_true", help="Show ownerless sessions and exit.")
    parser.add_argument("--token", help="Browser ownership token (df-owner value).")
    parser.add_argument(
        "--session",
        action="append",
        default=None,
        help="Limit to a session id (repeatable). Default: every ownerless session.",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Write the change. Without this the run is a dry run.",
    )
    args = parser.parse_args()

    legacy = store.list_legacy_sessions()
    print(f"storage: {store.DATA_DIR}")
    print(f"ownerless sessions: {len(legacy)}")
    for meta in legacy:
        print(f"  {meta['id']}  {meta.get('name')!r}  created {meta.get('created_at')}")

    if args.list:
        return 0

    if not args.token:
        print("\nNo --token supplied: nothing to do. Use --token <df-owner value> --apply.")
        return 0
    if not legacy:
        print("\nNothing to claim.")
        return 0

    claimed = store.claim_legacy_sessions(
        _owner_digest(args.token), session_ids=args.session, dry_run=not args.apply
    )
    verb = "claimed" if args.apply else "would claim"
    print(f"\n{verb} {len(claimed)} session(s): {', '.join(claimed) or 'none'}")
    if not args.apply:
        print("Dry run only — re-run with --apply to write the change.")
    else:
        print("Done. Reload the workspace in that browser to see the sessions.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
