#!/usr/bin/env bash
# Run FROM THE MAC. Pulls videos / metrics / images / logs (and checkpoints unless --no-ckpt)
# from ~/dance-rl/runs on the box into dance-rl/runs/ here.
#   remote/pull.sh [run_name] [--no-ckpt]
set -euo pipefail
HOST="${DANCE_HOST:-root@115.75.223.236}"
PORT="${DANCE_PORT:-57243}"
RDIR="${DANCE_DIR:-dance-rl}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
RUN=""; CK=1
for a in "$@"; do case "$a" in --no-ckpt) CK=0 ;; *) RUN="$a" ;; esac; done
SSH="ssh -o StrictHostKeyChecking=accept-new -o LogLevel=ERROR -p $PORT"
mkdir -p "$HERE/runs" "$HERE/logs"
EXCL=(--exclude '*.npz')
[ $CK = 1 ] || EXCL+=(--exclude checkpoints/)
# checkpoints: only latest/final/best to keep it small
rsync -az -e "$SSH" "${EXCL[@]}" --include '*/' --include 'latest.pkl' --include 'final.pkl' --include 'best.pkl' --include 'best.json' \
  --exclude 'ckpt_*.pkl' "$HOST:$RDIR/runs/$RUN" "$HERE/runs/"
rsync -az -e "$SSH" "$HOST:$RDIR/logs/" "$HERE/logs/" || true
echo "pulled into $HERE/runs/$RUN"
