"""Stitch fragmented BoT-SORT tracks into per-player identities via appearance ReID.

Online trackers fragment IDs when a player is occluded, leaves the frame, or the
camera cuts. This offline pass merges fragments belonging to the same player by
matching their appearance embeddings, gated by a plausible temporal gap.
"""

from __future__ import annotations

import numpy as np


def stitch_tracks(
    track_frames: dict[int, list[int]],
    embeddings: dict[int, np.ndarray],
    max_gap: int = 180,
    sim_threshold: float = 0.6,
) -> dict[int, int]:
    """Greedy chain-merge of track fragments by appearance.

    Parameters
    ----------
    track_frames : tid -> sorted list of frame indices where the track appears.
    embeddings   : tid -> L2-normalized mean appearance embedding (or None).
    max_gap      : max frames between the end of one fragment and the start of
                   another for them to be merge candidates (~7 s at 25 fps).
    sim_threshold: minimum cosine similarity to merge (higher = fewer merges).

    Returns ``{old_tid: canonical_tid}``.
    """
    tids = [t for t in track_frames if embeddings.get(t) is not None]
    parent = {t: t for t in tids}

    def find(x: int) -> int:
        root = x
        while parent[root] != root:
            root = parent[root]
        while parent[x] != root:
            parent[x], x = root, parent[x]
        return root

    seg = {t: (min(track_frames[t]), max(track_frames[t])) for t in tids}
    order = sorted(tids, key=lambda t: seg[t][0])

    for b in order:
        b_start = seg[b][0]
        eb = embeddings[b]
        best_a: int | None = None
        best_sim = sim_threshold
        for a in order:
            if seg[a][0] >= b_start:
                break  # `order` is by start; nothing earlier remains
            a_root = find(a)
            if a_root == find(b):
                continue
            gap = b_start - seg[a_root][1]
            if gap <= 0 or gap > max_gap:
                continue
            ea = embeddings.get(a_root)
            if ea is None:
                continue
            sim = float(np.dot(ea, eb))
            if sim > best_sim:
                best_sim, best_a = sim, a_root
        if best_a is not None:
            parent[find(b)] = best_a

    return {t: find(t) for t in tids}


def majority_team(
    remap: dict[int, int],
    team_of_old: dict[int, str | None],
) -> dict[int, str | None]:
    """Assign each canonical id the majority team across its merged fragments."""
    from collections import Counter

    votes: dict[int, Counter] = {}
    for old_tid, canon in remap.items():
        team = team_of_old.get(old_tid)
        if team is None:
            continue
        votes.setdefault(canon, Counter())[team] += 1
    return {canon: c.most_common(1)[0][0] for canon, c in votes.items() if c}


def stitch_by_position(
    track_frames: dict[int, list[int]],
    first_pos: dict[int, tuple[float, float]],
    last_pos: dict[int, tuple[float, float]],
    team_of: dict[int, str | None],
    fps: float = 25.0,
    max_gap: int = 180,
    max_speed: float = 8.0,
    margin: float = 6.0,
) -> dict[int, int]:
    """Stitch track fragments by team agreement + pitch-position continuity.

    Appearance-ReID backbones pretrained on ImageNet (e.g. MobileNetV3) are not
    discriminative for player identity, so we merge only when (a) the two
    fragments share a team and (b) the second fragment reappears within a
    plausible walking/running distance of where the first was last seen. Pitch
    positions are stable through camera pans thanks to the per-frame homography.
    """
    import math

    tids = [t for t in track_frames if t in first_pos and t in last_pos]
    parent = {t: t for t in tids}

    def find(x: int) -> int:
        root = x
        while parent[root] != root:
            root = parent[root]
        while parent[x] != root:
            parent[x], x = root, parent[x]
        return root

    seg = {t: (min(track_frames[t]), max(track_frames[t])) for t in tids}
    order = sorted(tids, key=lambda t: seg[t][0])

    for b in order:
        b_start = seg[b][0]
        fb = first_pos[b]
        tb = team_of.get(b)
        best_a: int | None = None
        best_d = math.inf
        for a in order:
            if seg[a][0] >= b_start:
                break
            a_root = find(a)
            if a_root == find(b):
                continue
            gap = b_start - seg[a_root][1]
            if gap <= 0 or gap > max_gap:
                continue
            if team_of.get(a_root) != tb:  # same team (or both referees) required
                continue
            la = last_pos.get(a_root)
            if la is None:
                continue
            d = math.hypot(la[0] - fb[0], la[1] - fb[1])
            max_d = max_speed * (gap / fps) + margin
            if d <= max_d and d < best_d:
                best_d, best_a = d, a_root
        if best_a is not None:
            parent[find(b)] = best_a

    return {t: find(t) for t in tids}
