"""Generate a synthetic v1 clip for viewer development before CV is ready.

Produces a plausible match: 2 teams of 11 (10 outfield + GK), referees, a ball on
a drifting path, with per-frame positions in pitch meters. Deterministic via seed.

    python -m pitchtwin.contract.synthetic --out data/sample_clip/synthetic.json
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import numpy as np

PITCH_LENGTH_M = 105.0
PITCH_WIDTH_M = 68.0
DEFAULT_FPS = 25
DEFAULT_FRAMES = 750  # 30 s
SCHEMA = "pitchtwin.frame/v1"


def _wrap_angle(a: float) -> float:
    return math.atan2(math.sin(a), math.cos(a))


def _home_positions() -> list[tuple[str, str, float, float, int]]:
    """Return [(team, role, x, z, jersey), ...] for a synthetic 11v11 + refs.

    Coordinates in pitch meters, origin at center spot.
    """
    out: list[tuple[str, str, float, float, int]] = []
    # Team A attacks +x, Team B attacks -x.
    team_a = [
        ("gk", -48.0, 0.0, 1),
        ("player", -30.0, -22.0, 2),
        ("player", -30.0, -8.0, 3),
        ("player", -30.0, 8.0, 4),
        ("player", -30.0, 22.0, 5),
        ("player", -12.0, -18.0, 6),
        ("player", -12.0, 0.0, 7),
        ("player", -12.0, 18.0, 8),
        ("player", 6.0, -20.0, 9),
        ("player", 8.0, 0.0, 10),
        ("player", 6.0, 20.0, 11),
    ]
    for role, x, z, j in team_a:
        out.append(("A", role, x, z, j))
    team_b = [
        ("gk", 48.0, 0.0, 1),
        ("player", 30.0, -22.0, 2),
        ("player", 30.0, -8.0, 3),
        ("player", 30.0, 8.0, 4),
        ("player", 30.0, 22.0, 5),
        ("player", 12.0, -18.0, 6),
        ("player", 12.0, 0.0, 7),
        ("player", 12.0, 18.0, 8),
        ("player", -6.0, -20.0, 9),
        ("player", -8.0, 0.0, 10),
        ("player", -6.0, 20.0, 11),
    ]
    for role, x, z, j in team_b:
        out.append(("B", role, x, z, j))
    # Referees (neutral: team=None; role distinguishes them for the viewer).
    out.append((None, "referee", 0.0, -30.0, 0))
    out.append((None, "referee", 0.0, 30.0, 0))
    return out


def generate(
    frames: int = DEFAULT_FRAMES,
    fps: float = DEFAULT_FPS,
    seed: int = 42,
    video: str = "synthetic.mp4",
) -> dict:
    """Build a complete v1 instance as a Python dict."""
    rng = np.random.default_rng(seed)
    homes = _home_positions()
    n = len(homes)

    # Per-entity wander parameters.
    amp = rng.uniform(3.0, 9.0, size=n)
    freq = rng.uniform(0.15, 0.45, size=n)
    phase = rng.uniform(0.0, 2 * math.pi, size=n)
    z_amp = rng.uniform(2.0, 6.0, size=n)
    z_freq = rng.uniform(0.2, 0.5, size=n)
    heights = rng.uniform(1.70, 1.90, size=n)

    base = np.array([[h[2], h[3]] for h in homes], dtype=float)
    teams = [h[0] for h in homes]
    roles = [h[1] for h in homes]
    jerseys = [h[4] for h in homes]

    # Ball: a slow drift across the pitch with a sinusoidal cross component.
    ball_x0, ball_z0 = -20.0, 0.0
    ball_drift_x = 18.0  # m over the clip
    ball_cross_amp = 14.0
    ball_cross_freq = 0.25

    frame_list = []
    prev_pos = base.copy()

    for i in range(frames):
        t = i / fps
        s = i / max(frames - 1, 1)  # normalized progress 0..1

        # Player positions.
        players = []
        cur_pos = np.empty_like(base)
        for k in range(n):
            x = base[k, 0] + amp[k] * math.sin(2 * math.pi * freq[k] * t + phase[k])
            z = base[k, 1] + z_amp[k] * math.sin(2 * math.pi * z_freq[k] * t + phase[k] * 0.5)
            # Clamp to pitch bounds with margin.
            x = float(np.clip(x, -PITCH_LENGTH_M / 2 + 1, PITCH_LENGTH_M / 2 - 1))
            z = float(np.clip(z, -PITCH_WIDTH_M / 2 + 1, PITCH_WIDTH_M / 2 - 1))
            cur_pos[k] = (x, z)

            vx = x - prev_pos[k, 0]
            vz = z - prev_pos[k, 1]
            speed = math.hypot(vx, vz) * fps
            facing = _wrap_angle(math.atan2(vz, vx)) if speed > 0.3 else 0.0
            # GKs move less; cap displayed speed for realism.
            speed = min(speed, 9.5)

            if roles[k] == "referee":
                jersey = {"number": None, "conf": 0.0}
            else:
                jersey = {"number": jerseys[k], "conf": 0.95}

            players.append(
                {
                    "id": k + 1,
                    "team": teams[k],
                    "role": roles[k],
                    "x": round(x, 3),
                    "z": round(z, 3),
                    "y": 0.0,
                    "facing": round(facing, 3),
                    "speed": round(speed, 3),
                    "height_est": round(float(heights[k]), 2),
                    "jersey": jersey,
                }
            )

        # Ball.
        bx = ball_x0 + ball_drift_x * s
        bz = ball_z0 + ball_cross_amp * math.sin(2 * math.pi * ball_cross_freq * t)
        bx = float(np.clip(bx, -PITCH_LENGTH_M / 2 + 1, PITCH_LENGTH_M / 2 - 1))
        bz = float(np.clip(bz, -PITCH_WIDTH_M / 2 + 1, PITCH_WIDTH_M / 2 - 1))
        bvx = (bx - (ball_x0 + ball_drift_x * max(s - 1 / fps / max(frames - 1, 1), 0))) * fps
        bvz = (
            ball_cross_amp
            * 2
            * math.pi
            * ball_cross_freq
            * math.cos(2 * math.pi * ball_cross_freq * t)
        )
        ball = {
            "x": round(bx, 3),
            "z": round(bz, 3),
            "y": 0.0,
            "vel": [round(bvx, 3), 0.0, round(bvz, 3)],
            "conf": 0.9,
            "tracked": True,
        }

        # Possession: nearest non-referee player within 2 m.
        possessor = None
        best_d = 2.0
        for k in range(n):
            if roles[k] == "referee":
                continue
            d = math.hypot(cur_pos[k, 0] - bx, cur_pos[k, 1] - bz)
            if d < best_d:
                best_d = d
                possessor = teams[k]
        possession = possessor  # "A" | "B" | None

        frame_list.append(
            {
                "frame": i,
                "t": round(t, 4),
                "ball": ball,
                "players": players,
                "possession": possession,
                "score": {"A": 0, "B": 0},
            }
        )
        prev_pos = cur_pos.copy()

    return {
        "schema": SCHEMA,
        "source": {
            "video": video,
            "fps": fps,
            "total_frames": frames,
            "clip_name": "synthetic",
        },
        "pitch": {"length_m": PITCH_LENGTH_M, "width_m": PITCH_WIDTH_M},
        "frames": frame_list,
    }


def main() -> None:
    p = argparse.ArgumentParser(description="Generate a synthetic v1 PitchTwin clip.")
    p.add_argument("--out", default="data/sample_clip/synthetic.json")
    p.add_argument("--frames", type=int, default=DEFAULT_FRAMES)
    p.add_argument("--fps", type=float, default=DEFAULT_FPS)
    p.add_argument("--seed", type=int, default=42)
    args = p.parse_args()

    instance = generate(frames=args.frames, fps=args.fps, seed=args.seed)

    # Self-validate before writing.
    from pitchtwin.contract.validator import validate

    validate(instance)

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", encoding="utf-8") as fh:
        json.dump(instance, fh)
    print(f"wrote {out} ({len(instance['frames'])} frames, schema={instance['schema']})")


if __name__ == "__main__":
    main()
