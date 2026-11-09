# Chaos: staggered fall-in, whole-song move pool, a fresh seed per visit

The feedback was "At the start they're all doing the same moves... I want the start to be different each time." Only
the scheduler changed. There is no new data and no training. Every dancer still plays a copy of the one trained finale
trajectory, but each one now picks its own 8-counts of it from anywhere in the song.

Everything was rendered muted: headless Chrome with `--mute-audio`, real page flow on the dev server (click, hold space
9 s, release, drop, stage). After that the song clock (`holdSync.songTime`) and `performance.now()` were pinned frame by
frame, and the song was muxed in afterwards with ffmpeg. The speakers never played anything. For the captures the
reveal's auto-sweep was cancelled so it doesn't cover the fall-in; the reveal still was set to 45% by hand.

## Files

| file | what |
| --- | --- |
| `desktop_clip_1280x720_6-26s.mp4` | Real page, 1280x720 CSS at 1.5x, scaled to 720p. Seed 892165. Idle, then the fall-in from 8.37 to 9.43 s, then everyone on their own moves. |
| `phone_clip_390x844@2x_6-26s.mp4` | Real page, 390x844 at 2x. Seed 398514. |
| `fallin_desktop_8.00-8.40-8.67-8.93-9.20-9.67s.png` | Six frames from the desktop clip: all idle, then 1, 2, 4, 6 and 9 dancers dancing. |
| `fallin_phone_8.0-…-25.97s.png` | Eight frames from the phone clip, from the fall-in to 26 s. |
| `seeds_12s.png` | Three visits in ONE page load (space to stop, hold again), stills at 12 s. Seeds 246717 / 470153 / 776916, labelled with each dancer's (unit, mirror). |
| `payoff_unison_68.50s.png` / `payoff_split_72.75s.png` | Visit 1: everyone on unit 14 at 68.5 s; one 8-count later all 9 are on different moves again. |
| `tags_reveal_12s.png` | Visit 1 at 12 s with the sim reveal at 45%. The tags show each dancer's own move. |
| `info_desktop_clip.json`, `info_phone_clip.json`, `visits_seeds.json` | The schedule info, roaming checks, perf marks and (for the visits) every dancer's assignment at 12 / 40 / 68.5 / 72.75 / 100 s. |

## Rules as implemented (`src/dance/schedule.js`, used by `CrewMotion` in `motion.js`)

**Fall-in, with no unison at the drop.** Until 8.37 s everyone idles. Each dancer then falls in after 0 to 4
half-beats (0 to 2 beats), drawn uniformly. The draws are shifted so the earliest dancer starts at the drop itself,
and they are re-drawn if the first and last end up less than 1.5 beats apart. Start times are on the half-beat grid:
8.37, 8.64, 8.90, 9.17, 9.43 s. Each dancer crossfades from its own breathing idle pose (`Rig.idlePose`) into its move
over ±0.35 s around its start, but the crossfade never begins before the drop. The lead slot is drawn like everyone
else. Its sim tag reads `IDLE` until the dancer is halfway in.

**Whole-song pool.** A dancer can play any unit 0 to 30 of the finale, plain or mirrored: 62 options. Unit 31 is left
out because it runs past the end of the rollout (141.82 s), where the data stops. A dancer keeps going through the
finale (m, m+1, ...) for a run of 2 to 4 8-counts, then switches to a new run at an 8-count boundary with the existing
±0.2 s crossfade. A run also ends early at the end of the data or when carrying on would break a rule. The per-unit
hard rules:
- No two dancers on the same (unit, mirror).
- Stricter than the brief: no two dancers on the same move as seen, i.e. (library move, mirrored as seen). Units 2k and
  2k+1 of the finale are mostly one move and its mirror, so (u0, plain) and (u1, mirrored) would look identical.
- At most two dancers on the same library move. That implies at most two on the same unit.
- At most one dancer on a fused unit (4, 7, 22, 24) at a time, across all four combined.
- Soft preferences, in this order: moves nobody else is on, sections (energy tiers) nobody else is in, not your own
  last move, and not the finale's own unit for that 8-count (that's the "script").

There are 13 distinct library moves, so most 8-counts give all 9 dancers 9 different moves.

**Unison payoffs.** These are set in `UNISON_UNITS = [14, 26]` in `schedule.js`. Checked against `crew.json`:
- Unit 14 is the section that starts at 68.13 s, with its 1-bar breakdown at 68.14 s.
- No section starts at 121 s. The section boundary is unit 26 at 119.13 s, and its breakdown is at 121.26 s, so unit 26
  is the payoff.

On those 8-counts everyone snaps to the finale's own unit, not mirrored, with the ±0.2 s crossfade. On the next 8-count
nobody may carry on, so everyone picks again under the rules and the crew splits at once. The old sync units 0, 6, 8,
16, 20 and 28 are now ordinary 8-counts.

**Roaming stays in sync.** The planner now uses `CrewMotion.noTrip` = {0, and every payoff unit ±1}:
- Unit 0 is excluded so trips don't mix with the fall-in crossfade.
- The 8-counts next to a payoff are excluded because a trip's blend reaches 0.35 s past its own 8-count, so no part of a
  trip touches a payoff.

One more rule was added. One travel clip (`gLH_sFM_d18_mLH2_ch17_s1`) is also a finale move, so a trip clip may not
duplicate a move someone else is on as seen, or make a third dancer on one move. All the safety checks are unchanged:
0.7 m clash, hull frame, occlusion and end speed.

## Seeds

- **Page.** Every stage visit gets a fresh seed from `freshSeed()`: `crypto.getRandomValues` XOR a hash of `Date.now()`,
  mod 10^6. It drives the fall-in, the move schedule and the roaming trips.
  - A visit is each time DanceStage mounts its canvas. Leaving the stage and coming back counts as a new visit. A WebGL
    context recovery inside one visit keeps the plan.
  - The first plan is built in idle time with the kit, during the first hold, as before. After each visit the next plan
    is built in idle time. Each roaming plan runs in its own idle slot, behind the same build gate, and never while a
    visit is on. Later holds also trigger it if it isn't ready yet.
  - If a visit starts before its new plan is ready, the last plan is replayed.
- **Clash re-draws.** With some seeds, two neighbours' in-place moves come closer than 0.7 m where no trip can fix it.
  It is nearly always dancers 0 and 1 on the phone layout during the fall-in 8-count, which has no trips. The page
  re-draws such a seed, up to 4 tries:
  - 12 of 60 seeds needed a re-draw.
  - The chance that all 4 tries fail is about 0.2%. In that case the plan with the widest gap is used.
- **Lab.**
  - `&roamseed=N` pins the visit seed (fall-in + moves + trips). Without it, the lab draws a random seed per load like
    the page.
  - The crew row has a `reseed · N` button.
  - `&seed=N` still re-rolls the looks, as before.
  - `__crew.planSeed`, `__crew.schedule` and `__crew.assign(t)` expose the plan.
  - A pinned seed reproduces the page exactly: `&roamseed=951216` gave the same 12 s assignment as that page visit.
  - The lab doesn't re-draw clashing seeds; it shows whatever the seed gives (`__crew.roam.minGap`).

`seeds_12s.png` comes from one page load with three visits. kit-ready fired once, and the visits mounted at 13.1 s,
29.4 s and 45.8 s with three different seeds.

## Measured fall-in spread

These come from the posed qpos: the first time each dancer's hinge rms moves 0.15 rad away from its idle pose, with the
roaming and the crossfade applied exactly as in the frame loop. Seed 892165 (the desktop clip):

| dancer | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| scheduled start (s) | 9.167 | 8.901 | 9.433 | 8.636 | 8.901 | 8.370 | 9.433 | 9.167 | 9.167 |
| visibly moving (s) | 9.070 | 8.820 | 9.370 | 8.545 | 8.803 | 8.487 | 9.345 | 9.053 | 9.037 |

- Scheduled spread: 1.06 s (4 half-beats). Visible spread: 8.49 to 9.37 s = 0.88 s.
- Over 2000 seeds the scheduled spread is always 0.80 or 1.06 s.
- On the real page the crew fades in while the intro loop is still playing and is fully visible by the drop, so the
  whole fall-in is seen.

## Who is on what (seed 892165, desktop)

`uN` is the finale unit the dancer plays, "mirrored" is the dancer's own mirror, and `(M)` means mirrored as seen on
stage (the tag).

| dancer | look | 12 s | 40 s | 100 s |
| --- | --- | --- | --- | --- |
| 0 (lead slot) | M hoodie | u19 mirrored, d24 ch19_s1 | u27 mirrored, d23 ch09_s1 | u5, d22 ch05_s0 (M) |
| 1 | M tee | u20, d23 ch08_s0 | trip: d17 ch10_s3 (M) (base u8 mirrored) | u28, d16 ch06_s2 |
| 2 | W crop hoodie | u23, d18 ch09_s1 (M) | u28, d16 ch06_s2 | u16, d18 ch17_s1 |
| 3 | W tee dress | u15 mirrored, d23 ch13_s1 | u10, d16 ch05_s6 | u20 mirrored, d23 ch08_s0 (M) |
| 4 | W all black | u6, d24 ch20_s6 | u16, d18 ch17_s1 | u6 mirrored, d24 ch20_s6 (M) |
| 5 | W tracksuit | u10, d16 ch05_s6 | u24 mirrored (fused), d23 ch08_s0 (M) | u2, d16 ch05_s1 |
| 6 | M hoodie | u4 (fused), d22 ch05_s0 | u6 mirrored, d24 ch20_s6 (M) | u14 mirrored, d23 ch13_s1 (M) |
| 7 | M tracksuit | u28 mirrored, d16 ch06_s2 (M) | trip: d22 ch04_s6 (M) (base u3 mirrored) | u27 mirrored, d23 ch09_s1 |
| 8 | W hoodie | u27 mirrored, d23 ch09_s1 | u26 mirrored, d23 ch09_s1 (M) | u9 mirrored, d23 ch05_s1 |

- Duplicates at 12 / 40 / 100 s: 0 for (unit, mirror) and 0 for moves as seen.
- At most 1 dancer per unit, and at most 1 / 2 / 1 per library move.
- At 40 s two dancers share d23 ch09_s1, one plain and one mirrored as seen, which is allowed.

**Whole-song checks.** Every non-payoff 8-count was checked, trips included:
- `planSchedule` alone, 2000 seeds: 0 violations of any rule, 0 relaxed picks, 0.25 ms per plan. The 100 sampled seeds
  give 100 different unit-0 assignments.
- Schedule + roaming, 60 seeds × 2 orientations: 0 seen-duplicates, 0 moves with 3+ dancers, 0 trips on or next to a
  payoff.

## Roaming checks (still passing)

| | desktop (L4 landscape) | phone (L4 portrait) |
| --- | --- | --- |
| closest approach, page plans shipped (5 visits) | 0.701 to 0.719 m (rule 0.7) | 0.711 m (phone clip), 0.746 m (lab, seed 892165) |
| closest approach, 60 random seeds before the re-draw | min 0.700 m | min 0.551 m. These seeds get re-drawn. |
| furthest root outside the slots' hull (allowed 0.45 m) | ≤ 0.443 m | ≤ 0.449 m |
| trips per plan | 22 to 35 walks + 2 to 8 turns | 25 to 36 walks + 2 to 8 turns |

Pops (seed 892165, 9.8 to 140.3 s, hip path at 30 fps):

| window | worst hip speed | worst hip acceleration |
| --- | --- | --- |
| ±0.25 s around move switches | 1.61 m/s | 16.2 m/s² |
| trip blends | 1.37 m/s | 17.2 m/s² |
| inside moves | 2.04 m/s | 20.1 m/s² |

There are about 100 switches per song now, and none of them pops: switch windows stay below what the moves do on their
own.

## Perf

**Planning.**
- The schedule takes 0.25 ms.
- Roaming plans on the page took 30 to 46 ms per orientation over 5 visits. In Node over 60 seeds: median 19 ms, p95
  30 ms, max 47.5 ms.
- The planner was made about 26% faster with byte-identical output on 40 plans:
  - samples after a trip are computed lazily, so a candidate that fails early costs little;
  - candidate loops have no iterator or closure allocations.
- Before that, the earlier sync units opening up for trips had pushed one page plan to 86 ms.

**Frame loop.** The schedule is two typed arrays. `_base` no longer allocates state arrays per frame, as it used to.
`moveAt` returns a reused object, and the fall-in uses one preallocated idle buffer.

**Rendering (lab, same Crew, seed 892165, during playback):**

| | uncapped | vsync | draw calls | crew update |
| --- | --- | --- | --- | --- |
| 1440x900 @2x | 654 fps, p95 2.9 ms | 60.1 fps, p95 16.7 ms | 12 (10 + the reveal's 2) | 0.054 ms/frame |
| 1920x1080 @2x | 641 fps, p95 3.0 ms | | 12 | 0.051 ms |
| 390x844 @2x | 665 fps, p95 2.8 ms | 60.1 fps, p95 16.8 ms | 12 | 0.049 ms |

That is the same as the reveal round (630 to 700 fps, 12 draw calls). Roaming off: 659 fps. On the page, the drop still
mounts and draws its first frame 4 to 19 ms after compile.

`npm run build` passes.

## Rough edges

- **Fewer areas per dancer.** The old page seed (24) was hand-picked so that every dancer but the lead roamed 3 to 5
  areas. Random seeds sometimes leave a dancer in 1 or 2 areas (for example seed 892165 desktop: 2, 4, 3, 3, 1, 3, 2,
  2, 1). The safety checks hold either way. A quality filter (e.g. require ≥ 2 areas each) could join the clash re-draw
  if this matters.
- **Energy can clash with the music.** The whole-song pool means a dancer can be on a calm verse move during a loud
  section. That is the point (chaos), but the section mixing makes it visible.
- **The lead is just slot 0 now.** It plays its own random schedule. "Unison" means the finale's own unit for that
  8-count. Only the planner's roaming rules (fewer trips, stays near its slot) still treat it as the lead.
- **The lab doesn't re-draw clashing seeds.** It shows what the seed gives, by design, so a pinned seed is always
  reproducible.
- **The payoff entrance is abrupt.** Everyone crossfades into unit 14 over ±0.2 s from different moves. Watch it and
  judge it.
