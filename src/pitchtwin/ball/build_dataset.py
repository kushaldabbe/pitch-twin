"""Build a single-class ball dataset from the player-detection labels.

Keeps only the ball (class 0) boxes from the football-players-detection dataset
so we can train a dedicated, higher-recall ball detector.

    python -m pitchtwin.ball.build_dataset
"""

from __future__ import annotations

import shutil

from pitchtwin.ball.config import DATA_YAML, DATASET_DIR, PLAYER_DS

_SPLIT_MAP = {"train": "train", "valid": "valid", "test": "valid"}


def build() -> dict[str, int]:
    DATASET_DIR.mkdir(parents=True, exist_ok=True)
    counts: dict[str, int] = {}
    for src_split, dst_split in _SPLIT_MAP.items():
        ssrc = PLAYER_DS / src_split
        if not ssrc.exists():
            continue
        img_src = ssrc / "images"
        lab_src = ssrc / "labels"
        dimg = DATASET_DIR / dst_split / "images"
        dlab = DATASET_DIR / dst_split / "labels"
        dimg.mkdir(parents=True, exist_ok=True)
        dlab.mkdir(parents=True, exist_ok=True)
        n = 0
        for lab in lab_src.glob("*.txt"):
            lines = [ln for ln in lab.read_text().splitlines() if ln.strip()]
            balls = [ln for ln in lines if ln.split()[0] == "0"]  # class 0 = ball
            if not balls:
                continue
            stem = lab.stem
            img = next(
                (
                    img_src / f"{stem}{ext}"
                    for ext in (".jpg", ".png", ".jpeg")
                    if (img_src / f"{stem}{ext}").exists()
                ),
                None,
            )
            if img is None:
                continue
            (dlab / f"{stem}.txt").write_text("\n".join(balls))
            shutil.copy(img, dimg / img.name)
            n += 1
        counts[dst_split] = counts.get(dst_split, 0) + n

    DATA_YAML.write_text(
        f"path: {DATASET_DIR}\ntrain: train/images\nval: valid/images\nnc: 1\nnames: ['ball']\n"
    )
    return counts


def main() -> None:
    counts = build()
    print(f"ball dataset built at {DATASET_DIR}: {counts}")


if __name__ == "__main__":
    main()
