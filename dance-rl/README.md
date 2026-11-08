# dance-rl

A simulated humanoid learns to dance to *Now Get Busy* with RL and no motion data.
The spec is in [PLAN.md](PLAN.md). Code is in `src/dance_rl/`, configs are in `configs/`, and
the tuning log is `experiments.md`.

- **Model:** the mujoco_playground dm_control-suite capsule Humanoid (21 hinge joints, 21 torque
  motors, ctrl in [-1, 1]), simulated with MJX (`impl="jax"`; mujoco_warp is not installed).
  Control runs at 50 Hz (`ctrl_dt` 0.02). Physics `sim_dt` is set in the config: 0.004 s, so
  5 substeps. On the 4090 with 4096 envs and random actions, the env alone runs 131k steps/s at
  0.002 × 10, 256k at 0.004 × 5 and 317k at 0.005 × 4. Full PPO training at 0.004 runs about
  130k env steps/s, plus about 2 min of XLA compile at startup.
- **Observation:** 107 dims. The music part is the same in every stage, so checkpoints carry
  over from one stage to the next.
- **RL:** Brax PPO with 4096 envs and 16 s episodes (800 steps). 20% of episodes start at 4.0 s.
- **Music:** `dance_rl.song` builds a 50 Hz feature table. The beat grid is anchored at the drop
  (8.37 s).

## Box workflow (run from the Mac, inside `dance-rl/`)

`remote/run.sh <name> <cmd>` rsyncs this folder to `~/dance-rl` on the box. It then runs `<cmd>`
there in tmux session `<name>`, with `PYTHONPATH=src` and `MUJOCO_GL=egl`, and logs to
`~/dance-rl/logs/<name>.log`. When the command exits, it appends `RUN_DONE <name> <rc>` to that
log. `remote/pull.sh [run]` copies `runs/` back here: videos, PNGs, metrics, logs and
latest/final checkpoints.

```bash
# 0. song features (once)
remote/run.sh song python3 -m dance_rl.song --mp3 now-get-busy.mp3 --out features/now-get-busy.features.npz

# 1. stage 1: stand (~30M steps)
remote/run.sh s1 python3 -m dance_rl.train --config configs/stage1_stand.yaml --run-name s1

# 2. stage 2: metronome, starting from stage 1
remote/run.sh s2 python3 -m dance_rl.train --config configs/stage2_metronome.yaml \
    --init-checkpoint runs/s1/checkpoints/final.pkl --run-name s2

# 3. stage 3: the song, starting from stage 2 (the tuning loop runs here; use --steps for half-length variants)
remote/run.sh s3_r01 python3 -m dance_rl.train --config configs/stage3_song.yaml \
    --init-checkpoint runs/s2/checkpoints/final.pkl --run-name s3_r01

# score + render a checkpoint (one command, chained)
R=s3_r01; remote/run.sh eval_$R "python3 -m dance_rl.rollout --checkpoint runs/$R/checkpoints/final.pkl --out runs/$R/rollout.npz && \
  python3 -m dance_rl.rollout --checkpoint runs/$R/checkpoints/final.pkl --episodes 100 --out runs/$R/episodes.npz && \
  python3 -m dance_rl.metrics --rollout runs/$R/rollout.npz --episodes runs/$R/episodes.npz --out runs/$R/metrics.json && \
  python3 -m dance_rl.render --rollout runs/$R/rollout.npz --contact-sheets --outdir runs/$R/sheets && \
  python3 -m dance_rl.render --rollout runs/$R/rollout.npz --song now-get-busy.mp3 --out runs/$R/dev.mp4"
remote/pull.sh $R

# final 1080p60 orbiting video
remote/run.sh final_$R python3 -m dance_rl.render --rollout runs/$R/rollout.npz --song now-get-busy.mp3 --final --out runs/$R/final.mp4
```

`dance_rl/compat.py` re-exposes `jax.device_put_replicated`, which brax 0.14.2 still calls and
jax 0.11.2 turned into a deprecation error. `train.py` imports it before brax.

Quick test: `python3 -m dance_rl.train --config configs/stage1_stand.yaml --smoke` (64 envs, 20k steps).
Other train flags: `--steps N` overrides `ppo.num_timesteps`, `--num-envs N`, `--seed`.
`runs/<run>/progress.jsonl` gets one JSON line per eval, with `eval/episode_reward`,
`per_step/<term>` (the weighted per-step mean of each reward term), `fall_rate` (fraction of
eval episodes that fell), `sps_window`, and Brax's training losses.

## Reward terms → code

Each term in PLAN §4 is a raw value computed in `DanceEnv.step` (`env.py`) and multiplied by
`reward_weights.<term>` from the YAML. Weights carry the sign. For example, `torque: -0.01` and
the raw value is `Σa²`. Raw values go in `state.info["terms"]`, and the weighted values go in
`state.metrics["r_<term>"]`. The pre-drop terms are multiplied by `1 - after_drop` and the
post-drop terms by `after_drop`.

Choices where the plan was ambiguous:
- `accent` is split into `accent_on` (`m̂·onset`, w = +2) and `accent_off` (`m̂·(1−onset)`, w = −1),
  so both coefficients are tunable.
- `m̂ = m / max(1-bar mean of m, m_floor=0.1 m/s)`. The floor stops a still body from blowing up m̂.
- `energy match` uses `(1-bar mean of m) / m_ref` (m_ref = 1.5 m/s) instead of the 1-bar mean of m̂.
  m̂'s own 1-bar mean is about 1 by construction, so the term would carry no signal.
- `groove`, `alternation` and `variety` compare poses pointwise at lags of 106, 53 and 425 steps.
  425 steps is exactly 4 bars. They read a 425-step ring buffer of joint positions. `variety`
  uses exp(−‖q(t) − q(t − 4 bars)‖²/σ²), which is the per-step version of comparing bar k with
  bar k−4. A lagged term is 0 until the episode has that much history.
- `alternation` uses left/right legs and arms (9 joints per side). The XML already mirrors the
  joint axes, so `q_left` and `q_right` are compared directly.
- `full body` groups: arms (shoulder1/2, elbow ×2), legs (hip xyz, knee, ankle yx ×2) and torso
  (abdomen z/y/x). The amplitude is the mean per-joint range over the last 27 steps (one beat).
  The model has no neck joint, so `head` is the range of the head position relative to the
  pelvis, in meters.
- `step on kick` counts foot-contact toggles (0→1 or 1→0, either foot). A toggle counts if
  `kick > 0.5` anywhere in ±3 steps (±60 ms). Contact means the lowest point of the foot capsule
  is below 2 cm.
- `idle bob` is clipped to ±0.1. `height` is 1 inside [0.8, 1.3] m pelvis z, otherwise
  `max(0, 1 − (d/0.3)²)`. PLAN says 0.9, but this model stands with its pelvis at 0.86 m, so 0.9
  would push it onto its toes. `fall` is −10 when pelvis z < 0.7, and the episode ends.
- `joint limits` is implemented as written. The knee's upper limit is 0.03 rad, which is
  basically straight, so straight knees always cost −1 each. In practice the policy learns soft
  knees within a few million steps.
- `drift` is measured from the spawn point (0, 0). `facing` uses the torso's x-axis yaw relative
  to +x. The camera sits on +x looking back at the humanoid.
- `m` is the mean world-frame speed of the head, hands and feet, from 50 Hz finite differences,
  passed through a first-order 10 Hz low-pass.

## Round 4 flags (all default off; v1 configs and checkpoints run unchanged)

Defaults reproduce round 3 bit-exactly (checked: identical actions and rewards over 400 steps).
New terms are appended to the end of `TERMS` and obs blocks to the end of the obs vector, so
`train.pad_obs_params` (and `rollout`, which pads too) can grow older checkpoints.
- `features_version: 2` (top level): v2 table (`features/now-get-busy.v2.features.npz`, grid anchored
  at 8.6304 s, claps on 2 and 4). `grid_kick` then uses the `beat_pulse` column. Rollouts store
  `features_version` / `grid_anchor`, and `metrics` / `render` use that grid (claps drawn in cyan).
- obs: `env.heading_obs` (+2: sin/cos torso yaw), `env.music_obs_v2` (+10: snare, downbeat,
  backbeat_pulse, is_breakdown, one-hot count_in_32, sin/cos section_phase). 107 → 109 → 119.
- terms: `bounce`, `knee_bend`, `nod`, `env.full_body_v2`, `env.accent_mode: arrive`
  (`arrive_approach` / `arrive_decel` / `arrive_hold`), `weight_transfer`, `env.step_signal: beat`,
  `env.alternation_mirror_fix` (flips shoulder1, shoulder2, ankle_x), `env.structure: aaba`
  (`aaba_same` / `aaba_contrast` / `aaba_section`), `env.drift_vel_penalty` + `drift_vel`.
  Formulas are in the `DEFAULT_ENV` comments in `env.py`.

## Round 5 additions (all default off / unchanged; round-4 configs reproduce bit-exactly)

Checked: s4/b_arrive and s4/c_structure give identical actions, rewards and terms over 450 steps
before and after the change (max |Δ| = 0).
- `env.forced_start_range: [lo, hi]` (s): a forced start (probability `forced_start_prob`) is drawn
  uniformly from [lo, hi] instead of the fixed `forced_start_time`. It uses its own key
  (`fold_in`), so configs without it keep the old RNG stream.
- `env.structure: aaba2`: same descriptor D as `aaba` (1-bar mean of q + heading-frame head − pelvis,
  synced to `eight_count_idx`, reset at section boundaries). `aaba_same` = exp(−d²/σ²) for count 1 vs
  count 0, and for count 3 vs count 0 when that history is in the episode (else count 3 vs count 1;
  16 s episodes almost never hold count 0 plus 3 units). `aaba_contrast` = min(d / `aaba_contrast_ref`, 1)
  for count 2 vs count 1 (linear, so d = 0 still gets a gradient). `aaba_section` = exp(−d²/σ²) between
  a section's first unit and the previous section's last unit (weight < 0). The D ring grows to 640.
- `reward_weights.torso_rock` (`env.torso_rock_deg` 6, `env.torso_rock_sigma_deg` 3): torso roll
  (lean about the heading axis, + = left) minus its trailing 1-bar mean tracks 6°·sin(2π·bar_phase)
  after the drop, gaussian like `bounce`. Appended last in `TERMS`.
- `train.py` also writes `checkpoints/best.pkl` (+ `best.json`): the trained eval checkpoint
  (step > 0) with the lowest eval `fall_rate`, ties → the latest. Eval chains use `best.pkl`.
- `metrics.py` adds `bounce_corr`, `travel_m_per_s` (mean |1-bar mean root xy velocity| after the
  drop), `travel_net_m`, `mean_cos_yaw` and `score_v2` (weights in `SCORE_V2_WEIGHTS`). The old
  `score` is kept unchanged.

## Round 6 additions (all default off / unchanged; round-5 configs reproduce bit-exactly)

- `env.facing_mode: sq` (default `cos`): the `facing` raw value becomes yaw² (rad², yaw = wrapped torso heading
  relative to +x, the camera direction), so 20° costs 0.12 instead of 1 − cos = 0.06.
- `reward_weights.arrive_early` + `env.arrive_early_window` (default [−0.35, −0.20] beat = −186…−106 ms): in
  arrive mode, `a_b · [δ in window] · ŝ` (weight < 0) charges hands+head speed well before the beat, so the
  hits stop creeping earlier. `arrive_approach_window` was already configurable (default unchanged).
- `env.torso_rock_phase` / `env.weight_transfer_phase` (cycles, default 0): targets become
  `R sin(2π(bar_phase + phase))`. s5_c's own torso roll fits −0.415 and its lateral weight shift −0.455
  (≈ anti-phase to the round-5 targets).
- `env.structure: mirror_alt`: A, A′, A, A′ per 8-count (1 unit = 212 steps). v = [q, heading-frame
  head − pelvis]; M = left/right swap with shoulder1/shoulder2/ankle_x flipped, abdomen_z/abdomen_x flipped
  and the lateral head offset negated (`dance_rl/mirror.py`; checked against forward kinematics: M q reflects
  every body). `mirror_alt` = exp(−‖v(t) − M v(t − 1 unit)‖²/`mirror_alt_sigma`²) · gate, gate =
  min(‖v − M v‖²/`mirror_alt_asym_ref`², 1) when the ref is > 0 (a left/right-symmetric 1-unit loop satisfies
  the mirror relation trivially). `aaba_same` = exp(−‖v(t) − v(t − 2 units)‖²/`mirror_same_sigma`²). Both need
  the lag inside the episode and in the same section. Uses the 425-step pose ring (27 columns).
- `metrics.py`: `beat_stop_align_ms` / `clap_stop_align_ms` (per beat / clap, the nearest post-hit stop
  within half a beat, median signed offset), `mirror_sim` (corr of q(t) with M q(t − 212)), `same_unit_sim`,
  `self_sym` (corr of q with M q: high = symmetric movement), `asym_rms_deg`. `score_v2_version` 2: the
  `on_beat` and `clap` parts are `1 − min(|beat_stop_align_ms|, 80)/80` and `1 − min(|clap_stop_align_ms|, 80)/80`
  (same weights); the round-5 value is kept as `score_v2_v1`.
- `render.py --contact-sheets --times 40,44.25,100`: sheet times (40 and 44.25 = two consecutive 8-counts).

## Phase 2: motion-data imitation (PLAN §14; all flag-gated, phase-1 configs reproduce bit-exactly)

Checked: s6/c_long gives identical actions, rewards, obs and terms over 450 steps at two song positions, old
vs new `env.py` (max |Δ| = 0). s6_c's `best.pkl` padded 119 → 200 inputs acts exactly like the parent in the
track env (max |Δ action| = 0 on 450 states, both with the new block zero and with random values in it, and in
closed loop over 450 steps vs the phase-1 env).

- **Library.** `data/library/moves.npz` via `dance_rl.motion_lib.MotionLibrary` (602 AIST++ gLH/gMH 8-counts,
  213 frames at 50 Hz, re-rooted, + mirrored copies). `dance_rl/track_ref.py` adapts it: `track.filter` picks
  moves from the manifest (`in_place`, `max_speed_factor`, `genre`, `style`, `min_loopability`,
  `max_pelvis_drop`, `ids`, `max_moves`), each kept move gets its mirrored copy, and everything the env needs
  is precomputed per frame with CPU MuJoCo FK (end effectors, gravity in the torso frame, root velocities,
  AMP features, yaw-normalised RSI states). `python -m dance_rl.track_ref --library data/library/moves.npz
  --in-place --max-speed-factor 1.2` prints the moves and the song schedule. A stand-in library from a
  phase-1 rollout: `python -m dance_rl.track_ref --synth-from runs/s6_c/rollout.npz --out runs/synth_lib/moves.npz`
  (`DANCE_TRACK_LIBRARY=<npz>` overrides `track.library`).
- **Env** (`mode: track` → `dance_rl/track_env.py`, `TrackEnv(DanceEnv)`). The only change to `env.py` is a
  `_reset_pose` hook (reset order changed, RNG stream unchanged). Song unit u starts at 8.6304 + 4.25 u s; the
  reference at song row r is move(u) at frame ⌊212.5 · pos⌋ (IDLE = standing before unit 0). move(u) comes from
  the episode's 1–3 random moves (`track.sequence`, cycled per 8-count) or from the choreographer
  (`track.choreo: section_energy`: moves ranked by end-effector speed + travel into 3 tiers; breakdowns → small,
  top-third energy → large, else medium; A, A′, B, B′ per section with ′ = mirrored copy). Fusion:
  `track.fusion: {upper_move, lower_move}` or `track.fusion_random: true` (abdomen + arms + head/hand targets
  from the upper move, legs/feet/root from the lower). Reset = RSI (`rsi_prob`, `rsi_noise`, reference
  velocity). Early termination: rms joint error > `term_rms` or root below the reference by `term_height`
  (with `term_grace` steps after the start and after each unit boundary); the fall check becomes
  reference-relative (`track.fall_rel`: pelvis z < reference pelvis z − 0.25 m counts as `fell` and pays
  `fall`; set `env.fall_height` low, the library goes down to 0.31 m). `track.jump_cap: m` (default off) caps the
  reference root / pelvis height used by both checks at standing + m, so reference jumps the policy doesn't copy are not
  falls (round 1: 44 of 389 moves jump, s7_c showed 30–40% false falls; c2/d use 0.05). Training uses
  `wrap_for_track_training` (full reset on done so the physics restarts at the new reference; episode
  bookkeeping and truncation are kept).
- **Obs** = the phase-1 obs (119 for the s6 flags) + an 81-dim block appended at the END: phase sin/cos (2),
  q_ref(t+1) − q, q_ref(t+5) − q, q_ref(t+10) − q (3 × 21), move code upper (8), lower (8) → 200. Move codes
  are fixed 8-dim random vectors per move, mirror pairs share the first 4 dims and negate the last 4.
- **Rewards** (`reward_weights.track_*`, raw in `info["track_terms"]`, weighted in `r_track_*`): track_pose
  exp(−2 Σ Δq²), track_vel exp(−0.1 Σ Δq̇²), track_ee exp(−40 Σ |Δp|²) (head/hands in the torso frame, feet
  in the pelvis frame, so fused targets are exact), track_root exp(−10 Δz² − 10 |Δg|² − 0.1 Δω_z²) (tilt +
  yaw rate; heading is left to `facing`; `track_root_xy` adds heading-frame root velocity), track_fail (1 on
  early termination). Scales are `track.s_*`. Every phase-1 term keeps its weight.
- **AMP** (`amp:` block, `w_amp > 0` → `dance_rl/ppo_amp.py`, a copy of brax 0.14.2's PPO with the AMP parts
  marked `# AMP:`). D = MLP 2 × 512 over 10-frame windows of 67 per-frame features (q, q̇, root z, gravity,
  end effectors in the torso frame, root lin/ang velocity), library-normalised; LSGAN + gradient penalty
  (w_gp 10); r_amp = max(0, 1 − ¼(D − 1)²) is added to the rollout rewards before the PPO update; per PPO
  epoch `disc_minibatches` discriminator steps on `disc_batch` policy vs library windows. Checkpoints get an
  `amp` entry (params + normaliser); `amp.restore` reloads it from `init_checkpoint`.
- **train.py**: `mode: track` switches env + wrapper, logs `per_step/track_*`, `term_rate` (falls + early
  terminations; best.pkl is chosen on it in track mode), `training/amp_r`, `training/d_ref`, `training/d_pol`,
  `training/disc_loss`. A top-level `init_checkpoint:` is used when `--init-checkpoint` is absent.
- **Eval**: `rollout.py` builds the track env with the song schedule for the full-song rollout (fusion: the
  choreographer's 2nd schedule) and stores ref_qpos / ref_move / track_err / track_terms / amp_feat;
  `--episodes` stores `fell` and `terminated`; `--mirror-odd-units` mirrors the track block too.
  `metrics.py` adds track_pose_err_deg, track_ee_err_cm, amp_score (mean D after the drop; `--checkpoint`
  overrides which discriminator), amp_reward, amp_score_library, term_rate. `render.py --reference` renders
  [policy | reference] tiles (sheets 4 × 4) and a split dev video.

Configs `configs/s7/`: `a_track` (pure tracking, in-place moves with speed factor ≤ 1.2, 4096 envs, 200M),
`b_track_music` (a + arrive 0.3/0.2/−0.2, bounce 0.3, facing −1, drift −0.5, drift_vel −2), `c_amp` (b +
AMP 1.0, tracking halved, choreographer, speed factor ≤ 1.2 incl. travelling moves), `d_fusion` (c +
fusion_random). All init from `runs/s6_c/checkpoints/best.pkl` (padded).

```bash
export DANCE_HOST=root@ssh9.vast.ai DANCE_PORT=30171
remote/run.sh s7_a python3 -m dance_rl.train --config configs/s7/a_track.yaml --run-name s7_a
remote/run.sh s7_b python3 -m dance_rl.train --config configs/s7/b_track_music.yaml --run-name s7_b
remote/run.sh s7_c python3 -m dance_rl.train --config configs/s7/c_amp.yaml --run-name s7_c
remote/run.sh s7_d python3 -m dance_rl.train --config configs/s7/d_fusion.yaml --run-name s7_d
# (one at a time on the 4090, like the earlier rounds; --steps 100e6 for half-length variants)

# eval chain (same pattern; metrics picks the discriminator from the checkpoint for amp_score)
R=s7_c; remote/run.sh eval_$R "python3 -m dance_rl.rollout --checkpoint runs/$R/checkpoints/best.pkl --out runs/$R/rollout.npz && \
  python3 -m dance_rl.rollout --checkpoint runs/$R/checkpoints/best.pkl --episodes 100 --out runs/$R/episodes.npz && \
  python3 -m dance_rl.metrics --rollout runs/$R/rollout.npz --episodes runs/$R/episodes.npz --out runs/$R/metrics.json && \
  python3 -m dance_rl.render --rollout runs/$R/rollout.npz --contact-sheets --reference --times 40,44.25,100 --outdir runs/$R/sheets && \
  python3 -m dance_rl.render --rollout runs/$R/rollout.npz --reference --song now-get-busy.mp3 --out runs/$R/dev.mp4"
remote/pull.sh $R
```

`remote/run.sh` now also skips `.venv*/`, `data/raw/` and `data/library/gallery/` (the library npz +
manifest are synced). Mac smoke test (CPU): `uv venv --python 3.12 .venv-train && VIRTUAL_ENV=.venv-train uv pip
install jax==0.11.2 brax==0.14.2 mujoco mujoco-mjx playground pyyaml scipy matplotlib tqdm pillow`, then
`PYTHONPATH=src .venv-train/bin/python -m dance_rl.train --config configs/s7/c_amp.yaml --smoke --num-envs 16 --steps 6400`.

## Phase 2 round 2 additions (all default off; round-1 configs reproduce bit-exactly)

Checked on the box (`t_r2`): the round-1 `track_env.py` and the new one give identical obs, actions, rewards, dones
and track terms (max |Δ| = 0) on s7/c2_amp and s7/d_fusion over 600 closed-loop steps of the full-song rollout env and
over 60 steps of a random RSI training reset (unbatched). Batched (vmap over 8 RSI resets) they differ at 1 ulp from
step 0 and then chaotically, but so does the round-1 env against ITSELF (GPU MJX under vmap is not deterministic run
to run), so that is not a code difference. New terms are only computed when their flag / weight is on.

- **Torso tilt** `reward_weights.track_tilt`: exp(−`track.s_tilt` ‖g − g_ref‖²), g = gravity in the torso frame
  (s_tilt 10). Was only part of track_root.
- **Absolute heading** `track.heading_mode: abs` + `reward_weights.track_yaw`: exp(−`s_yaw_abs` wrap(yaw − yaw_ref)²),
  yaw_ref = the reference root yaw (moves are re-rooted so frame 0 faces +x = the camera; the dancer's turns are
  reproduced and the average facing is kept). Set `facing` to 0 with it. `track.root_obs: true` appends 15 obs dims
  (per lookahead offset [sin, cos](yaw_ref − yaw) and g_ref − g; padded checkpoints start with zero rows), so the
  policy can see where the dancer turns / leans instead of inferring it from move code + phase.
- **Amplitude** `track.penalty_scale` scales torque / action_rate / joint_limits / foot_slide, `track.upright_scale`
  scales `upright` (exp(−4 tilt²) pays for NOT leaning), `track.err_weighting: energy` multiplies the positive
  tracking terms per frame by (1 + v_ref / mean v_ref) / 2 (v_ref = mean reference end-effector speed in the
  tracking frames, `RefArrays.ee_speed`; mean 1 over the library).
- **Fused reset** `track.fusion_reset: grounded` (MJX kinematics of the fused RSI pose, root z shifted so the lowest
  foot point is 1 cm above the floor) and `track.fusion_abdomen: lower` (fused RSI abdomen from the lower move;
  reset only, the target keeps the upper move's abdomen).
- **AMP** `amp.features: full | lower` (lower: leg q / q̇, root z, gravity, root lin / ang velocity = 34 per frame;
  the checkpoint's `amp.cols` records it, metrics' D applies it; a discriminator with other features is not
  restored). `reward_weights.ankle_rate` = −Σ over the 4 ankle joints of (q̇(t) − q̇(t−1))².
- **best.pkl** `checkpoint.best: term_pose` = min(term_rate + 0.05 · track_pose_err_deg) of the eval (never step 0;
  progress.jsonl logs it as `best_score`).
- **metrics** (track rollouts): tilt_mean/p90_deg, ref_tilt_mean/p90_deg, tilt_diff_deg, heading_diff_deg,
  rom_ratio (Σ std(q) / Σ std(q_ref) per post-drop 8-count), rom_ratio_top_third.
- **render**: `--ghost` (dev video, one view, reference translucent over the policy), `--ghost --units 5,9,14,20`
  (those 8-counts back-to-back with their song slices: fusion showcase), `--final --camera front` (fixed camera).

Configs `configs/s8/`: `a_lean` (s7_c2 final + all of the above except fusion, 400M), `b_fusion` (a + fusion_random,
grounded fused resets, abdomen lower, amp.features lower, w_amp 0.3, 200M from s8_a best), `c_final` (a + 200M).

## Phase 2 round 3 additions (all default off; round-2 configs reproduce bit-exactly)

Checked on the box (`t_r3`): the round-2 `track_env.py` and the new one give identical obs, actions, rewards, dones and
track terms (max |Δ| = 0) on s8/a_lean and s8/b_fusion over 600 steps of the full-song rollout env and 300 steps of an
RSI training reset (unbatched); the shared `track_ref.build_arrays` arrays are identical (max |Δ| = 0).

- **Self-consistent fused target** `track.fused_target: fk` (default `raw`). The fused frame keeps move X's PELVIS
  (legs + stance) and puts move Y's abdomen + arms on it: torso = pelvis_X · (pelvis-in-torso of Y's abdomen)⁻¹. The
  torso tilt (gravity) / heading / root height / yaw-rate targets, the root_obs block and the rollout's `ref_qpos` come
  from that pose. `track_ref.build_arrays` stores per frame the pelvis world quaternion (RSI frame) and the pelvis pose in
  the torso frame (`pel_q`, `rel_q`, `rel_t`); the env composes them (a few quaternion ops per lookup). Checked against
  CPU MuJoCo FK of the fused qpos: pelvis orientation / height, torso gravity, yaw, all five end-effector targets agree
  to ≤ 3e-7; unfused frames are bit-identical to `raw`. On random fused pairs the `raw` tilt target was 21° (mean,
  max 68°) away from the consistent one, the heading 15°, the root height 1.9 cm. Reset: with `fusion_abdomen: lower`
  a fused RSI state is X's root + X's abdomen (= X's pelvis, as before), with `upper` the fk root.
- `track.s_vel` (already a config key) → 0.02 in s9 configs (raw track_vel on the fastest frames was 0.1–0.2).
- **metrics**: `ref_clap_stop_align_ms`, `ref_beat_stop_align_ms`, `ref_arrive_align_ms` = the same stop detector on
  the reference (`ref_qpos` FK with root xy frozen: the reference's limb + body-rotation speed, a property of the
  schedule only). The stop code is now
  `metrics.stop_metrics` (values unchanged).
- **show** (`dance_rl.show`, `mode: show` config, rollout only): the choreographer schedule with the N highest-energy
  non-breakdown units FUSED (legs = scheduled move, arms = the next-highest-energy move of the other genre, mirrored
  on ' units), the acting checkpoint switched per 8-count (`checkpoints.fused` on fused units, `unfused` elsewhere).
  `rollout.full_song` takes `setup` / `act_fn` / `extra_save` for it. `--plan-only` prints the schedule.
- **render**: split / ghost videos label every frame with its unit and, on fused units, `FUSED` + `LEGS:` / `ARMS:`.

Configs `configs/s9/`: `a_polish` (s8_a best + s_vel 0.02, AMP off, 150M), `b_fusion_fk` (s8_b best + fused_target fk +
s_vel 0.02, AMP off, 150M), `c_show` (finale rollout: the round-3 champions, s8_a best on unfused units and s9_b on the 4 fused units;
runs/s9_c, alternate with s9_a final: runs/s9_c_s9a).

```bash
remote/run.sh s9_a python3 -m dance_rl.train --config configs/s9/a_polish.yaml --run-name s9_a
remote/run.sh s9_b python3 -m dance_rl.train --config configs/s9/b_fusion_fk.yaml --run-name s9_b
remote/run.sh show python3 -m dance_rl.show --config configs/s9/c_show.yaml
remote/run.sh fin "python3 -m dance_rl.render --rollout runs/s9_c/rollout.npz --song now-get-busy.mp3 --final --camera front --out runs/s9_c/final_front.mp4"
# split (policy | reference, unit + FUSED / LEGS / ARMS labels) and the fused-unit gallery with ghost
python3 -m dance_rl.render --rollout runs/s9_c/rollout.npz --reference --song now-get-busy.mp3 --out runs/s9_c/final_split.mp4
python3 -m dance_rl.render --rollout runs/s9_c/rollout.npz --ghost --units 4,7,22,24 --song now-get-busy.mp3 --out runs/s9_c/fusion_gallery.mp4
```
