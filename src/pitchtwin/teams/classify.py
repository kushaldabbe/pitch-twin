"""Team classification by jersey color.

Re-derived approach (no code copied): for each player we take the mean LAB
color of the **non-grass pixels** in the torso crop (so the green pitch doesn't
swamp the signal), accumulate per track, then KMeans k=2 on the outfield
players. LAB is used instead of an H-S histogram because two teams often differ
in brightness (light vs dark jerseys) as much as in hue -- a hue-only histogram
cannot separate those. Goalkeepers go to the nearest cluster, referees are
neutral. Assignments are locked per track.
"""

from __future__ import annotations

from collections import defaultdict

import cv2
import numpy as np
from sklearn.cluster import KMeans

from pitchtwin.detection.config import GOALKEEPER, PLAYER, REFEREE

# Green-pitch HSV range to mask OUT (so only jersey pixels are measured).
_GRASS_LOWER = np.array([35, 40, 40])
_GRASS_UPPER = np.array([90, 255, 255])


def torso_crop(frame: np.ndarray, xyxy: np.ndarray) -> np.ndarray:
    """Top 20-60% of the bbox height -- the jersey region, above the shorts."""
    x1, y1, x2, y2 = (int(round(v)) for v in xyxy)
    x1, x2 = max(x1, 0), min(x2, frame.shape[1])
    h = y2 - y1
    ty1, ty2 = y1 + int(0.2 * h), y1 + int(0.6 * h)
    ty1, ty2 = max(ty1, 0), min(ty2, frame.shape[0])
    return frame[ty1:ty2, x1:x2]


def jersey_lab(crop: np.ndarray) -> np.ndarray | None:
    """Mean LAB color of the non-grass pixels in ``crop`` (or None if too few)."""
    if crop.size == 0:
        return None
    hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
    grass = cv2.inRange(hsv, _GRASS_LOWER, _GRASS_UPPER)
    jersey_mask = cv2.bitwise_not(grass)
    if cv2.countNonZero(jersey_mask) < 30:
        return None
    lab = cv2.cvtColor(crop, cv2.COLOR_BGR2LAB)
    mean = cv2.mean(lab, mask=jersey_mask)[:3]
    return np.asarray(mean, dtype=np.float32)


class TeamClassifier:
    """Accumulate per-track jersey LAB colors, then cluster into two teams."""

    def __init__(self, min_samples: int = 3, random_state: int = 42) -> None:
        self.min_samples = min_samples
        self.random_state = random_state
        self.colors: dict[int, list[np.ndarray]] = defaultdict(list)
        self.cls_of: dict[int, int] = {}
        self.assignment: dict[int, str | None] = {}
        self._centroids: np.ndarray | None = None
        self.locked = False

    def observe(self, track_id: int, cls: int, frame: np.ndarray, xyxy: np.ndarray) -> None:
        self.cls_of[track_id] = cls
        if cls == REFEREE:
            self.assignment[track_id] = None
            return
        lab = jersey_lab(torso_crop(frame, xyxy))
        if lab is not None:
            self.colors[track_id].append(lab)

    def fit(self) -> None:
        players = [
            t
            for t, c in self.colors.items()
            if self.cls_of.get(t) == PLAYER and len(c) >= self.min_samples
        ]
        if len(players) < 2:
            for t in list(self.colors):
                self.assignment.setdefault(t, "A")
            self.locked = True
            return

        means = np.array([np.mean(self.colors[t], axis=0) for t in players])
        km = KMeans(2, n_init=10, random_state=self.random_state).fit(means)
        self._centroids = km.cluster_centers_
        for t, lab in zip(players, km.labels_, strict=True):
            self.assignment[t] = "A" if lab == 0 else "B"

        for t, c in self.colors.items():
            if t in self.assignment:
                continue
            if self.cls_of.get(t) == REFEREE:
                self.assignment[t] = None
                continue
            self.assignment[t] = self._nearest(t, c)
        self.locked = True

    def _nearest(self, track_id: int, colors: list[np.ndarray]) -> str:
        if not colors or self._centroids is None:
            return "A"
        m = np.mean(colors, axis=0).reshape(1, -1)
        lab = int(np.argmin(((self._centroids - m) ** 2).sum(axis=1)))
        return "A" if lab == 0 else "B"

    def team_of(self, track_id: int, cls: int) -> str | None:
        if cls == REFEREE:
            return None
        assigned = self.assignment.get(track_id)
        if assigned in ("A", "B"):
            return assigned
        if self.locked and self._centroids is not None:
            return self._nearest(track_id, self.colors.get(track_id, []))
        return "A"

    def derive_roles(
        self,
        remap: dict[int, int],
        canonical_team: dict[int, str | None],
        positions_by_canon: dict[int, list[tuple[float, float]]],
        half_length: float,
    ) -> dict[int, tuple[int, str | None]]:
        """Assign role per canonical id from kit colour + pitch position.

        The detector's class label is unreliable for keepers/refs, so role is
        decided from trusted signals: keeper and referee kits differ in colour
        from both outfield teams, and keepers stay in their own goal area. Color
        separates outfield from officials; position separates keeper from ref.

        Returns ``{canon: (cls, team)}`` with cls in {GOALKEEPER, PLAYER, REFEREE}.
        """
        col_by_canon: dict[int, list[np.ndarray]] = {}
        for tid, labs in self.colors.items():
            col_by_canon.setdefault(remap.get(tid, tid), []).extend(labs)

        fallback = self._centroids is None or len(self._centroids) < 2
        all_canons = set(col_by_canon) | set(positions_by_canon)
        if fallback:
            return {c: (PLAYER, canonical_team.get(c, "A")) for c in all_canons}

        c0 = np.asarray(self._centroids[0], dtype=np.float32)
        c1 = np.asarray(self._centroids[1], dtype=np.float32)
        team_dist = float(np.linalg.norm(c0 - c1))

        team_x: dict[str, list[float]] = {}
        for canon, team in canonical_team.items():
            if team in ("A", "B"):
                xs = [p[0] for p in positions_by_canon.get(canon, ())]
                if xs:
                    team_x.setdefault(team, []).extend(xs)
        goal_team: dict[int, str] = {}
        if team_x.get("A") and team_x.get("B"):
            side_a = 1 if float(np.median(team_x["A"])) > float(np.median(team_x["B"])) else -1
            goal_team[side_a] = "A"
            goal_team[-side_a] = "B"

        derived: dict[int, tuple[int, str | None]] = {}
        for canon in all_canons:
            labs = col_by_canon.get(canon)
            team = canonical_team.get(canon, "A")
            if not labs:
                derived[canon] = (PLAYER, team)
                continue
            mean_col = np.asarray(labs, dtype=np.float32).mean(axis=0)
            d0 = float(np.linalg.norm(mean_col - c0))
            d1 = float(np.linalg.norm(mean_col - c1))
            distinct = min(d0, d1) > 0.45 * team_dist
            ps = positions_by_canon.get(canon, ())
            med_x = float(np.median([p[0] for p in ps])) if ps else 0.0
            med_z = float(np.median([p[1] for p in ps])) if ps else 0.0
            if distinct:
                near_goal = abs(med_x) > half_length - 16.5 and abs(med_z) < 20.15
                if near_goal:
                    gk_team = goal_team.get(1 if med_x > 0 else -1, team)
                    derived[canon] = (GOALKEEPER, gk_team)
                else:
                    derived[canon] = (REFEREE, None)
            else:
                derived[canon] = (PLAYER, "A" if d0 <= d1 else "B")
        return derived
