"""BoT-SORT multi-object tracking for broadcast football.

Wraps ultralytics' BoT-SORT with a re-derived config (camera-motion
compensation on). Produces per-frame tracks: ``(track_id, box, conf, class)``.

Design note: the ultralytics persistent-class-filter gotcha (where
``model.track(classes=[...])`` poisons later ``model.predict()`` calls) is
avoided by using a *dedicated* YOLO instance for tracking, separate from the
:class:`pitchtwin.detection.infer.Detector` used for raw detection.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from pitchtwin.detection.config import BEST_WEIGHTS as DEFAULT_DETECTOR
from pitchtwin.tracking.config import PLAYER_CLASSES, TRACK_CONF, TRACKER_CONFIG


@dataclass
class FrameTracks:
    """All tracks for one frame, arrays aligned along axis 0."""

    boxes: np.ndarray  # (N, 4) xyxy
    ids: np.ndarray  # (N,) int track ids
    conf: np.ndarray  # (N,)
    cls: np.ndarray  # (N,) int class ids

    @property
    def n(self) -> int:
        return len(self.ids)

    def by_id(self) -> dict[int, np.ndarray]:
        return {int(i): b for i, b in zip(self.ids, self.boxes, strict=True)}


class Tracker:
    """Stateful BoT-SORT tracker. Call :meth:`track_frame` once per frame in order."""

    def __init__(
        self,
        detector_weights: Path | str = DEFAULT_DETECTOR,
        tracker_config: Path | str = TRACKER_CONFIG,
        device: int | str = 0,
        classes: Iterable[int] = PLAYER_CLASSES,
        conf: float = TRACK_CONF,
    ) -> None:
        from ultralytics import YOLO

        self.model = YOLO(str(detector_weights))
        self.tracker_config = str(tracker_config)
        self.device = device
        self.classes = list(classes)
        self.conf = conf

    def track_frame(self, frame: np.ndarray, persist: bool = True) -> FrameTracks:
        """Track one BGR frame. ``persist=True`` keeps state across calls."""
        res = self.model.track(
            frame,
            persist=persist,
            tracker=self.tracker_config,
            classes=self.classes,
            conf=self.conf,
            device=self.device,
            verbose=False,
        )[0]
        boxes = res.boxes
        empty = FrameTracks(
            np.zeros((0, 4), np.float32),
            np.zeros((0,), np.int64),
            np.zeros((0,), np.float32),
            np.zeros((0,), np.int64),
        )
        if boxes is None or boxes.id is None:
            return empty
        return FrameTracks(
            boxes.xyxy.cpu().numpy().astype(np.float32),
            boxes.id.cpu().numpy().astype(np.int64),
            boxes.conf.cpu().numpy().astype(np.float32),
            boxes.cls.cpu().numpy().astype(np.int64),
        )
