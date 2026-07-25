"""Pitch calibration / homography — the accuracy-critical "crown jewel".

Lifts image footpoints into metric pitch coordinates via a homography fit to
detected pitch landmarks. Modules:

- :mod:`pitchtwin.calibration.pitch_template`  FIFA-standard 32-keypoint template
- :mod:`pitchtwin.calibration.keypoints`       YOLOv8-pose landmark detector
- :mod:`pitchtwin.calibration.homography`      RANSAC homography + projection
"""
