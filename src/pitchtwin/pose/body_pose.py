"""Player body pose (YOLOv8-pose, COCO 17 keypoints).

Provides per-player torso orientation (facing) from the shoulder/hip line, used
for the POV fallback (off-the-ball moments) and for Stage-2 avatar animation.
Uses the COCO-pretrained model -- no training required to start; a soccer-pose
dataset would refine it later.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

REPO_ROOT = Path(__file__).resolve().parents[3]
# COCO-pretrained body-pose model (17 keypoints). Auto-downloads on first use.
MODEL_NAME = "yolov8n-pose.pt"
BEST_WEIGHTS = MODEL_NAME

# COCO keypoint indices.
LSHOULDER, RSHOULDER = 5, 6
LHIP, RHIP = 11, 12


def _seg(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """Image-plane vector from keypoint a to b."""
    return np.array([b[0] - a[0], b[1] - a[1]], dtype=np.float32)


def facing_vector(kpts: np.ndarray, vel_image: np.ndarray | None = None) -> np.ndarray | None:
    """Return a unit image-plane vector pointing 'forward' (where the chest faces).

    Built perpendicular to the shoulder line (or hip line as fallback). The 2D
    front/back ambiguity is resolved by aligning with ``vel_image`` (the player's
    pixel-space motion direction) when available; otherwise an arbitrary sign.
    Returns None if no usable shoulder/hip pair is visible.
    """
    if kpts is None or kpts.shape[0] < 17:
        return None

    def vis(i: int) -> bool:
        return kpts[i][2] > 0.3

    if vis(LSHOULDER) and vis(RSHOULDER):
        seg = _seg(kpts[LSHOULDER], kpts[RSHOULDER])
    elif vis(LHIP) and vis(RHIP):
        seg = _seg(kpts[LHIP], kpts[RHIP])
    else:
        return None

    # Perpendicular candidates to the shoulder/hip line.
    perp = np.array([-seg[1], seg[0]], dtype=np.float32)
    n = np.linalg.norm(perp)
    if n < 1e-6:
        return None
    perp /= n

    if vel_image is not None and np.linalg.norm(vel_image) > 1e-3:
        if float(np.dot(perp, vel_image)) < 0:
            perp = -perp
    return perp


class BodyPoseDetector:
    """Run YOLOv8-pose on a frame; return person boxes + keypoints."""

    def __init__(
        self, weights: Path | str = BEST_WEIGHTS, device: int | str = 0, conf: float = 0.3
    ) -> None:
        from ultralytics import YOLO

        self.model = YOLO(str(weights))
        self.device = device
        self.conf = conf

    def detect(self, frame: np.ndarray) -> list[dict]:
        """Return ``[{box: (4,), kpts: (17,3), conf: float}, ...]``."""
        res = self.model.predict(frame, device=self.device, conf=self.conf, verbose=False)[0]
        out: list[dict] = []
        if res.keypoints is None or res.boxes is None:
            return out
        boxes = res.boxes.xyxy.cpu().numpy().astype(np.float32)
        confs = res.boxes.conf.cpu().numpy().astype(np.float32)
        kpts_all = res.keypoints.data.cpu().numpy().astype(np.float32)  # (N, 17, 3)
        for box, conf, kpts in zip(boxes, confs, kpts_all, strict=True):
            out.append({"box": box, "kpts": kpts, "conf": float(conf)})
        return out
