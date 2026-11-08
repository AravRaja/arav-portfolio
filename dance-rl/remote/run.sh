#!/usr/bin/env bash
# Run FROM THE MAC. Syncs dance-rl/ to the box and launches a command in a named tmux session.
#   remote/run.sh <name> <command...>
#   e.g. remote/run.sh s1 python3 -m dance_rl.train --config configs/stage1_stand.yaml
# The command runs in ~/dance-rl with PYTHONPATH=src, MUJOCO_GL=egl; output -> ~/dance-rl/logs/<name>.log,
# and the line "RUN_DONE <name> <exit code>" is appended to that log when it exits.
# Env overrides: DANCE_HOST, DANCE_PORT, DANCE_DIR.
set -euo pipefail
HOST="${DANCE_HOST:-root@115.75.223.236}"
PORT="${DANCE_PORT:-57243}"
RDIR="${DANCE_DIR:-dance-rl}"
[ $# -ge 2 ] || { echo "usage: $0 <name> <command...>"; exit 1; }
NAME="$1"; shift
CMD="$*"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
SSH="ssh -o StrictHostKeyChecking=accept-new -o LogLevel=ERROR -p $PORT"

rsync -az -e "$SSH" \
  --exclude checkpoints/ --exclude videos/ --exclude frames/ --exclude runs/ --exclude logs/ \
  --exclude __pycache__/ --exclude '*.mp4' --exclude '*.pkl' --exclude rollouts/ \
  --exclude '.venv*/' --exclude data/raw/ --exclude data/library/gallery/ \
  "$HERE/" "$HOST:$RDIR/"

# the remote script is written to a file so quoting inside CMD survives tmux
$SSH "$HOST" bash -s <<REMOTE
set -e
cd ~/$RDIR
mkdir -p logs
if tmux has-session -t '$NAME' 2>/dev/null; then echo "tmux session $NAME already exists"; exit 1; fi
cat > logs/$NAME.sh <<'INNER'
cd ~/$RDIR
export PATH=/venv/main/bin:\$PATH PYTHONPATH=src MUJOCO_GL=egl XLA_PYTHON_CLIENT_MEM_FRACTION=0.9 PYTHONUNBUFFERED=1
echo "== \$(date) RUN_START $NAME: $CMD"
( $CMD ) 2>&1
rc=\$?
echo "RUN_DONE $NAME \$rc"
INNER
tmux new-session -d -s '$NAME' "bash logs/$NAME.sh >> logs/$NAME.log 2>&1"
echo "launched $NAME -> ~/$RDIR/logs/$NAME.log"
REMOTE
