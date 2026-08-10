"""Assemble per-frame v1 JSON from pipeline outputs and validate it."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from pitchtwin.contract.validator import validate

SCHEMA_ID = "pitchtwin.frame/v1"

# detection class id -> contract role
ROLE = {1: "gk", 2: "player", 3: "referee"}


def build_player(
    track_id: int,
    team: str | None,
    cls: int,
    x: float,
    z: float,
    speed: float,
    facing: float,
    height: float = 1.78,
    jersey: int | None = None,
) -> dict[str, Any]:
    return {
        "id": int(track_id),
        "team": team,
        "role": ROLE.get(int(cls), "player"),
        "x": round(float(x), 3),
        "z": round(float(z), 3),
        "y": 0.0,
        "facing": round(float(facing), 3),
        "speed": round(float(speed), 3),
        "height_est": round(float(height), 2),
        "jersey": {"number": jersey, "conf": 0.0 if jersey is None else 0.5},
    }


def build_ball(x: float, z: float, conf: float, tracked: bool = True) -> dict[str, Any]:
    """A ball record. Height stays 0 until Stage 3 (projectile fit)."""
    return {
        "x": round(float(x), 3),
        "z": round(float(z), 3),
        "y": 0.0,
        "conf": round(float(conf), 3),
        "tracked": bool(tracked),
    }


def write(
    path: str | Path,
    *,
    video: str,
    fps: float,
    total_frames: int,
    length_m: float,
    width_m: float,
    frames: list[dict[str, Any]],
    colors: dict[str, list[int]] | None = None,
) -> dict[str, Any]:
    """Assemble the v1 instance, validate against the schema, write to ``path``."""
    instance = {
        "schema": SCHEMA_ID,
        "source": {"video": video, "fps": fps, "total_frames": total_frames},
        "pitch": {"length_m": length_m, "width_m": width_m},
        "frames": frames,
    }
    if colors:
        instance["colors"] = colors
    validate(instance)
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(instance), encoding="utf-8")
    return instance
