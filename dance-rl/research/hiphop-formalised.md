# Hip-hop, formalised: what makes it read as dancing, as reward terms

Research notes for dance-rl stage 3+. The goal is to turn what dancers, music-cognition
researchers and dance-generation papers say into terms computable from our MJX state.
Written 2026-10-08, against PLAN.md §2–4, experiments.md (up to s3r2) and env.py
(`DEFAULT_ENV` with `accent_signal`, `accent_off_power`, `spin_penalty`, `phrase_clock`).

**TL;DR.** The current reward is built around one idea: be fast on the beat and slow
between beats. Every source below disagrees with that. Hip-hop groove is a **continuous
vertical bounce** (knees, low point on the beat) with **weight transfer every 2 beats**, a
**torso/head nod**, and **accents that arrive into the beat and stop**. Accents are bigger on
the snare (2 and 4) and on phrase boundaries, and the material is organised in **8-counts
(2 bars) and 32-counts (8 bars)**. One local finding comes before any of that: the
song's clap/snare does **not** land on our grid's beats 2 and 4 (§1E). Check this first.

---

## 1. Findings (each with a source)

### A. How dancers and teachers describe it
- **A1 Bounce and rock are the base layer.** Beginner hip-hop courses teach music
  rhythm, then the *bounce* (up-down from the knees) and the *rock* (back-and-forth from the
  waist up), then isolations, waves and steps. Arms and head are layered on last.
  [CUHK syllabus][cuhk], [Kennedy Center: groove = repeating movement on the beat][kc].
- **A2 Down groove.** The default is "down": drop on the beat, rebound with a slight
  knee bend, shift weight side to side. The *up* groove (rise on the beat) is the variant.
  [Udemy hip-hop basics][udemy]. Lab data agrees that "down" is the more natural mode:
  untrained people switch from up-on-beat to down-on-beat above about **125 BPM**, trained street
  dancers above about **164 BPM** ([Miura/Kudo/Nakazawa 2011][kudo1];
  [Kudo NASPSPA 2012][kudo2]). At 112.9 BPM both modes are physically fine, so down is a style
  choice, not a constraint.
- **A3 Accents follow the drum sound.** Bass/kick ("boom") goes with grounded moves
  (stomp, drop). The snare ("ka!") goes with sharp, staccato moves (arm shot, head flick).
  Teachers say to find patterns like "kick on 1 and 5, snare on every even count".
  [Steezy: basics of musicality][steezy-mus]. In hip-hop the backbeat snare/clap sits on
  **2 and 4** ([Soundbrenner: backbeat][backbeat]).
- **A4 Hits, holds, texture.** A "stick" means tensing and holding a picture. The suggested drill is
  to stick a pose on counts 1 and 5 ([Steezy: execution][steezy-exec]). Texture comes from
  "variation in your hits, milks and speed" ([Steezy: what is musicality][steezy-what]),
  so a hit is fast in, held, then released slowly ("milked"). In Locking, stops punctuate
  phrases ([Cal Poly: stops][stops]).
- **A5 8-count phrasing.** The working unit is the 8-count (2 bars of 4/4). Melodic phrases
  run 16 or 32 counts. Routines are often 4 × 8-counts, with the same 8-count returning
  with a change of direction or ending ([CLI: 8-count][cli]). Lining moves up with the phrase
  every single time gets predictable and dull, and good dancers break it on purpose
  ([Lindy musical interpretation][lindy]).
- **A6 Old-school vocabulary for 1986** (Licensed to Ill era). Party dances like the Wop
  (mid-80s NY: sway right on each beat, knees bend, shoulder drops, arms swing across the
  chest, [Steezy: Wop][wop]), Cabbage Patch (circular arms over an in-place groove),
  Running Man and Roger Rabbit (late 80s, alternating leg slides/hops). All of them are **an
  in-place bounce + side-to-side weight shift + one repeated arm pattern**. That is the
  same structure as A1, and it is reachable without mocap.

### B. Music cognition and biomechanics
- **B1 Different body axes lock to different metric levels.** In free dance, the eigenmovements lock
  to the meter: **vertical bounce at the 1-beat level**, limb sway at the 2-beat level, and
  mediolateral body sway at the 4-beat level ([Toiviainen, Luck & Thompson 2010][toiv10]).
  The replication (72 dancers, 8 genres) found 11 of 12 eigenmovements frequency-locked to one of
  four metrical levels, with amplitude scaling with musical fluctuation at the 1- and 2-beat
  levels ([Toiviainen & Carlson 2022][toiv22]). Vertical movement locks to the tactus and
  mediolateral movement to the bar ([Burger et al. 2014][burger14]).
- **B2 Bounce is the movement people synchronise with.** In 70 dancing pairs, vertical
  bounce was the only principal movement with a specific periodicity equal to the beat. It
  was also the one movement amplified when partners could see each other
  ([Bigand et al. 2024, Current Biology][bigand]).
- **B3 Which body part follows which band.** Over 30 pop stimuli
  ([Burger et al. 2013][burger13]):
  - pulse clarity correlates with whole-body movement (CoM speed r=.67, shoulder wiggle .67,
    hip wiggle .58, feet .55)
  - **50–100 Hz flux** (kick, bass) correlates with **head speed (r=.73)**
  - **6.4–12.8 kHz flux** (hats) correlates with **hand speed (r=.65)** and hand distance
  - percussiveness correlates with head (.67), shoulders (.61) and hands (.57)
  - tempo had no effect
- **B4 What gets rated as "good dancing" (male avatars).** The best predictors were the **amplitude and
  variability of neck and trunk movement** and the **speed of the right knee**. Flailing arms did not
  make up for a stiff core ([Neave et al. 2011][neave]).
- **B5 (female avatars).** Ratings rose with greater hip swing, more asymmetric thigh movement, and
  **intermediate** arm asymmetry. Too symmetric and too independent both scored worse
  ([McCarty et al. 2017][mccarty]).
- **B6 Groove.** Groove is the pleasurable urge to move, and it tracks how easy
  sensorimotor coupling is ([Janata et al. 2012][janata]). Medium syncopation maximises
  both the urge to move and pleasure, on an inverted U ([Witek et al. 2014][witek]).
  For movement, that suggests mostly on-beat with occasional off-beat accents, not all-on or all-off.
- **B7 Anticipation.** Taps lead the beat by about **20–100 ms** (negative mean asynchrony,
  [Repp review][repp], [cross-cultural NMA][nma]). Audio–video sync is detectable once audio
  **leads** the picture by >45 ms, or lags it by >125 ms ([ITU-R BT.1359][itu]). So a visual
  hit can be early by up to ~100 ms but should never be late by more than ~40 ms.
- **B8 Pocket.** "Laid-back" drumming lives in microtiming of about 10–40 ms. Instructed
  laid-back snares were ~17 ms late at 96 BPM ([Câmara et al. 2020][camara];
  [secondhand figure][vonappen]). At 50 Hz (20 ms/step) that is one step at most. Treat
  the pocket as **dynamics** (slow release after the hit), not as late timing.
- **B9 The visual beat is a sudden deceleration.** Davis & Agrawala make arbitrary motion
  look danced by aligning *visual beats*, which are moments of sudden visible deceleration, to musical beats
  ([Davis & Agrawala 2018][davis]; deceleration definition as summarised in
  [Visual Rhythm Prediction 2019][vrp]).

### C. Computational dance metrics and rule-based choreography
- **C1 Beat Align Score.** Kinematic beats are **local minima of joint speed**. FACT averages
  `exp(-d²/2σ²)` per kinematic beat to its nearest music beat, with σ=3 frames at 60 fps
  ([FACT/AIST++][fact]). Bailando averages per **music beat** instead ([Bailando][bailando]).
  Transflower uses minima of the hip's vertical velocity ([Transflower][transflower]).
  EDGE's critique: FACT punishes real dances with speed minima between beats, Bailando
  punishes skipped beats, and both punish half-time ([EDGE][edge]).
- **C2 PFC (physical foot contact).** `mean_i(‖ā_COM‖·‖v_L‖·‖v_R‖)/max‖ā_COM‖`, where ā uses
  horizontal acc and `max(a_z,0)`. It is low when at least one foot is still whenever the body accelerates.
  It tracked human ratings ([EDGE][edge]). In MJX the physics is real, but this stays a useful
  lint against "skating" with both feet loaded and moving.
- **C3 Diversity and FID.** Div_k/Div_g are mean pairwise distances of kinetic/geometric
  features. EDGE: FID_k/FID_g disagreed with users, and **jitter inflates diversity**, so
  match the reference spread rather than maximise it ([EDGE][edge]).
- **C4 ChoreoMaster.** Production system (NetEase, SIGGRAPH 2021). Music and dance phrases
  carry a style label and an **8-bit rhythm signature**. A motion graph is searched under
  rhythm, style, structure and transition costs. Removing rhythm signatures lost >40% preference with
  artists ([project][choreomaster], [dataset/labels][cm-git]). The idea we take from it:
  rhythm is a per-phrase binary accent pattern, and repeated music gets repeated dance.
- **C5 Rhythm is a Dancer.** Three tiers: pose → motif (short repeated movements) →
  choreography (ordering motifs to follow the genre's global structure)
  ([Aristidou et al. 2022][aristidou]). This is the same hierarchy as A5.

### D. RL / physics without mocap
- **D1 Periodic reward composition.** Gaits come from rewards with no reference: phase windows
  (von Mises indicators) times simple force/velocity measurements, with the sign set
  per phase ([Siekmann et al. 2021][siekmann]). Our beat-window terms (`g(δ)` below) are
  exactly this pattern, applied to beat phase instead of gait phase.
- **D2 Contact-event timing rewards.** Robot Drummer gives dense rewards for correct, wrong
  and missed contact events against a rhythm ([Robot Drummer][drummer]). That is a template
  for step/stomp timing.
- **D3 Repertoire without data.** DIAYN rewards `log q(z|s) − log p(z)` ([DIAYN][diayn]).
  This is already PLAN S4. Other dance-RL work uses video-trained reward models
  ([May the Dance be with You][maydance]) or Bailando's actor-critic beat reward, which
  penalises missing dance beats ([Bailando][bailando]). I found **no** prior physics-humanoid
  dance trained from hand-written rewards alone. The closest analogue is D1.

### E. Our song: local analysis of `public/now-get-busy.mp3`
I ran spectral flux per band, folded onto the drop-anchored grid (16th-note bins,
post-drop). The script is in §4.5.
- **E1 Snare/clap position.** The 2–5 kHz transient that repeats every 2 beats peaks in
  bins 6 and 14, i.e. **on the "and" of 2 and the "and" of 4**. Crack peaks sit a median
  +224 / +229 ms after grid beats 2/4 (a half beat is 266 ms). The kick (40–120 Hz)
  hits both grid beats and the "and" of 1, which is why the kick-only grid check passed.
  I fitted a backbeat template (kick on 1 and 3, crack on 2 and 4) over downbeat offsets.
  It scores **1.34 at +0.5 beat** against **0.88 at the current offset 0** (crack-on-2/4:
  0.71 vs 0.32). Likely reading: **the grid's beats are the off-beats of the backbeat**, so the
  agent's hits land between the claps. An ear check is needed. A click overlay is at
  `<scratchpad>/an/click_on_grid.mp3` (clicks on grid beats, high click on bar beat 1). If
  the claps fall between clicks, move the grid anchor to ≈ 8.37 + 0.266 − 0.04 ≈ **8.60 s**
  (keep `after_drop` and the drop bonus at 8.37).
- **E2 Sections.** Two-bar breakdowns (RMS ≈ 0.6 of normal, kick and hats drop) start at
  **33.9, 67.9, 93.4, 118.9 and 140.1 s**. Counted in 8-counts from the drop, that is indices 6,
  14, 20, 26 and 31. They are **not** on a fixed 32-count grid from the drop. 76–93 s has
  stronger kick and crack (a different section). Phrase features should come from the audio,
  not from a free-running 8-bar clock.

---

## 2. Notation (all from existing env state unless marked NEW)
- `φ` = beat_phase. `δ = ((φ+0.5) mod 1) − 0.5` ∈ [−0.5, 0.5) beats, signed, negative = before the beat.
- `β` = bar_phase. `b = round(4β) mod 4` (count = b+1). `ψ2 = frac(2β)` (2-beat cycle).
- `g(δ; μ, s) = exp(−(δ−μ)²/(2s²))` is a beat window, Siekmann-style.
- `z` = pelvis height `xpos[pelvis,2]`. `ż` = `qvel[2]` (world frame). `z̄` = 1-bar mean of z (NEW: 106-float ring like `m_hist`).
- `h` = normalised `R[0:2,0]` (torso heading in xy). `ℓ = (−h_y, h_x)` (left).
- `p_L, p_R` = foot body xpos (`ee[3], ee[4]`). `c_L, c_R` = contact flags. `w = ‖(p_L−p_R)_xy‖` = stance width.
- `f = (head − pelvis)·h` = head forward offset (hist[21:24] projected). `f̄` = 1-bar mean.
- `m_u` = 10 Hz low-passed mean speed of head + both hands (NEW, same filter as `m`). `m̂_u = m_u / max(1-bar mean, m_floor)`. `ṁ_u = (m_u − m_u,prev)/dt`.
- `κ = −½(q_Lknee + q_Rknee)` (rad, positive = flexed; knee range −160°…+2°).
- Mirror map `M` (from the dm_control XML axes): mirrored motion is `q_L = −q_R` for
  `shoulder1`, `shoulder2` and `q_L = q_R` for `hip_x`, `hip_z`, `hip_y`, `knee`, `elbow`, `ankle_y`.
  `ankle_x` needs checking by rendering `q_L = ±q_R`.
- `a_b` = accent weight of the nearest beat (NEW feature column, §4.2). `k` = 8-count index within
  the current 32-count (NEW, §4.3).

---

## 3. Finding → reward table

Weights are starting points next to the current scale (upright 1, accent_on 2, groove 1).
"Replaces" uses PLAN §4 names.

| # | from | term (formula in our state) | sign / weight | replaces / extends | hacking risk → block |
|---|---|---|---|---|---|
| R1 | A1, A2, B1, B2 | **bounce**: `z_ref = −A1·cos(2πφ) + A2·cos(4πβ)` with A1=0.015 m, A2=0.006 m (≈3 cm peak-to-peak, ≈4 cm on 2 and 4) (troughs every beat, deeper on 2 and 4; flip the A2 sign if E1 moves the grid by an odd number of beats). `r = max(c_L,c_R)·exp(−((z−z̄) − z_ref)²/(2·0.015²))` | +0.8 … +1.5 | new post-drop carrier. It is the post-drop version of `idle_bob`. Note `idle_bob` uses `cos`, which puts the low point ¼ beat *before* the beat; use `sin` (`ż·sin 2πφ`) for down-on-beat | hopping → gate on ≥1 foot down. Squat-pumping from hips → `upright`, `height`. Stiff pogo → small A, no full-body reference. Bigger-is-better → it is a tracking target, so overshoot is penalised |
| R2 | B3, B4 | **nod** (no neck joint, so it comes from abdomen_y/hip pitch): `r = exp(−((f−f̄) − N·cos 2πφ)²/(2·0.02²))·(0.5+0.5·kick)`, N=0.03 m (head furthest forward on the beat) | +0.3 … +0.6 | extends `full_body` (torso/head) | static forward lean → mean-removed (f−f̄), plus `upright`. Nodding without bounce → fine, the terms stack |
| R3 | A4, B7, B9, C1 | **arrive-on-the-beat accent**. `r_in = a_b·g(δ;−0.10,0.06)·m̂_u` (speed going *into* the beat, peak ≈53 ms early). `r_stop = a_b·g(δ;0,0.04)·min(1, relu(−ṁ_u)/(4·max(m̄_u,m_floor)))` (decelerate at the beat). `c_hold = g(δ;+0.18,0.08)·m̂_u²` (stick ~0.1 s after) | in +1.5, stop +0.5, hold −1.0 | **replaces** `accent_on`/`accent_off` (and makes `accent_off_power=2` redundant) | farming decel by vibrating → ṁ on the 10 Hz-filtered m, `action_rate`, cap at 1. Never stopping, just early → `c_hold`. Squared hold penalty makes a slow release in δ∈[0.3,0.45] cheap, which is the intent. **Changes the PLV metric**: m peaks move to δ≈−0.1, so add the velocity-minimum BAS (§3 note) before comparing runs |
| R4 | A3, B6, C4 | **accent hierarchy**: `a_b = 0.6 + 0.4·snare_b` (from audio, §4.2), ×1.3 on count 1 of each 8-count | (inside R3) | extends `accent_on` | agent puts all effort on 2 and 4 and ignores 1 and 3 → floor 0.6 and R1 bounce on every beat |
| R5 | A1, A6, B1 | **weight transfer**: `s = ((pelvis − ½(p_L+p_R))·ℓ)/0.10 m`, target `s* = 0.6·cos(2πψ2)` (over the left foot on counts 1 and 3, the right on 2 and 4). `r = exp(−(s−s*)²/(2·0.3²))`. Plus stance penalty `−max(0,w−0.45) − max(0,0.15−w)` | +0.4 … +0.8 | extends `alternation` (same 2-beat lag) | lean torso instead of shifting the pelvis → pelvis-based + `upright`. Widening stance → stance penalty. Drifting → `drift` |
| R6 | B5 | **fix alternation's mirror**: `alt = exp(−‖q_L(t) − M·q_R(t−½bar)‖²/σ²)` with the signs above. As written, alternation compares raw `q_left` vs `q_right`, which rewards *anti*-mirrored shoulders | keep 0.5 | **bug-level fix** to `alternation` | none new |
| R7 | A1, A2 | **grounded knees**: `r = exp(−(κ̄_bar − 0.35)²/(2·0.12²))`, 1-bar mean κ (0.35 rad ≈ 20°). Geometry (L≈0.4 m thigh+shin): bending 20°→35° drops the pelvis ≈2.5 cm, but 0°→15° only ≈0.7 cm, so bounce needs pre-bent knees | +0.2 … +0.4 | extends `height` | deep crouch → `height` band (0.8 m floor). Stays grounded but frozen → R1 needs motion |
| R8 | A6, D2 | **step on the beat**: `r = toggles·(g(δ;0,0.08) − 0.5·(1−g(δ;0,0.08)))`, at most 2 toggles per beat | +0.5 | **replaces** `step_on_kick` (the kick also hits off-beats, E1, so the current term pays steps on the "and") | tap-dancing a foot → cap and `foot_slide`. Never stepping → fine, it is optional vocabulary |
| R9 | B4, B5 | **core-weighted full_body**: `Σ_g c_g·√max(min(amp_g,cap_g) − 0.02, 0)`, with c = torso 1.5, head 1.5, legs 1.0, arms 0.5 and arms cap 0.6 rad | keep 0.8 | **changes** `full_body` (also fixes the √-of-noise payout noted in experiments) | arm flailing pays less. Torso thrash → `upright`, `action_rate` |
| R10 | B5 | **intermediate arm asymmetry**: ρ = corr over the last bar of `q_Larm` vs `M·q_Rarm`, `r = exp(−(ρ−0.4)²/(2·0.25²))` | +0.1 … +0.2 | new, low priority | random arms → ρ≈0 is penalised. Perfect mirror (ρ=1) is penalised |
| R11 | A5, C4, C5 | **32-count form A-A-B-A**: with `sim(L) = exp(−‖q̃ − q̃(t−L)‖²/σ²)`, q̃ = q minus its 1-bar mean, L2 = 212 (2 bars), L4 = 425 (4 bars, = HIST): `r = [k=1]·sim(L2) + [k=2]·(1−sim(L2)) + [k=3]·(sim(L4) − sim(L2))`. k=0 is free (a new 32-count may change) | +0.5 … +1.0 | **replaces** `variety`; groove weight → 0.5 and gated off during k=2 | "B" faked with a static offset pose → q̃ removes offsets. **Useless without k in the obs** (s3r2_a showed an MLP can't vary without a phrase input) |
| R12 | A4, A5 | **phrase punctuation**: count 8 of each 8-count: `r = [b=3 ∧ last bar of 8-count]·g(δ;+0.1,0.1)·exp(−m_u/0.15)` (a stick); count 1 after a section boundary: `r = window·m̂` (drop_bonus-like) | +0.3 | extends `drop_bonus` | long freezes → window ≤ ¼ beat, still subject to `fall` and `upright` |
| R13 | B3 | **hands may ride the hats**: scale `c_hold` for hand speed by `(1 − 0.5·hat)` | (inside R3) | later | hands-only twitching → `action_rate` |
| R14 | B1, B6 | **energy → amplitude** stays as `energy_match`. In breakdowns (E2) also scale A1, A2 and N by `energy` so the bounce shrinks | keep −0.5 | extends `energy_match` | none new |

**Metric note (needed with R3).** Add to `metrics.py`: kinematic beats = local minima of `m_u` and of
pelvis `ż` sign changes (bottoms). Report both FACT-style (per kinematic beat) and
Bailando-style (per music beat) `mean exp(−d²/2σ²)` with σ = 0.06 s, plus bounce PLV (phase of
pelvis-z minima). The PLV on m peaks will read ~0.1 beat early under R3, and that is correct.

---

## 4. New music features (song.py, offline; obs and/or reward)

### 4.1 Snare / clap envelope (backbeat)
Percussive component, then the geometric mean of body and crack flux. This rejects vocals
(no body transient) and kick (no crack):
```python
H, P = librosa.decompose.hpss(S)                     # S = |stft(n_fft=2048, hop=441)|
def bflux(lo, hi):
    b = (freqs >= lo) & (freqs < hi); L = np.log1p(100 * P[b]).sum(0)
    return _norm01(np.maximum(np.diff(L, prepend=L[:1]), 0))
snare = _norm01(_lowpass(np.sqrt(bflux(150, 400) * bflux(2000, 5000)), 8.0))
hat   = _norm01(_lowpass(bflux(6400, 11000), 8.0))  # Burger sub-band 9, capped by Nyquist 11 kHz
```

### 4.2 Accent weight per beat `a_b` (data-driven, not hardcoded 2 and 4)
Fold `snare` and `kick` onto the 4 beat slots over the post-drop song (±40 ms max around each
grid beat). `snare_b` = slot mean / max. Store per-row `accent_w = 0.6 + 0.4·snare_b(nearest beat)`
and ×1.3 on 8-count count 1. If E1 holds and the grid isn't shifted, `snare_b` will be flat
across beats (the claps are between beats). That is itself the symptom to look for.

### 4.3 Phrase position from the audio
- `beat_in_bar` one-hot (4) from `bar_phase` (free, no audio).
- `eight_phase` = sin/cos of the 2-bar phase. This separates bar 1 from bar 2 of an 8-count, which
  `bar_phase` can't.
- `section_start` times: boundaries of a novelty curve. Either use
  `librosa.segment.recurrence_matrix` on beat-synchronous chroma+MFCC with a checkerboard kernel,
  or the simple version that works here: 2-bar RMS < 0.75 × median marks a breakdown
  (E2: 33.9, 67.9, 93.4, 118.9, 140.1 s). Snap boundaries to the 8-count grid.
- `k` = (8-counts since the last section start) mod 4, one-hot (4), plus `breakdown` flag (0/1).
  These replace/extend `phrase_clock`, which free-runs from the drop and drifts against E2.

### 4.4 Half-time / downbeat flags
Not needed for this track: kick and snare positions are stable all song. The 2-bar breakdowns are the
only texture change. For other tracks: `half_time = snare autocorr at 4 beats ≫ at 2 beats`, and
`downbeat` = `beat_in_bar == 0`.

### 4.5 Reproducing E1 (numpy + ffmpeg only)
`ffmpeg -i now-get-busy.mp3 -ac 1 -ar 22050 -f f32le song.raw`, STFT (n_fft 2048, hop 441),
log-flux per band, then for downbeat offsets `o ∈ {0, 1/8, …, 31/8}` beats score
`mean(kick at bar+o, bar+o+2 beats) + mean(crack at bar+o+1, bar+o+3 beats)`, taking the ±30 ms max.
Results: o=0 → 0.88. o=0.5 → 1.34 (best). o=1.0 → 1.07.

---

## 5. Prioritised shortlist (≤6, by visual impact per unit effort)

1. **Verify and, if needed, shift the beat grid by half a beat (E1).** Listen to the click
   overlay. If the claps fall between the clicks, set the grid anchor to ≈8.60 s in
   `song.grid_phases`/`beat_times` (keep `after_drop` at 8.37), regenerate features, and
   fine-tune from s3r2_b. *See in sheets:* the hit frames line up with the clap on the
   rendered audio strip. A viewer stops reading the dance as off-beat, even with
   PLV unchanged.
2. **Bounce carrier R1 + grounded knees R7** (≈30 lines: z ring buffer + 2 terms). *See:* a
   visible knee dip on every beat across all 16 frames. The pelvis-z trace becomes a clean 1-beat wave
   with deeper troughs every other beat. The legs amplitude rises without the arms rising.
3. **Arrive-on-the-beat accent R3/R4 replacing accent_on/off** (+ the BAS metric). *See:* the
   small secondary bump after each hit goes away. The beat-line frames show a held
   pose rather than a mid-swing blur. Velocity-min BAS rises, and peaks_per_beat measured on minima
   goes to ≈1.
4. **Core-weighted full_body R9 + nod R2.** *See:* torso and head amplitude up, arms down
   from 1.3 rad. It reads as body groove instead of arm-throwing (Neave). amp_torso and
   amp_head rise in metrics.
5. **Weight transfer R5 + alternation mirror fix R6 + step-on-beat R8.** *See:* the pelvis
   rocks left/right over the standing foot every 2 beats, arms alternate as mirrors, and
   foot lifts fall on beat lines. It looks like a two-step/Wop instead of a static stance.
6. **32-count form R11 with audio-derived `k` and section features (§4.3)**, groove at 0.5.
   *See:* contact sheets of 8-counts k=0, 1 and 3 match, k=2 differs, and the pattern resets after each
   breakdown. variety climbs above 0.04 while groove stays >0.8 inside A blocks.

(Spin, which is being fixed separately, should land before 5, because weight transfer is
defined in the heading frame.)

---

## 6. Things NOT to do
- **Don't reward peak speed at the beat** (the current accent_on). Viewers read the
  *deceleration/stop* as the beat (B9, C1), and peak speed at the beat forces an
  out-and-back stroke whose return is the post-hit bump.
- **Don't penalise all between-beat motion.** Groove is continuous (bounce, sway). Penalise
  only the short post-hit hold window (R3), and with m², not m.
- **Don't track a full-body sinusoid or any reference pose trajectory.** Only 1-D carriers
  (pelvis z, head forward, lateral shift) with small amplitudes (2–3 cm). Whole-body periodic
  targets give a metronome robot and remove the variability raters reward (B4).
- **Don't maximise diversity or novelty directly.** Jitter inflates diversity (C3).
  Structure variation (R11) and measure it on low-passed, mean-removed poses.
- **Don't raise `variety`/form weights without a phrase input in the obs.** It has been
  shown dead (s3r2_a).
- **Don't reward mirror symmetry, and don't reward fully independent limbs.** The optimum is
  intermediate (B5). Also fix the shoulder sign in alternation (R6).
- **Don't hardcode "accent 2 and 4" before E1 is resolved.** Derive `a_b` from the snare
  envelope. Don't key steps to the raw kick either: it hits off-beats too.
- **Don't try to put the hit late "in the pocket".** Being >45 ms late is visible (B7). The pocket
  is the slow release. Aim visual stops at −60…+20 ms.
- **Don't reward 8th-note (double-time) bouncing or half-time skipping as the default.**
  Bounce at the beat (B1, B2). Half-time or up-groove belong to B sections later, as vocabulary.
- **Don't use long freezes.** A stick is ≤ ¼ beat. Longer stillness reads as dead and lets
  the agent park (the `stillness` lesson pre-drop).
- **Don't use FACT BAS or PLV alone as the score.** Both punish legitimate half-time and
  between-beat minima (C1). Keep the contact sheets as the judge.

---

## Sources
[cuhk]: https://cuhk.edu.hk/peu/Intranet/subjectmaterials/Course_Contents/2024/CHHD_e.pdf
[kc]: https://www.kennedy-center.org/education/resources-for-educators/classroom-resources/lessons-and-activities/activities/tap/grooving-and-moving-with-alex-gossen/
[udemy]: https://www.udemy.com/course/learn-hip-hop-dance-moves/
[kudo1]: https://www.bio-conferences.org/articles/bioconf/abs/2011/01/bioconf_skills_00063/bioconf_skills_00063.html
[kudo2]: https://www.dexterity-lab.c.u-tokyo.ac.jp/materials/NASPSPA2012_abstract_Kudo.pdf
[steezy-mus]: https://steezy.co/posts/basics-dance-musicality
[steezy-exec]: https://www.steezy.co/posts/how-to-execute-movement
[steezy-what]: https://www.steezy.co/posts/what-is-dance-musicality
[stops]: https://grandavehousing.calpoly.edu/news/hip-hop-dance-styles-the
[backbeat]: https://www.soundbrenner.com/blogs/articles/backbeat
[cli]: https://www.clistudios.com/blog/posts/what-is-an-8-count-in-dance/
[lindy]: https://lurklurk.org/lindyhop/musical_interpretation.html
[wop]: https://steezy.co/posts/how-to-do-the-wop
[toiv10]: https://sonicfield.org/library/embodied-meter-hierarchical-eigenmodes-in-music-induced-movement
[toiv22]: https://jyx.jyu.fi/jyx/Record/jyx_123456789_79777
[burger14]: https://pmc.ncbi.nlm.nih.gov/articles/PMC4224089
[bigand]: https://pmc.ncbi.nlm.nih.gov/articles/PMC11266842/
[burger13]: https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2013.00183/full
[neave]: https://nrl.northumbria.ac.uk/id/eprint/4110
[mccarty]: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5299992/
[janata]: https://atonal.ucdavis.edu/projects/groove
[witek]: https://ideas.repec.org/a/plo/pone00/0094446.html
[repp]: https://www.doi.org/10.3758/BF03206433
[nma]: https://arxiv.org/pdf/2107.03971
[itu]: https://www.forasoft.com/learn/audio-for-video/articles-audio/lip-sync-itu-r-bt-1359-tolerance-windows
[camara]: https://duo.uio.no/bitstream/handle/10852/79965/MP3801_01_Camara.pdf?sequence=1
[vonappen]: https://tnp.mtsnys.org/vol49-50/carter_von_appen
[davis]: https://openaccess.thecvf.com/content_cvpr_2018_workshops/w49/html/Davis_Visual_Rhythm_and_CVPR_2018_paper.html
[vrp]: https://arxiv.org/pdf/1901.10163
[fact]: https://arxiv.org/pdf/2101.08779
[bailando]: https://arxiv.org/pdf/2203.13055
[transflower]: https://arxiv.org/pdf/2106.13871
[edge]: https://arxiv.org/html/2211.10658v2
[choreomaster]: https://netease-gameai.github.io/ChoreoMaster/
[cm-git]: https://github.com/NetEase-GameAI/ChoreoMaster
[aristidou]: https://arxiv.org/abs/2111.12159v1
[siekmann]: https://arxiv.org/abs/2011.01387v2
[drummer]: https://arxiv.org/html/2507.11498v2
[diayn]: https://arxiv.org/pdf/1802.06070
[maydance]: https://www.alphaxiv.org/abs/2405.19743

Caveats: several cognition results come from abstracts or secondary summaries (Toiviainen 2010
level assignments, the 17 ms laid-back figure, ChoreoMaster rule details). Bounce amplitudes
(2–3 cm) are geometric estimates for this model, not literature values; no source reported
bounce in cm. E1 is a signal-analysis inference that still needs an ear check.
