"""Pitch-landmark keypoint detector (YOLOv8-pose) + training.

Detects the 32 pitch keypoints defined by the Roboflow football-field-detection
dataset. Output keypoints feed :class:`pitchtwin.calibration.homography.Calibrator`.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

from pitchtwin.calibration.pitch_template import NUM_KEYPOINTS

REPO_ROOT = Path(__file__).resolve().parents[3]
DATASET_DIR = REPO_ROOT / "data" / "datasets" / "football-pitch-keypoints"
DATA_YAML = DATASET_DIR / "data.yaml"

# nano pose model fits the 4 GB GPU; 32 keypoints.
MODEL_NAME = "yolov8n-pose.pt"
IMGSZ = 640
BATCH = 4
EPOCHS = 100
PATIENCE = 20

WEIGHTS_DIR = REPO_ROOT / "runs" / "pose" / "pitch-keypoints"
BEST_WEIGHTS = WEIGHTS_DIR / "weights" / "best.pt"
LAST_WEIGHTS = WEIGHTS_DIR / "weights" / "last.pt"


def train(
    model: str = MODEL_NAME,
    data: Path | str = DATA_YAML,
    epochs: int = EPOCHS,
    batch: int = BATCH,
    imgsz: int = IMGSZ,
    patience: int = PATIENCE,
    device: int | str = 0,
    resume: bool = False,
):
    """Train the 32-keypoint pitch pose model."""
    from ultralytics import YOLO

    if resume and LAST_WEIGHTS.exists():
        model_obj = YOLO(str(LAST_WEIGHTS))
    else:
        model_obj = YOLO(model)

    return model_obj.train(
        data=str(data),
        epochs=epochs,
        batch=batch,
        imgsz=imgsz,
        patience=patience,
        device=device,
        project=str(WEIGHTS_DIR.parent),
        name=WEIGHTS_DIR.name,
        exist_ok=True,
        amp=True,
        pretrained=True,
        resume=resume,
    )


class PitchKeypointDetector:
    """Run the trained pose model; return keypoints as ``(32, 3)`` arrays."""

    def __init__(
        self,
        weights: Path | str = BEST_WEIGHTS,
        device: int | str = 0,
        conf: float = 0.5,
    ) -> None:
        from ultralytics import YOLO

        self.model = YOLO(str(weights))
        self.device = device
        self.conf = conf

    def detect(self, frame: np.ndarray) -> np.ndarray:
        """Return ``(NUM_KEYPOINTS, 3)`` = (x_px, y_px, conf) for one frame.

        Missing/low-confidence keypoints get ``(0, 0, 0)`` and are filtered out
        downstream by the ``conf_threshold`` in :class:`Calibrator`.
        """
        out = np.zeros((NUM_KEYPOINTS, 3), dtype=np.float32)
        res = self.model.predict(frame, device=self.device, verbose=False)[0]
        if res.keypoints is None or len(res.keypoints) == 0:
            return out
        # Single-subject dataset (one pitch per frame): take the top detection.
        kpt = res.keypoints.data[0].cpu().numpy()  # (32, 3) = x, y, conf
        kpt = kpt[:NUM_KEYPOINTS]
        out[: len(kpt)] = kpt
        return out


def main() -> None:
    import argparse

    p = argparse.ArgumentParser(description="Train the PitchTwin pitch-keypoint pose model.")
    p.add_argument("--epochs", type=int, default=EPOCHS)
    p.add_argument("--batch", type=int, default=BATCH)
    p.add_argument("--imgsz", type=int, default=IMGSZ)
    p.add_argument("--patience", type=int, default=PATIENCE)
    p.add_argument("--device", default="0")
    p.add_argument("--resume", action="store_true")
    args = p.parse_args()
    train(
        epochs=args.epochs,
        batch=args.batch,
        imgsz=args.imgsz,
        patience=args.patience,
        device=args.device,
        resume=args.resume,
    )
    print(f"\nDone. Best weights: {BEST_WEIGHTS}")


if __name__ == "__main__":
    main()
