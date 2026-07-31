"""Ball-module configuration."""

from __future__ import annotations

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
PLAYER_DS = REPO_ROOT / "data" / "datasets" / "football-players-detection"
DATASET_DIR = REPO_ROOT / "data" / "datasets" / "ball"
DATA_YAML = DATASET_DIR / "data.yaml"

MODEL_NAME = "yolov8n.pt"  # nano -- a small ball only needs a small model
IMGSZ = 640
BATCH = 8
EPOCHS = 60
PATIENCE = 20

WEIGHTS_DIR = REPO_ROOT / "runs" / "detect" / "ball"
BEST_WEIGHTS = WEIGHTS_DIR / "weights" / "best.pt"
