"""MJX humanoid dance env (PLAN sections 2-4).

Model: mujoco_playground's dm_control-suite capsule Humanoid XML (21 hinge actuators, torque
motors, ctrlrange [-1, 1]) driven through playground's MJX pipeline (mjx_env.make_data / mjx.forward / mjx_env.step, impl='jax';
mujoco_warp is not installed on the box).

Control 50 Hz (ctrl_dt 0.02). sim_dt comes from config (see configs/*.yaml).

Song time lives in state.info: `start` (row in the feature bank) + `ep_step`. The env also
resets its own info (song window, counters, filters) when an episode ends, because Brax's
auto-reset wrapper only swaps physics `data` and `obs` back to the cached first state and keeps
`info` as is. ep_step is kept in lock-step with the EpisodeWrapper's step counter.

Pose history for groove / alternation / variety / full-body is a ring buffer of the last
4 bars (425 steps at 50 Hz, 4 bars = exactly 425 steps) of [q (21), head-minus-pelvis (3)].
Entries older than the current episode are never read: every lagged read is gated by ep_step.
"""
from __future__ import annotations

from typing import Any, Dict, Optional

import jax
import jax.numpy as jp
import mujoco
import numpy as np
from ml_collections import config_dict
from mujoco import mjx

from mujoco_playground._src import mjx_env
from mujoco_playground._src.dm_control_suite import common as pg_common
from mujoco_playground._src.dm_control_suite import humanoid as pg_humanoid

from dance_rl import song

FPS = song.FPS
BAR_STEPS = 106          # 2.125 s * 50 = 106.25
HALF_BAR_STEPS = 53
BEAT_STEPS = 27          # 0.53125 s * 50 = 26.6
HIST = 425               # 4 bars exactly
EIGHT_STEPS = 212        # one 8-count = 2 bars = 4.25 s = 212.5 steps
DHIST = 426              # ring of 1-bar-mean pose descriptors (round 4 structure term), >= 2 eight-counts + 1
DHIST2 = 640             # aaba2 needs 3 eight-counts back (count 3 vs count 0): >= 3 * 212 + 1
C = song.COL             # v1 layout; the env itself uses self.C (v1 or v2, from features_version)

TERMS = [
    # always on
    "upright", "height", "fall", "torque", "action_rate", "joint_limits", "drift", "facing",
    "foot_slide",
    # before the drop
    "stillness", "idle_bob",
    # after the drop
    "accent_on", "accent_off", "step_on_kick", "groove", "alternation", "full_body",
    "energy_match", "variety",
    # the drop itself
    "drop_bonus",
    # always on, opt-in (env.spin_penalty); appended last so older term indices stay put
    "spin",
    # round 4 (all after the drop, all opt-in through their weight / env flag; appended last)
    "bounce", "knee_bend", "arrive_approach", "arrive_decel", "arrive_hold", "nod",
    "weight_transfer", "aaba_same", "aaba_contrast", "aaba_section",
    # always on, opt-in (env.drift_vel_penalty), added after a0 travelled 34 m over the song
    "drift_vel",
    # round 5: torso carrier (after the drop, opt-in through its weight)
    "torso_rock",
    # round 6 (after the drop, opt-in): early-approach penalty (arrive mode) and mirrored 8-counts
    "arrive_early", "mirror_alt",
]

DEFAULT_ENV = dict(
    ctrl_dt=0.02, sim_dt=0.004, episode_seconds=16.0, forced_start_time=4.0,
    forced_start_prob=0.2, forced_start_range=None, init_noise=0.02, fall_height=0.7, height_band=[0.8, 1.3],
    height_falloff=0.3, contact_height=0.02, m_lowpass_hz=10.0, m_floor=0.1, m_ref=1.5,
    groove_sigma=1.0, alternation_sigma=1.0, variety_sigma=1.0, idle_bob_clip=0.1,
    kick_window_s=0.06, kick_threshold=0.5, drift_leash=1.0, joint_limit_margin=0.05,
    solver_iterations=None, solver_ls_iterations=None,
    # accent signal used in accent_on / accent_off (observations are unaffected):
    #   "onset"     -> raw onset envelope (original behaviour)
    #   "grid_kick" -> clip(max(pulse, kick), 0, 1), pulse = exp(-d^2 / (2 sigma^2)),
    #                  d = min(phi, 1 - phi) = circular distance (beats) of beat_phase from the beat
    accent_signal="onset", accent_pulse_sigma=0.08,
    # accent_off = m_hat**accent_off_power * (1 - accent). 1 = original (linear); 2 makes a slow
    # return stroke cheaper than a fast one (a linear penalty only charges distance).
    accent_off_power=1,
    # spin = (1-bar mean of the world-frame yaw rate of the root/torso, rad/s)^2, weight
    # reward_weights.spin. Off by default (term stays 0 and no extra state is carried).
    spin_penalty=False,
    # phrase clock: append sin/cos(2*pi*phrase_phase) to the obs (+2 dims, 107 -> 109).
    # phrase = phrase_bars * 2.125 s, anchored at phrase_anchor (s): the drop for the song,
    # 0 for the metronome bank (make_env sets it when it is None).
    phrase_clock=False, phrase_bars=8, phrase_anchor=None,
    # ---------------- round 4 (defaults = round-3 behaviour) ----------------
    # 1 = v1 table (32 cols, grid anchored at the drop 8.37 s); 2 = v2 table (41 cols, grid anchored
    # at song.GRID_ANCHOR_V2 = 8.6304 s, snare / pulses / phrase columns). make_env copies the
    # top-level config key `features_version` here.
    features_version=1,
    # obs += [sin, cos] of the torso's world yaw (heading), so `facing` becomes learnable (+2 dims)
    heading_obs=False,
    # obs += snare, downbeat, backbeat_pulse, is_breakdown, one-hot count_in_32 (4),
    # sin/cos(2 pi section_phase) (+10 dims, v2 features only)
    music_obs_v2=False,
    # bounce: pelvis z minus its 1-bar mean tracks z_ref = -A1 cos(2 pi beat_phase) + A2 cos(4 pi bar_phase)
    # reward exp(-((dz - z_ref)/sigma)^2) * [a foot in contact] * after_drop
    bounce_a1=0.015, bounce_a2=0.006, bounce_sigma=0.01,
    # knee_bend: exp(-((mean knee flexion - target)/sigma)^2) after the drop (degrees; flexion = -q_knee)
    knee_target_deg=20.0, knee_sigma_deg=10.0,
    # accent_mode "onoff" = accent_on / accent_off (original). "arrive" = arrive_approach /
    # arrive_decel / arrive_hold on the hands+head speed s_hat (accent_on/off terms are then 0).
    # Windows are in signed beats delta = ((beat_phase + 0.5) mod 1) - 0.5 (negative = before the beat).
    accent_mode="onoff",
    arrive_approach_window=[-0.25, -0.08], arrive_decel_window=[-0.08, 0.03],
    arrive_hold_window=[0.03, 0.20],
    arrive_decel_ref=10.0,       # 1/s: decel = clip(relu(-ds/dt) / max(1-bar mean s, m_floor) / ref, 0, cap)
    arrive_decel_cap=2.0,
    # full_body_v2: sum_g c_g sqrt(amp_g), c = arms/legs/torso/head weights, arm amp capped (rad)
    full_body_v2=False, full_body_group_weights=[0.5, 1.0, 1.5, 1.5], full_body_arm_cap=0.6,
    # nod: clip(w_pitch_fwd * cos(2 pi (beat_phase + nod_phase)), +-nod_clip) after the drop, w_pitch_fwd =
    # torso angular velocity about its own lateral axis (rad/s, + = pitching forward / nose down).
    # nod_phase 0.25 -> the reference forward pitch angle peaks ON the beat (forward velocity before
    # the beat, back after); 0.5 -> -cos(2 pi phi) (forward velocity peaks half a beat off).
    nod_phase=0.25, nod_clip=1.0,
    # weight_transfer: lateral pelvis offset from the feet midpoint along the torso's left axis, minus its
    # 1-bar mean, tracks W sin(2 pi bar_phase) (left on beat 2, right on beat 4), gaussian like bounce
    weight_transfer_w=0.03, weight_transfer_sigma=0.015,
    # step_on_kick fires on: "kick" (original: kick > kick_threshold within +-kick_window_s) or
    # "beat" (v2 beat_pulse > step_beat_threshold; 0.325 = +-60 ms of a grid beat for the 40 ms pulse)
    step_signal="kick", step_beat_threshold=0.325,
    # alternation compares q_left(t) with M q_right(t - 1/2 bar). With the fix, M = -1 for the joints
    # whose XML axes are mirror-SAME (left axis = reflection of the right one): shoulder1, shoulder2,
    # ankle_x; +1 elsewhere. False = original raw comparison.
    alternation_mirror_fix=False,
    # structure "variety" = original variety term. "aaba" = A-A-B-A over 32 counts (variety term = 0):
    # D(t) = 1-bar mean of [q, heading-frame head - pelvis]; sim(L) = exp(-|D(t) - D(t-L)|^2 / sigma^2)
    #   aaba_same     count_in_32 == 1: sim(1 unit); count_in_32 == 3: sim(2 units) (back to A)
    #   aaba_contrast count_in_32 == 2: 1 - sim(1 unit)
    #   aaba_section  count_in_32 == 0 right after a section boundary: sim(1 unit) (weight < 0)
    # every comparison needs the lagged unit to be exactly 1 (2) units back, in the same section (the
    # memory resets at section boundaries) except aaba_section, and fully inside the episode.
    structure="variety", aaba_sigma=0.25,
    # drift_vel = |1-bar mean of the root's world-frame horizontal velocity|^2 ((m/s)^2), weight
    # reward_weights.drift_vel. The position-based `drift` term is unobservable (no xy in the obs) and
    # only bites after 1 m; the mean velocity is observable (linvel + heading), like `spin` for yaw.
    drift_vel_penalty=False,
    # ---------------- round 5 ----------------
    # forced_start_range [lo, hi] (s): a forced start is drawn uniformly from [lo, hi] instead of the
    # fixed forced_start_time (None = round-4 behaviour, bit-exact RNG stream).
    # structure "aaba2" = aaba with a linear contrast term (same descriptor D, same section reset):
    #   aaba_same     count 1 vs count 0 (1 unit back): exp(-d^2/sigma^2); count 3 vs count 0 (3 units back)
    #                 when that history exists in the episode, else vs count 1 (2 units back; 16 s
    #                 episodes almost never hold count 0 + 3 units)
    #   aaba_contrast count 2 vs count 1: min(d / aaba_contrast_ref, 1), d = |D(t) - D(t - 1 unit)|
    #                 (rad-equivalent; linear, so an identical loop d = 0 still gets a gradient)
    #   aaba_section  first unit of a section vs the last unit of the previous one: exp(-d^2/sigma^2)
    #                 (weight < 0)
    aaba_contrast_ref=0.6,
    # torso_rock: torso roll (lateral lean about the heading axis, deg, + = leaning left) minus its 1-bar
    # mean tracks R sin(2 pi bar_phase) (left on beat 2, right on beat 4, in phase with weight_transfer):
    # exp(-((roll - roll_bar - target) / sigma)^2) after the drop. Weight reward_weights.torso_rock.
    torso_rock_deg=6.0, torso_rock_sigma_deg=3.0,
    # ---------------- round 6 ----------------
    # torso_rock target = R sin(2 pi (bar_phase + torso_rock_phase)); 0 = round-5 target (static branch,
    # so the default graph is unchanged). s5_c rocks unprompted at about -0.415 cycles (fit on its rollout).
    torso_rock_phase=0.0,
    # weight_transfer target = W sin(2 pi (bar_phase + weight_transfer_phase)); 0 = round-4/5 target. s5_c shifts
    # its weight unprompted at about -0.455 cycles (right on 2, left on 4; fit on its rollout, R^2 0.66).
    weight_transfer_phase=0.0,
    # facing_mode "cos" = facing raw value 1 - cos(yaw) (original); "sq" = yaw^2 (rad^2), yaw = wrapped
    # torso heading relative to +x (the camera-facing direction), so 20 deg costs 0.12 instead of 0.06.
    facing_mode="cos",
    # arrive_early (arrive mode only): a_b * [delta in arrive_early_window] * s_hat, weight < 0, so hands +
    # head speed well before the beat (default -0.35..-0.20 beat = -186..-106 ms) is charged and the hits
    # stop creeping earlier. The approach window itself stays arrive_approach_window.
    arrive_early_window=[-0.35, -0.20],
    # structure "mirror_alt": A, A', A, A' ... per 8-count (1 unit = EIGHT_STEPS = 212 steps), v = [q (21),
    # heading-frame head - pelvis (3)], M = swap left/right joints with MIRROR_FLIP + abdomen_z/abdomen_x
    # sign flips and the lateral head offset negated (MIRROR_FLIP_TORSO):
    #   mirror_alt  exp(-|v(t) - M v(t - 1 unit)|^2 / mirror_alt_sigma^2) * gate
    #               gate = min(|v(t) - M v(t)|^2 / mirror_alt_asym_ref^2, 1) when mirror_alt_asym_ref > 0
    #               (a left/right-symmetric pose satisfies v = M v(t - 1 unit) for any 1-unit-periodic loop,
    #               so without the gate a symmetric loop earns the full term; 0 = no gate)
    #   aaba_same   exp(-|v(t) - v(t - 2 units)|^2 / mirror_same_sigma^2)   (A repeats)
    # Both need the lagged sample inside the episode and in the same section (memory resets at section
    # boundaries, as aaba). variety = 0 under this structure.
    mirror_alt_sigma=1.0, mirror_same_sigma=1.0, mirror_alt_asym_ref=0.0,
)
ACCENT_SIGNALS = ("onset", "grid_kick")
ACCENT_MODES = ("onoff", "arrive")
STEP_SIGNALS = ("kick", "beat")
STRUCTURES = ("variety", "aaba", "aaba2", "mirror_alt")
FACING_MODES = ("cos", "sq")
# joints whose left/right XML axes are reflections of each other WITHOUT a sign change (so a mirrored
# motion has q_L = -q_R) and the unpaired torso joints that flip: see dance_rl/mirror.py
from dance_rl.mirror import MIRROR_FLIP, MIRROR_FLIP_TORSO, mirror_perm_sign  # noqa: E402,F401


def section_ids(table: np.ndarray) -> np.ndarray:
    """Per-row section index of a v2 table: a section starts where count_in_32 resets to 0 from a
    value other than 3 (a short section ended) or where a breakdown starts. For the song this gives
    exactly the analyzer's boundaries 34.13, 42.63, 68.13, 76.63, 93.63, 121.26, 129.76 s; the v2
    metronome (free 8-counts, no breakdowns) is one section."""
    c = song.COL_V2
    k = table[..., c["count_in_32"]]
    bd = table[..., c["is_breakdown"]]
    k0, k1 = k[..., :-1], k[..., 1:]
    start = (k1 == 0) & (k0 != 0) & ((k0 != 3) | ((bd[..., 1:] > 0.5) & (bd[..., :-1] < 0.5)))
    z = np.zeros(start.shape[:-1] + (1,), np.int32)
    return np.concatenate([z, np.cumsum(start, axis=-1, dtype=np.int32)], axis=-1)

# Body / joint names in the dm_control humanoid
EE_BODIES = ["head", "left_hand", "right_hand", "left_foot", "right_foot"]
ARM = ["shoulder1", "shoulder2", "elbow"]
LEG = ["hip_x", "hip_z", "hip_y", "knee", "ankle_y", "ankle_x"]
TORSO = ["abdomen_z", "abdomen_y", "abdomen_x"]


def load_model(sim_dt: float, iterations=None, ls_iterations=None) -> mujoco.MjModel:
    xml = pg_humanoid._XML_PATH.read_text()
    m = mujoco.MjModel.from_xml_string(xml, pg_common.get_assets())
    m.opt.timestep = sim_dt
    if iterations:
        m.opt.iterations = int(iterations)
    if ls_iterations:
        m.opt.ls_iterations = int(ls_iterations)
    m.vis.global_.offwidth = 1920
    m.vis.global_.offheight = 1080
    return m


def standing_qpos(m: mujoco.MjModel, foot_geoms) -> np.ndarray:
    """qpos0 with the root lowered so the lowest foot point sits on the floor."""
    d = mujoco.MjData(m)
    mujoco.mj_forward(m, d)
    low = min(_lowest_z_np(m, d, g) for g in foot_geoms)
    q = m.qpos0.copy()
    q[2] -= low - 0.002
    return q


def _lowest_z_np(m, d, g):
    r = m.geom_size[g, 0]
    if m.geom_type[g] == mujoco.mjtGeom.mjGEOM_CAPSULE:
        return d.geom_xpos[g, 2] - abs(d.geom_xmat[g].reshape(3, 3)[2, 2]) * m.geom_size[g, 1] - r
    return d.geom_xpos[g, 2] - r


class DanceEnv(mjx_env.MjxEnv):
    def __init__(self, env_cfg: Dict[str, Any], weights: Dict[str, float], feature_bank: np.ndarray,
                 forced_start_prob: Optional[float] = None, auto_reset_info: bool = True,
                 episode_steps: Optional[int] = None):
        cfg = dict(DEFAULT_ENV)
        cfg.update(env_cfg or {})
        self.cfg = cfg
        ep_steps = int(episode_steps or round(cfg["episode_seconds"] * FPS))
        pg_cfg = config_dict.create(ctrl_dt=cfg["ctrl_dt"], sim_dt=cfg["sim_dt"],
                                    episode_length=ep_steps, action_repeat=1, vision=False)
        super().__init__(pg_cfg)
        self.episode_steps = ep_steps
        self.auto_reset_info = auto_reset_info
        self.forced_start_prob = cfg["forced_start_prob"] if forced_start_prob is None else forced_start_prob

        unknown = set(weights) - set(TERMS)
        if unknown:
            raise ValueError(f"unknown reward terms in config: {unknown}")
        self.weights = {k: float(weights.get(k, 0.0)) for k in TERMS}

        self._mj_model = load_model(cfg["sim_dt"], cfg["solver_iterations"], cfg["solver_ls_iterations"])
        self._mjx_model = mjx.put_model(self._mj_model, impl="jax")
        m = self._mj_model

        def body(n): return mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_BODY, n)
        def jq(n): return m.jnt_qposadr[mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_JOINT, n)] - 7

        self._torso = body("torso")
        self._pelvis = body("pelvis")
        self._head = body("head")
        self._ee = np.array([body(n) for n in EE_BODIES])
        self._foot_geoms = [[g for g in range(m.ngeom) if m.geom_bodyid[g] == body(f"{s}_foot")]
                            for s in ("left", "right")]
        self._joint_names = [mujoco.mj_id2name(m, mujoco.mjtObj.mjOBJ_JOINT, j) for j in range(1, m.njnt)]
        self._arm_idx = np.array([jq(f"{s}_{n}") for s in ("left", "right") for n in ARM])
        self._leg_idx = np.array([jq(f"{s}_{n}") for s in ("left", "right") for n in LEG])
        self._torso_idx = np.array([jq(n) for n in TORSO])
        self._left_idx = np.array([jq(f"left_{n}") for n in LEG + ARM])
        self._right_idx = np.array([jq(f"right_{n}") for n in LEG + ARM])
        self._jrange = jp.asarray(m.jnt_range[1:])
        fg = np.array(sum(self._foot_geoms, []))
        self._fg = fg
        self._fg_side = np.array([0] * len(self._foot_geoms[0]) + [1] * len(self._foot_geoms[1]))
        self._fg_capsule = jp.asarray(m.geom_type[fg] == mujoco.mjtGeom.mjGEOM_CAPSULE)
        self._fg_size = jp.asarray(m.geom_size[fg])
        self._qpos0 = jp.asarray(standing_qpos(m, fg))
        self._nu = m.nu

        bank = np.asarray(feature_bank, np.float32)
        if bank.ndim == 2:
            bank = bank[None]
        self._bank = jp.asarray(bank)
        self._n_tracks, self._T, _ = bank.shape
        self._max_start = max(self._T - self.episode_steps, 1)
        self._forced_start = int(round(cfg["forced_start_time"] * FPS))
        self._alpha = float(cfg["ctrl_dt"] / (cfg["ctrl_dt"] + 1.0 / (2 * np.pi * cfg["m_lowpass_hz"])))
        kw = int(round(cfg["kick_window_s"] * FPS))
        self._kick_offsets = jp.arange(-kw, kw + 1)
        # ---- round 4
        self.version = int(cfg["features_version"])
        if self.version not in (1, 2):
            raise ValueError(f"features_version must be 1 or 2, got {self.version}")
        self.C = song.COL if self.version == 1 else song.COL_V2
        self._n_scalar = len(song.SCALAR_COLUMNS) if self.version == 1 else len(song.SCALAR_COLUMNS_V2)
        want = song.N_FEATURES if self.version == 1 else song.N_FEATURES_V2
        if bank.shape[-1] != want:
            raise ValueError(f"features_version {self.version} needs a {want}-column table, got {bank.shape[-1]}")
        for key, allowed in (("accent_mode", ACCENT_MODES), ("step_signal", STEP_SIGNALS),
                             ("structure", STRUCTURES), ("facing_mode", FACING_MODES)):
            if cfg[key] not in allowed:
                raise ValueError(f"env.{key} must be one of {allowed}, got {cfg[key]!r}")
        needs_v2 = [k for k in ("music_obs_v2",) if cfg[k]] + \
            (["accent_mode=arrive"] if cfg["accent_mode"] == "arrive" else []) + \
            (["step_signal=beat"] if cfg["step_signal"] == "beat" else []) + \
            ([f"structure={cfg['structure']}"] if cfg["structure"] in ("aaba", "aaba2", "mirror_alt") else [])
        if needs_v2 and self.version != 2:
            raise ValueError(f"{needs_v2} need features_version 2")
        self._knee_idx = np.array([jq("left_knee"), jq("right_knee")])
        self._mirror = jp.asarray([-1.0 if n in MIRROR_FLIP else 1.0 for n in LEG + ARM])
        self._hand_head = np.array([0, 1, 2])          # rows of EE_BODIES: head, left_hand, right_hand
        self._aaba = cfg["structure"] in ("aaba", "aaba2")
        self._dhist = DHIST2 if cfg["structure"] == "aaba2" else DHIST
        self._mirror_alt = cfg["structure"] == "mirror_alt"
        if self._aaba or self._mirror_alt:
            self._sec = jp.asarray(section_ids(bank))   # (n_tracks, T)
        if self._mirror_alt:
            perm, sign = mirror_perm_sign(self._joint_names)
            self._mperm = jp.asarray(perm)
            self._msign = jp.asarray(np.concatenate([sign, np.array([1.0, -1.0, 1.0], np.float32)]))
        fr = cfg["forced_start_range"]
        self._forced_range = None if fr is None else (int(round(fr[0] * FPS)), int(round(fr[1] * FPS)))
        self._phrase_steps = cfg["phrase_bars"] * song.BAR * FPS          # 850 steps for 8 bars
        self._phrase_anchor = float(song.DROP if cfg["phrase_anchor"] is None else cfg["phrase_anchor"])
        if cfg["accent_signal"] not in ACCENT_SIGNALS:
            raise ValueError(f"env.accent_signal must be one of {ACCENT_SIGNALS}, got {cfg['accent_signal']!r}")

    # ------------------------------------------------------------------ playground API
    @property
    def xml_path(self) -> str:
        return str(pg_humanoid._XML_PATH)

    @property
    def action_size(self) -> int:
        return self._nu

    @property
    def mj_model(self) -> mujoco.MjModel:
        return self._mj_model

    @property
    def mjx_model(self) -> mjx.Model:
        return self._mjx_model

    # ------------------------------------------------------------------ helpers
    def _feat(self, info, offset=0):
        idx = jp.clip(info["start"] + info["ep_step"] + offset, 0, self._T - 1)
        return self._bank[info["track"], idx]

    def _contacts(self, data):
        pos = data.geom_xpos[self._fg]
        axis_z = jp.abs(data.geom_xmat[self._fg][:, 2, 2])
        low = pos[:, 2] - self._fg_size[:, 0] - jp.where(self._fg_capsule, axis_z * self._fg_size[:, 1], 0.0)
        touching = low < self.cfg["contact_height"]
        return jp.stack([jp.any(jp.where(self._fg_side == s, touching, False)) for s in (0, 1)]).astype(jp.float32)

    def _fresh_info(self, rng, start=None, track=None):
        rng, k1, k2, k3 = jax.random.split(rng, 4)
        if track is None:
            track = jax.random.randint(k1, (), 0, self._n_tracks)
        if start is None:
            start = jax.random.randint(k2, (), 0, self._max_start)
            forced = jax.random.uniform(k3) < self.forced_start_prob
            if self._forced_range is None:
                fstart = min(self._forced_start, self._max_start - 1)
            else:                                    # own key, so the default RNG stream is unchanged
                lo, hi = self._forced_range
                fstart = jp.minimum(jax.random.randint(jax.random.fold_in(k3, 1), (), lo, hi + 1),
                                    self._max_start - 1)
            start = jp.where(forced, fstart, start)
        return dict(
            rng=rng, track=jp.asarray(track, jp.int32), start=jp.asarray(start, jp.int32),
            ep_step=jp.zeros((), jp.int32), prev_action=jp.zeros(self._nu), m_lp=jp.zeros(()),
            prev_contact=jp.ones(2),
        )

    def _obs(self, data, info, contact):
        R = data.xmat[self._torso]
        grav = R.T @ jp.array([0.0, 0.0, -1.0])
        angvel = data.qvel[3:6]
        linvel = R.T @ data.qvel[0:3]
        f = self._feat(info)
        C = self.C
        bp, brp = 2 * jp.pi * f[C["beat_phase"]], 2 * jp.pi * f[C["bar_phase"]]
        music = [
            jp.array([jp.sin(bp), jp.cos(bp), jp.sin(brp), jp.cos(brp), f[C["onset"]],
                      f[C["energy"]], f[C["after_drop"]]]),
            f[self._n_scalar:],
        ]
        # optional blocks are appended last, in this order, so padded checkpoints line up
        if self.cfg["phrase_clock"]:
            idx = jp.clip(info["start"] + info["ep_step"], 0, self._T - 1)
            pp = 2 * jp.pi * (idx - self._phrase_anchor * FPS) / self._phrase_steps
            music.append(jp.array([jp.sin(pp), jp.cos(pp)]))
        if self.cfg["heading_obs"]:
            h = R[0:2, 0] / (jp.linalg.norm(R[0:2, 0]) + 1e-6)       # torso x-axis yaw: (cos, sin)
            music.append(jp.array([h[1], h[0]]))
        if self.cfg["music_obs_v2"]:
            k32 = jp.round(f[C["count_in_32"]]).astype(jp.int32)
            sp = 2 * jp.pi * f[C["section_phase"]]
            music += [jp.array([f[C["snare"]], f[C["downbeat"]], f[C["backbeat_pulse"]], f[C["is_breakdown"]]]),
                      jax.nn.one_hot(k32, 4), jp.array([jp.sin(sp), jp.cos(sp)])]
        music = jp.concatenate(music)
        return jp.concatenate([
            data.qpos[7:], data.qvel[6:], grav, angvel, data.xpos[self._pelvis, 2:3], linvel,
            contact, info["prev_action"], music,
        ])

    # ------------------------------------------------------------------ reset / step
    def reset(self, rng: jax.Array) -> mjx_env.State:
        return self.reset_at(rng)

    def _reset_pose(self, kq, info):
        """(qpos, qvel) of the initial physics state: standing + uniform joint noise. Phase 2's TrackEnv
        overrides this for reference-state init; the base result does not depend on info."""
        noise = self.cfg["init_noise"] * jax.random.uniform(kq, (self._nu,), minval=-1, maxval=1)
        q = self._qpos0.at[7:].add(noise)
        q = q.at[7:].set(jp.clip(q[7:], self._jrange[:, 0], self._jrange[:, 1]))
        return q, jp.zeros(self._mj_model.nv)

    def reset_at(self, rng, start=None, track=None) -> mjx_env.State:
        rng, kq = jax.random.split(rng)
        info = self._fresh_info(rng, start, track)      # (consumes only `rng`, so the order vs kq is free)
        q, qd = self._reset_pose(kq, info)
        data = mjx_env.make_data(self._mj_model, qpos=q, qvel=qd,
                                 ctrl=jp.zeros(self._nu), impl="jax")
        data = mjx.forward(self._mjx_model, data)
        contact = self._contacts(data)
        info["prev_contact"] = contact
        info["prev_ee"] = data.xpos[self._ee]
        info["hist"] = jp.zeros((HIST, 24))
        info["m_hist"] = jp.zeros(BAR_STEPS)
        if self.cfg["spin_penalty"]:
            info["wz_hist"] = jp.zeros(BAR_STEPS)
        cfg = self.cfg
        w = self.weights
        if w["bounce"] != 0.0:
            info["z_hist"] = jp.zeros(BAR_STEPS)
        if w["weight_transfer"] != 0.0:
            info["lat_hist"] = jp.zeros(BAR_STEPS)
        if cfg["accent_mode"] == "arrive":
            info["mu_lp"] = jp.zeros(())
            info["mu_hist"] = jp.zeros(BAR_STEPS)
        if cfg["drift_vel_penalty"]:
            info["vxy_hist"] = jp.zeros((BAR_STEPS, 2))
        if w["torso_rock"] != 0.0:
            info["roll_hist"] = jp.zeros(BAR_STEPS)
        if self._mirror_alt:
            info["hist"] = jp.zeros((HIST, 27))          # + heading-frame head - pelvis (cols 24:27)
        if self._aaba:
            info["hist"] = jp.zeros((HIST, 27))          # + heading-frame head - pelvis (cols 24:27)
            info["pose_sum"] = jp.zeros(24)
            info["D_hist"] = jp.zeros((self._dhist, 24))
        info["terms"] = {k: jp.zeros(()) for k in TERMS}
        obs = self._obs(data, info, contact)
        metrics = {f"r_{k}": jp.zeros(()) for k in TERMS}
        metrics.update(fell=jp.zeros(()), motion_energy=jp.zeros(()))
        return mjx_env.State(data, obs, jp.zeros(()), jp.zeros(()), metrics, info)

    def step(self, state: mjx_env.State, action: jax.Array) -> mjx_env.State:
        cfg, info = self.cfg, dict(state.info)
        C, W = self.C, self.weights
        action = jp.clip(action, -1.0, 1.0)
        data = mjx_env.step(self._mjx_model, state.data, action, self.n_substeps)

        s = info["ep_step"]                    # index of this post-step sample in the episode
        first = s == 0
        # features at the new song time
        nxt = dict(info, ep_step=s + 1)
        f = self._feat(nxt)
        row = jp.clip(info["start"] + s + 1, 0, self._T - 1)      # bank row of f
        after = f[C["after_drop"]]
        pre = 1.0 - after
        onset = f[C["onset"]]
        if cfg["accent_signal"] == "grid_kick":      # static python branch, jit/vmap safe
            if self.version == 2:                    # v2: grid pulse column (sigma 40 ms) on the v2 grid
                pulse = f[C["beat_pulse"]]
            else:
                phi = f[C["beat_phase"]]
                d = jp.minimum(phi, 1.0 - phi)
                pulse = jp.exp(-d ** 2 / (2.0 * cfg["accent_pulse_sigma"] ** 2))
            accent = jp.clip(jp.maximum(pulse, f[C["kick"]]), 0.0, 1.0)
        else:
            accent = onset

        # ---- kinematics
        R = data.xmat[self._torso]
        pelvis = data.xpos[self._pelvis]
        head = data.xpos[self._head]
        ee = data.xpos[self._ee]
        dt = cfg["ctrl_dt"]
        ee_vel = jp.where(first, 0.0, (ee - info["prev_ee"]) / dt)
        speeds = jp.linalg.norm(ee_vel, axis=-1)
        m_prev = jp.where(first, 0.0, info["m_lp"])
        m = m_prev + self._alpha * (jp.mean(speeds) - m_prev)      # 10 Hz low-passed motion energy
        q = data.qpos[7:]
        contact = self._contacts(data)

        # ---- motion-energy history (1 bar) -> m_hat
        m_hist = info["m_hist"].at[s % BAR_STEPS].set(m)
        mask = (jp.arange(BAR_STEPS) <= s) | (s >= BAR_STEPS)
        m_bar = jp.sum(m_hist * mask) / jp.sum(mask)
        m_hat = m / jp.maximum(m_bar, cfg["m_floor"])
        bar_mean = lambda h: jp.sum(h * mask) / jp.sum(mask)

        # ---- yaw rate (world z of the root angular velocity; qvel[3:6] is body-frame for a free
        # joint, so wz = (R w)_z = -grav_body . w, which the policy observes) -> 1-bar mean
        if cfg["spin_penalty"]:
            wz = (data.xmat[self._torso] @ data.qvel[3:6])[2]
            wz_hist = info["wz_hist"].at[s % BAR_STEPS].set(wz)
            wz_bar = jp.sum(wz_hist * mask) / jp.sum(mask)
            spin = wz_bar ** 2
        else:
            spin = jp.zeros(())

        if cfg["drift_vel_penalty"]:
            vxy_hist = info["vxy_hist"].at[s % BAR_STEPS].set(data.qvel[0:2])   # free joint: world-frame lin vel
            vbar = jp.sum(vxy_hist * mask[:, None], 0) / jp.sum(mask)
            drift_vel = jp.sum(vbar ** 2)
        else:
            drift_vel = jp.zeros(())

        # ---- pose history
        hxy = R[0:2, 0] / (jp.linalg.norm(R[0:2, 0]) + 1e-6)       # torso heading (cos, sin)
        aaba = self._aaba
        pose = jp.concatenate([q, head - pelvis])
        hist = info["hist"]
        if aaba:
            hp = head - pelvis                       # head - pelvis in the heading frame (fwd, left, up)
            hp_h = jp.array([hp[0] * hxy[0] + hp[1] * hxy[1], -hp[0] * hxy[1] + hp[1] * hxy[0], hp[2]])
            old = hist[(s - BAR_STEPS) % HIST]       # the sample that leaves the 1-bar window
            pose_d = jp.concatenate([q, hp_h])
            pose_sum = jp.where(first, 0.0, info["pose_sum"]) + pose_d \
                - jp.where(s >= BAR_STEPS, jp.concatenate([old[:21], old[24:27]]), 0.0)
            D = pose_sum / jp.minimum(s + 1, BAR_STEPS).astype(jp.float32)
            pose = jp.concatenate([pose, hp_h])
        mirror_alt = self._mirror_alt
        if mirror_alt:
            hp = head - pelvis                       # head - pelvis in the heading frame (fwd, left, up)
            hp_h = jp.array([hp[0] * hxy[0] + hp[1] * hxy[1], -hp[0] * hxy[1] + hp[1] * hxy[0], hp[2]])
            pose = jp.concatenate([pose, hp_h])
            vec = lambda p: jp.concatenate([p[:21], p[24:27]])
            Mvec = lambda v: jp.concatenate([v[:21][self._mperm], v[21:]]) * self._msign
            v_now = jp.concatenate([q, hp_h])
            v_u1, v_u2 = vec(hist[(s - EIGHT_STEPS) % HIST]), vec(hist[(s - 2 * EIGHT_STEPS) % HIST])
        lag = lambda L: hist[(s - L) % HIST]
        q_bar, q_half, q_4bar = lag(BAR_STEPS)[:21], lag(HALF_BAR_STEPS)[:21], lag(HIST)[:21]
        hist = hist.at[s % HIST].set(pose)
        win = hist[(s - jp.arange(BEAT_STEPS)) % HIST]
        wmask = (jp.arange(BEAT_STEPS) <= s)[:, None]
        rng_ = jp.max(jp.where(wmask, win, -jp.inf), 0) - jp.min(jp.where(wmask, win, jp.inf), 0)

        # ---- always-on terms
        tilt = jp.arccos(jp.clip(R[2, 2], -1.0, 1.0))
        z = pelvis[2]
        lo, hi = cfg["height_band"]
        dz = jp.maximum(lo - z, 0.0) + jp.maximum(z - hi, 0.0)
        fell = (z < cfg["fall_height"]) | jp.any(jp.isnan(data.qpos))
        a_prev = info["prev_action"]
        jr = self._jrange
        margin = cfg["joint_limit_margin"] * (jr[:, 1] - jr[:, 0])
        near = (q < jr[:, 0] + margin) | (q > jr[:, 1] - margin)
        xy = data.qpos[0:2] - self._qpos0[0:2]
        cos_yaw = R[0, 0] / (jp.linalg.norm(R[0:2, 0]) + 1e-6)
        foot_speed = jp.linalg.norm(ee_vel[3:5, 0:2], axis=-1)
        head_vz = ee_vel[0, 2]

        # ---- after-drop terms
        toggles = jp.where(first, 0.0, jp.sum(jp.abs(contact - info["prev_contact"])))
        if cfg["step_signal"] == "beat":
            kick_near = f[C["beat_pulse"]] > cfg["step_beat_threshold"]
        else:
            kidx = jp.clip(info["start"] + s + 1 + self._kick_offsets, 0, self._T - 1)
            kick_near = jp.max(self._bank[info["track"], kidx, C["kick"]]) > cfg["kick_threshold"]
        groove = jp.exp(-jp.sum((q - q_bar) ** 2) / cfg["groove_sigma"] ** 2) * (s >= BAR_STEPS)
        q_right_half = q_half[self._right_idx]
        if cfg["alternation_mirror_fix"]:
            q_right_half = q_right_half * self._mirror
        alt = jp.exp(-jp.sum((q[self._left_idx] - q_right_half) ** 2)
                     / cfg["alternation_sigma"] ** 2) * (s >= HALF_BAR_STEPS)
        if aaba or mirror_alt:
            variety = jp.zeros(())
        else:
            variety = jp.exp(-jp.sum((q - q_4bar) ** 2) / cfg["variety_sigma"] ** 2) * (s >= HIST)
        amp = jp.stack([
            jp.mean(rng_[self._arm_idx]), jp.mean(rng_[self._leg_idx]),
            jp.mean(rng_[self._torso_idx]), jp.mean(rng_[21:24]),
        ])
        if cfg["full_body_v2"]:
            amp = amp.at[0].set(jp.minimum(amp[0], cfg["full_body_arm_cap"]))
            full_body = jp.sum(jp.asarray(cfg["full_body_group_weights"], jp.float32)
                               * jp.sqrt(jp.maximum(amp, 0.0)))
        else:
            full_body = jp.sum(jp.sqrt(jp.maximum(amp, 0.0)))
        energy_match = (m_bar / cfg["m_ref"] - f[C["energy"]]) ** 2

        # ---- round 4 terms (each computed only when used; 0 otherwise)
        zero = jp.zeros(())
        new = {}
        phi = f[C["beat_phase"]]
        any_contact = jp.max(contact)
        if W["bounce"] != 0.0:
            z_hist = info["z_hist"].at[s % BAR_STEPS].set(z)
            z_ref = -cfg["bounce_a1"] * jp.cos(2 * jp.pi * phi) + cfg["bounce_a2"] * jp.cos(4 * jp.pi * f[C["bar_phase"]])
            new["bounce"] = after * any_contact * jp.exp(-(((z - bar_mean(z_hist)) - z_ref) / cfg["bounce_sigma"]) ** 2)
        if W["knee_bend"] != 0.0:
            flex = -jp.mean(q[self._knee_idx])                            # rad, + = bent
            new["knee_bend"] = after * jp.exp(-((jp.degrees(flex) - cfg["knee_target_deg"])
                                                / cfg["knee_sigma_deg"]) ** 2)
        arrive = cfg["accent_mode"] == "arrive"
        if arrive:
            mu_prev = jp.where(first, 0.0, info["mu_lp"])
            mu = mu_prev + self._alpha * (jp.mean(speeds[self._hand_head]) - mu_prev)   # hands + head
            mu_hist = info["mu_hist"].at[s % BAR_STEPS].set(mu)
            mu_den = jp.maximum(bar_mean(mu_hist), cfg["m_floor"])
            s_hat = mu / mu_den
            decel = jp.clip(jp.maximum(-(mu - mu_prev) / dt, 0.0) / mu_den / cfg["arrive_decel_ref"],
                            0.0, cfg["arrive_decel_cap"]) * (s > 0)
            delta = jp.mod(phi + 0.5, 1.0) - 0.5                         # signed beats to nearest beat
            nb = jp.clip(row - jp.round(delta * song.BEAT * FPS).astype(jp.int32), 0, self._T - 1)
            nbw = jp.clip(nb + jp.arange(-2, 3), 0, self._T - 1)
            tr = info["track"]
            a_b = 0.5 + 0.5 * jp.clip(jp.maximum(self._bank[tr, nb, C["backbeat_pulse"]],
                                                 jp.max(self._bank[tr, nbw, C["snare"]])), 0.0, 1.0)
            inw = lambda w: ((delta >= w[0]) & (delta < w[1])).astype(jp.float32)
            new["arrive_approach"] = after * a_b * inw(cfg["arrive_approach_window"]) * s_hat
            new["arrive_decel"] = after * a_b * inw(cfg["arrive_decel_window"]) * decel
            new["arrive_hold"] = after * a_b * inw(cfg["arrive_hold_window"]) * s_hat ** 2
            if W["arrive_early"] != 0.0:
                new["arrive_early"] = after * a_b * inw(cfg["arrive_early_window"]) * s_hat
        if W["nod"] != 0.0:
            w_pitch = data.qvel[4]                   # body-frame angular velocity about the torso's y (left) axis
            new["nod"] = after * jp.clip(w_pitch * jp.cos(2 * jp.pi * (phi + cfg["nod_phase"])),
                                         -cfg["nod_clip"], cfg["nod_clip"])
        if W["weight_transfer"] != 0.0:
            left = jp.array([-hxy[1], hxy[0]])
            lat = jp.dot(pelvis[0:2] - 0.5 * (ee[3, 0:2] + ee[4, 0:2]), left)
            lat_hist = info["lat_hist"].at[s % BAR_STEPS].set(lat)
            if cfg["weight_transfer_phase"] != 0.0:
                tgt = cfg["weight_transfer_w"] * jp.sin(2 * jp.pi * (f[C["bar_phase"]] + cfg["weight_transfer_phase"]))
            else:
                tgt = cfg["weight_transfer_w"] * jp.sin(2 * jp.pi * f[C["bar_phase"]])
            new["weight_transfer"] = after * any_contact * jp.exp(
                -(((lat - bar_mean(lat_hist)) - tgt) / cfg["weight_transfer_sigma"]) ** 2)
        if W["torso_rock"] != 0.0:
            # torso z-axis in the heading frame: lean about the forward axis (+ = top of the torso to the left)
            zx = R[0, 2] * (-hxy[1]) + R[1, 2] * hxy[0]
            roll = jp.degrees(jp.arctan2(zx, R[2, 2]))
            roll_hist = info["roll_hist"].at[s % BAR_STEPS].set(roll)
            if cfg["torso_rock_phase"] != 0.0:
                tgt = cfg["torso_rock_deg"] * jp.sin(2 * jp.pi * (f[C["bar_phase"]] + cfg["torso_rock_phase"]))
            else:
                tgt = cfg["torso_rock_deg"] * jp.sin(2 * jp.pi * f[C["bar_phase"]])
            torso_rock = after * jp.exp(-(((roll - bar_mean(roll_hist)) - tgt) / cfg["torso_rock_sigma_deg"]) ** 2)
        else:
            torso_rock = jp.zeros(())
        if aaba:
            D_hist = info["D_hist"]
            NH = self._dhist
            unit = jp.round(f[C["eight_count_idx"]]).astype(jp.int32)
            k32 = jp.round(f[C["count_in_32"]]).astype(jp.int32)

            def lagged(n):                           # D n 8-counts back: (squared distance, same-section ok, cross ok)
                L = n * EIGHT_STEPS
                lrow = jp.clip(row - L, 0, self._T - 1)
                lunit = jp.round(self._bank[info["track"], lrow, C["eight_count_idx"]]).astype(jp.int32)
                ok = (s >= L + BAR_STEPS - 1) & (row - L >= 0) & (lunit == unit - n)
                same = self._sec[info["track"], lrow] == self._sec[info["track"], row]
                d2 = jp.sum((D - D_hist[(s - L) % NH]) ** 2)
                return d2, ok & same, ok & ~same

            sim = lambda d2: jp.exp(-d2 / cfg["aaba_sigma"] ** 2)
            d21, ok1, cross1 = lagged(1)
            d22, ok2, _ = lagged(2)
            if cfg["structure"] == "aaba":
                new["aaba_same"] = after * (((k32 == 1) & ok1) * sim(d21) + ((k32 == 3) & ok2) * sim(d22))
                new["aaba_contrast"] = after * ((k32 == 2) & ok1) * (1.0 - sim(d21))
            else:                                    # aaba2
                d23, ok3, _ = lagged(3)
                same3 = jp.where(ok3, sim(d23), sim(d22))
                new["aaba_same"] = after * (((k32 == 1) & ok1) * sim(d21) + ((k32 == 3) & (ok3 | ok2)) * same3)
                d1 = jp.sqrt(d21 + 1e-12)
                new["aaba_contrast"] = after * ((k32 == 2) & ok1) * jp.minimum(d1 / cfg["aaba_contrast_ref"], 1.0)
            new["aaba_section"] = after * ((k32 == 0) & cross1) * sim(d21)
            D_hist = D_hist.at[s % NH].set(D)
        if mirror_alt:
            tr = info["track"]

            def sec_ok(L):                           # lagged sample inside the episode and the same section
                lrow = jp.clip(row - L, 0, self._T - 1)
                return (s >= L) & (row - L >= 0) & (self._sec[tr, lrow] == self._sec[tr, row])

            d2m = jp.sum((v_now - Mvec(v_u1)) ** 2)
            gate = jp.ones(())
            if cfg["mirror_alt_asym_ref"] > 0:
                gate = jp.minimum(jp.sum((v_now - Mvec(v_now)) ** 2) / cfg["mirror_alt_asym_ref"] ** 2, 1.0)
            new["mirror_alt"] = after * sec_ok(EIGHT_STEPS) * jp.exp(-d2m / cfg["mirror_alt_sigma"] ** 2) * gate
            new["aaba_same"] = after * sec_ok(2 * EIGHT_STEPS) * jp.exp(
                -jp.sum((v_now - v_u2) ** 2) / cfg["mirror_same_sigma"] ** 2)

        terms = dict(
            upright=jp.exp(-4.0 * tilt ** 2),
            height=jp.maximum(0.0, 1.0 - (dz / cfg["height_falloff"]) ** 2),
            fall=fell.astype(jp.float32),
            torque=jp.sum(action ** 2),
            action_rate=jp.sum((action - a_prev) ** 2),
            joint_limits=jp.sum(near).astype(jp.float32),
            drift=jp.maximum(0.0, jp.linalg.norm(xy) - cfg["drift_leash"]),
            facing=(jp.arctan2(R[1, 0], R[0, 0]) ** 2) if cfg["facing_mode"] == "sq" else 1.0 - cos_yaw,
            foot_slide=jp.sum(foot_speed * contact),
            stillness=pre * m,
            idle_bob=pre * jp.clip(head_vz * jp.cos(2 * jp.pi * f[C["beat_phase"]]),
                                   -cfg["idle_bob_clip"], cfg["idle_bob_clip"]),
            accent_on=zero if arrive else after * m_hat * accent,
            accent_off=zero if arrive else
            after * (m_hat if cfg["accent_off_power"] == 1 else m_hat ** cfg["accent_off_power"])
            * (1.0 - accent),
            step_on_kick=after * toggles * kick_near,
            groove=after * groove,
            alternation=after * alt,
            full_body=after * full_body,
            energy_match=after * energy_match,
            variety=after * variety,
            drop_bonus=f[C["drop_window"]] * m_hat,
            spin=spin,
        )
        for k in TERMS[TERMS.index("bounce"):TERMS.index("drift_vel")]:
            terms[k] = new.get(k, zero)
        terms["drift_vel"] = drift_vel
        terms["torso_rock"] = torso_rock
        terms["arrive_early"] = new.get("arrive_early", zero)
        terms["mirror_alt"] = new.get("mirror_alt", zero)
        terms = {k: jp.nan_to_num(v) for k, v in terms.items()}
        weighted = {k: self.weights[k] * terms[k] for k in TERMS}
        reward = sum(weighted.values())

        # ---- next info
        info.update(ep_step=s + 1, prev_action=action, m_lp=m, prev_contact=contact, prev_ee=ee,
                    hist=hist, m_hist=m_hist, terms=terms)
        if cfg["spin_penalty"]:
            info["wz_hist"] = wz_hist
        if cfg["drift_vel_penalty"]:
            info["vxy_hist"] = vxy_hist
        if W["bounce"] != 0.0:
            info["z_hist"] = z_hist
        if W["weight_transfer"] != 0.0:
            info["lat_hist"] = lat_hist
        if arrive:
            info.update(mu_lp=mu, mu_hist=mu_hist)
        if W["torso_rock"] != 0.0:
            info["roll_hist"] = roll_hist
        if aaba:
            info.update(pose_sum=pose_sum, D_hist=D_hist)
        obs = self._obs(data, info, contact)
        if self.auto_reset_info:
            rng, k = jax.random.split(info["rng"])
            info["rng"] = rng
            over = fell | (s + 1 >= self.episode_steps)
            fresh = self._fresh_info(k)
            for key, val in fresh.items():
                if key != "rng":
                    info[key] = jp.where(over, val, info[key])

        metrics = dict(state.metrics)  # keep keys added by wrappers (e.g. brax EvalWrapper's 'reward')
        metrics.update({f"r_{k}": weighted[k] for k in TERMS})
        metrics.update(fell=fell.astype(jp.float32), motion_energy=m)
        return state.replace(data=data, obs=obs, reward=reward, done=fell.astype(jp.float32),
                             metrics=metrics, info=info)


# ---------------------------------------------------------------------- construction helpers
def feature_bank_from_config(cfg: dict, root: str = ".") -> np.ndarray:
    import os
    src = cfg.get("music_source", "song")
    if src == "metronome":
        mc = cfg.get("metronome", {})
        dur = cfg["env"].get("episode_seconds", 16.0) + 1.0
        bank, _ = song.metronome_bank(int(mc.get("n_tracks", 256)), dur, int(mc.get("seed", 0)),
                                      (float(mc.get("bpm_min", 90)), float(mc.get("bpm_max", 130))),
                                      version=int(cfg.get("features_version", 1)))
        return bank
    return song.load_table(os.path.join(root, cfg["features"]))


def make_env(cfg: dict, root: str = ".", **kw) -> DanceEnv:
    bank = kw.pop("feature_bank", None)
    if bank is None:
        bank = feature_bank_from_config(cfg, root)
    env_cfg = dict(cfg.get("env", {}))
    env_cfg["features_version"] = int(cfg.get("features_version", env_cfg.get("features_version", 1)))
    if cfg.get("music_source", "song") == "metronome":
        env_cfg["forced_start_prob"] = 0.0
        if env_cfg.get("phrase_anchor") is None:
            env_cfg["phrase_anchor"] = 0.0
    return DanceEnv(env_cfg, cfg.get("reward_weights", {}), bank, **kw)
