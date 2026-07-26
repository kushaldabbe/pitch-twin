"""Team classification by jersey color.

Re-derived approach (no code copied): 2D HSV (hue-saturation) histograms of the
torso crop, KMeans k=2 on **outfield players only**, then goalkeepers assigned
to the nearest cluster and referees flagged neutral. Assignments are locked
per track. Value (brightness) is dropped from the histogram for lighting
robustness.
"""

from __future__ import annotations

from collections import defaultdict

import cv2
import numpy as np
from sklearn.cluster import KMeans

from pitchtwin.detection.config import PLAYER, REFEREE

HIST_BINS = (16, 8)  # hue x saturation


def torso_crop(frame: np.ndarray, xyxy: np.ndarray) -> np.ndarray:
    """Top 20-60% of the bbox height — the jersey region, above the shorts."""
    x1, y1, x2, y2 = (int(round(v)) for v in xyxy)
    x1, x2 = max(x1, 0), min(x2, frame.shape[1])
    h = y2 - y1
    ty1, ty2 = y1 + int(0.2 * h), y1 + int(0.6 * h)
    ty1, ty2 = max(ty1, 0), min(ty2, frame.shape[0])
    return frame[ty1:ty2, x1:x2]


def torso_histogram(crop: np.ndarray) -> np.ndarray:
    if crop.size == 0:
        return np.zeros(HIST_BINS[0] * HIST_BINS[1], dtype=np.float32)
    hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
    hist = cv2.calcHist([hsv], [0, 1], None, list(HIST_BINS), [0, 180, 0, 256])
    cv2.normalize(hist, hist)
    return hist.flatten().astype(np.float32)


class TeamClassifier:
    """Accumulate per-track torso histograms, then cluster into two teams."""

    def __init__(self, min_samples: int = 3, random_state: int = 42) -> None:
        self.min_samples = min_samples
        self.random_state = random_state
        self.hists: dict[int, list[np.ndarray]] = defaultdict(list)
        self.cls_of: dict[int, int] = {}
        self.assignment: dict[int, str | None] = {}
        self._centroids: np.ndarray | None = None
        self.locked = False

    def observe(self, track_id: int, cls: int, frame: np.ndarray, xyxy: np.ndarray) -> None:
        self.cls_of[track_id] = cls
        if cls == REFEREE:
            self.assignment[track_id] = None
            return
        self.hists[track_id].append(torso_histogram(torso_crop(frame, xyxy)))

    def fit(self) -> None:
        players = [
            t
            for t, h in self.hists.items()
            if self.cls_of.get(t) == PLAYER and len(h) >= self.min_samples
        ]
        if len(players) < 2:
            # Degenerate: fall back to assigning everyone seen to team A.
            for t in list(self.hists):
                self.assignment.setdefault(t, "A")
            self.locked = True
            return

        means = np.array([np.mean(self.hists[t], axis=0) for t in players])
        km = KMeans(2, n_init=10, random_state=self.random_state).fit(means)
        self._centroids = km.cluster_centers_
        for t, lab in zip(players, km.labels_, strict=True):
            self.assignment[t] = "A" if lab == 0 else "B"

        # Goalkeepers and low-sample players: nearest centroid.
        for t, h in self.hists.items():
            if t in self.assignment:
                continue
            if self.cls_of.get(t) == REFEREE:
                self.assignment[t] = None
                continue
            self.assignment[t] = self._nearest(t, h)
        self.locked = True

    def _nearest(self, track_id: int, h: list[np.ndarray]) -> str:
        if not h or self._centroids is None:
            return "A"
        m = np.mean(h, axis=0).reshape(1, -1)
        lab = int(np.argmin(((self._centroids - m) ** 2).sum(axis=1)))
        return "A" if lab == 0 else "B"

    def team_of(self, track_id: int, cls: int) -> str | None:
        if cls == REFEREE:
            return None
        # A player-class frame must always resolve to a team (A/B), even if the
        # track's last-observed class was a spurious referee label.
        assigned = self.assignment.get(track_id)
        if assigned in ("A", "B"):
            return assigned
        if self.locked and self._centroids is not None:
            return self._nearest(track_id, self.hists.get(track_id, []))
        return "A"
