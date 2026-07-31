"""End-to-end CV pipeline orchestrator (Stage 0m).

python -m pitchtwin.pipeline.run --video <mp4> --out <json> [--max-frames 250]
"""

from __future__ import annotations

import argparse
import math
from collections import defaultdict
from pathlib import Path

import cv2
import numpy as np

from pitchtwin.analytics.kinematics import (
    compute_kinematics,
    forward_fill,
    smooth_angles,
    smooth_trajectory,
)
from pitchtwin.calibration.homography import Calibrator
from pitchtwin.calibration.keypoints import BEST_WEIGHTS as KP_WEIGHTS
from pitchtwin.calibration.keypoints import PitchKeypointDetector
from pitchtwin.detection.config import BEST_WEIGHTS as DET_WEIGHTS
from pitchtwin.detection.infer import Detector
from pitchtwin.export.writer import build_ball, build_player
from pitchtwin.export.writer import write as write_v1
from pitchtwin.pose.body_pose import BodyPoseDetector, facing_vector
from pitchtwin.teams.classify import TeamClassifier
from pitchtwin.tracking.scene import SceneSegmentor
from pitchtwin.tracking.stitch import majority_team, stitch_by_position
from pitchtwin.tracking.tracker import Tracker

DEFAULT_LENGTH_M = 105.0
DEFAULT_WIDTH_M = 68.0
REID_SAMPLE_INTERVAL = 15  # (unused; kept for reference)
POSE_SAMPLE_INTERVAL = 5  # body-pose inference cadence (frames)


def _iou(a, b) -> float:
    x1, y1 = max(a[0], b[0]), max(a[1], b[1])
    x2, y2 = min(a[2], b[2]), min(a[3], b[3])
    inter = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    ua = (
        max(0.0, a[2] - a[0]) * max(0.0, a[3] - a[1])
        + max(0.0, b[2] - b[0]) * max(0.0, b[3] - b[1])
        - inter
    )
    return inter / ua if ua > 0 else 0.0


REID_SAMPLE_INTERVAL = 15  # embed crops every N frames per track


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
    cal = Calibrator(smoothing_alpha=0.7)
    seg = SceneSegmentor()
    teams = TeamClassifier()
    try:
        body = BodyPoseDetector(device=device)
    except Exception:
        body = None
    pose_raw: dict[int, list[tuple[int, float]]] = defaultdict(list)
    prev_center: dict[int, tuple[float, float]] = {}

    frame_meta: list[tuple[int, float]] = []
    items_per_frame: list[list[tuple[int, int, float]]] = []
    raw_pitch: list[dict[int, tuple[float, float]]] = []
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

        # Body pose -> torso facing (used as the POV fallback for off-ball
        # moments and to drive Stage-2 avatars). Sampled every N frames.
        if body is not None and idx % POSE_SAMPLE_INTERVAL == 0 and len(tr.boxes) > 0:
            for pose in body.detect(frame):
                best_k, best_iou = None, 0.3
                for k in range(len(tr.boxes)):
                    iou = _iou(pose["box"], tr.boxes[k])
                    if iou > best_iou:
                        best_iou, best_k = iou, k
                if best_k is None:
                    continue
                box_m = tr.boxes[best_k]
                tid_m = int(tr.ids[best_k])
                cx = float((box_m[0] + box_m[2]) / 2.0)
                cy = float(box_m[3])
                pc = prev_center.get(tid_m)
                vel_img = np.array([cx - pc[0], cy - pc[1]], np.float32) if pc else None
                prev_center[tid_m] = (cx, cy)
                fv = facing_vector(pose["kpts"], vel_img)
                if fv is None or cal.H is None:
                    continue
                foot = np.array([[cx, cy]], dtype=np.float32)
                tip = np.array([[cx + fv[0] * 50.0, cy + fv[1] * 50.0]], dtype=np.float32)
                pf = cal.image_to_pitch(np.concatenate([foot, tip], axis=0))
                if pf is not None:
                    dx, dz = float(pf[1, 0] - pf[0, 0]), float(pf[1, 1] - pf[0, 1])
                    if dx * dx + dz * dz > 1e-6:
                        pose_raw[tid_m].append((idx, math.atan2(dz, dx)))

        # Ball
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

    # Smooth per-fragment trajectories + kinematics.
    smoothed: dict[int, dict[int, tuple[float, float]]] = {
        tid: smooth_trajectory(traj, window=smooth_window) for tid, traj in trajectories.items()
    }
    kin = {
        tid: compute_kinematics([(f, x, z) for f, (x, z) in smoothed[tid].items()], fps)
        for tid in trajectories
    }
    teams.fit()

    # ReID stitching: merge fragmented track ids into per-player identities
    # using team agreement + pitch-position continuity (appearance ReID is not
    # discriminative enough with ImageNet-pretrained backbones).
    track_frames = {tid: [f for f, _, _ in traj] for tid, traj in trajectories.items()}
    # Body-pose facing: smooth per track, then hold across active frames.
    pose_facing: dict[int, dict[int, float]] = {
        tid: forward_fill(smooth_angles(raw, window=7), track_frames.get(tid, []))
        for tid, raw in pose_raw.items()
    }
    first_pos = {tid: sm[min(sm)] for tid, sm in smoothed.items() if sm}
    last_pos = {tid: sm[max(sm)] for tid, sm in smoothed.items() if sm}
    team_of_old = {tid: teams.team_of(tid, teams.cls_of.get(tid, 2)) for tid in trajectories}
    remap = stitch_by_position(track_frames, first_pos, last_pos, team_of_old, fps=fps)
    canonical_team = majority_team(remap, team_of_old) if remap else team_of_old

    frames_out = []
    for fi, (fidx, t) in enumerate(frame_meta):
        players = []
        for tid, cls, _conf in items_per_frame[fi]:
            pos = smoothed.get(tid, {}).get(fidx)
            if pos is None:
                continue
            sp, fac = kin.get(tid, {}).get(fidx, (0.0, 0.0))
            pose_f = pose_facing.get(tid, {}).get(fidx)
            if pose_f is not None:
                fac = pose_f
            canon = remap.get(tid, tid)
            team = canonical_team.get(canon, "A")
            players.append(build_player(canon, team, cls, pos[0], pos[1], sp, fac))
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
    n_canonical = len({remap.get(t, t) for t in trajectories}) if remap else len(trajectories)
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
        f"wrote {out}: {len(frames_out)} frames | "
        f"tracks {len(trajectories)} -> {n_canonical} canonical (ReID) | "
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
