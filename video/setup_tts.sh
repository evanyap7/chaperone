#!/usr/bin/env bash
# One-time setup for the local neural voice used by both videos.
# Kokoro-82M (Apache-2.0) via kokoro-onnx, running fully offline on CPU.
#   - venv:   video/.venv   (Python 3.12, managed by uv)
#   - models: video/models/ (kokoro-v1.0.onnx ~310 MB, voices-v1.0.bin ~27 MB)
# Both are gitignored. Re-running is safe: existing files are kept.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"

command -v uv >/dev/null || { echo "uv is required: brew install uv"; exit 1; }
command -v ffmpeg >/dev/null || { echo "ffmpeg is required: brew install ffmpeg"; exit 1; }

if [ ! -x .venv/bin/python ]; then
  uv venv --python 3.12 .venv
fi
# kokoro-onnx bundles espeak-ng (espeakng-loader), so no system espeak is needed.
uv pip install --python .venv/bin/python "kokoro-onnx==0.6.1" "soundfile>=0.12" "numpy<3" "pillow>=10"

mkdir -p models
BASE="https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0"
for f in kokoro-v1.0.onnx voices-v1.0.bin; do
  if [ ! -s "models/$f" ]; then
    echo "downloading $f ..."
    curl -fL --retry 3 -o "models/$f.part" "$BASE/$f"
    mv "models/$f.part" "models/$f"
  fi
done

.venv/bin/python -c "import kokoro_onnx, soundfile; print('kokoro-onnx ready')"
ls -lh models
