"""Tracking configuration (re-derived; no code copied from reference repos)."""

from __future__ import annotations

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
TRACKER_CONFIG = Path(__file__).resolve().parent / "botsort.yaml"

# Classes to track: exclude ball (class 0) — the ball is tracked by the
# dedicated ball module (0e) to avoid polluting player trajectories.
BALL, GOALKEEPER, PLAYER, REFEREE = 0, 1, 2, 3
PLAYER_CLASSES = (GOALKEEPER, PLAYER, REFEREE)

# Detection confidence floor for tracking.
TRACK_CONF = 0.3
