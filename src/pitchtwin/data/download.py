"""Dataset downloaders for PitchTwin.

SoccerNet v3 (``frames`` task) gives us extra broadcast frame images for training
detection / keypoint models. Roboflow datasets (player detection, pitch keypoints)
carry the box / keypoint labels and are the primary training source.

Note: the SoccerNet Calibration / Tracking ground truth (needed for the quantitative
homography / tracking eval) is NOT in this downloader — it lives in separate repos
(``SoccerNet/calibration``, ``SoccerNet/tracking``) and is handled in a later step.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path


def download_soccernet_frames(
    out_dir: str | Path = "data/datasets/soccernet_frames",
    split: str = "valid",
    n_games: int | None = None,
    files: list[str] | None = None,
) -> None:
    """Download SoccerNet ``frames`` task data for ``n_games`` of ``split``.

    Default ``files`` are the per-game frame zip + v3 labels. ``n_games=None``
    downloads the entire split (large — hundreds of GB across train).
    """
    import warnings

    warnings.filterwarnings("ignore")
    from SoccerNet.Downloader import SoccerNetDownloader
    from SoccerNet.utils import getListGames

    files = files or ["Labels-v3.json", "Frames-v3.zip"]
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)

    games = getListGames(split=split, task="frames")
    if n_games is not None:
        games = games[:n_games]
    print(f"[soccernet] split={split} games={len(games)} files={files} -> {out}")

    dl = SoccerNetDownloader(LocalDirectory=str(out))
    for game in games:
        try:
            dl.downloadGame(game=game, files=files, spl=split, verbose=False)
            print(f"  ok: {game}")
        except Exception as exc:  # noqa: BLE001
            print(f"  FAIL: {game}: {exc}", file=sys.stderr)


def main() -> None:
    p = argparse.ArgumentParser(description="Download datasets for PitchTwin.")
    sub = p.add_subparsers(dest="cmd", required=True)

    sn = sub.add_parser("soccernet", help="Download SoccerNet frames task data.")
    sn.add_argument("--out", default="data/datasets/soccernet_frames")
    sn.add_argument("--split", default="valid", choices=["train", "valid", "test"])
    sn.add_argument("--n-games", type=int, default=None, help="Limit number of games.")
    sn.add_argument("--files", nargs="+", default=["Labels-v3.json", "Frames-v3.zip"])

    args = p.parse_args()
    if args.cmd == "soccernet":
        download_soccernet_frames(
            out_dir=args.out, split=args.split, n_games=args.n_games, files=args.files
        )


if __name__ == "__main__":
    main()
