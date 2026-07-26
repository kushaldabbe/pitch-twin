"""End-to-end CV pipeline orchestrator (Stage 0m).

python -m pitchtwin.pipeline.run --video <mp4> --out <json> [--max-frames 250]
"""

from __future__ import annotations

import argparse
from collections import defaultdict
from pathlib import Path

import cv2
import numpy as np

from pitchtwin.analytics.kinematics import compute_kinematics, smooth_trajectory
from pitchtwin.calibration.homography import Calibrator
from pitchtwin.calibration.keypoints import BEST_WEIGHTS as KP_WEIGHTS
from pitchtwin.calibration.keypoints import PitchKeypointDetector
from pitchtwin.detection.config import BEST_WEIGHTS as DET_WEIGHTS
from pitchtwin.detection.infer import Detector
from pitchtwin.export.writer import build_ball, build_player
from pitchtwin.export.writer import write as write_v1
from pitchtwin.teams.classify import TeamClassifier
from pitchtwin.tracking.scene import SceneSegmentor
from pitchtwin.tracking.tracker import Tracker

DEFAULT_LENGTH_M = 105.0
DEFAULT_WIDTH_M = 68.0


def _in_bounds(x: float, z: float, length_m: float, width_m: float, margin: float = 5.0) -> bool:
    return (
        -length_m / 2 - margin <= x <= length_m / 2 + margin
        and -width_m / 2 - margin <= z <= width_m / 2 + margin
    )


def run(
    video: str | Path,
    out: str | Path,
    max_frames: int | None = None,
    keypoint_interval: int = 1,
    smooth_window: int = 5,
    device: int | str = 0,
    length_m: float = DEFAULT_LENGTH_M,
    width_m: float = DEFAULT_WIDTH_M,
) -> dict:
    """Process ``video`` -> a validated v1 JSON at ``out``."""
    cap = cv2.VideoCapture(str(video))
    if not cap.isOpened():
        raise SystemExit(f"could not open video: {video}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0

    tracker = Tracker(detector_weights=DET_WEIGHTS, device=device)
    ball_det = Detector(weights=DET_WEIGHTS, device=device, conf=0.15)
    kp_det = PitchKeypointDetector(weights=KP_WEIGHTS, device=device)
    # Per-frame homography + light smoothing: tracks broadcast camera pans
    # without the lag a heavy EMA would introduce.
    cal = Calibrator(smoothing_alpha=0.7)
    seg = SceneSegmentor()
    teams = TeamClassifier()

    # Per-frame raw records.
    frame_meta: list[tuple[int, float]] = []  # (idx, t)
    items_per_frame: list[list[tuple[int, int, float]]] = []  # (id, cls, conf)
    raw_pitch: list[dict[int, tuple[float, float]]] = []  # tid -> raw (x,z)
    ball_per_frame: list[dict | None] = []
    trajectories: dict[int, list[tuple[int, float, float]]] = defaultdict(list)

    idx = 0
    while True:
        if max_frames is not None and idx >= max_frames:
            break
        ok, frame = cap.read()
        if not ok:
            break

        is_cut = seg.update(frame)
        if idx == 0 or is_cut or (keypoint_interval > 1 and idx % keypoint_interval == 0):
            cal.update(kp_det.detect(frame))

        # Players
        tr = tracker.track_frame(frame, persist=True)
        pitch_now: dict[int, tuple[float, float]] = {}
        items: list[tuple[int, int, float]] = []
        for box, tid, conf, cls in zip(tr.boxes, tr.ids, tr.conf, tr.cls, strict=True):
            tid, cls, conf = int(tid), int(cls), float(conf)
            items.append((tid, cls, conf))
            teams.observe(tid, cls, frame, box)
            if cal.H is not None:
                foot = np.array([[float(box[0] + box[2]) / 2.0, float(box[3])]], dtype=np.float32)
                p = cal.image_to_pitch(foot)
                if p is not None:
                    x, z = float(p[0, 0]), float(p[0, 1])
                    if _in_bounds(x, z, length_m, width_m):
                        pitch_now[tid] = (x, z)
                        trajectories[tid].append((idx, x, z))

        # Ball (dedicated detector pass, class 0 only)
        ball_rec: dict | None = None
        bdets = ball_det.detect(frame, classes=(0,))
        if cal.H is not None and bdets.n > 0:
            bi = int(np.argmax(bdets.confidence))
            b = bdets.xyxy[bi]
            foot = np.array([[float(b[0] + b[2]) / 2.0, float(b[3])]], dtype=np.float32)
            p = cal.image_to_pitch(foot)
            if p is not None:
                bx, bz = float(p[0, 0]), float(p[0, 1])
                if _in_bounds(bx, bz, length_m, width_m):
                    ball_rec = build_ball(bx, bz, float(bdets.confidence[bi]))

        frame_meta.append((idx, idx / fps))
        items_per_frame.append(items)
        raw_pitch.append(pitch_now)
        ball_per_frame.append(ball_rec)
        idx += 1
    cap.release()

    # Smooth trajectories -> less jitter; recompute kinematics on smoothed positions.
    smoothed: dict[int, dict[int, tuple[float, float]]] = {
        tid: smooth_trajectory(traj, window=smooth_window) for tid, traj in trajectories.items()
    }
    kin = {
        tid: compute_kinematics([(f, x, z) for f, (x, z) in smoothed[tid].items()], fps)
        for tid in trajectories
    }

    teams.fit()

    frames_out = []
    for fi, (fidx, t) in enumerate(frame_meta):
        players = []
        for tid, cls, _conf in items_per_frame[fi]:
            pos = smoothed.get(tid, {}).get(fidx)
            if pos is None:
                continue
            sp, fac = kin.get(tid, {}).get(fidx, (0.0, 0.0))
            players.append(build_player(tid, teams.team_of(tid, cls), cls, pos[0], pos[1], sp, fac))
        frames_out.append(
            {
                "frame": fidx,
                "t": round(t, 4),
                "ball": ball_per_frame[fi],
                "players": players,
                "possession": None,
                "score": {"A": 0, "B": 0},
            }
        )

    n_ball = sum(1 for b in ball_per_frame if b is not None)
    instance = write_v1(
        out,
        video=Path(video).name,
        fps=fps,
        total_frames=len(frames_out),
        length_m=length_m,
        width_m=width_m,
        frames=frames_out,
    )
    print(
        f"wrote {out}: {len(frames_out)} frames | {len(trajectories)} tracks | "
        f"ball in {n_ball}/{len(frames_out)} frames"
    )
    return instance


def main() -> None:
    p = argparse.ArgumentParser(description="Run the PitchTwin CV pipeline on a video clip.")
    p.add_argument("--video", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--max-frames", type=int, default=None)
    p.add_argument("--keypoint-interval", type=int, default=1)
    p.add_argument("--smooth-window", type=int, default=5)
    p.add_argument("--device", default="0")
    p.add_argument("--length-m", type=float, default=DEFAULT_LENGTH_M)
    p.add_argument("--width-m", type=float, default=DEFAULT_WIDTH_M)
    args = p.parse_args()
    run(
        video=args.video,
        out=args.out,
        max_frames=args.max_frames,
        keypoint_interval=args.keypoint_interval,
        smooth_window=args.smooth_window,
        device=args.device,
        length_m=args.length_m,
        width_m=args.width_m,
    )


if __name__ == "__main__":
    main()
