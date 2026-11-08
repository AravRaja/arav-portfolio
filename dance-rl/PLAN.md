# Dance RL — plan (not started)

Teach a simulated humanoid to dance to *Now Get Busy* (Beastie Boys) with reinforcement
learning and **no motion data**. The only "data" is the song itself. The character waits
through the intro, then starts dancing at the beat drop (8.37s), exactly where the
space-bar hold on the site lands.

## 0. Facts pulled from the repo

| thing | value | source |
|---|---|---|
| track | `public/now-get-busy.mp3`, 141.87s | ffprobe |
| bar length | 2.125s (loopEnd − loopStart) → **112.9 BPM**, beat = 0.531s | `src/audio/soundProfile.js` |
| drop hit | **8.37s** | `soundProfile.js` `dropHit` |
| intro loop | 1.235s → 3.36s | `soundProfile.js` |

The bar grid is the same grid the site already uses to land the drop, so whatever the
policy learns will line up with what the page plays.

## 1. Stack

- **Sim:** MuJoCo **MJX** (GPU, thousands of humanoids in parallel) via `mujoco_playground`
  Humanoid env (21 actuated joints, capsule body). Stretch: swap in the Unitree G1 robot
  model (same library) once the capsule guy dances.
- **RL:** Brax **PPO** (JAX). 4096 parallel envs, 50 Hz control (sim 500 Hz, action repeat 10).
- **Music analysis:** `librosa` once, offline, on the Mac → a feature file. No learning here.
- **Hardware:** Vast.ai RTX 4090. One run = 100–200M env steps ≈ 10–20 min.
- **Render:** headless MuJoCo (EGL) → PNG frames → ffmpeg, with the song muxed in and a
  beat/motion-energy strip drawn at the bottom so sync is visible at a glance.
- **Repo:** `dance-rl/` folder here (own `requirements.txt`, gitignored checkpoints/videos).
  Final exported animation JSON gets copied into `public/`.

## 2. "Formalising the music" — the song becomes a signal, not a dataset

`analyze_song.py` runs once and writes `now-get-busy.features.npz`, sampled at 50 Hz
(one row per control step, 7094 rows):

| feature | how | used for |
|---|---|---|
| `beat_phase` φ ∈ [0,1) | from the known grid (beat = 0.531s, anchored at 8.37s). librosa `beat_track` only as a cross-check | obs + reward |
| `bar_phase` | φ/4 with downbeat anchored at the drop | obs + periodicity reward |
| `onset` | librosa onset-strength envelope, normalised 0–1, low-passed | accent reward |
| `kick` | onset strength of the 40–120 Hz band only | step/stomp reward |
| `energy` | RMS loudness, 1-bar moving average, normalised 0–1 | amplitude target |
| `after_drop` | 0 before 8.37s, 1 after | reward switching |
| `lookahead` | next 0.5s of `onset` (25 values) | obs only — lets the policy wind up *before* a hit, like a real dancer |

The policy sees `sin/cos(2πφ)`, `sin/cos(2π·bar_phase)`, `onset`, `energy`, `after_drop`,
`lookahead` alongside its body state. Phases go in as sin/cos so there's no jump at the wrap.

Episodes are 16s windows starting at a random point in the song, so every section is
trained on. 20% of episodes are forced to start at 4s so the drop transition itself is
seen a lot.

## 3. Observations (what the policy gets each step)

- joint positions (21), joint velocities (21)
- torso orientation (gravity vector in body frame) and angular velocity
- pelvis height, linear velocity
- foot contact flags (L/R)
- previous action (needed so the smoothness penalty is learnable)
- the music features above (~33 values)

No global position — the dance should be position-invariant.

## 4. Rewards and penalties

All terms are per control step, weighted, summed. Weights are the knobs tuned in the loop.
`m(t)` = **motion energy** = mean speed of the hands, feet and head (end-effectors), low-pass
filtered at 10 Hz so vibrating can't fake it. `q(t)` = joint position vector.

### Always on

| term | formula | why |
|---|---|---|
| upright | `exp(−4·tilt²)`, tilt = torso angle from vertical | don't fall |
| height | `1` if pelvis z in [0.9, 1.3] else quadratic falloff | no crouch-cheese |
| **fall** | episode ends if pelvis z < 0.7, −10 | hard stop |
| torque cost | `−0.01·Σ a²` | don't burn energy |
| **action rate** | `−0.05·Σ (a_t − a_{t−1})²` | the main anti-jitter term |
| joint limits | `−1` per joint within 5% of its limit | no broken poses |
| drift | `−0.5·max(0, ‖xy − xy₀‖ − 1.0)` | dance in place, 1m leash |
| facing | `−0.2·(1 − cos yaw)` | stays roughly facing the camera |
| foot slide | `−0.3·foot_speed` while that foot is in contact | no moonwalk glitches |

### Before the drop (`after_drop = 0`) — "waiting for it"

| term | formula | why |
|---|---|---|
| stillness | `−1.0·m(t)` | stand there |
| idle bob | `+0.3·(head_z_velocity · cos 2πφ)` clipped | a small head nod on the beat is allowed, nothing more |

### After the drop (`after_drop = 1`) — "dance"

| term | formula | why |
|---|---|---|
| **accent** (beat sync) | `+2.0·m̂(t)·onset(t) − 1.0·m̂(t)·(1 − onset(t))`, m̂ = m normalised by its 1-bar mean | move hard *on* hits, ease off *between* them. The subtraction is what stops constant thrashing |
| **step on kick** | `+1.0` if a foot contact toggles within ±60ms of a `kick` > 0.5 | stomps / steps land on the kick |
| **groove** (periodicity) | `+1.0·exp(−‖q(t) − q(t − 1 bar)‖² / σ²)` | repeat the move every bar — that's what makes it read as dancing |
| alternation | `+0.5·exp(−‖q_left(t) − q_right(t − ½ bar)‖² / σ²)` | left does what right did half a bar ago; classic two-step structure |
| **full body** | `+0.8·Σ_g √(amp_g)` over groups g ∈ {arms, legs, torso, head}; amp_g = joint-position range over the last beat | √ gives diminishing returns per group, so it pays more to move a second limb than to wave one arm harder |
| energy match | `−0.5·(m̂_bar − energy(t))²`, m̂_bar = 1-bar mean of m̂ | louder section → bigger moves, breakdowns → smaller |
| phrase variety | `−0.3·exp(−‖Q_k − Q_{k−4}‖² / σ²)`, Q_k = the pose sequence of bar k | mild push to change the move every 4 bars, so it isn't the same loop for 2 minutes. Deliberately weaker than groove |

### The drop itself
A one-off bonus: `+5·m̂` in the 0.25s after 8.37s, so the first move is a big one.

### Known ways the agent will try to cheat, and the term that blocks each
- vibrate in place → `action rate` + low-passed `m`
- wave one arm → `full body` √ per group
- thrash constantly → the negative half of `accent`
- crouch/lean to make "movement" cheap → `height`, `upright`
- walk away → `drift`
- fall over at the end of the episode for free → fall penalty is bigger than anything it can earn in a second

## 5. Curriculum (what gets trained, in order)

| stage | reward set | expect | GPU time |
|---|---|---|---|
| **S1 stand** | always-on only | stands still, doesn't fall | ~5 min, done once |
| **S2 metronome** | always-on + after-drop set, but with a synthetic click track at random BPM 90–130 instead of the song | bounces on the beat at any tempo; proves the sync reward works before the real track | 2–4 runs |
| **S3 the song** | everything, real features, pre/post drop switch | waits, drops, dances. This is where the tuning loop lives | 10–30 runs |
| **S4 moves** (optional, the cool bit) | add a random "move code" z (8-dim) resampled every 8 bars, plus a DIAYN-style discriminator that rewards the policy when z can be guessed from the motion | a *repertoire* of distinct moves instead of one, with no data. Then pick z per phrase to choreograph the song | 5–10 runs |

Each stage initialises from the previous checkpoint.

## 6. The tuning loop (this is most of the work)

For each S3 run:
1. train 15 min, save checkpoint
2. roll out the full 142s song once, render video with audio + beat strip
3. compute metrics automatically:
   - **phase-locking value** between motion-energy peaks and beats (0 = random, 1 = perfect)
   - fall rate over 100 random episodes
   - per-group amplitude (arms/legs/torso/head)
   - groove score (1-bar self-similarity) and variety score (4-bar dissimilarity)
   - pre-drop motion energy (should be near 0)
4. I look at frame strips from 3 spots (just after drop, 40s, 100s) and judge
5. log weights + metrics + verdict to `experiments.md`, adjust 1–2 weights, go again

Stop when: PLV > 0.7, fall rate < 2%, all four groups moving, pre-drop still, and it
looks like dancing to a human.

## 7. Export to the site (last phase, can be its own goal)

- roll out the final policy over the whole song → `public/dance.json`
  (30 fps, joint angles + root transform, ~2.5 MB)
- a small three.js (or 2D stick-figure) view on the music stage, driven by the Tone.js
  player's current time so it stays in sync with scrubbing / fade / revive
- before the drop it idles with the intro loop; the hold-release drop triggers the dance

## 8. What I need from you

1. Vast.ai 4090 up with the PyTorch/CUDA 12 image, SSH on; send me the ssh command
2. confirm the choices in the "decisions" list in chat

## 9. Videos

- **Dev video** (every run): 720p, song muxed in, beat/motion-energy strip along the bottom.
  Pulled back to the Mac after each run and sent to the user.
- **Final video**: full 142s song, 1080p 60fps, clean scene (shadows, slow orbiting camera,
  no overlays) + a second cut with the strip. Capsule humanoid; nicer character comes from
  the three.js export (section 7) or the G1 stretch.

## 10. Monitoring (event-driven, no cron)

- training runs in `tmux` on the box; survives laptop sleep / session drop
- each run is launched over SSH as a background command → the harness re-invokes Claude on
  exit; `Monitor` on the remote log for anything longer than a run
- on finish the box auto-renders the dev video + **contact sheets** (16-frame strips over
  2 bars at ~9s, 40s, 100s) + motion-energy-vs-beat plot. Images + metrics are how Claude
  judges a run
- cap: 30 S3 runs (≈ $4) unless the stop criteria in section 6 are met earlier
- cost safety: user sets a Vast spend limit, or exports `VAST_API_KEY` in their shell so
  Claude can `vastai destroy instance` when done

## 11. Chosen machine

Vast.ai m:51178 — 1x RTX 4090, Vietnam, $0.339/hr, 98.2% reliability, 25.6 cores / 52 GB / 207 GB. Template: PyTorch (Vast) CUDA 12.4.
Backup: m:11740 (Argentina, full machine, 99.42%). Launch mode SSH, PyTorch CUDA 12 image, ~60 GB disk.

## 12. The improvement loop (search with memory)

Per round (~20 min): propose 3 single-change variants of the current best → train each at
half length from the same checkpoint → score with the fixed card (PLV, fall rate, per-limb
amplitude, groove, variety, pre-drop motion, jerk) + contact sheets → diagnose with the
symptom→fix table → a variant replaces "best" only if it wins on weighted score AND no
metric drops below its floor → log config diff, metrics, verdict, next hypothesis to
`experiments.md` (reread before every proposal, no retrying dead ideas).

Symptom → fix:
- high PLV, tiny amplitude → lower action-rate penalty, raise full-body
- big amplitude, low PLV → raise accent, confirm lookahead in obs
- one limb only → stronger concavity / per-group floor
- falls after the drop → smaller drop bonus, 0.5s ramp
- same loop forever → raise variety, or move to stage 4
- jitter on beat → lower motion low-pass cutoff, raise jerk penalty
- good metrics, looks dead → rewrite a term, not a weight

Across rounds: plateau (3 rounds < 2% gain) ⇒ rewrite a term or advance the curriculum
stage; one ablation pass mid-way, drop terms that don't matter; champion gets a 3× run every
5 rounds; user gets best-vs-previous video every 5 rounds and replies A/B or a note;
stop at targets met + user sign-off, or the 30-round cap.

## 13. Decisions log

- **2026-10-08 — beat grid is half a beat late.** Research agent's band-flux analysis found the 2–5 kHz
  snare/clap on the "and" of our grid beats; user confirmed by ear (click overlay B, shifted +0.5 beat,
  wins "for sure"). New grid anchor ≈ 8.60–8.64 s (snap to the claps). `after_drop` and the drop bonus
  STAY at 8.37 s (that is where the site lands the hold-release). Everything trained before this
  (s2, s3r1_*, s3r2_*, s3r3_*) hit between the claps.
- **2026-10-08 — adopt the research shortlist** (research/hiphop-formalised.md §shortlist) for round 4:
  bounce + bent knees; "arrive on the beat" accent replacing accent_on/off; full_body weighted to
  torso/head + nod from torso pitch; weight transfer every 2 beats, steps on beats, fix the
  `alternation` L/R shoulder-axis sign bug; A-A-B-A per 32 counts with an audio-derived 8-count
  index replacing the free-running phrase clock. Snare band feature (150–400 Hz + 2–5 kHz flux) added
  to song features.
- Round 3 (spin penalty / squared off-beat / phrase clock) runs to completion first so each fix is
  measured in isolation before being combined with the above.

## 14. Phase 2 — learn from real dancers (started 2026-10-08)

User decision: use motion data, mimic it as faithfully as possible ("feels like a real human dancing"),
reuse the phase-1 RL + music formalisation for timing/transitions, and try move FUSION (arms of one
move + feet of another). Stop only when the humanoid looks like a real hip-hop dancer from the dataset.

Data: AIST++ hip-hop clips (genres gMH = Middle Hip-hop and gLH = LA-style Hip-hop; note gHO is House, not hip-hop), 3D keypoints (no SMPL licence needed), time-warped to 112.9 BPM
and beat-aligned to our grid. Retargeted to the 21-joint humanoid by per-frame IK → qpos/qvel at
50 Hz with contact flags, segmented into 2-bar "moves".

Stages:
- **S5 motion library (tracking).** DeepMimic-style tracking policy: obs = body state + clip id +
  phase; reward = pose/velocity/end-effector/root tracking; reference-state init + early termination.
  Learns to execute every move physically. Init from s6_c for balance.
- **S6 style + transitions (AMP).** Discriminator on 0.5 s motion windows from the library; policy
  conditioned on music features + the move to perform; reward = tracking (when a move is active) +
  AMP style + phase-1 music terms (claps, bounce, facing, no-drift, arrive). Move selection per 8-count
  from an explicit choreographer (section/energy-driven) first; learned selector later.
- **S7 fusion.** Part-wise references: upper-body target from move i, lower-body from move j (both
  beat-aligned); AMP keeps the combination physically plausible. Gallery of fused moves.
- **S8 full song + final renders**, same score card + new: tracking error, discriminator score,
  human-likeness judged on sheets vs dataset frames side by side.

Stop criterion: side-by-side contact sheets (dataset clip vs humanoid) read as the same dance;
tracking error small; no falls; claps/bounce still met.
