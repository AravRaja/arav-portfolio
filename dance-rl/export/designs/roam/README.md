# Roaming crew

The 9 dancers no longer stay on their L4 slots for the whole song. Each one makes a few trips to other parts of the
floor: it plays a travelling 8-count from the move library, then carries on with its own finale copy (same moves as
before) at the new spot. Unison is unchanged. On the drop and on the first 8-count of every section, everyone does the
lead's moves wherever they are standing at that moment.

Everything here was rendered muted: headless Chrome with `--mute-audio`, frozen song time stepped frame by frame from
the lab (`/dance-lab?crew=L4`, `__lab.freeze(t)`). The song was muxed into the clips afterwards with ffmpeg, so the
speakers never played anything.

| file | what |
| --- | --- |
| `desktop_clip_1280x720_44-60s.mp4` | 16 s, 44 to 60 s. Trips: dancer 3 at 46.9 s (0.9 m), dancer 7 at 51.1 s (0.9 m), dancer 8 turns at 55.4 s, dancer 1 leaves at 59.6 s |
| `phone_clip_390x844@2x_44-60s.mp4` | 16 s, 44 to 60 s. Trips: dancers 5 (1.4 m) and 2 (1.0 m) at 46.9 s, 6 and the lead at 51.1 s, 3 at 55.4 s, 7 and 4 leave at 59.6 s |
| `formation_desktop.png` | 1920x1080 stills at 40 / 70 / 100 / 130 s (2x2) |
| `formation_phone.png` | 390x844 @2x stills at 40 / 70 / 100 / 130 s (1x4) |

## Travel moves (`public/dance/travel.{json,bin}`, 359 kB + 8 kB)

Export: `PYTHONPATH=src .venv-data/bin/python -m dance_rl.export_web travel --out ../public/dance/travel`. This is a
new subcommand. The finale export is unchanged and still rebuilds `finale.bin` byte for byte. Each move is played
kinematically from the library qpos, resampled to 30 fps, re-rooted (root xy = 0, heading +x at t = 0) and stored in
the finale's 29-float frame layout. The time column counts seconds since the clip's first downbeat. There are 129
frames per clip, covering 0 to 4.27 s, and every move also has its mirror: 12 moves, 24 clips. The header holds each
clip's net displacement, its end heading, and path and speed stats.

Picked from the 274 non-in-place library moves:

- the filter: displacement 0.64 to 2.1 m, |yaw change| <= 61°, speed_factor <= 1.13, pelvis_z_min > 0.6
- then by root path and contact sheets: progress mostly one way, lateral wobble <= 0.42 m, both feet off the floor
  <= 28% of the time, torso never above 1.33 m (no jumps)
- each clip must start and settle at walking pace (<= 0.67 / 0.58 m/s over its first / last half second)

| move | disp (m) | direction (move frame) | heading change | lateral wobble (m) | v start / end (m/s) | speed factor |
| --- | --- | --- | --- | --- | --- | --- |
| gMH_sFM_d23_mMH5_ch13_s0 | 0.97 | -179° (back) | -6° | 0.16 | 0.25 / 0.27 | 0.87 |
| gLH_sFM_d18_mLH2_ch17_s0 | 0.87 | -83° (side) | 29° | 0.07 | 0.16 / 0.24 | 1.13 |
| gMH_sFM_d23_mMH2_ch10_s2 | 0.98 | -87° (side) | -19° | 0.18 | 0.47 / 0.56 | 1.13 |
| gMH_sFM_d23_mMH4_ch12_s1 | 0.95 | 0° (forward) | 31° | 0.15 | 0.37 / 0.26 | 0.94 |
| gLH_sFM_d17_mLH2_ch10_s3 | 0.96 | -18° (forward) | 7° (spin) | 0.27 | 0.14 / 0.26 | 1.13 |
| gLH_sFM_d18_mLH2_ch17_s3 | 1.47 | 162° (back) | 15° (spin) | 0.35 | 0.45 / 0.36 | 1.13 |
| gMH_sFM_d23_mMH4_ch12_s7 | 2.11 | -163° (back) | 22° | 0.21 | 0.16 / 0.28 | 0.94 |
| gMH_sFM_d23_mMH4_ch12_s2 | 1.41 | 145° (back diagonal) | -61° | 0.16 | 0.20 / 0.24 | 0.94 |
| gLH_sFM_d17_mLH3_ch11_s2 | 0.77 | -137° (back diagonal) | -10° | 0.28 | 0.65 / 0.14 | 1.03 |
| gLH_sFM_d17_mLH3_ch11_s3 | 0.65 | 30° (forward diagonal) | 40° | 0.42 | 0.67 / 0.17 | 1.03 |
| gLH_sFM_d18_mLH2_ch17_s1 | 0.65 | 25° (forward diagonal) | -50° | 0.33 | 0.39 / 0.12 | 1.13 |
| gMH_sFM_d22_mMH3_ch04_s6 | 0.64 | 103° (side) | 24° | 0.19 | 0.11 / 0.38 | 1.03 |

Rejected:

- d22 ch03_s0 / s4 and d24 ch21_s5: out-and-back loops
- d23 ch10_s1 and ch13_s7: jumps
- d23 ch10_s3: overshoots 1.2 m past its end
- d23 ch13_s3 and ch12_s6: still moving at 1.45 / 0.78 m/s, crouched, when the 8-count ends. They were in the first
  cut and caused the only visible lurch at trip ends, a 2.4 m/s hip spike.

The strict brief range (0.8 to 2.5 m) leaves only 9 usable moves. The last three are 0.64 to 0.65 m and fill the
forward diagonals.

## Choreography (`src/dance/roam.js`, played by `CrewMotion.sample` in `motion.js`)

The plan is seeded and deterministic. It is made once per layout and orientation, takes about 40 to 60 ms, and is
cached. The page makes both orientations' plans in idle time while the crew is being prepared, so mounting on the drop
costs nothing extra (the page test shows first-frame 5 ms after compiled).

**When**
- A trip fills one whole 8-count that is not a sync unit, so never the drop or the first 8-count of a section. Units
  that end after the song are skipped.
- At most 3 trips per 8-count (2 is the maximum actually used), and no dancer moves in two 8-counts in a row.
- Quotas: the lead gets 3 trips, the others 4 or 5. One trip per dancer (never its first) is a turn in place of 25 to
  45° instead of a walk.

**How**
- The clip is re-rooted where the dancer stands and turned to its current heading, so the trip starts without a pop.
- An aim turn of |delta| <= 45° is eased in over the first two beats.
- The root path is scaled by sigma in [0.87, 1.15].
- Over the last two beats the dancer turns by up to 45° so it ends facing the camera within ±35°, biased a little
  towards centre stage.
- The next home is solved so the finale copy continues exactly where the clip ends. Trips blend in and out over
  ±0.35 s; the finale's own switches still use ±0.2 s.

**Where**
- Candidate landings come from every clip × aim × scale.
- A landing must be at least 1.0 m from everyone else's spot, inside the slots' convex hull (+0.1 m), and in a
  different area of a floor plan of 13 to 15 spots: the 9 slots plus up to 6 gap-fillers.
- No one may be more than half hidden. On screen that means a stage-x gap under 0.32 m plus up to 0.2 m more when the
  two are close in depth; on the phone, dancers about 2 m apart in depth stop hiding each other.
- Candidates are scored on: aim turn, scale, end turn, occlusion, revisiting an area, distance from the nearest
  floor-plan spot, crowding, keeping the crew as wide and as centred as the layout, how well the leg pose matches the
  finale at both ends, and a little randomness.
- The best candidate is then checked against the actual sampled paths at 10 Hz, including everyone's in-place wander,
  from the trip to the end of the song:
  - roots never closer than 0.7 m
  - every root inside the hull + 0.45 m, which is inside the camera's dance box around the slots, so the framing
    never changes
  - once landed, nobody stands right in front of or behind it (stage-x gap < 0.25 m), checked every second
- If it fails, the next candidate is tried, up to 30.

**The lead** gets 2 walks + 1 turn, every landing within 1.1 m of its slot, and nobody may park in front of it.

Seed 24 is the page default (`CREW_ROAM_SEED`). It was picked from seeds 1 to 40 as one where every dancer but the
lead dances in 3 to 5 areas in both orientations.

### Trip schedule, seed 24

Desktop (L4 landscape): 30 walks + 7 turns over 22 of the 24 eligible 8-counts. Walks are 0.55 to 1.54 m (mean
0.9 m), sigma 0.90 to 1.06, facing after each trip within ±34°. Areas per dancer, lead first: 2, 4, 4, 3, 3, 3, 3, 3, 3.

| dancer | trips |
| --- | --- |
| 0 (lead) | 38.4 s 0.7 m, 63.9 s 1.0 m, 89.4 s turn -43° |
| 1 | 12.9 s 1.0 m, 59.6 s 1.0 m, 72.4 s 0.9 m, 80.9 s turn +43°, 114.9 s 1.0 m |
| 2 | 85.1 s 0.9 m, 97.9 s 1.5 m, 106.4 s 1.0 m, 114.9 s 1.5 m |
| 3 | 25.6 s 1.0 m, 38.4 s turn +33°, 46.9 s 0.9 m, 110.6 s 0.6 m |
| 4 | 12.9 s 0.6 m, 80.9 s 0.8 m, 102.1 s turn +30°, 131.9 s 0.8 m |
| 5 | 21.4 s 1.0 m, 29.9 s 1.0 m, 89.4 s 0.9 m, 97.9 s turn +36°, 110.6 s 0.6 m |
| 6 | 85.1 s 0.8 m, 102.1 s 0.7 m, 123.4 s 0.9 m, 131.9 s 0.9 m |
| 7 | 17.1 s 0.9 m, 25.6 s turn +45°, 51.1 s 0.9 m, 106.4 s 1.0 m |
| 8 | 29.9 s 0.7 m, 55.4 s turn -26°, 63.9 s 0.7 m, 123.4 s 0.9 m |

Phone (L4 portrait): 29 walks + 9 turns over 23 eight-counts. Walks are 0.47 to 2.29 m (mean 1.0 m), sigma 0.87 to
1.15, facing within ±34°. Areas per dancer: 2, 4, 3, 3, 3, 4, 4, 4, 3.

| dancer | trips |
| --- | --- |
| 0 (lead) | 51.1 s 0.8 m, 72.4 s turn +26°, 106.4 s 0.6 m |
| 1 | 21.4 s 1.0 m, 102.1 s 1.5 m, 110.6 s turn -36°, 131.9 s 0.8 m |
| 2 | 17.1 s 0.9 m, 29.9 s turn -28°, 46.9 s 1.0 m, 85.1 s 1.4 m, 97.9 s 2.2 m |
| 3 | 29.9 s 0.9 m, 55.4 s 1.0 m, 89.4 s turn +29°, 102.1 s 0.9 m |
| 4 | 12.9 s 0.9 m, 38.4 s turn -25°, 59.6 s 0.6 m, 85.1 s 0.5 m, 106.4 s 0.8 m |
| 5 | 46.9 s 1.4 m, 63.9 s turn +34°, 114.9 s 0.7 m, 131.9 s 0.9 m |
| 6 | 51.1 s 0.8 m, 63.9 s 1.1 m, 80.9 s turn -38°, 97.9 s 2.3 m |
| 7 | 21.4 s 0.6 m, 59.6 s 0.7 m, 80.9 s turn -31°, 89.4 s 1.0 m, 114.9 s 1.1 m |
| 8 | 25.6 s 0.9 m, 38.4 s 0.7 m, 123.4 s 1.1 m, 136.1 s turn +30° |

Mean distance each dancer moved between the 9 / 40 / 70 / 100 / 130 s checkpoints:

- desktop: 0.66, 0.60, 0.51, 0.76 m
- phone: 0.57, 0.73, 0.62, 0.96 m

## Checks

Each layout was checked over its whole song, using the sampled root timelines (10 Hz, in-place wander included).

| | desktop (L4 landscape) | phone (L4 portrait) |
| --- | --- | --- |
| closest approach of any two roots | 0.723 m (rule 0.7) | 0.710 m (rule 0.7) |
| same, layout without roaming | 0.967 m | 0.640 m (the phone slots already come that close before any trip) |
| furthest root outside the slots' hull | 0.428 m (allowed 0.45, inside the camera's dance box) | 0.436 m |
| mean pairs overlapping on screen (stage-x gap < 0.45 m, within the depth limit) | 0.79 (no roaming: 0) | 0.51 (no roaming: about 1) |

**Foot sliding.** This measures the speed of the planted foot: the lower ankle, on the floor and at least 3 cm below
the other one. Each row compares roaming with the plain finale over the same windows.

| | median, roaming | median, finale | p90, roaming | p90, finale |
| --- | --- | --- | --- | --- |
| dancing at home | 0.12 m/s | 0.12 m/s | 0.62 | 0.62 |
| during walks | 0.17 m/s | 0.12 m/s | 0.58 | 0.81 |
| ±0.25 s around trip starts / ends | 0.50 m/s | 0.18 m/s | 1.19 | 1.14 |

Walks add only a little sliding (the scale stays within ±15%, and the aim and end turns are eased over two beats).
The trip blends add some (a 0.7 s foot slide at each end, about 0.3 m), at the same p90 as the finale's own switches.

**Pops.** The worst hip speed in any blend window is 1.26 m/s on desktop and 1.2 m/s on phone. The finale's own peak
is 1.76 m/s, and the worst blend acceleration (17 m/s²) is no higher than the finale's own (18 m/s²).

**Slow in-place drift (brief step 3): skipped.** The feet are rigidly attached to the root while dancing in place, so
any drift is foot sliding by definition. At or below 0.08 m/s it would be invisible (no benefit); above that it reads
as skating. The trips do this job instead.

**Other layouts (lab).**
- L1 and L3 plan fine: about 30 walks and 7 turns each, closest approach at least 0.73 m.
- L2 (Line) has no room (0.85 to 0.95 m spacing in one row), so the planner finds no legal trips and it stays a line.

**Performance.**
- 10 draw calls, roaming on or off.
- Headless Chrome (Metal, uncapped frame rate, 1440x900 and 390x844 @2x, during playback): 630 to 700 fps, p95 frame
  time about 3 ms, the same with roaming on and off (636 vs 668 fps on desktop). Plenty of headroom for 60 fps.
- The real page (hold space, release, drop) was checked in headless Chrome on desktop and phone. travel.json / .bin
  are fetched with the prefetch. kit-ready came at 3.7 s, and on the drop the crew mounted, compiled in about 100 ms
  and drew its first frame 5 to 16 ms later.
- The per-frame path allocates nothing new (`TravelLib.sample` and the trip transform write into preallocated
  buffers). Posing all 9 dancers costs about 0.1 ms.

`npm run build` passes.

## Toggles

- Lab: `&roam=0|1` (default 1), `&roamseed=N`, and a `roam on/off` button in the crew row. The panel readout marks
  `>TRIP` / `>TURN`. `__crew.roam` holds the plan (trip list, checks, timelines) and `__crew.track(t0, t1)` gives foot
  and hip paths.
- Page: roaming is on (`<Crew roam roamSeed={CREW_ROAM_SEED}>`). `travel.json` / `.bin` join the prefetch started
  when space is first held, and `prepareCrew` waits for them with the other data. Without them the crew just dances on
  its slots.
