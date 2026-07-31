"""Per-track kinematics (speed, facing) from pitch-coordinate trajectories.

First-pass analytics for the v1 JSON; the full analytics module (distance,
possession, smoothed speeds) comes in 0k.
"""

from __future__ import annotations

import math

import numpy as np


def _wrap(a: float) -> float:
    return math.atan2(math.sin(a), math.cos(a))


def smooth_angles(samples: list[tuple[int, float]], window: int = 7) -> dict[int, float]:
    """Smooth a track's per-frame angle samples (radians) via a vector mean.

    ``samples`` are ``(frame, angle)``; returns ``{frame: smoothed_angle}``.
    Robust to the wraparound at +/-pi.
    """
    obs = sorted(samples, key=lambda o: o[0])
    if not obs:
        return {}
    frames = [o[0] for o in obs]
    ang = [o[1] for o in obs]
    out: dict[int, float] = {}
    for i in range(len(obs)):
        lo = max(0, i - window)
        seg = ang[lo : i + 1]
        out[frames[i]] = math.atan2(np.sin(seg).mean(), np.cos(seg).mean())
    return out


def forward_fill(samples: dict[int, float], active_frames: list[int]) -> dict[int, float]:
    """Hold the most recent sample value across ``active_frames`` (sorted)."""
    if not samples or not active_frames:
        return {}
    items = sorted(samples.items())
    out: dict[int, float] = {}
    j = 0
    for f in sorted(active_frames):
        while j + 1 < len(items) and items[j + 1][0] <= f:
            j += 1
        if items[j][0] <= f:
            out[f] = items[j][1]
    return out


def _centered_moving_avg(a: np.ndarray, k: int) -> np.ndarray:
    """Centered moving average with edge clamping (``k`` is forced odd)."""
    if k % 2 == 0:
        k -= 1
    pad = k // 2
    ap = np.pad(a, (pad, pad), mode="edge")
    return np.convolve(ap, np.ones(k) / k, mode="valid")


def smooth_trajectory(
    observations: list[tuple[int, float, float]], window: int = 5
) -> dict[int, tuple[float, float]]:
    """Centered moving-average smoothing of a track's ``(frame, x, z)`` series.

    Returns ``{frame: (x_smooth, z_smooth)}``. Reduces detection/keypoint jitter
    before kinematics and before emitting positions to the viewer.
    """
    obs = sorted(observations, key=lambda o: o[0])
    n = len(obs)
    if n == 0:
        return {}
    frames = [o[0] for o in obs]
    x = np.array([o[1] for o in obs], dtype=np.float64)
    z = np.array([o[2] for o in obs], dtype=np.float64)
    k = max(1, min(window, n))
    if k >= 3:
        x = _centered_moving_avg(x, k)
        z = _centered_moving_avg(z, k)
    return {frames[i]: (float(x[i]), float(z[i])) for i in range(n)}


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
