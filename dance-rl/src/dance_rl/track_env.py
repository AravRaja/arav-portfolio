"""Phase 2 tracking env (PLAN section 14, S5-S7): DanceEnv + DeepMimic-style motion tracking.

Config: top-level `mode: track`, a `track:` block (DEFAULT_TRACK below), optional `amp:` block (dance_rl.amp),
and the tracking weights in `reward_weights` next to the phase-1 terms (track_pose, track_vel, track_ee,
track_root, track_fail). Every phase-1 term keeps working with its weight, so a config can blend them.

Reference timing. Moves are 2-bar beat-aligned 8-counts. Song unit u starts at GRID_ANCHOR_V2 + u * 4.25 s
(v2 grid). At song row r the reference is move(u(r)) at frame min(floor(pos(r) * 212.5), L - 1), pos = position
in the unit (0..1). Rows before unit 0 (the intro, up to 8.63 s) track IDLE (standing still, the phase-1 wait).
move(u):
  - `track.choreo: section_energy`: the deterministic per-8-count song schedule (track_ref.choreograph)
  - otherwise each episode draws n ~ U{sequence[0]..sequence[1]} moves (uniform, or `move_weights`) and cycles
    them over its units: n = 1 loops one move, n = 2-3 practises transitions
  - fusion: `track.fusion: {upper_move: i, lower_move: j}` fixes the pair; `fusion_random: true` draws an
    independent upper move per unit slot (training) or uses the choreographer's second schedule
    (`fusion_schedule: true`, set by rollout). Upper joints (abdomen + arms) and head/hand targets come from the
    upper move, legs / feet / root from the lower move; both share the unit phase.

Reset = reference-state init (`rsi_prob`): the physics starts at the reference pose of the start row (yaw-
normalised, spawn xy, feet on the floor) + uniform joint noise `rsi_noise`, with the reference velocity.
Early termination (done, `track_fail` = 1): rms joint error > `term_rms` rad, or root height below the
reference by more than `term_height`, outside the `term_grace` steps after the episode start and after every
unit boundary (references jump between moves there). The phase-1 fall (pelvis z < fall_height) still applies.
Training uses wrap_for_track_training (a FULL reset on done: the physics must restart at the new episode's
reference pose, which Brax's cached-first-state reset can't do).

Obs = phase-1 obs (unchanged, first) + TRACK block appended at the END (so pad_obs_params grows a phase-1
checkpoint with zero first-layer rows):
  phase sin/cos (2) | q_ref(r+1) - q (21) | q_ref(r+5) - q (21) | q_ref(r+10) - q (21) | code(upper) (8) | code(lower) (8)
= 81. Move id = a fixed 8-dim random code per move (not one-hot): the library size is open-ended (AIST++ gHO
slices + mirrored copies can exceed 64), the obs width stays fixed as the library grows, the target block already
carries the pose, and the code is mirror-equivariant (mirrored copy = [a, -b], see track_ref.move_codes).

Rewards (raw values in info["track_terms"], weighted in metrics r_<term>):
  track_pose = exp(-s_pose * sum (q - q_ref)^2)                     s_pose 2
  track_vel  = exp(-s_vel  * sum (qd - qd_ref)^2)                   s_vel 0.1
  track_ee   = exp(-s_ee   * sum |p - p_ref|^2) head/hands in the torso frame, feet in the pelvis frame   s_ee 40
  track_root = exp(-s_h (z - z_ref)^2 - s_ori |g - g_ref|^2 - s_yaw (wz - wz_ref)^2 [- s_xy |v_h - v_h_ref|^2])
               g = gravity in the torso frame (tilt; heading is free: the camera-facing `facing` term owns it),
               wz = world yaw rate (turns), v_h = heading-frame root velocity (only with track_root_xy)
  track_fail = 1 on the early-termination step (weight <= 0, default 0)
Round 2 (phase 2; all default off, round-1 configs reproduce bit-exactly):
  track_tilt = exp(-s_tilt |g - g_ref|^2)                           torso tilt as its own term (s_tilt 10)
  track_yaw  = exp(-s_yaw_abs wrap(yaw - yaw_ref)^2)  (track.heading_mode: abs; yaw_ref = reference root yaw,
               each move re-rooted to face +x = the camera at frame 0; set reward_weights.facing 0 with it)
  ankle_rate = sum over the 4 ankle joints of (qd(t) - qd(t-1))^2   (weight < 0: the AMP discriminator keys on it)
  track.penalty_scale / upright_scale scale the phase-1 penalties / upright; track.err_weighting: energy multiplies
  the positive tracking terms by (1 + v_ref / mean v_ref) / 2; track.root_obs appends ROOT_OBS obs dims;
  track.fusion_reset: grounded + fusion_abdomen: lower fix the fused RSI state (see DEFAULT_TRACK).
"""
from __future__ import annotations

import os
from typing import Any, Dict, Optional

import jax
import jax.numpy as jp
import numpy as np
from brax.envs.wrappers import training as brax_training
from mujoco_playground._src import mjx_env
from mujoco_playground._src import wrapper as pg_wrapper

from dance_rl import song, track_ref
from dance_rl.env import TERMS, DanceEnv, feature_bank_from_config

TRACK_TERMS = ["track_pose", "track_vel", "track_ee", "track_root", "track_fail", "track_tilt", "track_yaw", "ankle_rate"]
POS_TRACK = ["track_pose", "track_vel", "track_ee", "track_root", "track_tilt", "track_yaw"]   # err_weighting scales these
PENALTY_TERMS = ["torque", "action_rate", "joint_limits", "foot_slide"]                       # track.penalty_scale
TRACK_METRICS = ["track_pose_err", "track_ee_err"]
TRACK_OBS = 2 + 3 * 21 + 2 * track_ref.CODE_DIM
ROOT_OBS = 3 * 5                 # track.root_obs: per lookahead [sin, cos](yaw_ref - yaw), g_ref - g (torso frame)
DEFAULT_TRACK = dict(
    library="data/library/moves.npz",
    filter=None,                 # MotionLibrary subset: {in_place, max_speed_factor, genre, style, min_loopability,
                                 # max_pelvis_drop, ids, max_moves} (track_ref.select_moves); mirrors are added
    sequence=[1, 3],             # moves per episode, cycled per 8-count
    move_weights=None,           # None = uniform over the library, else one weight per move
    choreo=None,                 # "section_energy" = deterministic song schedule (track_ref.choreograph)
    fusion=None,                 # {upper_move: i, lower_move: j}
    fusion_random=False,
    fusion_schedule=False,       # rollout: upper move from the choreographer's second schedule
    rsi_prob=0.9, rsi_noise=0.02, rsi_vel_scale=1.0,
    lookahead=[1, 5, 10],
    term_rms=0.6, term_height=0.3, term_grace=20,
    jump_cap=None,               # None = off. Else a margin (m): the reference root z (term_height) and pelvis z (fall_rel)
                                 # used by the early-termination / fall checks are capped at the standing (IDLE) values +
                                 # jump_cap, so a reference JUMP the policy doesn't copy is not counted as a fall (round 1:
                                 # gMH sFM moves jump ~0.2 m and made 30-40% false "falls" in s7_c)
    fall_rel=0.25,               # FALL (counts as `fell`, pays reward_weights.fall) when pelvis z < ref pelvis z - fall_rel;
                                 # env.fall_height should then be low (e.g. 0.2): library moves go down to 0.31 m
    s_pose=2.0, s_vel=0.1, s_ee=40.0, s_h=10.0, s_ori=10.0, s_yaw=0.1, s_xy=2.0,
    track_root_xy=False,
    # ---- phase 2 round 2 (all default off = round-1 behaviour, bit-exact)
    s_tilt=10.0,                 # track_tilt = exp(-s_tilt |g - g_ref|^2), g = gravity in the torso frame
    heading_mode="rate",         # "rate": heading only via track_root's yaw-rate term (+ env `facing`);
                                 # "abs": + track_yaw = exp(-s_yaw_abs wrap(yaw - yaw_ref)^2), yaw_ref = the reference
                                 # root yaw (re-rooted: frame 0 of each move faces +x = the camera)
    s_yaw_abs=4.0,
    root_obs=False,              # append ROOT_OBS dims: per lookahead offset [sin, cos](yaw_ref - yaw) + (g_ref - g)
    penalty_scale=1.0,           # scales the phase-1 penalties torque / action_rate / joint_limits / foot_slide
    upright_scale=1.0,           # scales the phase-1 `upright` reward (exp(-4 tilt^2) pays for NOT leaning)
    err_weighting=None,          # "energy": positive tracking terms x (1 + v_ref / mean v_ref) / 2, v_ref = mean reference
                                 # end-effector speed of the frame (mean over the library = 1, fast frames count more)
    fusion_reset=None,           # "grounded": fused RSI states are FK'd and shifted in z so the lowest foot point
                                 # sits 1 cm above the floor
    fusion_abdomen="upper",      # "lower": a fused RSI state takes the abdomen joints from the LOWER move (reset only;
                                 # the tracking target keeps the upper move's abdomen)
    # ---- phase 2 round 3 (default = round-2 behaviour, bit-exact)
    fused_target="raw",          # "fk": a fused frame's ROOT target is the forward kinematics of the fused pose with
                                 # the lower move's PELVIS kept in place: torso = pelvis_X * (pelvis-in-torso of the
                                 # upper move's abdomen)^-1, so torso tilt (gravity), heading, root height and yaw rate
                                 # are self-consistent with legs from X and abdomen + arms from Y ("raw": X's torso
                                 # with Y's abdomen, which tilts X's pelvis/legs). Head/hand (torso frame) and feet
                                 # (pelvis frame) targets are already FK-exact. Reset: fusion_abdomen lower -> X's root
                                 # (+ X's abdomen = X's pelvis), upper -> the fk root.
    seed=0,
)
SLOTS = 4                        # max moves per episode sequence


class TrackEnv(DanceEnv):
    def __init__(self, env_cfg: Dict[str, Any], weights: Dict[str, float], feature_bank: np.ndarray,
                 track_cfg: Dict[str, Any], lib: track_ref.RefLib, amp_window: int = 0, **kw):
        kw.pop("auto_reset_info", None)               # resets are full resets (wrap_for_track_training)
        tw = {k: float(weights.get(k, 0.0)) for k in TRACK_TERMS}
        base_w = {k: v for k, v in weights.items() if k not in TRACK_TERMS}
        tc = dict(DEFAULT_TRACK)
        tc.update(track_cfg or {})
        unknown = set(track_cfg or {}) - set(DEFAULT_TRACK)
        if unknown:
            raise ValueError(f"unknown track options: {unknown}")
        if float(tc["penalty_scale"]) != 1.0:
            for k in PENALTY_TERMS:
                if k in base_w:
                    base_w[k] = float(base_w[k]) * float(tc["penalty_scale"])
        if float(tc["upright_scale"]) != 1.0 and "upright" in base_w:
            base_w["upright"] = float(base_w["upright"]) * float(tc["upright_scale"])
        assert tc["heading_mode"] in ("rate", "abs"), tc["heading_mode"]
        assert tc["err_weighting"] in (None, "energy"), tc["err_weighting"]
        assert tc["fusion_reset"] in (None, "grounded"), tc["fusion_reset"]
        assert tc["fusion_abdomen"] in ("upper", "lower"), tc["fusion_abdomen"]
        assert tc["fused_target"] in ("raw", "fk"), tc["fused_target"]
        super().__init__(env_cfg, base_w, feature_bank, auto_reset_info=False, **kw)
        if self.version != 2:
            raise ValueError("mode: track needs features_version 2 (unit grid anchored at GRID_ANCHOR_V2)")
        self.tcfg = tc
        self.tw = tw
        self.amp_window = int(amp_window)
        self.lib = lib
        m = self._mj_model
        fg = list(self._fg)
        ref = track_ref.build_arrays(lib, m, np.asarray(self._qpos0), fg, seed=int(tc["seed"]))
        self.ref = ref
        J = lambda x: jp.asarray(x)
        self._r = dict(q=J(ref.q), qd=J(ref.qd), z=J(ref.z), pz=J(ref.pz), grav=J(ref.grav), ee=J(ref.ee), vh=J(ref.vh),
                       wz=J(ref.wz), rsi_qpos=J(ref.rsi_qpos), rsi_qvel=J(ref.rsi_qvel), amp=J(ref.amp),
                       length=J(ref.length), code=J(ref.code))
        if tc["fused_target"] == "fk":
            self._r.update(pel_q=J(ref.pel_q), rel_q=J(ref.rel_q), rel_t=J(ref.rel_t))
        if tc["err_weighting"] == "energy":
            v = np.concatenate([ref.ee_speed[i, :ref.length[i]].mean(-1) for i in range(ref.idle)])
            self._ee_speed_mean = float(v.mean())
            self._r["ee_speed"] = J(ref.ee_speed)
        self.n_moves = ref.idle
        self.IDLE = ref.idle
        up, lo = track_ref.upper_lower_sets(self._joint_names)
        self._upper_mask = J(np.isin(np.arange(21), up))
        self._ee_upper = J(np.isin(np.arange(5), track_ref.UPPER_EE))
        self._abd = np.array([i for i, n in enumerate(self._joint_names) if str(n).startswith("abdomen_")], np.int32)
        self._ankle = np.array([i for i, n in enumerate(self._joint_names) if "ankle" in str(n)], np.int32)
        self._torso_b = self._torso
        self._ee_ids = self._ee
        w = tc["move_weights"]
        w = np.ones(self.n_moves) if w is None else np.asarray(w, np.float64)
        assert len(w) == self.n_moves, f"move_weights needs {self.n_moves} entries"
        self._logits = J(np.log(np.maximum(w, 1e-12)).astype(np.float32))
        self._seq = (int(tc["sequence"][0]), int(tc["sequence"][1]))
        assert 1 <= self._seq[0] <= self._seq[1] <= SLOTS
        self._anchor = float(song.GRID_ANCHOR_V2)
        fus = tc["fusion"]
        self._fixed = None if not fus else (int(fus["upper_move"]), int(fus["lower_move"]))
        self._choreo = tc["choreo"] is not None
        table = np.asarray(self._bank[0])
        n_units, *_ = track_ref.song_units(table, self._anchor)
        self.n_units = n_units
        if self._choreo:
            lo_s, up_s = track_ref.choreograph(table, ref, tc["choreo"], seed=int(tc["seed"]), anchor=self._anchor)
        else:
            lo_s = up_s = np.zeros(n_units, np.int32)
        self.schedule = (lo_s, up_s)
        self._sched_lo, self._sched_up = J(lo_s), J(up_s)
        self._look = [int(x) for x in tc["lookahead"]]
        assert len(self._look) == 3, "lookahead must have 3 offsets (obs layout)"

    # ------------------------------------------------------------------ reference lookup
    def _unit_pos(self, row):
        x = (row.astype(jp.float32) / song.FPS - self._anchor) / song.EIGHT
        u = jp.floor(x).astype(jp.int32)
        return u, x - jp.floor(x)

    def _moves_at(self, info, row):
        """(upper move, lower move, unit position) at song row `row` (scalar)."""
        u, pos = self._unit_pos(row)
        uc = jp.clip(u, 0, self.n_units - 1)
        if self._choreo:
            lower = self._sched_lo[uc]
            if self.tcfg["fusion_random"] and self.tcfg["fusion_schedule"]:
                upper = self._sched_up[uc]
            elif self.tcfg["fusion_random"]:
                upper = info["ep_upper"][jp.mod(u, SLOTS)]
            else:
                upper = lower
        else:
            u0 = jp.maximum(self._unit_pos(info["start"])[0], 0)
            j = jp.mod(u - u0, info["ep_n"])
            lower = info["ep_moves"][j]
            upper = info["ep_upper"][j] if self.tcfg["fusion_random"] else lower
        if self._fixed is not None:
            upper, lower = jp.int32(self._fixed[0]), jp.int32(self._fixed[1])
        idle = u < 0
        return jp.where(idle, self.IDLE, upper), jp.where(idle, self.IDLE, lower), pos, u

    def _frame(self, mv, pos):
        return jp.minimum(jp.floor(pos * track_ref.EIGHT_FRAMES).astype(jp.int32), self._r["length"][mv] - 1)

    def ref_at(self, info, row):
        """Fused reference quantities at song row `row`."""
        up, lo, pos, u = self._moves_at(info, row)
        fu, fl = self._frame(up, pos), self._frame(lo, pos)
        R = self._r
        um = self._upper_mask
        q = jp.where(um, R["q"][up, fu], R["q"][lo, fl])
        qd = jp.where(um, R["qd"][up, fu], R["qd"][lo, fl])
        ee = jp.where(self._ee_upper[:, None], R["ee"][up, fu], R["ee"][lo, fl])
        rq_lo = R["rsi_qpos"][lo, fl]
        rv_lo = R["rsi_qvel"][lo, fl]
        rq = rq_lo.at[7:].set(q)
        rv = rv_lo.at[6:].set(qd)
        w, x, y, z = rq_lo[3], rq_lo[4], rq_lo[5], rq_lo[6]
        yaw = jp.arctan2(2 * (x * y + w * z), 1 - 2 * (y ** 2 + z ** 2))     # reference root (torso) yaw
        out = dict(up=up, lo=lo, pos=pos, unit=u, q=q, qd=qd, ee=ee, z=R["z"][lo, fl], pz=R["pz"][lo, fl],
                   grav=R["grav"][lo, fl],
                   vh=R["vh"][lo, fl], wz=R["wz"][lo, fl], qpos=rq, qvel=rv, amp=R["amp"][lo, fl],
                   yaw=yaw, qpos_lo=rq_lo, qvel_lo=rv_lo)
        if self.tcfg["fused_target"] == "fk":
            out.update(self._fk_root(up, fu, lo, fl, out, rq_lo))
        if "ee_speed" in R:
            out["ee_speed"] = jp.mean(jp.where(self._ee_upper, R["ee_speed"][up, fu], R["ee_speed"][lo, fl]))
        return out

    def _fk_torso(self, up, fu, lo, fl):
        """Fused torso quaternion (RSI frame), rotation, height of the pelvis-anchored fused pose."""
        R = self._r
        qn = _qmul(R["pel_q"][lo, fl], _qconj(R["rel_q"][up, fu]))
        qn = qn / jp.linalg.norm(qn)
        Rn = _qmat(qn)
        zn = R["pz"][lo, fl] - (Rn @ R["rel_t"][up, fu])[2]
        return qn, Rn, zn

    def _fk_root(self, up, fu, lo, fl, out, rq_lo):
        """track.fused_target fk: root targets of the fused pose (see DEFAULT_TRACK); unfused frames unchanged."""
        R = self._r
        fused = up != lo
        qn, Rn, zn = self._fk_torso(up, fu, lo, fl)
        yaw_n = jp.arctan2(Rn[1, 0], Rn[0, 0])
        # yaw rate: the lower move's rate + the rate of change of the fused yaw offset (next frame, clipped)
        fu1 = jp.minimum(fu + 1, R["length"][up] - 1)
        fl1 = jp.minimum(fl + 1, R["length"][lo] - 1)
        _, Rn1, _ = self._fk_torso(up, fu1, lo, fl1)
        q1 = R["rsi_qpos"][lo, fl1, 3:7]
        yaw_x1 = jp.arctan2(2 * (q1[1] * q1[2] + q1[0] * q1[3]), 1 - 2 * (q1[2] ** 2 + q1[3] ** 2))
        off0 = yaw_n - out["yaw"]
        off1 = jp.arctan2(Rn1[1, 0], Rn1[0, 0]) - yaw_x1
        doff = jp.arctan2(jp.sin(off1 - off0), jp.cos(off1 - off0))
        wz_n = out["wz"] + song.FPS * doff * (fl1 > fl)
        rq = out["qpos"].at[3:7].set(qn).at[2].set(zn + (rq_lo[2] - out["z"]))
        sel = lambda a, b: jp.where(fused, a, b)
        return dict(grav=sel(-Rn[2, :], out["grav"]), yaw=sel(yaw_n, out["yaw"]), z=sel(zn, out["z"]),
                    wz=sel(wz_n, out["wz"]), qpos=sel(rq, out["qpos"]))

    # ------------------------------------------------------------------ kinematics helpers
    def _ee_split(self, data):
        P = data.xpos[self._ee]
        Rt, Rp = data.xmat[self._torso], data.xmat[self._pelvis]
        pt, pp = data.xpos[self._torso], data.xpos[self._pelvis]
        upper = (P - pt) @ Rt
        lower = (P - pp) @ Rp
        return jp.where(self._ee_upper[:, None], upper, lower)

    def amp_frame(self, data):
        """Per-frame AMP features from MJX data (same layout as track_ref.amp_features_np)."""
        R = data.xmat[self._torso]
        P = data.xpos[self._ee]
        ee_t = ((P - data.xpos[self._torso]) @ R).reshape(-1)
        return jp.concatenate([data.qpos[7:], data.qvel[6:], data.qpos[2:3], R.T @ jp.array([0.0, 0.0, -1.0]),
                               ee_t, R.T @ data.qvel[0:3], data.qvel[3:6]])

    # ------------------------------------------------------------------ overrides
    def _fresh_info(self, rng, start=None, track=None):
        info = super()._fresh_info(rng, start, track)
        k1, k2, k3 = jax.random.split(jax.random.fold_in(info["rng"], 17), 3)
        info["ep_n"] = jax.random.randint(k1, (), self._seq[0], self._seq[1] + 1).astype(jp.int32)
        info["ep_moves"] = jax.random.categorical(k2, self._logits, shape=(SLOTS,)).astype(jp.int32)
        info["ep_upper"] = jax.random.categorical(k3, self._logits, shape=(SLOTS,)).astype(jp.int32)
        return info

    def _reset_pose(self, kq, info):
        q0, qd0 = super()._reset_pose(kq, info)
        tc = self.tcfg
        k1, k2 = jax.random.split(jax.random.fold_in(kq, 1))
        ref = self.ref_at(info, info["start"])
        rqpos, rqvel = ref["qpos"], ref["qvel"]
        fused = ref["up"] != ref["lo"]
        if tc["fusion_abdomen"] == "lower":          # abdomen from the lower move (the torso is the root)
            a = self._abd
            if tc["fused_target"] == "fk":           # fk target root -> X's root (with X's abdomen = X's pelvis)
                rqpos = rqpos.at[2:7].set(jp.where(fused, ref["qpos_lo"][2:7], rqpos[2:7]))
            rqpos = rqpos.at[7 + a].set(jp.where(fused, ref["qpos_lo"][7 + a], rqpos[7 + a]))
            rqvel = rqvel.at[6 + a].set(jp.where(fused, ref["qvel_lo"][6 + a], rqvel[6 + a]))
        noise = tc["rsi_noise"] * jax.random.uniform(k1, (self._nu,), minval=-1, maxval=1)
        qj = jp.clip(rqpos[7:] + noise, self._jrange[:, 0], self._jrange[:, 1])
        q = rqpos.at[7:].set(qj)
        qd = rqvel * tc["rsi_vel_scale"]
        if tc["fusion_reset"] == "grounded":         # fused pose: lowest foot point -> floor + 1 cm
            low = self._lowest_foot(q)
            q = q.at[2].add(jp.where(fused, 0.01 - low, 0.0))
        use = jax.random.uniform(k2) < tc["rsi_prob"]
        return jp.where(use, q, q0), jp.where(use, qd, qd0)

    def _lowest_foot(self, qpos):
        """Lowest point (world z) of the foot geoms for a qpos (MJX kinematics; same formula as _contacts)."""
        from mujoco import mjx
        d = mjx_env.make_data(self._mj_model, qpos=qpos, impl="jax")
        d = mjx.kinematics(self._mjx_model, d)
        pos = d.geom_xpos[self._fg]
        axis_z = jp.abs(d.geom_xmat[self._fg][:, 2, 2])
        low = pos[:, 2] - self._fg_size[:, 0] - jp.where(self._fg_capsule, axis_z * self._fg_size[:, 1], 0.0)
        return jp.min(low)

    @staticmethod
    def _yaw_g(data, torso):
        R = data.xmat[torso]
        return jp.arctan2(R[1, 0], R[0, 0]), R.T @ jp.array([0.0, 0.0, -1.0])

    def _track_obs(self, data, info):
        row = info["start"] + info["ep_step"]
        q = data.qpos[7:]
        up, lo, pos, _ = self._moves_at(info, row)
        tg = [self.ref_at(info, row + k)["q"] - q for k in self._look]
        R = self._r
        blocks = [jp.array([jp.sin(2 * jp.pi * pos), jp.cos(2 * jp.pi * pos)])] + tg + [R["code"][up], R["code"][lo]]
        if self.tcfg["root_obs"]:
            yaw, g = self._yaw_g(data, self._torso)
            for k in self._look:
                rf = self.ref_at(info, row + k)
                dy = rf["yaw"] - yaw
                blocks.append(jp.concatenate([jp.array([jp.sin(dy), jp.cos(dy)]), rf["grav"] - g]))
        return jp.concatenate(blocks)

    def _obs(self, data, info, contact):
        return jp.concatenate([super()._obs(data, info, contact), self._track_obs(data, info)])

    def _amp_init(self, info):
        rows = info["start"] - jp.arange(self.amp_window - 1, -1, -1)
        return jax.vmap(lambda r: self.ref_at(info, r)["amp"])(rows)          # (W, F), oldest first

    def reset_at(self, rng, start=None, track=None) -> mjx_env.State:
        st = super().reset_at(rng, start, track)
        info = dict(st.info)
        info["track_terms"] = {k: jp.zeros(()) for k in TRACK_TERMS}
        info["track_err"] = jp.zeros(2)
        if self.tw["ankle_rate"] != 0.0:
            info["prev_ankle_qd"] = st.data.qvel[6 + self._ankle]
        if self.amp_window:
            h = self._amp_init(info).at[-1].set(self.amp_frame(st.data))
            info["amp_hist"] = h
            info["amp_obs"] = h.reshape(-1)
        metrics = dict(st.metrics)
        metrics.update({f"r_{k}": jp.zeros(()) for k in TRACK_TERMS})
        metrics.update({k: jp.zeros(()) for k in TRACK_METRICS})
        metrics["terminated"] = jp.zeros(())
        return st.replace(info=info, metrics=metrics)

    def step(self, state: mjx_env.State, action: jax.Array) -> mjx_env.State:
        st = super().step(state, action)
        tc = self.tcfg
        info = dict(st.info)
        data = st.data
        s = info["ep_step"]                          # this sample's index in the episode (post-step)
        row = info["start"] + s
        ref = self.ref_at(info, row)
        q, qd = data.qpos[7:], data.qvel[6:]
        dq = q - ref["q"]
        ee = self._ee_split(data)
        R = data.xmat[self._torso]
        g = R.T @ jp.array([0.0, 0.0, -1.0])
        z = data.qpos[2]
        wz = (R @ data.qvel[3:6])[2]
        root_e = tc["s_h"] * (z - ref["z"]) ** 2 + tc["s_ori"] * jp.sum((g - ref["grav"]) ** 2) \
            + tc["s_yaw"] * (wz - ref["wz"]) ** 2
        if tc["track_root_xy"]:
            hx = R[0:2, 0] / (jp.linalg.norm(R[0:2, 0]) + 1e-6)
            v = data.qvel[0:3]
            vh = jp.array([v[0] * hx[0] + v[1] * hx[1], -v[0] * hx[1] + v[1] * hx[0], v[2]])
            root_e = root_e + tc["s_xy"] * jp.sum((vh - ref["vh"]) ** 2)
        ee_d = jp.linalg.norm(ee - ref["ee"], axis=-1)
        rms = jp.sqrt(jp.mean(dq ** 2))
        # grace after the episode start and after each unit boundary
        since_unit = jp.floor(ref["pos"] * track_ref.EIGHT_FRAMES)
        live = (s > tc["term_grace"]) & (since_unit >= tc["term_grace"])
        z_chk, pz_chk = ref["z"], ref["pz"]
        if tc["jump_cap"] is not None:
            jc = float(tc["jump_cap"])
            z_chk = jp.minimum(z_chk, self._r["z"][self.IDLE, 0] + jc)
            pz_chk = jp.minimum(pz_chk, self._r["pz"][self.IDLE, 0] + jc)
        fail = live & ((rms > tc["term_rms"]) | (z < z_chk - tc["term_height"]))
        rel_fall = (data.xpos[self._pelvis, 2] < pz_chk - tc["fall_rel"]) & (st.metrics["fell"] < 0.5)
        if tc["heading_mode"] == "abs":
            yaw = jp.arctan2(R[1, 0], R[0, 0])
            dyaw = jp.arctan2(jp.sin(yaw - ref["yaw"]), jp.cos(yaw - ref["yaw"]))
            track_yaw = jp.exp(-tc["s_yaw_abs"] * dyaw ** 2)
        else:
            track_yaw = jp.zeros(())
        # new terms are only computed when used (an unused op changes XLA's fusion under vmap -> ulp differences)
        track_tilt = jp.exp(-tc["s_tilt"] * jp.sum((g - ref["grav"]) ** 2)) if self.tw["track_tilt"] != 0.0 \
            else jp.zeros(())
        if self.tw["ankle_rate"] != 0.0:
            aqd = qd[self._ankle]
            ankle_rate = jp.sum((aqd - info["prev_ankle_qd"]) ** 2)
            info["prev_ankle_qd"] = aqd
        else:
            ankle_rate = jp.zeros(())
        terms = dict(
            track_pose=jp.exp(-tc["s_pose"] * jp.sum(dq ** 2)),
            track_vel=jp.exp(-tc["s_vel"] * jp.sum((qd - ref["qd"]) ** 2)),
            track_ee=jp.exp(-tc["s_ee"] * jp.sum(ee_d ** 2)),
            track_root=jp.exp(-root_e),
            track_fail=fail.astype(jp.float32),
            track_tilt=track_tilt,
            track_yaw=track_yaw,
            ankle_rate=ankle_rate,
        )
        terms = {k: jp.nan_to_num(v) for k, v in terms.items()}
        weighted = {k: self.tw[k] * terms[k] for k in TRACK_TERMS}
        if tc["err_weighting"] == "energy":
            ew = 0.5 * (1.0 + ref["ee_speed"] / self._ee_speed_mean)
            weighted = {k: (v * ew if k in POS_TRACK else v) for k, v in weighted.items()}
        reward = st.reward + sum(weighted.values()) + self.weights["fall"] * rel_fall
        info["track_terms"] = terms
        info["track_err"] = jp.stack([jp.mean(jp.abs(dq)), jp.mean(ee_d)])
        if self.amp_window:
            h = jp.concatenate([info["amp_hist"][1:], self.amp_frame(data)[None]], 0)
            info["amp_hist"] = h
            info["amp_obs"] = h.reshape(-1)
        metrics = dict(st.metrics)
        metrics.update({f"r_{k}": weighted[k] for k in TRACK_TERMS})
        metrics.update(track_pose_err=info["track_err"][0], track_ee_err=info["track_err"][1])
        fell = jp.maximum(st.metrics["fell"], rel_fall.astype(jp.float32))
        metrics["fell"] = fell
        metrics["r_fall"] = self.weights["fall"] * fell
        metrics["terminated"] = jp.maximum(fell, terms["track_fail"])
        info["terms"] = dict(info["terms"], fall=fell)
        done = jp.maximum(fell, terms["track_fail"])
        return st.replace(reward=reward, done=done, metrics=metrics, info=info)


def _qconj(q):
    return q * jp.array([1.0, -1.0, -1.0, -1.0])


def _qmul(a, b):
    w1, x1, y1, z1 = a[0], a[1], a[2], a[3]
    w2, x2, y2, z2 = b[0], b[1], b[2], b[3]
    return jp.stack([w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2, w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2,
                     w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2, w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2])


def _qmat(q):
    w, x, y, z = q[0], q[1], q[2], q[3]
    return jp.array([[1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
                     [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
                     [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)]])


# ---------------------------------------------------------------------- training wrapper
class TrackAutoResetWrapper(pg_wrapper.Wrapper):
    """Auto-reset with a FULL env.reset on done (new reference pose + new episode info), like playground's
    BraxAutoResetWrapper(full_reset=True), but the episode bookkeeping of brax's EpisodeWrapper (steps,
    truncation, episode_done, episode_metrics) and `amp_obs` (the window ending at the terminal step) are kept
    from the stepped state, so time-outs still bootstrap and the terminal AMP window is the real one."""
    KEEP = ("steps", "truncation", "episode_done", "episode_metrics", "amp_obs")
    KEY = "TrackAutoReset_rng"

    def reset(self, rng):
        rk = jax.vmap(jax.random.split)(rng)
        state = self.env.reset(rk[..., 1])
        state.info[self.KEY] = rk[..., 0]
        return state

    def step(self, state, action):
        rk = jax.vmap(jax.random.split)(state.info[self.KEY])
        reset_rng, reset_key = rk[..., 0], rk[..., 1]
        if "steps" in state.info:
            state.info.update(steps=jp.where(state.done, jp.zeros_like(state.info["steps"]), state.info["steps"]))
        state = state.replace(done=jp.zeros_like(state.done))
        state = self.env.step(state, action)
        rs = self.env.reset(reset_key)
        done = state.done

        def where_done(x, y):
            d = jp.reshape(done, [x.shape[0]] + [1] * (x.ndim - 1)) if done.shape else done
            return jp.where(d, x, y)

        data = jax.tree.map(where_done, rs.data, state.data)
        obs = jax.tree.map(where_done, rs.obs, state.obs)
        info = {}
        for k, v in state.info.items():
            if k in self.KEEP or k == self.KEY or k not in rs.info:
                info[k] = v
            else:
                info[k] = jax.tree.map(where_done, rs.info[k], v)
        info[self.KEY] = reset_rng
        return state.replace(data=data, obs=obs, info=info)


def wrap_for_track_training(env, episode_length: int = 1000, action_repeat: int = 1, randomization_fn=None,
                            **_):
    assert randomization_fn is None
    env = brax_training.VmapWrapper(env)
    env = brax_training.EpisodeWrapper(env, episode_length, action_repeat)
    return TrackAutoResetWrapper(env)


# ---------------------------------------------------------------------- construction
def library_path(cfg: dict) -> str:
    """track.library, overridable with $DANCE_TRACK_LIBRARY (smoke tests with the synthetic library)."""
    return os.environ.get("DANCE_TRACK_LIBRARY") or dict(DEFAULT_TRACK, **cfg.get("track", {}))["library"]


def make_track_env(cfg: dict, root: str = ".", rollout: bool = False, **kw) -> TrackEnv:
    bank = kw.pop("feature_bank", None)
    if bank is None:
        bank = feature_bank_from_config(cfg, root)
    env_cfg = dict(cfg.get("env", {}))
    env_cfg["features_version"] = int(cfg.get("features_version", env_cfg.get("features_version", 1)))
    tc = dict(cfg.get("track", {}))
    if rollout:                     # full-song eval follows the song schedule (fusion: the 2nd schedule)
        tc.setdefault("choreo", "section_energy")
        if tc["choreo"] is None:
            tc["choreo"] = "section_energy"
        tc["fusion_schedule"] = True
    from dance_rl.env import load_model
    lib = track_ref.load_library(os.path.join(root, library_path(cfg)), load_model(0.004), tc.get("filter"))
    amp = cfg.get("amp") or {}
    want_feat = bool(kw.pop("amp_features", False))      # popped first: never reaches DanceEnv(**kw)
    window = int(amp.get("window", 10)) if (float(amp.get("w_amp", 0.0)) > 0 or want_feat) else 0
    return TrackEnv(env_cfg, cfg.get("reward_weights", {}), bank, tc, lib, amp_window=window, **kw)


ALL_TERMS = TERMS + TRACK_TERMS
