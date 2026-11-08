"""Validation renders for the move library: kinematic playback (qpos set directly, no physics).

    MUJOCO_GL=cgl python -m dance_rl.motion_gallery --library data/library --raw data/raw/aistpp
    (on the Linux box use MUJOCO_GL=egl)

For each selected move (8 representative ones by default, or --ids a,b,c):
  gallery/<id>.mp4  640x480, 50 fps, the move played twice (so the loop seam shows) then its mirror once,
                    with a click track on the beats (high click on the downbeats) and a beat counter.
  gallery/<id>.png  contact sheet, 16 tiles over the 2 bars (every half beat): row block 1 = humanoid
                    from the front (render.py camera: azimuth 180, elevation -12), block 2 = the AIST++
                    dancer's own keypoints (uniformly scaled, hip-centre aligned to the humanoid) from
                    the same camera, block 3 = humanoid from its left side. Feet in contact are marked.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import wave

os.environ.setdefault("MUJOCO_GL", "cgl" if os.uname().sysname == "Darwin" else "egl")

import mujoco  # noqa: E402
import numpy as np  # noqa: E402
from PIL import Image, ImageDraw  # noqa: E402

from dance_rl import humanoid_model as hm  # noqa: E402
from dance_rl import retarget  # noqa: E402
from dance_rl.build_motion_lib import SONG_BPM, heading_yaw  # noqa: E402

FFMPEG = "/opt/homebrew/bin/ffmpeg" if os.path.exists("/opt/homebrew/bin/ffmpeg") else "ffmpeg"
COCO_EDGES = [("left_shoulder", "right_shoulder"), ("left_hip", "right_hip"),
              ("left_shoulder", "left_hip"), ("right_shoulder", "right_hip"),
              ("left_shoulder", "left_elbow"), ("left_elbow", "left_wrist"),
              ("right_shoulder", "right_elbow"), ("right_elbow", "right_wrist"),
              ("left_hip", "left_knee"), ("left_knee", "left_ankle"),
              ("right_hip", "right_knee"), ("right_knee", "right_ankle"), ("nose", "left_shoulder"),
              ("nose", "right_shoulder")]


def select(manifest, n=8):
    """Representative, distinct-clip picks: basics from both genres, freestyle highlights,
    the most travelling, the most turning, the deepest and the most arm-heavy move."""
    mv = manifest["moves"]
    used, out = set(), []

    def pick(cands, key, why):
        for m in sorted(cands, key=key):
            if m["clip"] not in used:
                used.add(m["clip"])
                out.append((m, why))
                return

    pick([m for m in mv if m["genre"] == "gMH" and m["style"] == "sBM" and m["in_place"]],
         lambda m: -m["loopability"], "middle-hip-hop basic, most loopable in-place")
    pick([m for m in mv if m["genre"] == "gLH" and m["style"] == "sBM" and m["in_place"]],
         lambda m: -m["loopability"], "LA hip-hop basic, most loopable in-place")
    pick([m for m in mv if m["genre"] == "gMH" and m["style"] == "sFM"], lambda m: -m["energy_mps"],
         "middle-hip-hop freestyle, highest energy")
    pick([m for m in mv if m["genre"] == "gLH" and m["style"] == "sFM"], lambda m: -m["energy_mps"],
         "LA hip-hop freestyle, highest energy")
    pick(mv, lambda m: -m["root_disp_m"], "most travelling")
    pick(mv, lambda m: -abs(m["yaw_change_deg"]), "biggest turn")
    pick(mv, lambda m: m["pelvis_z_mean"], "lowest level (deepest)")
    pick([m for m in mv if m["style"] == "sFM" and m["in_place"]], lambda m: -m["loopability"],
         "freestyle, most loopable in-place")
    return out[:n]


class Views:
    def __init__(self, w, h):
        self.m = hm.load_model()
        self.d = mujoco.MjData(self.m)
        self.r = mujoco.Renderer(self.m, height=h, width=w)
        self.cam = mujoco.MjvCamera()
        self.cam.type = mujoco.mjtCamera.mjCAMERA_FREE
        self.cam.distance = 4.2
        self.cam.elevation = -12.0
        self.cam.azimuth = 180.0
        self.look = None
        bid = lambda n: mujoco.mj_name2id(self.m, mujoco.mjtObj.mjOBJ_BODY, n)
        self.pelvis = bid("pelvis")

    def _cam(self, qpos, azimuth, smooth):
        target = np.array([qpos[0], qpos[1], 1.0])
        self.look = target if (self.look is None or smooth >= 1) else self.look + smooth * (target - self.look)
        self.cam.lookat[:] = self.look
        self.cam.azimuth = azimuth

    def humanoid(self, qpos, azimuth=180.0, smooth=0.1, distance=4.2):
        self.d.qpos[:] = qpos
        mujoco.mj_forward(self.m, self.d)
        self.cam.distance = distance
        self._cam(qpos, azimuth, smooth)
        self.r.update_scene(self.d, camera=self.cam)
        return self.r.render()

    def skeleton(self, qpos, pts, azimuth=180.0, distance=4.2):
        """Dataset keypoints as capsules; the humanoid itself is moved far below the floor."""
        q = qpos.copy()
        q[2] -= 50.0
        self.d.qpos[:] = q
        mujoco.mj_forward(self.m, self.d)
        self.cam.distance = distance
        self._cam(qpos, azimuth, 1.0)
        self.r.update_scene(self.d, camera=self.cam)
        sc = self.r.scene
        P = {n: pts[i] for i, n in enumerate(hm.FIT)}
        for a, b in COCO_EDGES:
            if sc.ngeom >= sc.maxgeom:
                break
            g = sc.geoms[sc.ngeom]
            mujoco.mjv_initGeom(g, mujoco.mjtGeom.mjGEOM_CAPSULE, np.zeros(3), np.zeros(3), np.zeros(9),
                                np.array([0.25, 0.75, 0.95, 1.0], np.float32))
            mujoco.mjv_connector(g, mujoco.mjtGeom.mjGEOM_CAPSULE, 0.035, P[a].astype(np.float64),
                                 P[b].astype(np.float64))
            sc.ngeom += 1
        if sc.ngeom < sc.maxgeom:
            g = sc.geoms[sc.ngeom]
            mujoco.mjv_initGeom(g, mujoco.mjtGeom.mjGEOM_SPHERE, np.array([0.08, 0, 0]),
                                P["nose"].astype(np.float64), np.eye(3).ravel(),
                                np.array([0.25, 0.75, 0.95, 1.0], np.float32))
            sc.ngeom += 1
        return self.r.render()

    def pelvis_pos(self, qpos):
        self.d.qpos[:] = qpos
        mujoco.mj_kinematics(self.m, self.d)
        return self.d.xpos[self.pelvis].copy()

    def close(self):
        self.r.close()


def dataset_points(move, raw_dir, retarget_dir):
    """Dancer keypoints (uniformly scaled by the clip's leg ratio) for every move frame, in the move's
    re-rooted frame, hip centre placed on the humanoid's hip centre."""
    clip = move["clip"]
    kp = retarget.smooth_keypoints(retarget.load_keypoints(os.path.join(raw_dir, "keypoints3d", clip + ".pkl")))
    rest = retarget.Rest(*hm.with_markers())
    _, _, _, raw = retarget.build_targets(kp, rest)
    src = np.load(os.path.join(retarget_dir, clip + ".npz"))
    Q60 = src["qpos60"].astype(np.float64)
    t_src = move["start_src_s"] + np.arange(213) / 50.0 * SONG_BPM / move["bpm"]
    idx = np.clip(np.round(t_src * 60).astype(int), 0, len(kp) - 1)
    q0 = Q60[idx[0]]
    yaw = heading_yaw(q0)
    c, s = np.cos(-yaw), np.sin(-yaw)
    Rz = np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])
    pts = raw[idx] - np.array([q0[0], q0[1], 0.0])
    return pts @ Rz.T


def click_wav(path, seconds, sr=44100):
    n = int(seconds * sr)
    x = np.zeros(n, np.float32)
    k = 0
    while True:
        t = k * 60.0 / SONG_BPM
        if t >= seconds:
            break
        f = 1760.0 if k % 4 == 0 else 1000.0
        L = int(0.03 * sr)
        tt = np.arange(L) / sr
        i0 = int(t * sr)
        seg = (0.9 if k % 4 == 0 else 0.5) * np.sin(2 * np.pi * f * tt) * np.exp(-tt / 0.008)
        x[i0:i0 + L][:len(seg[:n - i0])] += seg[:n - i0]
        k += 1
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes((np.clip(x, -1, 1) * 32767).astype(np.int16).tobytes())


def label(img, text, sub=None, color=(255, 255, 255)):
    im = Image.fromarray(img)
    dr = ImageDraw.Draw(im)
    dr.text((6, 5), text, fill=color)
    if sub:
        dr.text((6, 18), sub, fill=(200, 200, 200))
    return np.asarray(im)


def count_str(t):
    b = t / (60.0 / SONG_BPM)
    k = int(np.floor(b + 1e-6))
    frac = b - k
    cnt = k % 8 + 1
    return f"{cnt}" if frac < 0.25 else (f"{cnt} &" if 0.25 <= frac < 0.75 else f"{cnt % 8 + 1}")


def video(move, Q, Qm, C, Cm, out, views):
    W, H, fps = 640, 480, 50
    seq = [(Q, C, "")] * 2 + [(Qm, Cm, " (mirror)")]
    frames = sum(len(q) - 1 for q, _, _ in seq)
    seconds = frames / fps
    wav = out[:-4] + ".clicks.wav"
    click_wav(wav, seconds)
    cmd = [FFMPEG, "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}",
           "-r", str(fps), "-i", "-", "-i", wav, "-map", "0:v", "-map", "1:a", "-c:a", "aac", "-b:a", "128k",
           "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
           "-t", f"{seconds:.3f}", "-movflags", "+faststart", out]
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    views.look = None
    k = 0
    for q_seq, c_seq, tag in seq:
        for i in range(len(q_seq) - 1):      # frame 212 ~ next downbeat: skip it so loops tile at 212.5
            q = q_seq[i].astype(np.float64)
            img = views.humanoid(q)
            t = k / fps
            cs = "".join(["L" if c_seq[i, 0] else "-", "R" if c_seq[i, 1] else "-"])
            img = label(img, f"{move['id']}{tag}", f"count {count_str(t):>4}   contact {cs}   "
                                                  f"{move['bpm']} BPM -> {SONG_BPM:.1f}")
            p.stdin.write(np.ascontiguousarray(img).tobytes())
            k += 1
    p.stdin.close()
    rc = p.wait()
    os.remove(wav)
    return rc


def sheet(move, Q, C, pts, out, views):
    idx = np.round(np.arange(16) * 212.5 / 16).astype(int)
    blocks = []
    for kind in ("front", "data", "side"):
        tiles = []
        for j, i in enumerate(idx):
            q = Q[i].astype(np.float64)
            if kind == "front":
                img = views.humanoid(q, 180.0, smooth=1.0, distance=3.0)
            elif kind == "side":
                img = views.humanoid(q, 90.0, smooth=1.0, distance=3.0)
            else:
                hip_h = views.pelvis_pos(q)
                P = pts[i]
                hip_d = 0.5 * (P[7] + P[8])
                img = views.skeleton(q, P - hip_d + hip_h, 180.0, distance=3.0)
            cnt = f"{j // 2 + 1}" + (" &" if j % 2 else "")
            cs = ("L" if C[i, 0] else "-") + ("R" if C[i, 1] else "-")
            img = label(img, f"{cnt}   {kind}", f"f{i}  contact {cs}",
                        color=(255, 220, 90) if j % 4 == 0 else (255, 255, 255))
            tiles.append(img)
        blocks += [np.concatenate(tiles[r * 8:(r + 1) * 8], axis=1) for r in range(2)]
    full = np.concatenate(blocks, axis=0)
    hdr = Image.new("RGB", (full.shape[1], 30), (20, 20, 26))
    ImageDraw.Draw(hdr).text((8, 8), f"{move['id']}  |  {move['bpm']} BPM x{move['speed_factor']}  |  disp "
                             f"{move['root_disp_m']} m, yaw {move['yaw_change_deg']} deg  |  loop "
                             f"{move['loopability']}  |  IK err {move['ik_err_cm']} cm  |  rows: humanoid front, "
                             f"AIST++ keypoints (blue), humanoid side", fill=(230, 230, 230))
    Image.fromarray(np.concatenate([np.asarray(hdr), full], axis=0)).save(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--library", default="data/library")
    ap.add_argument("--raw", default="data/raw/aistpp")
    ap.add_argument("--retarget", default="data/interim/retarget")
    ap.add_argument("--ids", default=None)
    ap.add_argument("--n", type=int, default=8)
    ap.add_argument("--no-video", action="store_true")
    a = ap.parse_args()
    man = json.load(open(os.path.join(a.library, "manifest.json")))
    lib = np.load(os.path.join(a.library, "moves.npz"))
    by_id = {m["id"]: m for m in man["moves"]}
    if a.ids:
        picks = [(by_id[i], "requested") for i in a.ids.split(",")]
    else:
        picks = select(man, a.n)
    outdir = os.path.join(a.library, "gallery")
    os.makedirs(outdir, exist_ok=True)
    views = Views(640, 480)
    tiles = Views(240, 320)          # render.py contact-sheet tile size
    listing = []
    for mv, why in picks:
        n = mv["index"]
        Q, Qm, C, Cm = lib["qpos"][n], lib["qpos_mirror"][n], lib["contacts"][n], lib["contacts_mirror"][n]
        pts = dataset_points(mv, a.raw, a.retarget)
        sheet(mv, Q, C, pts, os.path.join(outdir, mv["id"] + ".png"), tiles)
        if not a.no_video:
            video(mv, Q, Qm, C, Cm, os.path.join(outdir, mv["id"] + ".mp4"), views)
        listing.append(dict(id=mv["id"], why=why))
        print(mv["id"], "-", why, flush=True)
    views.close()
    tiles.close()
    with open(os.path.join(outdir, "selection.json"), "w") as fh:
        json.dump(listing, fh, indent=1)


if __name__ == "__main__":
    main()
