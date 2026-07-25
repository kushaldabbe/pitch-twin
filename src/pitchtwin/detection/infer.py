"""Detection inference wrapper: frames -> Detection records."""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from pitchtwin.detection.config import BEST_WEIGHTS, CLASS_NAMES


@dataclass
class Detection:
    """One frame's detections.

    Arrays are aligned along axis 0 (one entry per detected box).
    """

    xyxy: np.ndarray  # (N, 4) pixel coords
    confidence: np.ndarray  # (N,)
    class_id: np.ndarray  # (N,) int

    @property
    def n(self) -> int:
        return len(self.class_id)

    def class_name(self, i: int) -> str:
        return CLASS_NAMES[int(self.class_id[i])]


class Detector:
    """Thin wrapper around a trained YOLO model."""

    def __init__(
        self,
        weights: Path | str = BEST_WEIGHTS,
        device: int | str = 0,
        conf: float = 0.25,
        iou: float = 0.7,
    ) -> None:
        from ultralytics import YOLO

        self.model = YOLO(str(weights))
        self.device = device
        self.conf = conf
        self.iou = iou

    def detect(self, frame: np.ndarray, classes: Iterable[int] | None = None) -> Detection:
        """Run detection on a single BGR frame."""
        res = self.model.predict(
            frame,
            device=self.device,
            conf=self.conf,
            iou=self.iou,
            classes=list(classes) if classes is not None else None,
            verbose=False,
        )[0]
        if res.boxes is None or len(res.boxes) == 0:
            return Detection(
                xyxy=np.zeros((0, 4), dtype=np.float32),
                confidence=np.zeros((0,), dtype=np.float32),
                class_id=np.zeros((0,), dtype=np.int64),
            )
        return Detection(
            xyxy=res.boxes.xyxy.cpu().numpy().astype(np.float32),
            confidence=res.boxes.conf.cpu().numpy().astype(np.float32),
            class_id=res.boxes.cls.cpu().numpy().astype(np.int64),
        )
