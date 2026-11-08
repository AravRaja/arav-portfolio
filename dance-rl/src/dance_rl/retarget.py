"""Retarget AIST++ COCO-17 3D keypoints onto the dance humanoid (per-frame IK), CPU only.

    python -m dance_rl.retarget --raw data/raw/aistpp --out data/interim/retarget --genres gMH,gLH

Per clip (keypoints3d_optim, 60 fps, cm, y-up):
 1. axes: AIST (x = dancer's left when facing +z, y up, z forward) -> humanoid world (x fwd, y left, z up):
    p_h = (z, x, y) / 100 (a cyclic permutation, so handedness is kept).
 2. limb-length scaling: a target skeleton is rebuilt from the data's bone DIRECTIONS with the humanoid's
    rest bone lengths (hip width 0.20, trunk 0.525, shoulder width 0.34, thigh 0.383, shin 0.33,
    upper arm 0.312, forearm 0.312 m). The hip-centre trajectory is scaled by s = humanoid leg / dancer leg.
 3. IK: damped Gauss-Newton on the full qpos (free root + 21 hinges) using mj_kinematics + mj_comPos +
    mj_jacSite on marker sites (humanoid_model.MARKERS), warm-started from the previous frame, joints
    limited by an active set (a hinge on its limit whose step points outward is frozen and the step
    re-solved). Extra residual rows: foot flat (toe z = heel z), weak pulls of hip_z / ankle / abdomen
    to 0 (COCO has no toes; abdomen pitch is redundant with torso pitch + hip flexion), and a temporal
    smoothness pull (0.1 / rad) to the previous frame.
 0. keypoints are low-passed first (8 Hz zero-phase Butterworth; removes ~1 cm frame jitter).
 4. zero-phase low-pass (10 Hz) on joint angles / root position / root quaternion components.
 5. FK error (cm) of the IK fit vs the target skeleton per marker; stored per clip.
 6. ground: a smoothed root-height offset puts the lowest point of a planted foot on z = 0 (planted =
    data ankle within 5 cm of its floor level and slower than 0.5 m/s) and never lets a foot go below 0.

Output per clip: <out>/<clip>.npz with qpos60 (T, 28), fk_err (T, 13) cm, targets (T, 13, 3), bpm, ...
Beat alignment / 50 Hz resampling / segmentation is build_motion_lib.py.
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import re
import time
from multiprocessing import Pool

import mujoco
import numpy as np
from scipy.signal import butter, filtfilt

from dance_rl import humanoid_model as hm
from dance_rl import safe_pickle

SRC_FPS = 60.0
KP_CUTOFF_HZ = 8.0
PLANT_HEIGHT = 0.05      # m above the ankle's 5th-percentile height
PLANT_SPEED = 0.5        # m/s (filtered keypoints)
COCO_IDX = {n: i for i, n in enumerate(hm.COCO)}
# marker weights in the IK (residual = w * position error in m)
W = {"nose": 0.3, "left_shoulder": 1.0, "right_shoulder": 1.0, "left_elbow": 0.8, "right_elbow": 0.8,
     "left_wrist": 1.0, "right_wrist": 1.0, "left_hip": 2.0, "right_hip": 2.0, "left_knee": 1.0,
     "right_knee": 1.0, "left_ankle": 1.5, "right_ankle": 1.5}
W_FOOT_FLAT = 0.4
W_SMOOTH = 0.1
# hip_z / ankle_x / ankle_y are barely observed by COCO-17 (no toes); abdomen pitch trades off against
# the free torso pitch and both hip_y (only the nose sees chest pitch), so all get a weak pull to 0
W_REST = {"hip_z": 0.03, "ankle_x": 0.08, "ankle_y": 0.01, "abdomen_y": 0.1, "abdomen_z": 0.05, "abdomen_x": 0.05}

GENRE_MUSIC_BPM = {str(i): 80 + 10 * i for i in range(6)}   # mXX0..mXX5 (all genres but house)
HOUSE_BPM = {str(i): 110 + 5 * i for i in range(6)}          # mHO0..mHO5


def clip_bpm(name: str) -> int:
    g, i = re.search(r"_m(\w\w)(\d)_", name).groups()
    return (HOUSE_BPM if g == "HO" else GENRE_MUSIC_BPM)[i]


def load_keypoints(path) -> np.ndarray:
    d = safe_pickle.load(path)
    k = np.asarray(d["keypoints3d_optim"], np.float64)
    if np.isnan(k).any():                     # linear fill per coordinate
        T = len(k)
        flat = k.reshape(T, -1)
        for c in range(flat.shape[1]):
            bad = np.isnan(flat[:, c])
            if bad.all():
                raise ValueError("all-NaN keypoint")
            if bad.any():
                flat[bad, c] = np.interp(np.flatnonzero(bad), np.flatnonzero(~bad), flat[~bad, c])
        k = flat.reshape(k.shape)
    return k[:, :, [2, 0, 1]] / 100.0


def smooth_keypoints(kp, fc=KP_CUTOFF_HZ):
    """Zero-phase low-pass of the keypoints (keypoints3d_optim still has ~1 cm frame-to-frame jitter,
    which reads as ~1.5 m/s of fake ankle speed at 60 fps)."""
    b, a = butter(2, fc / (SRC_FPS / 2))
    return filtfilt(b, a, kp, axis=0) if len(kp) > 12 else kp


def _unit(v):
    return v / np.maximum(np.linalg.norm(v, axis=-1, keepdims=True), 1e-9)


class Rest:
    """Humanoid rest dimensions measured from FK at qpos0."""

    def __init__(self, m, sid):
        d = mujoco.MjData(m)
        mujoco.mj_kinematics(m, d)
        p = {n: d.site_xpos[sid[n]].copy() for n in hm.MARKERS}
        L = lambda a, b: float(np.linalg.norm(p[a] - p[b]))
        self.hip_w = L("left_hip", "right_hip")
        self.sh_w = L("left_shoulder", "right_shoulder")
        hipm = 0.5 * (p["left_hip"] + p["right_hip"])
        shm = 0.5 * (p["left_shoulder"] + p["right_shoulder"])
        self.trunk = float(np.linalg.norm(shm - hipm))
        self.head = float(np.linalg.norm(p["nose"] - shm))
        self.thigh = L("left_hip", "left_knee")
        self.shin = L("left_knee", "left_ankle")
        self.uarm = L("left_shoulder", "left_elbow")
        self.farm = L("left_elbow", "left_wrist")
        self.leg = self.thigh + self.shin


def build_targets(kp: np.ndarray, rest: Rest):
    """Limb-length-scaled target skeleton (T, 13, 3) in hm.FIT order, plus scale info."""
    J = {n: kp[:, COCO_IDX[n]] for n in hm.COCO}
    hip_mid = 0.5 * (J["left_hip"] + J["right_hip"])
    sh_mid = 0.5 * (J["left_shoulder"] + J["right_shoulder"])
    floor = np.percentile(np.minimum(J["left_ankle"][:, 2], J["right_ankle"][:, 2]), 2)
    med = lambda a, b: float(np.median(np.linalg.norm(J[a] - J[b], axis=-1)))
    leg = 0.5 * (med("left_hip", "left_knee") + med("left_knee", "left_ankle")
                 + med("right_hip", "right_knee") + med("right_knee", "right_ankle"))
    s = rest.leg / leg
    root = hip_mid.copy()
    root[:, :2] *= s
    root[:, 2] = s * (hip_mid[:, 2] - floor)
    T = {}
    T["left_hip"] = root + 0.5 * rest.hip_w * _unit(J["left_hip"] - J["right_hip"])
    T["right_hip"] = root - 0.5 * rest.hip_w * _unit(J["left_hip"] - J["right_hip"])
    shm = root + rest.trunk * _unit(sh_mid - hip_mid)
    T["left_shoulder"] = shm + 0.5 * rest.sh_w * _unit(J["left_shoulder"] - J["right_shoulder"])
    T["right_shoulder"] = shm - 0.5 * rest.sh_w * _unit(J["left_shoulder"] - J["right_shoulder"])
    T["nose"] = shm + rest.head * _unit(J["nose"] - sh_mid)
    for sd in ("left", "right"):
        T[f"{sd}_elbow"] = T[f"{sd}_shoulder"] + rest.uarm * _unit(J[f"{sd}_elbow"] - J[f"{sd}_shoulder"])
        T[f"{sd}_wrist"] = T[f"{sd}_elbow"] + rest.farm * _unit(J[f"{sd}_wrist"] - J[f"{sd}_elbow"])
        T[f"{sd}_knee"] = T[f"{sd}_hip"] + rest.thigh * _unit(J[f"{sd}_knee"] - J[f"{sd}_hip"])
        T[f"{sd}_ankle"] = T[f"{sd}_knee"] + rest.shin * _unit(J[f"{sd}_ankle"] - J[f"{sd}_knee"])
    tg = np.stack([T[n] for n in hm.FIT], axis=1)
    # data-side planted-foot flags (for the ground correction): ankle near its floor level and slow
    planted = np.zeros((len(kp), 2), bool)
    for i, sd in enumerate(("left", "right")):
        a = J[f"{sd}_ankle"]
        h = a[:, 2] - np.percentile(a[:, 2], 5)
        v = np.r_[0.0, np.linalg.norm(np.diff(a, axis=0), axis=-1) * SRC_FPS]
        planted[:, i] = (h < PLANT_HEIGHT) & (v < PLANT_SPEED)
    # raw keypoints uniformly scaled by s about the hip centre (for the "proportions" error)
    raw = (kp - hip_mid[:, None]) * s + root[:, None]
    raw = np.stack([raw[:, COCO_IDX[n]] for n in hm.FIT], axis=1)
    return tg, planted, dict(scale=s, dancer_leg=leg, floor=float(floor)), raw


def quat_from_frame(fwd, left):
    """Root quaternion (w, x, y, z) with body x = fwd, y = left (orthonormalised), z = x cross y."""
    x = _unit(fwd)
    y = _unit(left - np.dot(left, x) * x)
    z = np.cross(x, y)
    R = np.stack([x, y, z], axis=1)
    q = np.zeros(4)
    mujoco.mju_mat2Quat(q, R.reshape(-1))
    return q


class IK:
    def __init__(self):
        self.m, self.sid = hm.with_markers()
        self.d = mujoco.MjData(self.m)
        self.rest = Rest(self.m, self.sid)
        m = self.m
        self.names = hm.joint_names(m)
        self.lo = m.jnt_range[1:, 0].copy()
        self.hi = m.jnt_range[1:, 1].copy()
        self.fit_ids = [self.sid[n] for n in hm.FIT]
        self.w = np.array([W[n] for n in hm.FIT])
        self.feet = [(self.sid["left_toe"], self.sid["left_heel"]), (self.sid["right_toe"], self.sid["right_heel"])]
        self.rest_w = np.zeros(21)
        for i, n in enumerate(self.names):
            for k, v in W_REST.items():
                if n.endswith(k):
                    self.rest_w[i] = v
        self.jacp = np.zeros((3, m.nv))
        self.jac2 = np.zeros((3, m.nv))

    def init_root(self, tg0):
        q = self.m.qpos0.copy()
        P = {n: tg0[i] for i, n in enumerate(hm.FIT)}
        left = P["left_shoulder"] - P["right_shoulder"]
        up = 0.5 * (P["left_shoulder"] + P["right_shoulder"]) - 0.5 * (P["left_hip"] + P["right_hip"])
        fwd = np.cross(left, up)
        q[3:7] = quat_from_frame(fwd, left)
        R = np.zeros(9)
        mujoco.mju_quat2Mat(R, q[3:7])
        shm = 0.5 * (P["left_shoulder"] + P["right_shoulder"])
        q[0:3] = shm - R.reshape(3, 3) @ np.array([0, 0, 0.06])
        # soft knees/hips for a well-conditioned start
        return q

    def residual(self, q, tg, q_prev):
        m, d = self.m, self.d
        d.qpos[:] = q
        mujoco.mj_kinematics(m, d)
        mujoco.mj_comPos(m, d)
        nf = len(self.fit_ids)
        rows, jac = [], []
        for i, s in enumerate(self.fit_ids):
            rows.append(self.w[i] * (d.site_xpos[s] - tg[i]))
            mujoco.mj_jacSite(m, d, self.jacp, None, s)
            jac.append(self.w[i] * self.jacp.copy())
        for toe, heel in self.feet:
            rows.append(np.array([W_FOOT_FLAT * (d.site_xpos[toe, 2] - d.site_xpos[heel, 2])]))
            mujoco.mj_jacSite(m, d, self.jacp, None, toe)
            mujoco.mj_jacSite(m, d, self.jac2, None, heel)
            jac.append(W_FOOT_FLAT * (self.jacp[2:3] - self.jac2[2:3]))
        r = np.concatenate(rows)
        Jm = np.concatenate(jac, axis=0)
        # joint regularisers (hinge dof i <-> qpos 7 + i <-> dof 6 + i)
        qj = q[7:]
        reg_r = [self.rest_w * qj]
        reg_J = np.zeros((21, m.nv))
        reg_J[np.arange(21), 6 + np.arange(21)] = self.rest_w
        regs = [reg_J]
        if q_prev is not None:
            reg_r.append(W_SMOOTH * (qj - q_prev[7:]))
            Js = np.zeros((21, m.nv))
            Js[np.arange(21), 6 + np.arange(21)] = W_SMOOTH
            regs.append(Js)
        r = np.concatenate([r] + reg_r)
        Jm = np.concatenate([Jm] + regs, axis=0)
        return r, Jm, nf

    def step(self, q, tg, q_prev, iters, mu=1e-3):
        m = self.m
        for _ in range(iters):
            r, Jm, _ = self.residual(q, tg, q_prev)
            g = Jm.T @ r
            H = Jm.T @ Jm + mu * np.eye(m.nv)
            # active set for the joint limits: a hinge sitting on a limit whose step points outward is
            # frozen and the step re-solved, so the other dofs compensate (plain clamping stalls)
            free = np.ones(m.nv, bool)
            qj = q[7:]
            at_lo = qj <= self.lo + 1e-6
            at_hi = qj >= self.hi - 1e-6
            for _k in range(4):
                dq = np.zeros(m.nv)
                dq[free] = -np.linalg.solve(H[np.ix_(free, free)], g[free])
                dj = dq[6:]
                bad = (at_lo & (dj < 0)) | (at_hi & (dj > 0))
                if not bad.any():
                    break
                free[6:][bad] = False
            n = np.linalg.norm(dq)
            if n > 0.5:
                dq *= 0.5 / n
            mujoco.mj_integratePos(m, q, dq, 1.0)
            q[7:] = np.clip(q[7:], self.lo, self.hi)
            q[3:7] /= np.linalg.norm(q[3:7])
            if n < 1e-5:
                break
        return q

    def fk(self, q):
        self.d.qpos[:] = q
        mujoco.mj_kinematics(self.m, self.d)
        return self.d.site_xpos[self.fit_ids].copy()

    def solve_clip(self, tg):
        T = len(tg)
        Q = np.zeros((T, self.m.nq))
        q = self.init_root(tg[0])
        q = self.step(q, tg[0], None, 200)
        q_prev = None
        for t in range(T):
            q = self.step(q, tg[t], q_prev, 12 if t else 50)
            Q[t] = q
            q_prev = q.copy()
        return Q


def lowpass(Q, fs=SRC_FPS, fc=10.0, lo=None, hi=None):
    b, a = butter(2, fc / (fs / 2))
    Q = Q.copy()
    quat = Q[:, 3:7]
    for t in range(1, len(quat)):                       # sign continuity
        if np.dot(quat[t], quat[t - 1]) < 0:
            quat[t] *= -1
    Q[:, 3:7] = quat
    if len(Q) > 12:
        Q = filtfilt(b, a, Q, axis=0)
    Q[:, 3:7] /= np.linalg.norm(Q[:, 3:7], axis=1, keepdims=True)
    if lo is not None:
        Q[:, 7:] = np.clip(Q[:, 7:], lo, hi)
    return Q


def ground(ik: IK, Q, planted):
    """Root z offset so planted feet touch z = 0 and no foot goes below it."""
    m, d = ik.m, ik.d
    fg = hm.foot_geoms(m)
    low = np.zeros((len(Q), 2))
    for t, q in enumerate(Q):
        d.qpos[:] = q
        mujoco.mj_kinematics(m, d)
        low[t] = [hm.lowest_z(m, d, g) for g in fg]
    want = np.where(planted, -low, -np.inf)
    off = want.max(axis=1)
    good = np.isfinite(off)
    if good.sum() < 2:
        off = -low.min(1)
    else:
        off = np.interp(np.arange(len(Q)), np.flatnonzero(good), off[good])
    b, a = butter(2, 3.0 / (SRC_FPS / 2))
    if len(off) > 12:
        off = filtfilt(b, a, off)
    off = np.maximum(off, -low.min(1))                  # never below the floor
    Q = Q.copy()
    Q[:, 2] += off
    return Q, low + off[:, None]


def process(args):
    path, out = args
    name = os.path.basename(path)[:-4]
    dst = os.path.join(out, name + ".npz")
    if os.path.exists(dst):
        return name, "cached"
    t0 = time.time()
    ik = IK()
    kp = smooth_keypoints(load_keypoints(path))
    tg, planted, info, raw = build_targets(kp, ik.rest)
    Q = ik.solve_clip(tg)
    Qf = lowpass(Q, lo=ik.lo, hi=ik.hi)
    fk = np.stack([ik.fk(q) for q in Qf])
    err = np.linalg.norm(fk - tg, axis=-1) * 100.0                   # cm, vs limb-scaled targets
    raw_err = np.linalg.norm((fk - fk.mean(1, keepdims=True)) - (raw - raw.mean(1, keepdims=True)), axis=-1) * 100
    Qg, low = ground(ik, Qf, planted)
    np.savez_compressed(dst, qpos60=Qg.astype(np.float32), fk_err=err.astype(np.float32),
                        raw_err=raw_err.astype(np.float32), targets=tg.astype(np.float32),
                        planted=planted, foot_low=low.astype(np.float32), bpm=clip_bpm(name),
                        scale=info["scale"], dancer_leg=info["dancer_leg"], fit_names=np.array(hm.FIT))
    return name, f"T={len(kp)} err={err.mean():.2f}cm p95={np.percentile(err, 95):.2f} ({time.time() - t0:.0f}s)"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", default="data/raw/aistpp")
    ap.add_argument("--out", default="data/interim/retarget")
    ap.add_argument("--genres", default="gMH,gLH")
    ap.add_argument("--only", default=None, help="substring filter on clip names")
    ap.add_argument("--workers", type=int, default=7)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    ignore = set()
    ig = os.path.join(a.raw, "ignore_list.txt")
    if os.path.exists(ig):
        ignore = {l.strip() for l in open(ig) if l.strip()}
    files = []
    for g in a.genres.split(","):
        for f in sorted(glob.glob(os.path.join(a.raw, "keypoints3d", f"{g}_*.pkl"))):
            n = os.path.basename(f)[:-4]
            if n in ignore or (a.only and a.only not in n):
                continue
            files.append(f)
    print(f"{len(files)} clips -> {a.out}")
    with Pool(a.workers) as p:
        for name, msg in p.imap_unordered(process, [(f, a.out) for f in files]):
            print(name, msg, flush=True)


if __name__ == "__main__":
    main()
