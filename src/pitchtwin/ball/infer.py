"""Ball inference wrapper."""

from __future__ import annotations

from pathlib import Path

import numpy as np

from pitchtwin.ball.config import BEST_WEIGHTS


class BallDetector:
    """Single-class ball detector. ``detect`` returns the best ball box or None."""

    def __init__(
        self, weights: Path | str = BEST_WEIGHTS, device: int | str = 0, conf: float = 0.2
    ) -> None:
        from ultralytics import YOLO

        self.model = YOLO(str(weights))
        self.device = device
        self.conf = conf

    def detect(self, frame: np.ndarray) -> tuple[np.ndarray, float] | None:
        res = self.model.predict(frame, device=self.device, conf=self.conf, verbose=False)[0]
        if res.boxes is None or len(res.boxes) == 0:
            return None
        i = int(res.boxes.conf.cpu().numpy().argmax())
        box = res.boxes.xyxy.cpu().numpy()[i].astype(np.float32)
        conf = float(res.boxes.conf.cpu().numpy()[i])
        return box, conf
