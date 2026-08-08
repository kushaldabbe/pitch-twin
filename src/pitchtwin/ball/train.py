"""Train the dedicated ball detector.

python -m pitchtwin.ball.train [--device 0]
"""

from __future__ import annotations

import argparse

from pitchtwin.ball.config import (
    BATCH,
    BEST_WEIGHTS,
    DATA_YAML,
    EPOCHS,
    IMGSZ,
    MODEL_NAME,
    PATIENCE,
    WEIGHTS_DIR,
)


def train(device: int | str = 0) -> None:
    from ultralytics import YOLO

    model = YOLO(MODEL_NAME)
    model.train(
        data=str(DATA_YAML),
        epochs=EPOCHS,
        batch=BATCH,
        imgsz=IMGSZ,
        patience=PATIENCE,
        device=device,
        workers=2,           # low to avoid Windows paging-file exhaustion
        cache=False,
        project=str(WEIGHTS_DIR.parent),
        name=WEIGHTS_DIR.name,
        exist_ok=True,
        amp=True,
    )
    print(f"\nDone. Best ball weights: {BEST_WEIGHTS}")


def main() -> None:
    p = argparse.ArgumentParser(description="Train the PitchTwin dedicated ball detector.")
    p.add_argument("--device", default="0")
    args = p.parse_args()
    train(device=args.device)


if __name__ == "__main__":
    main()
