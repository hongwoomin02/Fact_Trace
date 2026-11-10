#!/usr/bin/env bash
# Fact-Trace AI: FSGAN inference wrapper (on GPU server)
# Usage: bash scripts/generate_fsgan.sh SOURCE_IMAGE TARGET_VIDEO OUTPUT_MP4
set -euo pipefail

if [[ $# -ne 3 ]]; then
  echo "사용법: $0 SOURCE_IMAGE TARGET_VIDEO OUTPUT_MP4" >&2
  exit 2
fi

SOURCE=$(realpath -e -- "$1")
TARGET=$(realpath -e -- "$2")
OUTPUT=$(realpath -m -- "$3")
mkdir -p "$(dirname -- "$OUTPUT")"

# FSGAN's tested preprocessing recognizes .jpg static images; .jpeg failed.
case "${SOURCE,,}" in
  *.jpg|*.jpeg) ;;
  *) echo "FSGAN 테스트 입력은 JPG/JPEG 사진만 지원합니다: $SOURCE" >&2; exit 2 ;;
esac
case "${TARGET,,}" in
  *.mp4) ;;
  *) echo "FSGAN 테스트 대상은 MP4 영상만 지원합니다: $TARGET" >&2; exit 2 ;;
esac

CONDA_SH="$HOME/miniconda3/etc/profile.d/conda.sh"
if [[ ! -f "$CONDA_SH" ]]; then
  echo "Conda 스크립트를 찾을 수 없습니다: $CONDA_SH" >&2
  exit 1
fi
# shellcheck disable=SC1090
source "$CONDA_SH"
conda activate fsgan
cd "$HOME/fsgan"

mkdir -p "$HOME/fsgan_jobs"
JOBDIR=$(mktemp -d "$HOME/fsgan_jobs/job_XXXXXXXX")
# FSGAN writes face-detection/processing caches beside inputs.
# Stage files in a writable private working directory and standardize image extension.
trap 'rm -rf -- "$JOBDIR"' EXIT
cp -- "$SOURCE" "$JOBDIR/source.jpg"
cp -- "$TARGET" "$JOBDIR/target.mp4"
mkdir -p "$JOBDIR/output"

python fsgan/inference/swap.py \
  "$JOBDIR/source.jpg" \
  -t "$JOBDIR/target.mp4" \
  -o "$JOBDIR/output" \
  --gpus "${GEN_GPU_ID:-0}" \
  --seg_remove_mouth

RESULT="$JOBDIR/output/source_target.mp4"
if [[ ! -s "$RESULT" ]]; then
  echo "FSGAN 종료 후 예상 출력 영상이 없습니다: $RESULT" >&2
  find "$JOBDIR/output" -maxdepth 1 -type f -printf '%f\n' >&2
  exit 1
fi
# FSGAN writes MPEG-4 Part 2, which browsers do not consistently support.
# Encode the result as H.264 and preserve optional audio from the target.
"${GEN_FFMPEG_BIN:-/usr/bin/ffmpeg}" -nostdin -y \
  -i "$RESULT" -i "$TARGET" \
  -map 0:v:0 -map '1:a:0?' \
  -c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p \
  -c:a aac -movflags +faststart -shortest "$OUTPUT"
printf 'FSGAN 출력 영상: %s\n' "$OUTPUT"
