#!/usr/bin/env bash
# One-shot environment setup for the Vast.ai 4090 box. Idempotent; logs to ~/setup.log.
# Installs into the image's venv (/venv/main) — system python3 is Debian-managed and fights pip.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

echo "== apt (EGL for headless MuJoCo rendering)"
apt-get update -qq
apt-get install -y -qq libegl1 libgles2 libgl1 libglib2.0-0 libosmesa6 rsync > /dev/null
apt-get clean

echo "== venv"
source /venv/main/bin/activate
which python3
# --no-cache: the box has a 16 GB disk, don't keep wheel caches around
uv pip install --no-cache -U "jax[cuda12]"
uv pip install --no-cache -U mujoco mujoco-mjx brax playground librosa soundfile imageio imageio-ffmpeg matplotlib numpy scipy pyyaml tqdm
rm -rf ~/.cache/pip ~/.cache/uv

echo "== sanity"
MUJOCO_GL=egl python3 - <<'EOF'
import jax, mujoco
print("jax", jax.__version__, "devices", jax.devices())
print("mujoco", mujoco.__version__)
from mujoco import mjx
import mujoco_playground
print("mjx + playground OK")
import librosa; print("librosa", librosa.__version__)
# headless render check
m = mujoco.MjModel.from_xml_string('<mujoco><worldbody><geom size="1"/></worldbody></mujoco>')
r = mujoco.Renderer(m, 64, 64); r.update_scene(mujoco.MjData(m)); r.render()
print("EGL render OK")
EOF
df -h / | tail -1
echo "== SETUP_DONE"
