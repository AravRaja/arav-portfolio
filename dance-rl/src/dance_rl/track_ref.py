"""Phase 2 reference motion for the tracking env: library adapter, kinematic precompute, choreographer.

Pure numpy + CPU MuJoCo (runs once at env construction); the env turns the arrays into jnp.

    # synthetic stand-in library (real humanoid motion: 2-bar slices of a phase-1 rollout + mirrored copies)
    python -m dance_rl.track_ref --synth-from runs/s6_c/rollout.npz --out runs/synth_lib/moves.npz
    # inspect a library (moves, lengths, sizes, the choreographer's schedule for the song)
    python -m dance_rl.track_ref --library data/library/moves.npz --features features/now-get-busy.v2.features.npz

Library source. `load_library(path)` uses `dance_rl.motion_lib.MotionLibrary.load(path)` when that module
exists (written by the data pipeline) and converts it with `RefLib.from_obj`; otherwise (or if that fails) it
reads the npz directly. Both paths accept the same field names (first match wins):
    qpos      (N, T, 28)  or a length-N list/object array of (T_i, 28)      [required]
    qvel      (N, T, 27)  or list                                           [finite-differenced if missing]
    contacts  "contacts" | "foot_contacts" | "contact"  (N, T, 2)            [optional]
    length    "length" | "lengths" | "n_frames"  (N,)                         [else T_i of each move]
    names     "names" | "move_names" | "move_id" | "move_ids" | "ids"         [optional]
    mirror    "mirror_of" | "mirror_idx" | "mirror_index" | "mirror_id"  (N,) index of the mirrored copy
              (-1 = none); else names ending in "_mirror"/"_m"/"_mir" are paired with their base name
    upper / lower joint index sets: only checked against the name-based sets below (indices into the 21
              hinge joints, or into qpos (offset 7) / qvel (offset 6) -- the offset is detected)
A move's frame 0 is the downbeat that starts its 2-bar unit (moves are beat-aligned 8-counts, 212-213 frames).

Frames used by the tracking terms (`ee_split`): head and hands relative to the TORSO (the free-joint root body)
in the torso frame, feet relative to the PELVIS in the pelvis frame. Head/hand positions in the torso frame
depend only on the upper joints (abdomen + arms) and feet in the pelvis frame only on the leg joints, so a
fused target (upper body of move i, lower body of move j) is exactly the forward kinematics of the fused pose
without running FK in the env. AMP features use all five end effectors in the torso frame.
"""
from __future__ import annotations

import argparse
import os
from dataclasses import dataclass, field

import mujoco
import numpy as np

from dance_rl import song

FPS = song.FPS
EIGHT_FRAMES = song.EIGHT * FPS            # 212.5 song rows per 2-bar unit
EE_BODIES = ["head", "left_hand", "right_hand", "left_foot", "right_foot"]
UPPER_EE = np.array([0, 1, 2])              # head, hands  -> torso frame, upper move
LOWER_EE = np.array([3, 4])                 # feet         -> pelvis frame, lower move
UPPER_PREFIX = ("abdomen_", "left_shoulder", "right_shoulder", "left_elbow", "right_elbow")
AMP_FEAT_DIM = 21 + 21 + 1 + 3 + 15 + 3 + 3  # q, qd, root z, gravity (torso frame), ee (torso frame), lin/ang vel (torso frame)
CODE_DIM = 8


def upper_lower_sets(joint_names):
    names = [str(n) for n in joint_names]
    up = np.array([i for i, n in enumerate(names) if n.startswith(UPPER_PREFIX)], np.int32)
    lo = np.array([i for i, n in enumerate(names) if i not in set(up.tolist())], np.int32)
    return up, lo


# ---------------------------------------------------------------------- library adapter
def _get(obj, names, default=None):
    for n in names:
        try:
            if hasattr(obj, "files") and n not in obj.files:      # np.load npz
                continue
            v = obj[n]
            return v
        except (KeyError, TypeError, IndexError, ValueError):
            pass
        if hasattr(obj, n):
            v = getattr(obj, n)
            if not callable(v):
                return v
    return default


def _ragged(x):
    """(N, T, D) array or list of (T_i, D) -> list of float32 arrays."""
    if x is None:
        return None
    if isinstance(x, np.ndarray) and x.dtype != object and x.ndim == 3:
        return [np.asarray(a, np.float32) for a in x]
    return [np.asarray(a, np.float32) for a in list(x)]


def _qvel_from_qpos(m: mujoco.MjModel, qpos: np.ndarray) -> np.ndarray:
    """Central-difference qvel (nv) of a qpos sequence with MuJoCo's own quaternion difference."""
    T = len(qpos)
    v = np.zeros((T, m.nv), np.float64)
    dt = 1.0 / FPS
    for t in range(T):
        a, b = max(t - 1, 0), min(t + 1, T - 1)
        if b == a:
            continue
        mujoco.mj_differentiatePos(m, v[t], (b - a) * dt, qpos[a].astype(np.float64), qpos[b].astype(np.float64))
    return v.astype(np.float32)


@dataclass
class RefLib:
    qpos: list                      # N x (T_i, 28)
    qvel: list                      # N x (T_i, 27)
    contacts: list | None
    names: list
    mirror_of: np.ndarray           # (N,) int, -1 = no mirrored copy known
    source: str = ""
    notes: list = field(default_factory=list)

    @property
    def n(self):
        return len(self.qpos)

    @property
    def lengths(self):
        return np.array([len(q) for q in self.qpos], np.int32)

    @staticmethod
    def from_obj(obj, model: mujoco.MjModel | None = None, source="") -> "RefLib":
        notes = []
        qpos = _get(obj, ["qpos"])
        if qpos is None and _get(obj, ["moves"]) is not None:          # list of per-move records
            mv = list(_get(obj, ["moves"]))
            qpos = [np.asarray(_get(r, ["qpos"]), np.float32) for r in mv]
            qvel = [_get(r, ["qvel"]) for r in mv]
            qvel = None if any(v is None for v in qvel) else qvel
            con = [_get(r, ["contacts", "foot_contacts", "contact"]) for r in mv]
            con = None if any(c is None for c in con) else con
            names = [str(_get(r, ["name", "move_id", "id"], i)) for i, r in enumerate(mv)]
            mir = [_get(r, ["mirror_of", "mirror_idx", "mirror_index", "mirror_id"], -1) for r in mv]
            lens = None
        else:
            if qpos is None:
                raise ValueError("motion library has no `qpos`")
            qvel = _get(obj, ["qvel"])
            con = _get(obj, ["contacts", "foot_contacts", "contact"])
            names = _get(obj, ["names", "move_names", "move_id", "move_ids", "ids"])
            mir = _get(obj, ["mirror_of", "mirror_idx", "mirror_index", "mirror_id"])
            lens = _get(obj, ["length", "lengths", "n_frames"])
        qpos = _ragged(qpos)
        N = len(qpos)
        if lens is not None:
            lens = np.asarray(lens).astype(int).reshape(-1)
            qpos = [q[:L] for q, L in zip(qpos, lens)]
        assert all(q.shape[1] == 28 for q in qpos), "qpos must be (T, 28) per move (7 root + 21 hinge)"
        if qvel is None:
            if model is None:
                raise ValueError("library has no qvel; pass the MuJoCo model to difference qpos")
            qvel = [_qvel_from_qpos(model, q) for q in qpos]
            notes.append("qvel finite-differenced from qpos")
        else:
            qvel = [v[:len(q)] for v, q in zip(_ragged(qvel), qpos)]
        con = None if con is None else [c[:len(q)] for c, q in zip(_ragged(con), qpos)]
        names = [str(x) for x in (np.asarray(names).reshape(-1).tolist() if names is not None else range(N))]
        if mir is not None:
            mir = np.asarray(mir).astype(int).reshape(-1)
        else:
            mir = -np.ones(N, int)
            base = {}
            for i, nm in enumerate(names):
                for suf in ("_mirror", "_mir", "_m"):
                    if nm.endswith(suf):
                        base[nm[: -len(suf)]] = i
            for i, nm in enumerate(names):
                if nm in base:
                    mir[i], mir[base[nm]] = base[nm], i
            if (mir < 0).all():
                notes.append("no mirror pairing found (mirror_of = -1 for every move)")
        return RefLib(qpos, qvel, con, names, mir.astype(np.int32), source, notes)


DEFAULT_FILTER = dict(in_place=None, max_speed_factor=None, genre=None, style=None, min_loopability=None,
                      max_pelvis_drop=None, ids=None, max_moves=None)


def select_moves(lib, filt: dict | None) -> list:
    """Indices of a MotionLibrary's moves passing `filt` (track.filter; manifest metadata):
    in_place (bool), max_speed_factor (time-warp factor to 112.9 BPM, e.g. 1.2 drops the 1.25 / 1.41 clips),
    genre / style (AIST++ codes, e.g. gMH, gLH), min_loopability, max_pelvis_drop (m below the 0.86 m stand,
    via pelvis_z_min), ids (explicit list), max_moves (first n after filtering)."""
    f = dict(DEFAULT_FILTER)
    f.update(filt or {})
    unknown = set(filt or {}) - set(DEFAULT_FILTER)
    if unknown:
        raise ValueError(f"unknown track.filter keys: {unknown}")
    keep = []
    for i, mid in enumerate(lib.ids):
        md = lib.meta.get(mid, {})
        if f["ids"] is not None and mid not in set(f["ids"]):
            continue
        if f["in_place"] is not None and md.get("in_place") != f["in_place"]:
            continue
        if f["max_speed_factor"] is not None and md.get("speed_factor", 1.0) > f["max_speed_factor"] + 1e-6:
            continue
        if f["genre"] is not None and md.get("genre") != f["genre"]:
            continue
        if f["style"] is not None and md.get("style") != f["style"]:
            continue
        if f["min_loopability"] is not None and md.get("loopability", 0.0) < f["min_loopability"]:
            continue
        if f["max_pelvis_drop"] is not None and 0.86 - md.get("pelvis_z_min", 0.86) > f["max_pelvis_drop"]:
            continue
        keep.append(i)
    if f["max_moves"] is not None:
        keep = keep[: int(f["max_moves"])]
    if not keep:
        raise ValueError(f"track.filter {filt} keeps no moves")
    return keep


def _from_motion_library(lib, filt, source) -> RefLib:
    """dance_rl.motion_lib.MotionLibrary -> RefLib: the selected moves, then their mirrored copies
    (`qpos_mirror` etc.; names <id>_M), mirror_of pairing i <-> i + K."""
    sel = select_moves(lib, filt)
    K = len(sel)
    qpos = [lib.qpos[i] for i in sel] + [lib.qpos_mirror[i] for i in sel]
    qvel = [lib.qvel[i] for i in sel] + [lib.qvel_mirror[i] for i in sel]
    con = [lib.contacts[i].astype(np.float32) for i in sel] + [lib.contacts_mirror[i].astype(np.float32) for i in sel]
    names = [lib.ids[i] for i in sel] + [lib.ids[i] + "_M" for i in sel]
    mir = np.concatenate([np.arange(K) + K, np.arange(K)]).astype(np.int32)
    notes = [f"{K} of {len(lib.ids)} moves pass track.filter {filt or {}}; + {K} mirrored copies"]
    notes += check_upper_lower({"upper": lib.upper_qpos_idx, "lower": lib.lower_qpos_idx}, lib.joint_names)
    return RefLib([np.asarray(q, np.float32) for q in qpos], [np.asarray(v, np.float32) for v in qvel], con, names,
                  mir, source, notes)


def load_library(path: str, model: mujoco.MjModel | None = None, filt: dict | None = None) -> RefLib:
    """The phase-2 library through dance_rl.motion_lib.MotionLibrary when the file has its layout
    (qpos + qpos_mirror, manifest.json next to it; `filt` = track.filter); any other npz with the generic
    field names in the module docstring (e.g. the synthetic stand-in) is read directly (no filter)."""
    with np.load(path, allow_pickle=False) as z:
        has_ml = "qpos_mirror" in z.files and "ids" in z.files
    if has_ml:
        from dance_rl.motion_lib import MotionLibrary
        return _from_motion_library(MotionLibrary.load(path), filt, f"MotionLibrary.load({path})")
    if filt:
        raise ValueError("track.filter needs a MotionLibrary file (manifest metadata)")
    d = np.load(path, allow_pickle=False)
    return RefLib.from_obj(d, model, source=f"np.load({path})")


def check_upper_lower(obj, joint_names):
    """Compare a library's upper/lower index sets (if it has them) with the name-based ones."""
    up, lo = upper_lower_sets(joint_names)
    out = []
    for key, ref in ((("upper", "upper_idx", "upper_joints"), up), (("lower", "lower_idx", "lower_joints"), lo)):
        v = _get(obj, list(key))
        if v is None:
            continue
        v = np.sort(np.asarray(v).astype(int).reshape(-1))
        ok = any(np.array_equal(v - off, np.sort(ref)) for off in (0, 6, 7))
        out.append(f"{key[0]}: {'matches' if ok else 'DIFFERS from'} the name-based set")
    return out


# ---------------------------------------------------------------------- kinematics
def _yaw_of_quat(q):
    w, x, y, z = q[..., 0], q[..., 1], q[..., 2], q[..., 3]
    return np.arctan2(2 * (x * y + w * z), 1 - 2 * (y ** 2 + z ** 2))


def _quat_mul(a, b):
    w1, x1, y1, z1 = a
    w2, x2, y2, z2 = b
    return np.array([w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2, w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2,
                     w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2, w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2])


def frame_kinematics(m: mujoco.MjModel, qpos: np.ndarray, qvel: np.ndarray, foot_geoms):
    """Per-frame reference quantities of one move (numpy). See module docstring for the frames."""
    d = mujoco.MjData(m)
    bid = lambda n: mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_BODY, n)
    torso, pelvis = bid("torso"), bid("pelvis")
    ee = np.array([bid(n) for n in EE_BODIES])
    T = len(qpos)
    out = dict(ee_split=np.zeros((T, 5, 3)), ee_torso=np.zeros((T, 5, 3)), ee_world=np.zeros((T, 5, 3)),
               grav=np.zeros((T, 3)), z=np.zeros(T), low=np.zeros(T), linvel_body=np.zeros((T, 3)),
               pz=np.zeros(T),
               vh=np.zeros((T, 3)), wz=np.zeros(T), yaw=np.zeros(T),
               pel_quat=np.zeros((T, 4)), rel_q=np.zeros((T, 4)), rel_t=np.zeros((T, 3)))
    for t in range(T):
        d.qpos[:] = qpos[t]
        mujoco.mj_kinematics(m, d)
        R = d.xmat[torso].reshape(3, 3)
        Rp = d.xmat[pelvis].reshape(3, 3)
        p0, pp = d.xpos[torso], d.xpos[pelvis]
        P = d.xpos[ee]
        out["ee_torso"][t] = (P - p0) @ R
        out["ee_split"][t, UPPER_EE] = (P[UPPER_EE] - p0) @ R
        out["ee_split"][t, LOWER_EE] = (P[LOWER_EE] - pp) @ Rp
        out["ee_world"][t] = P
        # round 3 (track.fused_target: fk): pelvis world orientation, pelvis pose in the torso frame
        qt, qp_ = d.xquat[torso].copy(), d.xquat[pelvis].copy()
        out["pel_quat"][t] = qp_
        out["rel_q"][t] = _quat_mul(qt * np.array([1, -1, -1, -1]), qp_)
        out["rel_t"][t] = (pp - p0) @ R
        out["grav"][t] = R.T @ np.array([0.0, 0.0, -1.0])
        out["z"][t] = qpos[t, 2]
        out["pz"][t] = pp[2]
        v = qvel[t, 0:3]
        out["linvel_body"][t] = R.T @ v
        hx = R[0:2, 0] / (np.linalg.norm(R[0:2, 0]) + 1e-6)
        out["yaw"][t] = np.arctan2(hx[1], hx[0])
        out["vh"][t] = np.array([v[0] * hx[0] + v[1] * hx[1], -v[0] * hx[1] + v[1] * hx[0], v[2]])
        out["wz"][t] = (R @ qvel[t, 3:6])[2]
        lows = []
        for g in foot_geoms:
            r = m.geom_size[g, 0]
            if m.geom_type[g] == mujoco.mjtGeom.mjGEOM_CAPSULE:
                lows.append(d.geom_xpos[g, 2] - abs(d.geom_xmat[g].reshape(3, 3)[2, 2]) * m.geom_size[g, 1] - r)
            else:
                lows.append(d.geom_xpos[g, 2] - r)
        out["low"][t] = min(lows)
    return out


def amp_features_np(q, qd, z, grav, ee_torso, linvel_body, angvel_body):
    """(T, AMP_FEAT_DIM) per-frame AMP features; the env computes the same vector from MJX data."""
    T = len(q)
    return np.concatenate([q, qd, z.reshape(T, 1), grav, ee_torso.reshape(T, 15), linvel_body, angvel_body],
                          axis=1).astype(np.float32)


def move_codes(n: int, mirror_of: np.ndarray, seed: int = 0) -> np.ndarray:
    """(n + 1, 8) fixed move codes (row n = idle). code = [a (4), b (4)] / sqrt(2), a, b ~ N(0, 1/4 I) seeded by
    the pair's canonical id; a move's mirrored copy gets [a, -b], so mirroring the observation is a fixed sign
    flip of dims 4..7 (rollout --mirror-odd-units). Idle = 0; moves without a known mirror get their own (a, b)."""
    codes = np.zeros((n + 1, CODE_DIM), np.float32)
    for i in range(n):
        j = int(mirror_of[i]) if mirror_of[i] >= 0 else i
        c = min(i, j)
        r = np.random.default_rng([seed, c])
        a, b = r.normal(0, 0.5, 4), r.normal(0, 0.5, 4)
        sgn = -1.0 if (j != i and i != c) else 1.0
        codes[i] = np.concatenate([a, sgn * b]) / np.sqrt(2)
    return codes


@dataclass
class RefArrays:
    """Stacked per-frame reference arrays, (n_moves + 1, Tm, ...); the last move is IDLE (standing still)."""
    q: np.ndarray            # (M, Tm, 21)
    qd: np.ndarray           # (M, Tm, 21)
    z: np.ndarray            # (M, Tm)   torso (root) height
    pz: np.ndarray           # (M, Tm)   pelvis height (reference-relative fall check)
    grav: np.ndarray         # (M, Tm, 3) gravity in the torso frame
    ee: np.ndarray           # (M, Tm, 5, 3) ee_split
    vh: np.ndarray           # (M, Tm, 3) root linear velocity in the heading frame
    wz: np.ndarray           # (M, Tm)   world yaw rate
    rsi_qpos: np.ndarray     # (M, Tm, 28) yaw-normalised (frame 0 of the move faces +x), xy = spawn, feet on floor
    rsi_qvel: np.ndarray     # (M, Tm, 27) root linear velocity rotated with it
    amp: np.ndarray          # (M, Tm, AMP_FEAT_DIM)
    length: np.ndarray       # (M,)
    code: np.ndarray         # (M, 8)
    size: np.ndarray         # (n_moves,) choreographer size score (z-scored ee speed + travel)
    mirror_of: np.ndarray    # (n_moves,)
    names: list
    idle: int
    ee_speed: np.ndarray = None  # (M, Tm, 5) speed (m/s) of the ee_split positions (head/hands in the torso frame,
                                 # feet in the pelvis frame; central difference) -> track.err_weighting: energy
    pel_q: np.ndarray = None     # (M, Tm, 4) pelvis world quaternion in the yaw-normalised RSI frame  } round 3,
    rel_q: np.ndarray = None     # (M, Tm, 4) pelvis orientation in the torso frame (abdomen only)     } track.
    rel_t: np.ndarray = None     # (M, Tm, 3) pelvis position in the torso frame (abdomen only)        } fused_target fk


def build_arrays(lib: RefLib, m: mujoco.MjModel, qpos0: np.ndarray, foot_geoms, seed: int = 0) -> RefArrays:
    N = lib.n
    L = lib.lengths
    Tm = int(max(L.max(), int(np.ceil(EIGHT_FRAMES))))
    M = N + 1
    A = dict(q=np.zeros((M, Tm, 21)), qd=np.zeros((M, Tm, 21)), z=np.zeros((M, Tm)), pz=np.zeros((M, Tm)),
             grav=np.zeros((M, Tm, 3)),
             ee=np.zeros((M, Tm, 5, 3)), vh=np.zeros((M, Tm, 3)), wz=np.zeros((M, Tm)),
             rsi_qpos=np.zeros((M, Tm, 28)), rsi_qvel=np.zeros((M, Tm, 27)), amp=np.zeros((M, Tm, AMP_FEAT_DIM)),
             pel_q=np.zeros((M, Tm, 4)), rel_q=np.zeros((M, Tm, 4)), rel_t=np.zeros((M, Tm, 3)))
    speed, travel = np.zeros(N), np.zeros(N)
    ee_speed = np.zeros((M, Tm, 5))
    seqs = [(lib.qpos[i], lib.qvel[i]) for i in range(N)]
    idle_T = int(np.ceil(EIGHT_FRAMES))
    seqs.append((np.repeat(qpos0[None].astype(np.float32), idle_T, 0), np.zeros((idle_T, 27), np.float32)))
    lengths = np.concatenate([L, [idle_T]]).astype(np.int32)
    for i, (qp, qv) in enumerate(seqs):
        k = frame_kinematics(m, qp, qv, foot_geoms)
        T = len(qp)
        pad = lambda x: np.concatenate([x, np.repeat(x[-1:], Tm - T, 0)], 0) if T < Tm else x[:Tm]
        A["q"][i], A["qd"][i] = pad(qp[:, 7:]), pad(qv[:, 6:])
        A["z"][i], A["grav"][i], A["ee"][i] = pad(k["z"]), pad(k["grav"]), pad(k["ee_split"])
        A["pz"][i] = pad(k["pz"])
        es = np.zeros((T, 5))
        if T > 2:
            es[1:-1] = np.linalg.norm(k["ee_split"][2:] - k["ee_split"][:-2], axis=-1) * FPS / 2
            es[0], es[-1] = es[1], es[-2]
        ee_speed[i] = pad(es)
        A["vh"][i], A["wz"][i] = pad(k["vh"]), pad(k["wz"])
        A["amp"][i] = pad(amp_features_np(qp[:, 7:], qv[:, 6:], k["z"], k["grav"], k["ee_torso"],
                                          k["linvel_body"], qv[:, 3:6]))
        # RSI state: rotate the root so frame 0 of the move faces +x, put it on the spawn point and lift it so
        # the lowest foot point is >= 2 mm above the floor (a frame where the reference floats stays as is)
        y0 = k["yaw"][0]
        c, s = np.cos(-y0), np.sin(-y0)
        Rz = np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])
        rq = np.zeros_like(qp)
        rv = qv.copy()
        qz = np.array([np.cos(-y0 / 2), 0, 0, np.sin(-y0 / 2)])
        for t in range(T):
            rq[t, 0:2] = qpos0[0:2]
            rq[t, 2] = qp[t, 2] + max(0.0, 0.002 - k["low"][t])
            rq[t, 3:7] = _quat_mul(qz, qp[t, 3:7])
            rq[t, 7:] = qp[t, 7:]
            rv[t, 0:3] = Rz @ qv[t, 0:3]
        A["rsi_qpos"][i], A["rsi_qvel"][i] = pad(rq), pad(rv)
        A["pel_q"][i] = pad(np.stack([_quat_mul(qz, x) for x in k["pel_quat"]]))
        A["rel_q"][i], A["rel_t"][i] = pad(k["rel_q"]), pad(k["rel_t"])
        if i < N:
            ew = k["ee_world"]
            speed[i] = np.linalg.norm(np.diff(ew, axis=0), axis=-1).mean() * FPS
            travel[i] = np.linalg.norm(qp[-1, 0:2] - qp[0, 0:2]) + np.abs(np.diff(k["yaw"])).sum() * 0.3
    zs = lambda x: (x - x.mean()) / (x.std() + 1e-6)
    size = zs(speed) + 0.5 * zs(travel) if N > 1 else np.zeros(N)
    return RefArrays(**{k: v.astype(np.float32) for k, v in A.items()}, length=lengths,
                     code=move_codes(N, lib.mirror_of, seed), size=size.astype(np.float32),
                     mirror_of=lib.mirror_of.astype(np.int32), names=list(lib.names), idle=N,
                     ee_speed=ee_speed.astype(np.float32))


# ---------------------------------------------------------------------- song units + choreographer
def song_units(table: np.ndarray, anchor: float = song.GRID_ANCHOR_V2):
    """Per 8-count unit of the song (unit u starts at anchor + u * 4.25 s): mean energy, breakdown fraction,
    v2 section id. Returns (n_units, energy, breakdown, section)."""
    from dance_rl.env import section_ids
    c = song.COL_V2
    T = len(table)
    t = np.arange(T) / FPS
    u = np.floor((t - anchor) / song.EIGHT).astype(int)
    n = int(u.max()) + 1
    sec = section_ids(table)
    E, B, S = np.zeros(n), np.zeros(n), np.zeros(n, int)
    for k in range(n):
        sel = u == k
        E[k] = table[sel, c["energy"]].mean()
        B[k] = table[sel, c["is_breakdown"]].mean()
        S[k] = np.bincount(sec[sel]).argmax()
    return n, E, B, S


def choreograph(table: np.ndarray, ref: RefArrays, mode: str = "section_energy", seed: int = 0,
                anchor: float = song.GRID_ANCHOR_V2):
    """Deterministic per-8-count move schedule for the song.

    section_energy: moves are ranked by `ref.size` (ee speed + travel/turning, z-scored) into three tiers
    (small / medium / large); a unit in a breakdown (is_breakdown > 0.5) takes a small move, a unit whose mean
    energy is in the top third of the song's units a large one, the rest medium. Within a section the units
    run A, A', B, B', A, A', ... where A and B are the next two moves of that tier (a per-tier rotating cursor,
    so consecutive sections use different moves) and X' is X's mirrored copy when the library has one.
    Returns (lower (n_units,), upper (n_units,)): `upper` is a second, independent schedule over all
    non-mirror moves (used only by fusion at rollout time, `track.fusion_schedule`)."""
    if mode != "section_energy":
        raise ValueError(f"unknown choreographer {mode!r}")
    n_units, E, B, S = song_units(table, anchor)
    N = ref.idle
    mir = ref.mirror_of
    base = np.array([i for i in range(N) if mir[i] < 0 or i < mir[i]])     # one of each mirror pair
    order = base[np.argsort(ref.size[base], kind="stable")]
    tiers = [t for t in np.array_split(order, 3)]
    tiers = [t if len(t) else order for t in tiers]
    hi_e = np.quantile(E, 2.0 / 3.0)
    cursor = [0, 0, 0]
    lower = np.zeros(n_units, np.int32)
    sec_start = 0
    pair = None
    for u in range(n_units):
        if u == 0 or S[u] != S[u - 1]:
            sec_start = u
            su = S == S[u]                   # tier from the section's breakdown share / mean energy
            tier = 0 if B[su].mean() > 0.5 else (2 if E[su].mean() >= hi_e else 1)
            tl = tiers[tier]
            a = tl[cursor[tier] % len(tl)]
            b = tl[(cursor[tier] + 1) % len(tl)]
            cursor[tier] += 2
            pair = (a, b)
        k = u - sec_start
        mv = pair[(k // 2) % 2]
        if k % 2 == 1 and mir[mv] >= 0:
            mv = mir[mv]
        lower[u] = mv
    rng = np.random.default_rng(seed + 1)
    upper = rng.choice(base, size=n_units) if len(base) else lower.copy()
    return lower, upper.astype(np.int32)


# ---------------------------------------------------------------------- synthetic library
def synth_from_rollout(rollout: str, out: str, units=(4, 9, 15, 22), seed: int = 0):
    """Stand-in library: 2-bar (8-count) slices of a phase-1 full-song rollout starting on v2 unit boundaries,
    plus a left/right-mirrored copy of each (dance_rl.mirror for the joints; root y -> -y, quat (w,-x,y,-z)).
    qvel by MuJoCo finite differences."""
    from dance_rl.env import load_model
    from dance_rl.mirror import mirror_perm_sign

    d = np.load(rollout)
    qpos = d["qpos"].astype(np.float64)
    names = [str(n) for n in d["joint_names"]]
    m = load_model(0.004)
    perm, sign = mirror_perm_sign(names)
    moves, mvel, cons, nm = [], [], [], []
    for k, u in enumerate(units):
        r0 = int(round((song.GRID_ANCHOR_V2 + u * song.EIGHT) * FPS))
        L = 212 + (k % 2)
        q = qpos[r0:r0 + L].copy()
        q[:, 0:2] -= q[0, 0:2]
        qm = q.copy()
        qm[:, 1] *= -1
        qm[:, 3:7] = q[:, 3:7] * np.array([1, -1, 1, -1])
        qm[:, 7:] = q[:, 7:][:, perm] * sign
        c = d["contacts"][r0:r0 + L]
        for qq, cc, tag in ((q, c, ""), (qm, c[:, ::-1], "_mirror")):
            moves.append(qq.astype(np.float32))
            mvel.append(_qvel_from_qpos(m, qq))
            cons.append(cc.astype(np.float32))
            nm.append(f"s6c_u{u:02d}{tag}")
    N = len(moves)
    Tm = max(len(x) for x in moves)
    padn = lambda xs: np.stack([np.concatenate([x, np.repeat(x[-1:], Tm - len(x), 0)]) for x in xs])
    mirror_of = np.array([i + 1 if i % 2 == 0 else i - 1 for i in range(N)], np.int32)
    t = np.arange(Tm) / FPS
    bp, brp = song.grid_phases(t, anchor=0.0)
    up, lo = upper_lower_sets(names)
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    np.savez_compressed(out, qpos=padn(moves), qvel=padn(mvel), contacts=padn(cons),
                        length=np.array([len(x) for x in moves], np.int32), names=np.array(nm),
                        move_id=np.arange(N), mirror_of=mirror_of,
                        beat_phase=np.repeat(bp[None], N, 0).astype(np.float32),
                        bar_phase=np.repeat(brp[None], N, 0).astype(np.float32),
                        upper=up, lower=lo, joint_names=np.array(names), synthetic=np.bool_(True),
                        source=np.array(os.path.abspath(rollout)))
    print(f"wrote {out}: {N} moves ({len(units)} slices of {rollout} + mirrored copies), lengths "
          f"{[len(x) for x in moves]}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--synth-from", default=None, help="phase-1 rollout.npz to slice into a stand-in library")
    ap.add_argument("--out", default="runs/synth_lib/moves.npz")
    ap.add_argument("--library", default=None)
    ap.add_argument("--features", default="features/now-get-busy.v2.features.npz")
    ap.add_argument("--in-place", action="store_true")
    ap.add_argument("--max-speed-factor", type=float, default=None)
    a = ap.parse_args()
    if a.synth_from:
        synth_from_rollout(a.synth_from, a.out)
        return
    from dance_rl.env import load_model, standing_qpos
    m = load_model(0.004)
    fg = [g for g in range(m.ngeom) if mujoco.mj_id2name(m, mujoco.mjtObj.mjOBJ_BODY, m.geom_bodyid[g])
          in ("left_foot", "right_foot")]
    filt = {k: v for k, v in dict(in_place=True if a.in_place else None,
                                   max_speed_factor=a.max_speed_factor).items() if v is not None}
    lib = load_library(a.library, m, filt or None)
    print(lib.source, "|", lib.n, "moves, lengths", sorted(set(lib.lengths.tolist())), "|", *lib.notes)
    ref = build_arrays(lib, m, standing_qpos(m, fg), fg)
    for i in range(min(lib.n, 40)):
        print(f"  {i:3d} {lib.names[i]:<28s} L={ref.length[i]} size={ref.size[i]:+.2f} mirror={lib.mirror_of[i]}")
    table = song.load_table(a.features)
    lo, upv = choreograph(table, ref)
    print("schedule (lower):", lo.tolist())
    print("schedule (upper, fusion):", upv.tolist())


if __name__ == "__main__":
    main()
