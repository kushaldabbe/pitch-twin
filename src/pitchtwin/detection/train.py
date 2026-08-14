"""Train the YOLOv8 football detector on the Roboflow dataset.

python -m pitchtwin.detection.train [--epochs 40] [--batch 4] [--device 0]
"""

from __future__ import annotations

import argparse
from typing import Any

from pitchtwin.detection.config import (
    BATCH,
    BEST_WEIGHTS,
    DATA_YAML,
    EPOCHS,
    IMGSZ,
    LAST_WEIGHTS,
    MODEL_NAME,
    PATIENCE,
    WEIGHTS_DIR,
)


def train(
    model: str = MODEL_NAME,
    data: Path | str = DATA_YAML,
    epochs: int = EPOCHS,
    batch: int = BATCH,
    imgsz: int = IMGSZ,
    patience: int = PATIENCE,
    device: int | str = 0,
    resume: bool = False,
    lr0: float = 0.01,
    name: str = WEIGHTS_DIR.name,
) -> Any:
    """Train the detector. Weights land at ``runs/detect/<name>/``."""
    from ultralytics import YOLO

    if resume:
        model_obj = YOLO(str(LAST_WEIGHTS)) if LAST_WEIGHTS.exists() else YOLO(model)
    else:
        model_obj = YOLO(model)

    return model_obj.train(
        data=str(data),
        epochs=epochs,
        batch=batch,
        imgsz=imgsz,
        patience=patience,
        device=device,
        lr0=lr0,
        project=str(WEIGHTS_DIR.parent),
        name=name,
        exist_ok=True,
        amp=True,  # mixed precision — halves VRAM, essential on 4 GB
        pretrained=True,
        verbose=True,
        resume=resume,
    )


def main() -> None:
    p = argparse.ArgumentParser(description="Train the PitchTwin football detector.")
    p.add_argument("--model", default=MODEL_NAME)
    p.add_argument("--data", default=str(DATA_YAML))
    p.add_argument("--epochs", type=int, default=EPOCHS)
    p.add_argument("--batch", type=int, default=BATCH)
    p.add_argument("--imgsz", type=int, default=IMGSZ)
    p.add_argument("--patience", type=int, default=PATIENCE)
    p.add_argument("--device", default="0")
    p.add_argument("--resume", action="store_true")
    p.add_argument("--lr0", type=float, default=0.01)
    p.add_argument("--name", default=WEIGHTS_DIR.name)
    args = p.parse_args()

    results = train(
        model=args.model,
        data=args.data,
        epochs=args.epochs,
        batch=args.batch,
        imgsz=args.imgsz,
        patience=args.patience,
        device=args.device,
        resume=args.resume,
        lr0=args.lr0,
        name=args.name,
    )
    print(f"\nDone. Best weights: {BEST_WEIGHTS}")
    print(f"Results: {results}")


if __name__ == "__main__":
    import sys
    from pathlib import Path

    sys.exit(main())
