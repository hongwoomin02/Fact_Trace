#!/usr/bin/env bash
# Fact-Trace AI: FaceFusion inference wrapper (on GPU server)
# Usage: bash scripts/generate_facefusion.sh SOURCE_IMAGE TARGET_VIDEO OUTPUT_MP4
set -euo pipefail

if [[ $# -ne 3 ]]; then
  echo "사용법: $0 SOURCE_IMAGE TARGET_VIDEO OUTPUT_MP4" >&2
  exit 2
fi

SOURCE=$(realpath -e -- "$1")
TARGET=$(realpath -e -- "$2")
OUTPUT=$(realpath -m -- "$3")
mkdir -p "$(dirname -- "$OUTPUT")"

CONDA_SH="$HOME/miniconda3/etc/profile.d/conda.sh"
if [[ ! -f "$CONDA_SH" ]]; then
  echo "Conda 스크립트를 찾을 수 없습니다: $CONDA_SH" >&2
  exit 1
fi
# shellcheck disable=SC1090
source "$CONDA_SH"
conda activate facefusion

# CUDA shared libraries needed for the verified FaceFusion setup.
export LD_LIBRARY_PATH="$CONDA_PREFIX/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
cd "$HOME/facefusion"

python facefusion.py headless-run \
  --source-paths "$SOURCE" \
  --target-path "$TARGET" \
  --output-path "$OUTPUT" \
  --processors face_swapper \
  --face-selector-mode one \
  --face-swapper-model hyperswap_1a_256 \
  --execution-providers cuda \
  --execution-device-ids 0 \
  --execution-thread-count 8 \
  --output-video-encoder libx264 \
  --output-video-preset veryfast \
  --output-video-quality 80 \
  --log-level info

if [[ ! -s "$OUTPUT" ]]; then
  echo "FaceFusion 종료 후 출력 영상이 존재하지 않거나 비어 있습니다: $OUTPUT" >&2
  exit 1
fi
printf 'FaceFusion 출력 영상: %s\n' "$OUTPUT"
