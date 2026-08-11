# Face Detection Models

This directory contains ONNX models for face detection used in the crop tool.

## YuNet Face Detector

**Required file:** `yunet_face.onnx` (~330KB)

**Download from:**
- OpenCV Model Zoo: https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet
- Direct link: https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx

**Usage:**
- Detects faces in images for smart crop positioning
- Optimized for CPU inference (~100-300ms per image)
- Works with both real photos and anime/illustrated characters

## Installation

1. Download `face_detection_yunet_2023mar.onnx` from the link above
2. Rename it to `yunet_face.onnx`
3. Place it in this directory (`src-tauri/models/`)
4. The model will be bundled with the application automatically

## Future Models

Additional models that may be added:

- **YOLOv8-nano** (~6MB) - Subject/person detection for full-body crop suggestions
- **Anime face detector** - Specialized model for anime/manga characters
