"""Per-track kinematics (speed, facing) from pitch-coordinate trajectories.

First-pass analytics for the v1 JSON; the full analytics module (distance,
possession, smoothed speeds) comes in 0k.
"""

from __future__ import annotations

import math

import numpy as np


def _wrap(a: float) -> float:
    return math.atan2(math.sin(a), math.cos(a))


def compute_kinematics(
    observations: list[tuple[int, float, float]],
    fps: float,
    window: int = 5,
    speed_cap: float = 10.0,
) -> dict[int, tuple[float, float]]:
    """Return ``{frame: (speed_mps, facing_rad)}`` for one track.

    ``observations`` are ``(frame_idx, x, z)`` in pitch meters, any order; they
    are sorted internally. Speed is a finite difference smoothed over ``window``
    frames; facing is the velocity heading. Speeds are capped (sprint ~10 m/s).
    """
    obs = sorted(observations, key=lambda o: o[0])
    if len(obs) < 2:
        return {f: (0.0, 0.0) for f, _, _ in obs}

    frames = np.array([o[0] for o in obs], dtype=np.float64)
    x = np.array([o[1] for o in obs], dtype=np.float64)
    z = np.array([o[2] for o in obs], dtype=np.float64)
    dt = np.maximum(np.diff(frames) / fps, 1e-6)

    vx = np.diff(x) / dt
    vz = np.diff(z) / dt
    raw_speed = np.concatenate([[0.0], np.hypot(vx, vz)])
    raw_facing = np.concatenate([[math.atan2(vz[0], vx[0])], np.arctan2(vz, vx)])

    out: dict[int, tuple[float, float]] = {}
    for i, f in enumerate(frames):
        lo = max(0, i - window)
        hi = i + 1
        speed = float(min(raw_speed[lo:hi].mean(), speed_cap))
        if speed > 0.6:
            # Vector-mean of the window's velocity headings (robust to wraparound).
            ang = raw_facing[lo:hi]
            facing = _wrap(math.atan2(np.sin(ang).mean(), np.cos(ang).mean()))
        elif i > 0:
            facing = out[int(frames[i - 1])][1]
        else:
            facing = 0.0
        out[int(f)] = (round(speed, 2), round(float(facing), 3))
    return out
