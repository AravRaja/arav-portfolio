"""Render a rollout npz (headless: MUJOCO_GL=egl).

Dev video (1280x720, 30 fps, song muxed in, motion-energy / beat strip along the bottom):
    python -m dance_rl.render --rollout runs/X/rollout.npz --song now-get-busy.mp3 --out runs/X/dev.mp4
Contact sheets (16 frames over 2 bars at ~8.5 s, 40 s, 100 s) + motion-energy-vs-beat PNG:
    python -m dance_rl.render --rollout runs/X/rollout.npz --contact-sheets --outdir runs/X/sheets
    (--times 40,44.25,100 picks the sheet times; each sheet starts on the first downbeat at or after its time,
    so 40 and 44.25 show two consecutive 8-counts)
Phase 2 (track-mode rollouts): --reference puts the scheduled reference (rollout ref_qpos, posed kinematically)
as a second humanoid beside the policy: each contact-sheet tile becomes [policy | reference] (sheet 4 x 4 tiles)
and the dev video's top half is split the same way. The reference tile is labelled with its move (lower move,
+ upper move when fused).
Ghost dev video (one view, reference drawn translucent over the policy): add --ghost; fusion showcase:
    --ghost --units 5,9,14,20 (those 8-counts back-to-back, with the matching song slices)
Final (1920x1080, 60 fps, slowly orbiting camera, no overlay; --camera front = fixed camera in front):
    python -m dance_rl.render --rollout runs/X/rollout.npz --song now-get-busy.mp3 --final --out runs/X/final.mp4

Frames are piped straight into ffmpeg's stdin; nothing is written to disk but the outputs.
"""
from __future__ import annotations

import argparse
import os
import subprocess

os.environ.setdefault("MUJOCO_GL", "egl")

import mujoco  # noqa: E402
import numpy as np  # noqa: E402

from dance_rl import song  # noqa: E402

FPS = song.FPS
SHEET_TIMES = (8.5, 40.0, 100.0)
SHEET_W, SHEET_H = 240, 320


def _grid(d):
    """(features_version, grid anchor) of a rollout dict; pre-round-4 rollouts are v1 (anchor = drop)."""
    fv = int(d["features_version"]) if "features_version" in d else 1
    anchor = float(d["grid_anchor"]) if "grid_anchor" in d else (song.DROP if fv == 1 else song.GRID_ANCHOR_V2)
    return fv, anchor


def _claps(dur):
    """Clap / snare times (beats 2 and 4 of the v2 grid), a property of the song."""
    k = np.arange(0, int(dur / (2 * song.BEAT)) + 2)
    c = song.GRID_ANCHOR_V2 + song.BEAT * (1 + 2 * k)
    c = np.concatenate([song.GRID_ANCHOR_V2 - song.BEAT * (1 + 2 * k[::-1]), c])
    return c[(c >= 0) & (c <= dur)]


def _model():
    from dance_rl.env import load_model
    return load_model(0.004)


class Scene:
    def __init__(self, model, width, height):
        self.m = model
        self.d = mujoco.MjData(model)
        self.r = mujoco.Renderer(model, height=height, width=width)
        self.cam = mujoco.MjvCamera()
        self.cam.type = mujoco.mjtCamera.mjCAMERA_FREE
        self.cam.distance = 4.2
        self.cam.elevation = -12.0
        self.cam.azimuth = 180.0          # humanoid faces +x; camera sits in front of it
        self.look = None

    def frame(self, qpos, azimuth=None, distance=None, smooth=0.1, ghost=None, ghost_rgba=(0.45, 0.8, 1.0, 0.35)):
        """ghost: a second qpos drawn translucent in the same scene (the reference)."""
        self.d.qpos[:] = qpos
        mujoco.mj_forward(self.m, self.d)
        target = np.array([qpos[0], qpos[1], 1.0])
        self.look = target if self.look is None else self.look + smooth * (target - self.look)
        self.cam.lookat[:] = self.look
        if azimuth is not None:
            self.cam.azimuth = azimuth
        if distance is not None:
            self.cam.distance = distance
        self.r.update_scene(self.d, camera=self.cam)
        if ghost is not None:
            if not hasattr(self, "_gd"):
                self._gd = mujoco.MjData(self.m)
                self._opt, self._pert = mujoco.MjvOption(), mujoco.MjvPerturb()
            self._gd.qpos[:] = ghost
            mujoco.mj_forward(self.m, self._gd)
            scn = self.r.scene
            n0 = scn.ngeom
            mujoco.mjv_addGeoms(self.m, self._gd, self._opt, self._pert, mujoco.mjtCatBit.mjCAT_DYNAMIC, scn)
            for i in range(n0, scn.ngeom):
                scn.geoms[i].rgba[:] = ghost_rgba
                scn.geoms[i].matid = -1
        return self.r.render()

    def close(self):
        self.r.close()


def _qpos_at(qpos, t):
    i = int(np.clip(round(t * FPS), 0, len(qpos) - 1))
    return qpos[i]


# ---------------------------------------------------------------- beat / motion-energy strip
class Strip:
    """Pre-drawn full-song strip; each video frame slices a window centred on the current time."""

    def __init__(self, d, width=1280, height=160, seconds=6.0):
        from PIL import Image, ImageDraw

        self.w, self.h, self.pps = width, height, width / seconds
        dur = float(d["t"][-1])
        W = int(dur * self.pps) + width + 2
        self.off = width // 2
        img = Image.new("RGB", (W, height), (18, 18, 24))
        dr = ImageDraw.Draw(img)
        X = lambda tt: self.off + tt * self.pps
        _, self.anchor = _grid(d)
        for k, bt in enumerate(song.beat_times(dur, anchor=self.anchor)):
            down = round((bt - self.anchor) / song.BEAT) % 4 == 0
            c = (150, 150, 165) if down else (70, 70, 85)
            dr.line([(X(bt), 0), (X(bt), height)], fill=c, width=2 if down else 1)
        for ct in _claps(dur):
            dr.line([(X(ct), 0), (X(ct), 14)], fill=(90, 220, 220), width=3)
        dr.line([(X(song.DROP), 0), (X(song.DROP), height)], fill=(220, 60, 60), width=3)
        t = d["t"]
        onset = d["features"][:, song.COL["onset"]]
        m = d["motion_energy"]
        mmax = max(np.percentile(m, 99.5), 1e-3)
        base = height - 8
        on_pts = [(X(tt), base - 0.45 * (height - 16) * v) for tt, v in zip(t, onset)]
        dr.polygon([(X(0), base)] + on_pts + [(X(t[-1]), base)], fill=(40, 70, 120))
        m_pts = [(X(tt), base - (height - 20) * min(v / mmax, 1.0)) for tt, v in zip(t, m)]
        dr.line(m_pts, fill=(255, 170, 40), width=3)
        self.img = np.asarray(img)
        self.mmax = mmax

    def at(self, t):
        from PIL import Image, ImageDraw
        x0 = int(round(self.off + t * self.pps)) - self.w // 2
        x0 = int(np.clip(x0, 0, self.img.shape[1] - self.w))
        win = self.img[:, x0:x0 + self.w].copy()
        win[:, self.w // 2 - 1:self.w // 2 + 1] = (255, 255, 255)
        im = Image.fromarray(win)
        dr = ImageDraw.Draw(im)
        beat = (t - self.anchor) / song.BEAT
        dr.text((8, 18), f"t {t:6.2f}s  beat {beat:7.2f}   orange: motion energy (max {self.mmax:.2f} m/s)"
                         "   blue: onset   lines: beats / downbeats   cyan ticks: claps   red: drop",
                fill=(230, 230, 230))
        return np.asarray(im)


# ---------------------------------------------------------------- ffmpeg
def _ffmpeg(out, w, h, fps, song_path, duration, crf=20, preset="veryfast"):
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
           "-s", f"{w}x{h}", "-r", str(fps), "-i", "-"]
    if song_path:
        cmd += ["-i", song_path, "-map", "0:v", "-map", "1:a", "-c:a", "aac", "-b:a", "192k"]
    cmd += ["-c:v", "libx264", "-preset", preset, "-crf", str(crf), "-pix_fmt", "yuv420p",
            "-t", f"{duration:.3f}", "-movflags", "+faststart", out]
    return subprocess.Popen(cmd, stdin=subprocess.PIPE)


def _ref_label(d, i):
    names = [str(n) for n in d["ref_move_names"]]
    up, lo = (int(x) for x in d["ref_move"][i])
    return names[lo] if up == lo else f"legs {names[lo]} / arms {names[up]}"


def _unit_of(d, i):
    _, anchor = _grid(d)
    return int(np.floor((float(d["t"][i]) - anchor) / song.EIGHT))


def _draw_ref_label(dr, d, i, x=10, y=10, unit=True):
    """Move label of frame i: 'unit N  move X', or for a fused unit 'unit N  FUSED' + 'LEGS: X' + 'ARMS: Y'."""
    u = _unit_of(d, i)
    pre = f"unit {u}  " if unit and u >= 0 else ""
    lab = _ref_label(d, i)
    if " / arms " in lab:
        lg, ar = lab.split(" / arms ")
        dr.text((x, y), pre + "FUSED", fill=(255, 120, 200))
        dr.text((x, y + 16), "LEGS:  " + lg[len("legs "):], fill=(255, 210, 120))
        dr.text((x, y + 32), "ARMS:  " + ar, fill=(160, 220, 255))
    else:
        dr.text((x, y), pre + "move " + lab, fill=(255, 210, 120))


def dev_video(d, out, song_path, max_seconds=None, fps=30, reference=False, ghost=False, units=None):
    from tqdm import tqdm
    W, H, SH = 1280, 720, 160
    model = _model()
    if ghost or units:
        return _dev_video_ghost(d, out, song_path, max_seconds, fps, units)
    if reference:
        return _dev_video_ref(d, out, song_path, max_seconds, fps)
    sc = Scene(model, W, H - SH)
    strip = Strip(d, W, SH)
    dur = float(d["t"][-1]) if max_seconds is None else min(max_seconds, float(d["t"][-1]))
    n = int(dur * fps)
    p = _ffmpeg(out, W, H, fps, song_path, n / fps)
    for k in tqdm(range(n), desc="dev video", mininterval=10):
        t = k / fps
        img = np.concatenate([sc.frame(_qpos_at(d["qpos"], t)), strip.at(t)], axis=0)
        p.stdin.write(np.ascontiguousarray(img).tobytes())
    p.stdin.close()
    rc = p.wait()
    sc.close()
    print(f"wrote {out} ({n} frames, ffmpeg rc {rc})")


def _dev_video_ref(d, out, song_path, max_seconds=None, fps=30):
    from PIL import Image, ImageDraw
    from tqdm import tqdm
    W, H, SH = 1280, 720, 160
    model = _model()
    sa, sb = Scene(model, W // 2, H - SH), Scene(_model(), W // 2, H - SH)
    strip = Strip(d, W, SH)
    dur = float(d["t"][-1]) if max_seconds is None else min(max_seconds, float(d["t"][-1]))
    n = int(dur * fps)
    p = _ffmpeg(out, W, H, fps, song_path, n / fps)
    for k in tqdm(range(n), desc="dev video (+reference)", mininterval=10):
        t = k / fps
        i = int(np.clip(round(t * FPS), 0, len(d["qpos"]) - 1))
        b = Image.fromarray(sb.frame(d["ref_qpos"][i]))
        bd = ImageDraw.Draw(b)
        bd.text((8, 8), "reference (dataset dancer)", fill=(255, 255, 255))
        _draw_ref_label(bd, d, i, 8, 26)
        a = Image.fromarray(sa.frame(d["qpos"][i]))
        ImageDraw.Draw(a).text((8, 8), "policy", fill=(255, 255, 255))
        img = np.concatenate([np.concatenate([np.asarray(a), np.asarray(b)], axis=1), strip.at(t)], axis=0)
        p.stdin.write(np.ascontiguousarray(img).tobytes())
    p.stdin.close()
    rc = p.wait()
    sa.close()
    sb.close()
    print(f"wrote {out} ({n} frames, policy | reference, ffmpeg rc {rc})")


def _dev_video_ghost(d, out, song_path, max_seconds=None, fps=30, units=None):
    """Policy (solid) with the scheduled reference as a translucent ghost in the same scene + the beat strip.
    units: list of 8-count unit indices rendered back-to-back (fusion showcase; audio = the same song slices)."""
    from PIL import Image, ImageDraw
    from tqdm import tqdm
    W, H, SH = 1280, 720, 160
    sc = Scene(_model(), W, H - SH)
    strip = Strip(d, W, SH)
    _, anchor = _grid(d)
    dur = float(d["t"][-1]) if max_seconds is None else min(max_seconds, float(d["t"][-1]))
    if units:
        segs = [(anchor + u * song.EIGHT, anchor + (u + 1) * song.EIGHT) for u in units]
    else:
        segs = [(0.0, dur)]
    times = np.concatenate([np.arange(int(round((b - a) * fps))) / fps + a for a, b in segs])
    n = len(times)
    p = _ffmpeg(out, W, H, fps, None if units else song_path, n / fps)
    has_ref = "ref_qpos" in d
    for k in tqdm(range(n), desc="dev video (ghost)", mininterval=10):
        t = float(times[k])
        if k and abs(t - times[k - 1] - 1.0 / fps) > 1e-6:
            sc.look = None                       # jump to the next showcase segment
        i = int(np.clip(round(t * FPS), 0, len(d["qpos"]) - 1))
        im = Image.fromarray(sc.frame(d["qpos"][i], ghost=d["ref_qpos"][i] if has_ref else None))
        dr = ImageDraw.Draw(im)
        if has_ref:
            _draw_ref_label(dr, d, i)
            dr.text((10, H - SH - 20), "solid = policy   translucent blue = reference (dataset dancer)",
                    fill=(230, 230, 230))
        img = np.concatenate([np.asarray(im), strip.at(t)], axis=0)
        p.stdin.write(np.ascontiguousarray(img).tobytes())
    p.stdin.close()
    rc = p.wait()
    sc.close()
    if units and song_path and os.path.exists(song_path) and rc == 0:      # mux the matching song slices
        fl = "".join(f"[1:a]atrim={a:.3f}:{b:.3f},asetpts=PTS-STARTPTS[a{j}];" for j, (a, b) in enumerate(segs))
        fl += "".join(f"[a{j}]" for j in range(len(segs))) + f"concat=n={len(segs)}:v=0:a=1[a]"
        tmp = out + ".mux.mp4"
        rc2 = subprocess.call(["ffmpeg", "-y", "-loglevel", "error", "-i", out, "-i", song_path, "-filter_complex", fl,
                               "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
                               "-shortest", tmp])
        if rc2 == 0:
            os.replace(tmp, out)
    print(f"wrote {out} ({n} frames, policy + reference ghost, ffmpeg rc {rc})")


def final_video(d, out, song_path, max_seconds=None, fps=60, orbit_period=60.0, camera="orbit"):
    from tqdm import tqdm
    W, H = 1920, 1080
    model = _model()
    sc = Scene(model, W, H)
    dur = float(d["t"][-1]) if max_seconds is None else min(max_seconds, float(d["t"][-1]))
    n = int(dur * fps)
    p = _ffmpeg(out, W, H, fps, song_path, n / fps, crf=18, preset="medium")
    for k in tqdm(range(n), desc="final video", mininterval=10):
        t = k / fps
        az = 180.0 + 360.0 * t / orbit_period if camera == "orbit" else 180.0     # front: fixed, facing +x
        img = sc.frame(_qpos_at(d["qpos"], t), azimuth=az, distance=4.5, smooth=0.05)
        p.stdin.write(np.ascontiguousarray(img).tobytes())
    p.stdin.close()
    rc = p.wait()
    sc.close()
    print(f"wrote {out} ({n} frames, ffmpeg rc {rc})")


def contact_sheets(d, outdir, times=SHEET_TIMES, reference=False):
    from PIL import Image, ImageDraw
    os.makedirs(outdir, exist_ok=True)
    model = _model()
    sc = Scene(model, SHEET_W, SHEET_H)
    sc.cam.distance = 3.6
    if reference:
        assert "ref_qpos" in d, "--reference needs a track-mode rollout (ref_qpos)"
        sr = Scene(_model(), SHEET_W, SHEET_H)
        sr.cam.distance = 3.6
    paths = []
    dur = float(d["t"][-1])
    fv, anchor = _grid(d)
    claps = _claps(dur)
    for T in times:
        T = min(T, dur - 2 * song.BAR)
        t0 = T
        if fv == 2:     # v2: start on a downbeat so the 16 tiles sit exactly on beats and "ands"
            t0 = anchor + song.BAR * np.ceil((T - anchor) / song.BAR - 1e-6)
            t0 = t0 if t0 + 2 * song.BAR <= dur else t0 - song.BAR
        ts = t0 + np.arange(16) * (2 * song.BAR / 16)
        sc.look = None
        if reference:
            sr.look = None
        tiles = []
        for tt in ts:
            im = Image.fromarray(sc.frame(_qpos_at(d["qpos"], tt), smooth=1.0))
            dr = ImageDraw.Draw(im)
            bp = ((tt - anchor) / song.BEAT) % 4 + 1
            clap = np.min(np.abs(claps - tt)) < 0.03 if len(claps) else False
            dr.text((4, 4), f"{tt:.2f}s  beat {bp:.2f}" + ("  CLAP" if clap else ""),
                    fill=(90, 230, 230) if clap else (255, 255, 255))
            tile = np.asarray(im)
            if reference:
                i = int(np.clip(round(tt * FPS), 0, len(d["qpos"]) - 1))
                rim = Image.fromarray(sr.frame(d["ref_qpos"][i], smooth=1.0))
                rd = ImageDraw.Draw(rim)
                rd.text((4, 4), "reference", fill=(255, 210, 120))
                lab = _ref_label(d, i)
                if " / arms " in lab:       # fused: two lines (one line truncated the arms move away)
                    lg, ar = lab.split(" / arms ")
                    rd.text((4, SHEET_H - 28), lg[:38], fill=(255, 210, 120))
                    rd.text((4, SHEET_H - 14), ("arms " + ar)[:38], fill=(160, 220, 255))
                else:
                    rd.text((4, SHEET_H - 14), lab[:38], fill=(255, 210, 120))
                tile = np.concatenate([tile, np.full((SHEET_H, 2, 3), 255, np.uint8), np.asarray(rim)], axis=1)
            tiles.append(tile)
        per = 4 if reference else 8
        rows = [np.concatenate(tiles[r * per:(r + 1) * per], axis=1) for r in range(16 // per)]
        sheet = np.concatenate(rows, axis=0)
        path = os.path.join(outdir, f"contact_{T:06.2f}s" + ("_ref" if reference else "") + ".png")
        Image.fromarray(sheet).save(path)
        paths.append(path)
        print("wrote", path)
    sc.close()
    if reference:
        sr.close()
    paths.append(energy_plot(d, os.path.join(outdir, "motion_energy_vs_beat.png"), times))
    return paths


def energy_plot(d, path, times=SHEET_TIMES):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    t, m = d["t"], d["motion_energy"]
    onset = d["features"][:, song.COL["onset"]]
    fv, anchor = _grid(d)
    beats = song.beat_times(float(t[-1]), anchor=anchor)
    claps = _claps(float(t[-1]))
    snare = d["features"][:, song.COL_V2["snare"]] if fv == 2 else None
    fig, axes = plt.subplots(len(times) + 1, 1, figsize=(14, 3 + 2.2 * len(times)))
    ax = axes[0]
    ax.plot(t, m, lw=0.6, color="tab:orange", label="motion energy m (m/s)")
    ax.axvline(song.DROP, color="red", lw=1)
    ax.set_title("whole song")
    ax.legend(loc="upper right")
    for ax, T in zip(axes[1:], times):
        sel = (t >= T - 1) & (t <= T + 2 * song.BAR + 1)
        ax.plot(t[sel], m[sel], color="tab:orange", lw=1.5, label="motion energy")
        ax2 = ax.twinx()
        ax2.fill_between(t[sel], onset[sel], color="tab:blue", alpha=0.2, label="onset")
        if snare is not None:
            ax2.plot(t[sel], snare[sel], color="tab:green", lw=0.8, alpha=0.7, label="snare")
        ax2.set_ylim(0, 1.05)
        for b in beats[(beats >= t[sel][0]) & (beats <= t[sel][-1])]:
            down = round((b - anchor) / song.BEAT) % 4 == 0
            ax.axvline(b, color="k", lw=1.2 if down else 0.5, alpha=0.6 if down else 0.3)
        for c in claps[(claps >= t[sel][0]) & (claps <= t[sel][-1])]:
            ax.axvline(c, color="tab:cyan", lw=1.0, ls="--", alpha=0.8)
        if t[sel][0] <= song.DROP <= t[sel][-1]:
            ax.axvline(song.DROP, color="red", lw=1.5)
        ax.set_title(f"{T:.1f}s window (v{fv} grid: beats = thin lines, downbeats = thick; claps = cyan dashed)")
        ax.set_xlabel("song time (s)")
    fig.tight_layout()
    fig.savefig(path, dpi=90)
    plt.close(fig)
    print("wrote", path)
    return path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rollout", required=True)
    ap.add_argument("--song", default="now-get-busy.mp3")
    ap.add_argument("--out", default=None)
    ap.add_argument("--outdir", default=None)
    ap.add_argument("--contact-sheets", action="store_true")
    ap.add_argument("--final", action="store_true")
    ap.add_argument("--max-seconds", type=float, default=None)
    ap.add_argument("--times", default=None, help="comma-separated contact-sheet times (s), default 8.5,40,100")
    ap.add_argument("--reference", action="store_true",
                    help="phase 2: render the scheduled reference beside the policy (track-mode rollouts)")
    ap.add_argument("--ghost", action="store_true",
                    help="dev video: the reference as a translucent ghost in the policy's scene (one view)")
    ap.add_argument("--units", default=None,
                    help="dev video: comma-separated 8-count unit indices rendered back-to-back with the ghost "
                         "(fusion showcase)")
    ap.add_argument("--camera", default="orbit", choices=["orbit", "front"],
                    help="--final camera: slow orbit (default) or fixed in front (+x)")
    a = ap.parse_args()
    d = dict(np.load(a.rollout))
    if a.contact_sheets:
        times = tuple(float(x) for x in a.times.split(",")) if a.times else SHEET_TIMES
        contact_sheets(d, a.outdir or os.path.dirname(a.rollout) or ".", times, reference=a.reference)
    if a.final:
        final_video(d, a.out or "final.mp4", a.song, a.max_seconds, camera=a.camera)
    elif a.out:
        units = [int(x) for x in a.units.split(",")] if a.units else None
        dev_video(d, a.out, a.song, a.max_seconds, reference=a.reference, ghost=a.ghost, units=units)


if __name__ == "__main__":
    main()
