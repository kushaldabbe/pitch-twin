"""Self-label a tactical-cam detection set from the current detector.

Samples frames across the tactical-cam clips, re-detects players with the
current best weights, keeps confident/large-enough boxes, relabels goal-area
boxes as goalkeepers (via the per-frame homography), and writes a YOLO
train/val split. Used to finetune the detector to the tactical-cam domain
(small players, fixed wide camera) -- no manual annotation for outfield.

Class indexing matches detection.config: ball=0, goalkeeper=1, player=2,
referee=3 (4 classes; ball stays empty).
"""

from __future__ import annotations

import argparse
import random
from pathlib import Path

import cv2
import numpy as np

from pitchtwin.calibration.homography import Calibrator
from pitchtwin.calibration.keypoints import BEST_WEIGHTS as KP_WEIGHTS
from pitchtwin.calibration.keypoints import PitchKeypointDetector
from pitchtwin.detection.config import BEST_WEIGHTS as DET_WEIGHTS
from pitchtwin.detection.infer import Detector

# Reuse the pipeline's goal-area definition (6-yard box) for keeper relabel.
GOAL_DEPTH = 5.5
GOAL_HALF_WIDTH = 9.16
LENGTH_M = 105.0
WIDTH_M = 68.0


def in_goal_area(x: float, z: float) -> bool:
    return abs(x) > LENGTH_M / 2 - GOAL_DEPTH and abs(z) < GOAL_HALF_WIDTH


def _in_bounds(x: float, z: float) -> bool:
    return (
        -LENGTH_M / 2 - 5 <= x <= LENGTH_M / 2 + 5
        and -WIDTH_M / 2 - 5 <= z <= WIDTH_M / 2 + 5
    )


def build(
    videos: list[Path],
    out: Path,
    frames_per_clip: int = 250,
    conf: float = 0.4,
    min_h: int = 16,
    val_fraction: float = 0.2,
    seed: int = 42,
    device: int | str = 0,
) -> Path:
    detector = Detector(weights=DET_WEIGHTS, device=device, conf=conf)
    kp_det = PitchKeypointDetector(weights=KP_WEIGHTS, device=device)
    cal = Calibrator(smoothing_alpha=0.7)

    for split in ("train", "val"):
        (out / split / "images").mkdir(parents=True, exist_ok=True)
        (out / split / "labels").mkdir(parents=True, exist_ok=True)

    rng = random.Random(seed)
    img_id = 0
    kept = 0

    for video in videos:
        cap = cv2.VideoCapture(str(video))
        if not cap.isOpened():
            print(f"could not open {video}")
            continue
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        stride = max(1, total // frames_per_clip)
        idx = 0
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            if idx % 300 == 0:
                cal.update(kp_det.detect(frame))
            if idx % stride == 0 and cal.H is not None:
                det = detector.detect(frame, classes=(1, 2, 3))
                boxes = []
                for k in range(det.n):
                    x1, y1, x2, y2 = det.xyxy[k]
                    c = int(det.class_id[k])
                    hpx = y2 - y1
                    if hpx < min_h:
                        continue
                    foot = np.array([[(x1 + x2) / 2.0, y2]], dtype=np.float32)
                    p = cal.image_to_pitch(foot)
                    if p is None:
                        continue
                    x, z = float(p[0, 0]), float(p[0, 1])
                    if not _in_bounds(x, z):
                        continue
                    cls = 1 if in_goal_area(x, z) else (3 if c == 3 else 2)
                    boxes.append((x1, y1, x2, y2, cls))
                if boxes:
                    split = "train" if rng.random() >= val_fraction else "val"
                    name = f"tactical_{img_id:06d}"
                    img_path = out / split / "images" / f"{name}.jpg"
                    cv2.imwrite(str(img_path), frame)
                    lab_path = out / split / "labels" / f"{name}.txt"
                    H, W = frame.shape[0], frame.shape[1]
                    with lab_path.open("w") as fh:
                        for (x1, y1, x2, y2, cls) in boxes:
                            cx, cy = (x1 + x2) / 2 / W, (y1 + y2) / 2 / H
                            w, h = (x2 - x1) / W, (y2 - y1) / H
                            fh.write(f"{cls} {cx:.6f} {cy:.6f} {w:.6f} {h:.6f}\n")
                    img_id += 1
                    kept += 1
            idx += 1
        cap.release()
        print(f"  {video.name}: {total} frames -> {img_id} kept so far")

    (out / "data.yaml").write_text(
        f"path: {out.as_posix()}\n"
        "train: train/images\n"
        "val: val/images\n"
        "nc: 4\n"
        "names:\n"
        "  - ball\n"
        "  - goalkeeper\n"
        "  - player\n"
        "  - referee\n",
        encoding="utf-8",
    )
    print(f"\nwrote {kept} labelled frames to {out}")
    return out / "data.yaml"


def main() -> None:
    p = argparse.ArgumentParser(description="Self-label tactical-cam frames for finetuning.")
    p.add_argument("--out", required=True, type=Path)
    p.add_argument("--videos", nargs="+", required=True, type=Path)
    p.add_argument("--frames-per-clip", type=int, default=250)
    p.add_argument("--conf", type=float, default=0.4)
    p.add_argument("--min-h", type=int, default=16)
    p.add_argument("--val-fraction", type=float, default=0.2)
    p.add_argument("--device", default="0")
    args = p.parse_args()
    build(
        videos=args.videos,
        out=args.out,
        frames_per_clip=args.frames_per_clip,
        conf=args.conf,
        min_h=args.min_h,
        val_fraction=args.val_fraction,
        device=args.device,
    )


if __name__ == "__main__":
    main()
