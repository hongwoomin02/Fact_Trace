#!/usr/bin/env python3
"""Fact-Trace AI video inference entrypoint. Run on the prepared Ubuntu GPU server.

Example:
    python3 run_video.py --model facefusion --source /path/source.jpg \
      --target /path/target.mp4 --output /path/result.mp4

Prints a machine-readable JSON summary when the command succeeds.
No HTTP API or model weights are bundled in this handoff package.
"""
import argparse
import hashlib
import json
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fp:
        while chunk := fp.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser(description="Fact-Trace AI video synthesis on prepared GPU server")
    parser.add_argument("--model", required=True, choices=("facefusion", "fsgan"))
    parser.add_argument("--source", required=True, help="Input face image path")
    parser.add_argument("--target", required=True, help="Input target MP4 path")
    parser.add_argument("--output", required=True, help="Output MP4 path")
    parser.add_argument("--log", help="Optional path to save execution console log")
    args = parser.parse_args()

    base = Path(__file__).resolve().parent
    script = base / "scripts" / f"generate_{args.model}.sh"
    source = Path(args.source).expanduser().resolve(strict=True)
    target = Path(args.target).expanduser().resolve(strict=True)
    output = Path(args.output).expanduser().resolve()
    if not source.is_file() or not target.is_file():
        parser.error("--source 와 --target 은 기존 파일이어야 합니다.")
    if output.suffix.lower() != ".mp4":
        parser.error("--output 은 .mp4 파일이어야 합니다.")

    started = time.perf_counter()
    result = subprocess.run(
        ["bash", str(script), str(source), str(target), str(output)],
        capture_output=True,
        text=True,
        check=False,
    )
    elapsed = round(time.perf_counter() - started, 3)
    log_text = result.stdout + result.stderr
    if args.log:
        logpath = Path(args.log).expanduser()
        logpath.parent.mkdir(parents=True, exist_ok=True)
        logpath.write_text(log_text, encoding="utf-8")
    if result.returncode != 0:
        print(log_text[-8000:], file=sys.stderr)
        print(f"{args.model} failed, exit={result.returncode}, elapsed={elapsed}s", file=sys.stderr)
        return result.returncode or 1
    if not output.is_file() or output.stat().st_size == 0:
        print(f"출력 파일이 없거나 비어 있습니다: {output}", file=sys.stderr)
        return 1

    print(json.dumps({
        "status": "success",
        "model": args.model,
        "output_path": str(output),
        "size_bytes": output.stat().st_size,
        "sha256": sha256_file(output),
        "processing_seconds": elapsed,
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "measurement_scope": "server subprocess (does not include network upload/download)",
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
