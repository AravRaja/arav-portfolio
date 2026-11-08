"""Beat-align, segment and deduplicate retargeted AIST++ clips into the phase-2 move library.

    python -m dance_rl.build_motion_lib --retarget data/interim/retarget --out data/library --genres gMH,gLH

Input: retarget.py's per-clip npz (qpos at the source 60 fps, already on the humanoid).

Beat alignment. AIST++ clips are cut to the music grid: every gMH/gLH/gHO clip is an exact whole
number of 8-counts long (sBM 16 beats, sFM 64 beats at the clip's BPM), so t = 0 of a clip is beat 1 of
an 8-count. A clip's BPM comes from its music id (mXX0..5 = 80..130 BPM, house mHO0..5 = 110..135; both
mappings confirmed by the clip lengths and by the autocorrelation of pelvis height). Each clip is
uniformly time-scaled to the song tempo (beat 0.53125 s = 112.94 BPM): t_song = t_src * bpm / 112.94,
so the move plays 0.71x..1.41x (80..130 BPM) or 0.97x..1.2x (house) as fast as the dancer did it.
beat_phase = (t_song / 0.53125) mod 1, bar_phase = (t_song / 2.125) mod 1, both 0 at the clip start.
Cross-check stored per clip in the manifest: circular mean phase (in beats) of the pelvis-height minima
and of the whole-body speed minima on that grid, with their resultant lengths R.

Segmentation. 8-count k of a clip covers t_song in [4.25 k, 4.25 (k + 1)); a move samples it at
50 Hz: 213 frames t = 4.25 k + i / 50, i = 0..212 (frame 212.5 would be the next downbeat).
Moves are re-rooted: root xy = 0 and torso heading = +x at frame 0. qvel is a central difference of
the continuous resampled trajectory (mj_differentiatePos, +-5 ms), so it has no segment-edge artefacts.
Contacts: foot's lowest capsule point < 3 cm and min(toe, heel) horizontal speed < 0.8 m/s.

Filtering / dedupe. Segments with mean marker FK error > 6 cm or end-effector motion below 0.25 m/s
(standing still) are dropped. Remaining segments are sorted by IK error and kept greedily unless their
frame-aligned pose distance (RMS over frames of [21 joint angles (rad), 2 x torso height (m),
torso up-vector (3)]) to an already kept move is < --dedupe-tau. A dropped duplicate's id is listed
under its keeper in the manifest.
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import re

import mujoco
import numpy as np
from scipy.interpolate import CubicSpline
from scipy.signal import argrelmin, butter, filtfilt
from scipy.spatial.transform import Rotation, Slerp

from dance_rl import humanoid_model as hm
from dance_rl.mirror import mirror_perm_sign

FPS = 50
BEAT = 0.53125
BAR = 4 * BEAT
EIGHT = 2 * BAR
SONG_BPM = 60.0 / BEAT
N_FRAMES = 213
SRC_FPS = 60.0
CONTACT_Z = 0.03
CONTACT_V = 0.8
MAX_IK_ERR_CM = 6.0
MIN_ENERGY = 0.25

UPPER = ("abdomen_z", "abdomen_y", "abdomen_x", "right_shoulder1", "right_shoulder2", "right_elbow",
         "left_shoulder1", "left_shoulder2", "left_elbow")


def quat_wxyz_to_xyzw(q):
    return np.concatenate([q[..., 1:], q[..., :1]], axis=-1)


def quat_xyzw_to_wxyz(q):
    return np.concatenate([q[..., 3:], q[..., :3]], axis=-1)


class Trajectory:
    """Continuous qpos(t_song) from 60 fps samples: cubic splines for position / joints, slerp for the root."""

    def __init__(self, Q, bpm):
        T = len(Q)
        self.t = np.arange(T) / SRC_FPS * bpm / SONG_BPM
        self.dur = self.t[-1]
        self.lin = CubicSpline(self.t, np.concatenate([Q[:, 0:3], Q[:, 7:]], axis=1), axis=0)
        quat = Q[:, 3:7].astype(np.float64)
        self.slerp = Slerp(self.t, Rotation.from_quat(quat_wxyz_to_xyzw(quat)))

    def __call__(self, ts):
        ts = np.clip(ts, 0, self.dur)
        L = self.lin(ts)
        q = quat_xyzw_to_wxyz(self.slerp(ts).as_quat())
        return np.concatenate([L[:, 0:3], q, L[:, 3:]], axis=1)


def qvel_of(m, traj, ts, h=0.005):
    a, b = traj(ts - h), traj(ts + h)
    lo = ts - h < 0
    hi = ts + h > traj.dur
    a[lo] = traj(ts[lo])
    b[hi] = traj(ts[hi])
    dt = np.where(lo | hi, h, 2 * h)
    v = np.zeros((len(ts), m.nv))
    for i in range(len(ts)):
        mujoco.mj_differentiatePos(m, v[i], dt[i], a[i], b[i])
    return v


def heading_yaw(q):
    R = np.zeros(9)
    mujoco.mju_quat2Mat(R, q[3:7])
    x = R.reshape(3, 3)[:, 0]
    return float(np.arctan2(x[1], x[0]))


def reroot(Q, V):
    """Root xy -> 0 and torso heading -> +x at frame 0 (rotation about world z)."""
    yaw = heading_yaw(Q[0])
    c, s = np.cos(-yaw), np.sin(-yaw)
    Rz = np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])
    Q = Q.copy()
    V = V.copy()
    xy0 = Q[0, 0:2].copy()
    Q[:, 0:2] -= xy0
    Q[:, 0:3] = Q[:, 0:3] @ Rz.T
    qz = np.array([np.cos(-yaw / 2), 0, 0, np.sin(-yaw / 2)])
    for i in range(len(Q)):
        out = np.zeros(4)
        mujoco.mju_mulQuat(out, qz, Q[i, 3:7])
        Q[i, 3:7] = out / np.linalg.norm(out)
    V[:, 0:3] = V[:, 0:3] @ Rz.T                  # free-joint linear velocity is world frame
    return Q, V                                    # angular velocity is body frame: unchanged


class FK:
    def __init__(self):
        self.m, self.sid = hm.with_markers()
        self.d = mujoco.MjData(self.m)
        self.fg = hm.foot_geoms(self.m)
        bid = lambda n: mujoco.mj_name2id(self.m, mujoco.mjtObj.mjOBJ_BODY, n)
        self.foot_b = [bid("left_foot"), bid("right_foot")]
        self.ee_b = [bid(n) for n in ("head", "left_hand", "right_hand", "left_foot", "right_foot")]
        self.pelvis = bid("pelvis")
        self.torso = bid("torso")
        self.toe_heel = [self.sid[n] for n in ("left_toe", "left_heel", "right_toe", "right_heel")]

    def run(self, Q):
        T = len(Q)
        low = np.zeros((T, 2))
        foot = np.zeros((T, 2, 3))
        ee = np.zeros((T, 5, 3))
        up = np.zeros((T, 3))
        pel = np.zeros((T, 3))
        th = np.zeros((T, 4, 3))
        for t in range(T):
            self.d.qpos[:] = Q[t]
            mujoco.mj_kinematics(self.m, self.d)
            low[t] = [hm.lowest_z(self.m, self.d, g) for g in self.fg]
            foot[t] = self.d.xpos[self.foot_b]
            ee[t] = self.d.xpos[self.ee_b]
            up[t] = self.d.xmat[self.torso].reshape(3, 3)[:, 2]
            pel[t] = self.d.xpos[self.pelvis]
            th[t] = self.d.site_xpos[self.toe_heel]
        return dict(low=low, foot=foot, ee=ee, up=up, pelvis=pel, toe_heel=th)


def contacts_of(f, fps=FPS):
    """Foot in contact: lowest capsule point < CONTACT_Z and the slower of its toe / heel points moves
    horizontally slower than CONTACT_V (a foot swivelling on its toe or heel still counts as planted)."""
    p = f["toe_heel"]
    v = np.zeros(p.shape[:2])
    v[1:-1] = np.linalg.norm(p[2:, :, :2] - p[:-2, :, :2], axis=-1) * fps / 2
    v[0], v[-1] = v[1], v[-2]
    v = np.minimum(v[:, 0::2], v[:, 1::2])          # (T, 2): min(toe, heel) per foot [left, right]
    return (f["low"] < CONTACT_Z) & (v < CONTACT_V)


def circ_phase(times, period, x, order=6):
    """Prominence-weighted circular mean phase (cycles) of the local minima of x."""
    i = argrelmin(x, order=order)[0]
    if len(i) == 0:
        return float("nan"), 0.0
    prom = np.array([max(x[max(j - 10, 0):j + 11].max() - x[j], 0.0) for j in i])
    z = np.sum(prom * np.exp(2j * np.pi * times[i] / period)) / max(prom.sum(), 1e-9)
    return float((np.angle(z) / (2 * np.pi)) % 1), float(abs(z))


def kinematic_beat_check(tg, bpm):
    """Beat phase of pelvis-height minima and whole-body speed minima in source time (t = 0 = beat 1)."""
    t = np.arange(len(tg)) / SRC_FPS
    b, a = butter(2, 8.0 / (SRC_FPS / 2))
    hz = filtfilt(b, a, tg[:, 7:9, 2].mean(1))
    sp = np.r_[0.0, np.linalg.norm(np.diff(tg, axis=0), axis=-1).mean(1) * SRC_FPS]
    sp = filtfilt(b, a, sp)
    P = 60.0 / bpm
    ph_h, r_h = circ_phase(t, P, hz)
    ph_v, r_v = circ_phase(t, P, sp)
    return dict(pelvis_min_phase=ph_h, pelvis_min_R=r_h, speed_min_phase=ph_v, speed_min_R=r_v)


def mirror_move(Q, V, C, perm, sign):
    """Reflect y -> -y: root pos (x,-y,z), quat (w,-x,y,-z), lin vel (vx,-vy,vz), body ang vel
    (-wx, wy, -wz); joints through mirror.py's (perm, sign); contacts swap left/right."""
    Qm = Q.copy()
    Vm = V.copy()
    Qm[..., 1] *= -1
    Qm[..., 4] *= -1
    Qm[..., 6] *= -1
    Qm[..., 7:] = Q[..., 7:][..., perm] * sign
    Vm[..., 1] *= -1
    Vm[..., 3] *= -1
    Vm[..., 5] *= -1
    Vm[..., 6:] = V[..., 6:][..., perm] * sign
    Cm = C[..., ::-1].copy()
    return Qm, Vm, Cm


def pose_feature(Q, f):
    return np.concatenate([Q[:, 7:], 2.0 * Q[:, 2:3], f["up"]], axis=1)


def parse(name):
    g, s, d, mus, ch = re.match(r"(g\w\w)_(s\w\w)_cAll_(d\d+)_(m\w\w\d)_(ch\d+)", name).groups()
    return g, s, d, mus, ch


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--retarget", default="data/interim/retarget")
    ap.add_argument("--out", default="data/library")
    ap.add_argument("--genres", default="gMH,gLH")
    ap.add_argument("--dedupe-tau", type=float, default=0.25)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    fk = FK()
    m = fk.m
    names = hm.joint_names(m)
    perm, sign = mirror_perm_sign(names)
    files = sorted(f for g in a.genres.split(",") for f in glob.glob(os.path.join(a.retarget, f"{g}_*.npz")))
    i_frames = np.arange(N_FRAMES)
    t_rel = i_frames / FPS
    beat_phase = (t_rel / BEAT) % 1.0
    bar_phase = (t_rel / BAR) % 1.0

    clips, segs = {}, []
    for f in files:
        name = os.path.basename(f)[:-4]
        g, s, dancer, mus, ch = parse(name)
        d = np.load(f)
        Q60 = d["qpos60"].astype(np.float64)
        bpm = int(d["bpm"])
        traj = Trajectory(Q60, bpm)
        beats = len(Q60) / SRC_FPS * bpm / 60.0
        n8 = int(np.floor(beats / 8 + 0.02))
        err = d["fk_err"]
        clips[name] = dict(
            genre=g, style=s, dancer=dancer, music=mus, choreo=ch, bpm=bpm, src_frames=len(Q60),
            src_seconds=round(len(Q60) / SRC_FPS, 3), beats=round(beats, 2), eight_counts=n8,
            speed_factor=round(SONG_BPM / bpm, 4),
            fk_err_cm=dict(mean=round(float(err.mean()), 2), p95=round(float(np.percentile(err, 95)), 2),
                           max=round(float(err.max()), 2),
                           per_marker={n: round(float(v), 2) for n, v in zip(hm.FIT, err.mean(0))}),
            proportion_err_cm=round(float(d["raw_err"].mean()), 2),
            scale=round(float(d["scale"]), 4), dancer_leg_m=round(float(d["dancer_leg"]), 3),
            beat_check=kinematic_beat_check(d["targets"].astype(np.float64), bpm),
            segments=[])
        src_err_t = np.arange(len(err)) / SRC_FPS * bpm / SONG_BPM
        for k in range(n8):
            t0 = k * EIGHT
            ts = t0 + t_rel
            if ts[-1] > traj.dur + 0.05:          # <= 2.5 frames held at the clip end (63.94-beat clips)
                clips[name]["segments"].append(dict(k=k, kept=False, reason="short"))
                continue
            Q = traj(ts)
            V = qvel_of(m, traj, ts)
            Q, V = reroot(Q, V)
            fr = fk.run(Q)
            C = contacts_of(fr)
            sel = (src_err_t >= t0) & (src_err_t < t0 + EIGHT)
            seg_err = float(err[sel].mean())
            rel = fr["ee"] - fr["pelvis"][:, None]
            energy = float(np.linalg.norm(np.diff(rel, axis=0), axis=-1).mean() * FPS
                           + np.linalg.norm(np.diff(Q[:, :2], axis=0), axis=-1).mean() * FPS)
            segs.append(dict(clip=name, k=k, t0_song=t0, t0_src=t0 * SONG_BPM / bpm, Q=Q, V=V, C=C,
                             feat=pose_feature(Q, fr), ik_err=seg_err, energy=energy, fr=fr))

    # ---------------- filter + dedupe
    kept, dup_of = [], {}
    order = sorted(range(len(segs)), key=lambda i: segs[i]["ik_err"])
    reasons = {}
    for i in order:
        sg = segs[i]
        if sg["ik_err"] > MAX_IK_ERR_CM:
            reasons[i] = f"ik_err {sg['ik_err']:.1f} cm"
            continue
        if sg["energy"] < MIN_ENERGY:
            reasons[i] = f"idle (energy {sg['energy']:.2f} m/s)"
            continue
        best, bd = None, np.inf
        for j in kept:
            dist = float(np.sqrt(np.mean((sg["feat"] - segs[j]["feat"]) ** 2)))
            if dist < bd:
                best, bd = j, dist
        if best is not None and bd < a.dedupe_tau:
            dup_of[i] = (best, bd)
            reasons[i] = "duplicate"
            continue
        kept.append(i)
    kept.sort(key=lambda i: (segs[i]["clip"], segs[i]["k"]))

    def mid(sg):
        g, s, d_, mus, ch = parse(sg["clip"])
        return f"{g}_{s}_{d_}_{mus}_{ch}_s{sg['k']}"

    # ---------------- assemble
    N = len(kept)
    qpos = np.stack([segs[i]["Q"] for i in kept]).astype(np.float32)
    qvel = np.stack([segs[i]["V"] for i in kept]).astype(np.float32)
    cont = np.stack([segs[i]["C"] for i in kept])
    qpos_m, qvel_m, cont_m = mirror_move(qpos, qvel, cont, perm, sign)
    ids = [mid(segs[i]) for i in kept]
    moves = []
    dups = {i: [] for i in kept}
    for i, (j, dist) in dup_of.items():
        dups[j].append((mid(segs[i]), round(dist, 3)))
    for n, i in enumerate(kept):
        sg = segs[i]
        Q = sg["Q"]
        disp = Q[-1, 0:2] - Q[0, 0:2]
        dyaw = float(np.degrees(np.angle(np.exp(1j * (heading_yaw(Q[-1]) - heading_yaw(Q[0]))))))
        path = float(np.linalg.norm(np.diff(Q[:, 0:2], axis=0), axis=-1).sum())
        f0, f1 = sg["feat"][0], sg["feat"][-1]
        loop_d = float(np.sqrt(np.mean((Q[-1, 7:] - Q[0, 7:]) ** 2)) + 2 * abs(Q[-1, 2] - Q[0, 2])
                       + np.linalg.norm(f1[-3:] - f0[-3:]))
        vel_d = float(np.sqrt(np.mean((sg["V"][-1, 6:] - sg["V"][0, 6:]) ** 2)))
        g, s, d_, mus, ch = parse(sg["clip"])
        moves.append(dict(
            id=ids[n], index=n, mirror_id=ids[n] + "_M", clip=sg["clip"], genre=g, style=s, dancer=d_,
            music=mus, choreo=ch, segment=sg["k"], bpm=clips[sg["clip"]]["bpm"],
            speed_factor=clips[sg["clip"]]["speed_factor"],
            start_src_s=round(sg["t0_src"], 4), start_song_s=round(sg["t0_song"], 4),
            root_disp_xy_m=[round(float(disp[0]), 3), round(float(disp[1]), 3)],
            root_disp_m=round(float(np.linalg.norm(disp)), 3), root_path_m=round(path, 3),
            yaw_change_deg=round(dyaw, 1),
            in_place=bool(np.linalg.norm(disp) < 0.35 and abs(dyaw) < 45),
            loop_dist=round(loop_d, 3), loop_vel_dist=round(vel_d, 3),
            loopability=round(float(np.exp(-loop_d / 0.5)), 3),
            ik_err_cm=round(sg["ik_err"], 2), energy_mps=round(sg["energy"], 3),
            contact_frac=[round(float(x), 3) for x in sg["C"].mean(0)],
            pelvis_z_mean=round(float(sg["fr"]["pelvis"][:, 2].mean()), 3),
            pelvis_z_min=round(float(sg["fr"]["pelvis"][:, 2].min()), 3),
            duplicates=[x[0] for x in dups[i]], duplicate_dist=[x[1] for x in dups[i]],
            next_segment_id=None))
    idset = set(ids)
    for mv in moves:
        nxt = f"{mv['genre']}_{mv['style']}_{mv['dancer']}_{mv['music']}_{mv['choreo']}_s{mv['segment'] + 1}"
        mv["next_segment_id"] = nxt if nxt in idset else None
    seg_index = {(sg["clip"], sg["k"]): i for i, sg in enumerate(segs)}
    for name, c in clips.items():
        for k in range(c["eight_counts"]):
            i = seg_index.get((name, k))
            if i is None:
                continue
            st = dict(k=k, kept=i in kept, ik_err_cm=round(segs[i]["ik_err"], 2),
                      energy_mps=round(segs[i]["energy"], 3))
            if i in reasons:
                st["reason"] = reasons[i]
            if i in dup_of:
                st["duplicate_of"] = mid(segs[dup_of[i][0]])
                st["dist"] = round(dup_of[i][1], 3)
            c["segments"].append(st)

    upper = [n in UPPER for n in names]
    upper_q = np.array([7 + i for i, u in enumerate(upper) if u])
    lower_q = np.array([7 + i for i, u in enumerate(upper) if not u])
    np.savez_compressed(
        os.path.join(a.out, "moves.npz"),
        ids=np.array(ids), qpos=qpos, qvel=qvel, contacts=cont,
        qpos_mirror=qpos_m.astype(np.float32), qvel_mirror=qvel_m.astype(np.float32), contacts_mirror=cont_m,
        beat_phase=beat_phase.astype(np.float32), bar_phase=bar_phase.astype(np.float32),
        t=t_rel.astype(np.float32), fps=FPS, beat=BEAT, bar=BAR,
        joint_names=np.array(names), actuator_names=np.array(hm.actuator_names(m)),
        upper_qpos_idx=upper_q, lower_qpos_idx=lower_q, upper_qvel_idx=upper_q - 1, lower_qvel_idx=lower_q - 1,
        mirror_perm=perm, mirror_sign=sign,
        bpm=np.array([mv["bpm"] for mv in moves]), loopability=np.array([mv["loopability"] for mv in moves]),
        in_place=np.array([mv["in_place"] for mv in moves]))
    errs = np.array([c["fk_err_cm"]["mean"] for c in clips.values()])
    manifest = dict(
        description="AIST++ hip-hop moves retargeted to the dm_control capsule humanoid, beat-aligned to 112.94 BPM",
        source="AIST++ keypoints3d_optim (COCO-17, 60 fps), CC BY 4.0; see data/README.md",
        genres=a.genres.split(","), song_bpm=SONG_BPM, fps=FPS, beat_s=BEAT, bar_s=BAR, frames_per_move=N_FRAMES,
        move_seconds=EIGHT, frame_times="t = i / 50, i = 0..212; beat_phase = (t / 0.53125) mod 1; bar_phase = (t / 2.125) mod 1",
        qpos_layout="0:3 root (torso) pos, 3:7 root quat wxyz, 7:28 hinge joints in joint_names order (= env.py data.qpos)",
        qvel_layout="0:3 root lin vel (world), 3:6 root ang vel (body frame), 6:27 hinge joints (= env.py data.qvel)",
        joint_names=names, actuator_names=hm.actuator_names(m),
        upper_joints=[n for n, u in zip(names, upper) if u], lower_joints=[n for n, u in zip(names, upper) if not u],
        upper_note="upper = abdomen (3) + shoulders/elbows (6); lower = hips/knees/ankles (12). The free root is the "
                   "TORSO (chest) body, so the root belongs to neither half: for fusion take root from the lower-body "
                   "move and re-solve abdomen if the pelvis must follow the legs.",
        mirror=dict(perm=perm.tolist(), sign=sign.tolist(), root="pos y -> -y; quat (w,x,y,z) -> (w,-x,y,-z); "
                    "lin vel vy -> -vy; body ang vel (wx,wy,wz) -> (-wx,wy,-wz); contacts [L,R] -> [R,L]"),
        contacts="[left, right]: foot lowest point < 3 cm and min(toe, heel) horizontal speed < 0.8 m/s",
        filters=dict(max_ik_err_cm=MAX_IK_ERR_CM, min_energy_mps=MIN_ENERGY, dedupe_tau=a.dedupe_tau),
        counts=dict(clips=len(clips), segments=len(segs), kept=N,
                    dropped_duplicate=sum(1 for r in reasons.values() if r == "duplicate"),
                    dropped_idle=sum(1 for r in reasons.values() if r.startswith("idle")),
                    dropped_ik=sum(1 for r in reasons.values() if r.startswith("ik_err"))),
        retarget_err_cm=dict(mean_of_clip_means=round(float(errs.mean()), 2), worst_clip=round(float(errs.max()), 2)),
        moves=moves, clips=clips)
    with open(os.path.join(a.out, "manifest.json"), "w") as fh:
        json.dump(manifest, fh, indent=1)
    print(json.dumps(manifest["counts"]), "retarget err", manifest["retarget_err_cm"])


if __name__ == "__main__":
    main()
