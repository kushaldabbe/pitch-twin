"""End-to-end CV pipeline orchestrator (Stage 0m).

python -m pitchtwin.pipeline.run --video <mp4> --out <json> [--max-frames 250]
"""

from __future__ import annotations

import argparse
from collections import defaultdict
from pathlib import Path

import cv2
import numpy as np

from pitchtwin.analytics.kinematics import compute_kinematics
from pitchtwin.calibration.homography import Calibrator
from pitchtwin.calibration.keypoints import BEST_WEIGHTS as KP_WEIGHTS
from pitchtwin.calibration.keypoints import PitchKeypointDetector
from pitchtwin.detection.config import BEST_WEIGHTS as DET_WEIGHTS
from pitchtwin.export.writer import build_player
from pitchtwin.export.writer import write as write_v1
from pitchtwin.teams.classify import TeamClassifier
from pitchtwin.tracking.scene import SceneSegmentor
from pitchtwin.tracking.tracker import Tracker

DEFAULT_LENGTH_M = 105.0
DEFAULT_WIDTH_M = 68.0


def run(
    video: str | Path,
    out: str | Path,
    max_frames: int | None = None,
    keypoint_interval: int = 10,
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
    kp_det = PitchKeypointDetector(weights=KP_WEIGHTS, device=device)
    cal = Calibrator()
    seg = SceneSegmentor()
    teams = TeamClassifier()

    per_frame: list[dict] = []  # [{idx, t, items:[(id,cls,conf,box)]}]
    pitch_per_frame: list[dict[int, tuple[float, float]]] = []
    trajectories: dict[int, list[tuple[int, float, float]]] = defaultdict(list)

    idx = 0
    while True:
        if max_frames is not None and idx >= max_frames:
            break
        ok, frame = cap.read()
        if not ok:
            break

        is_cut = seg.update(frame)
        if idx == 0 or is_cut or idx % keypoint_interval == 0:
            cal.update(kp_det.detect(frame))

        tr = tracker.track_frame(frame, persist=True)
        items: list[tuple[int, int, float, np.ndarray]] = []
        pitch_now: dict[int, tuple[float, float]] = {}
        for box, tid, conf, cls in zip(tr.boxes, tr.ids, tr.conf, tr.cls, strict=True):
            tid, cls, conf = int(tid), int(cls), float(conf)
            items.append((tid, cls, conf, box))
            teams.observe(tid, cls, frame, box)
            if cal.image_to_pitch is not None and cal.H is not None:
                foot = np.array([[float(box[0] + box[2]) / 2.0, float(box[3])]], dtype=np.float32)
                p = cal.image_to_pitch(foot)
                if p is not None:
                    x, z = float(p[0, 0]), float(p[0, 1])
                    in_bounds = (
                        -length_m / 2 - 5 <= x <= length_m / 2 + 5
                        and -width_m / 2 - 5 <= z <= width_m / 2 + 5
                    )
                    if in_bounds:
                        pitch_now[tid] = (x, z)
                        trajectories[tid].append((idx, x, z))

        per_frame.append({"idx": idx, "t": idx / fps, "items": items})
        pitch_per_frame.append(pitch_now)
        idx += 1
    cap.release()

    teams.fit()
    kin = {tid: compute_kinematics(traj, fps) for tid, traj in trajectories.items()}

    frames_out = []
    team_counts: dict[str, int] = {"A": 0, "B": 0}
    for fi, fr in enumerate(per_frame):
        players = []
        for tid, cls, _conf, _box in fr["items"]:
            pos = pitch_per_frame[fi].get(tid)
            if pos is None:
                continue
            sp, fac = kin.get(tid, {}).get(fr["idx"], (0.0, 0.0))
            team = teams.team_of(tid, cls)
            players.append(build_player(tid, team, cls, pos[0], pos[1], sp, fac))
            if team in team_counts:
                team_counts[team] += 1
        frames_out.append(
            {
                "frame": fr["idx"],
                "t": round(fr["t"], 4),
                "ball": None,
                "players": players,
                "possession": None,
                "score": {"A": 0, "B": 0},
            }
        )

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
        f"team samples A/B={team_counts['A']}/{team_counts['B']}"
    )
    return instance


def main() -> None:
    p = argparse.ArgumentParser(description="Run the PitchTwin CV pipeline on a video clip.")
    p.add_argument("--video", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--max-frames", type=int, default=None)
    p.add_argument("--keypoint-interval", type=int, default=10)
    p.add_argument("--device", default="0")
    p.add_argument("--length-m", type=float, default=DEFAULT_LENGTH_M)
    p.add_argument("--width-m", type=float, default=DEFAULT_WIDTH_M)
    args = p.parse_args()
    run(
        video=args.video,
        out=args.out,
        max_frames=args.max_frames,
        keypoint_interval=args.keypoint_interval,
        device=args.device,
        length_m=args.length_m,
        width_m=args.width_m,
    )


if __name__ == "__main__":
    main()
