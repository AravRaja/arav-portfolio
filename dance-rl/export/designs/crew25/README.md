# The live choreography again, with 25 dancers

The live site (`origin/master` = a3f13d5) has 9 dancers. This change goes back to its choreography, keeps the dev
branch's sim-reveal wipe and caption, and raises the crew to 25. Nothing has been committed.

All runs were muted. Headless Chrome ran with `--mute-audio`. Audio was added to the clips afterwards with ffmpeg, from
`now-get-busy.mp3`. Nothing played through the speakers. **No real phone was tested.** The "phone" profiles are headless
Chrome on the M1 Pro, with a 390×844 viewport, DPR 3, touch, and CPU throttling.

## What the page does now (defaults in `src/dance/stageKit.js`)

| setting | value | meaning |
|---|---|---|
| `CHOREO_MODE` | `'crew'` | The live a3f13d5 scheduler. `'chaos'` (the seeded per-visit scheduler) is still there. |
| `ROAM` | `false` | No roaming. `roam.js` is untouched and can be turned on in the lab. |
| `CREW_SIZE` | `25` | Bodies built; desktop and landscape show all 25. |
| `CREW_SIZE_PHONE` | `13` | Portrait screens show dancers 0–12, using their own layout. |

- **Seed.** Crew mode is deterministic: one stage plan is built with the kit and reused on every visit. Nothing is
  re-planned between visits. Chaos mode still draws a fresh seed per visit.
- **Kept from dev:**
  - the sim-reveal wipe: the handle, the `← SIM` tag, one auto-sweep per stage entry, and move tags
  - the caption `RL-trained in MuJoCo · I think dancers are safe for now...`, with no `[RL]` tag and no stats block
    (checked in the DOM: 0 `.sim-reveal-stats`, 0 `.dancer-caption-tag`)
  - the rule that the crew dances from its first drawn frame
- **Off-beat release in crew mode.** If the crew shows before the drop, it plays in unison from its first frame on
  unit 0's move until the first downbeat (unit 1 mirrored, then a crossfade into unit 0 at 8.63 s). The drop therefore
  lands with everyone on one move. Measured in the clips: from the first visible frame (drop − 0.77 s), every dancer is
  moving (min joint rms 83–129 °/s) and all 25 (or 13) are on the same unit at 8.2, 8.37, 8.5, 9 and 10 s.
- **Normal release.** The crew shows about 0.8 s after the drop, exactly as on the live site.
- **Lab** (`/dance-lab?crew=L4`):
  - `&n=1..25` (default 25), `&nphone=N` (default 13; `0` shows all), `&choreo=crew|chaos`, `&roam=1`
  - a `choreo` toggle button
  - chaos at n=25 with roaming checked: 0 schedule conflicts, roam min gap 0.724 m

## The n=9 restore is exact

- **Pose.** New `CrewMotion` in crew mode against a3f13d5's `CrewMotion` (loaded from git), dancers 0–8, every 1/60 s
  from the drop to 141 s (71,622 samples): max |Δqpos| = **0**. The same holds with n=25 for dancers 0–8.
  See `checks/n9_restore_qpos.txt`.
- **Image.** a3f13d5's lab against the new lab at `n=9`, frozen at 41.04 s and at 100.3 s, crew area 1830×830: **0
  differing pixels**, with no fuzz. The only differences in the whole frame are the new reveal handle at the right edge
  (8,069 px).
- **Looks and layout.** `generateCrew(7, 9)` is byte-identical to a3f13d5's `generateCrew(7)`. The 9-dancer L4 slots
  and camera are unchanged.

## Offsets and mirrors for 25 (`schedule.js` `crewRecipes` / `planCrewSchedule`)

- The scheme is the live one, generalised:
  - The lead is offset 0.
  - Pair k = (2k−1, 2k) gets offset `[2, 1, 3, 4][(k−1) mod 4]`. The even dancer is mirrored.
  - The offset is a whole number of 8-counts inside the current section, wrapped by the section's length.
  - On the sync units `[0, 6, 8, 14, 16, 20, 26, 28]`, and before or after the song, everyone plays the lead's unit,
    unmirrored. Switches use the same ±0.2 s crossfades.
- Pairs 1–4 are the live recipes exactly.
- In layouts with 25 dancers, odd dancers stand right of the centre and even dancers (the mirrored ones) stand left.

| dancers | offset | mirrored |
|---|---|---|
| 0 (lead) | 0 | – |
| 1 / 2, 9 / 10, 17 / 18 | 2 | even ones |
| 3 / 4, 11 / 12, 19 / 20 | 1 | even ones |
| 5 / 6, 13 / 14, 21 / 22 | 3 | even ones |
| 7 / 8, 15 / 16, 23 / 24 | 4 | even ones |

- **How in sync it reads.** The proportions match live: lead + 6 per offset (live: lead + 2 per offset).
  - In 4-unit sections, offset 4 is the lead's own unit.
  - In 2-unit sections, offsets 2 and 4 are the lead's unit and 1 and 3 are the other one.
  - So most of the crew is on one or two moves outside the 6-unit sections, and everyone is on one move on all 8 sync
    8-counts.

## Looks (`looks.js`)

- Dancers 0–8 are unchanged. 9–24 come from `extendCrew`, which uses its own RNG stream from seed 7.
- **Bodies.** The crew is 13 women and 12 men. The new bodies are dealt in seeded f/m pairs, so the phone's first 13
  are 7 women and 6 men.
- **Templates.** Women get crop hoodie, tee dress, hoodie, tracksuit and tee. Men get hoodie, tracksuit and tee. There
  is exactly one more all-black look, on a man (dancer 16). That makes one all-black look per body, so the cast's
  re-dress rule never fires.
- **Colours.** Garments only come from the palette. No new yellow garments: yellow stays for accents, and the cast keeps
  its one yellow tee and yellow hoodie. White tops only go on tees, tracksuits and tee dresses, so the lead's white
  hoodie stays unique. Colours are dealt from an even red / blue-grey / off-white / white deck, preferring unused
  template:colour pairs.
- **Repeats.** Five template:colour pairs repeat once (tracksuit blue-grey, hoodie off-white, tracksuit red, hoodie
  red, all-black). None of them are neighbours in any layout.
- **Hair.** Per-body decks, reshuffled when used up, never the same style as the previous dancer. Headwear only goes
  where it fits.
- See `lineup25.png`.

## Layouts (`layouts.js`, L4 club)

- **How they were made.** A seeded scatter is annealed against the real camera fit and a raster occlusion proxy
  (`tools/layout_opt.mjs`). Dancers are then assigned to slots under the look and mirror rules (`tools/assign.mjs`).
  Positions and facings are refined against the proxy, with the dancers at their real root positions at 36 song times
  (`tools/refine.mjs`).
- **How they were checked.** ID renders in the lab: occlusion = 1 − visible pixels / pixels when drawn alone, at 50
  song times from 8.6 s to 138 s every 2.65 s, plus 41.04 s.
- **Desktop.** It uses a `big` camera override: 18° elevation (the 9-dancer layout uses 13°), fov 30. The crew is
  14.6 m wide × 11.7 m deep, with the lead front-centre and a little left.

| layout | worst occlusion (any dancer, any sampled time) | dancer height, px (smallest per-dancer median / mean) | min root gap over the song | slot min |
|---|---|---|---|---|
| desktop 25, 1920×1080 | **9.2%** (11.5% at 41.04 s) | 138 / 188 (live 9: ~243–348) | **0.90 m** | 1.28 m |
| phone 13, 390×844 (default) | **9.9%** | **80 / 96** | **0.81 m** | 1.12 m |
| phone 25, 390×844 | 24.9% | 51 / 57 | 0.81 m | 1.16 m |
| phone 15 (lab only) | 14.4% | 67 / 82 | – | – |
| phone 11 (tested, not kept) | 9.0% | 92 / 114 | – | – |

- **Spacing.** Root paths were measured in the lab with `__crew.track` (the real rig and retargeter, 10 Hz, from the
  drop to 141.5 s, crew mode). Every layout keeps all pairs ≥ 0.7 m apart for the whole song.
- **Neighbour rules.** Neighbours here means the 2 nearest dancers, or anyone within 1.6 m.
  - No neighbours share template + top colour in any layout.
  - The all-black looks (4 and 16) are 6.7 m apart on desktop and 7.8 m apart on phone 25, and not neighbours.
  - Every odd dancer is right of centre and every even dancer is left.
  - Yaw is within ±35°.
  - One neighbour pair does the identical move in each 25 layout: 9/17 on desktop, 11/19 on phone 25. That was a soft
    rule.
  - See `checks/spacing_and_neighbours.jsonl`.

### Phone decision: 13 by default

- **25 on a phone is too small**, not too slow. The dancers are 51–64 px tall, mean 57. See `phone25_390x844@2x_41.04s.png`.
- **13 is the default.** It's the largest count where the crew still reads as people:
  - mean height 96 px
  - the two back dancers at about 80 px; front dancers about 130 px
  - worst occlusion 10%, well under 25%
- **Why not 15 or 11.** 15 drops to a mean of 82 px. 11 is the only count where every dancer stays ≥ 90 px (92 / 114).
  If "every dancer ≥ 90 px" is the hard rule, set `CREW_SIZE_PHONE = 11` and use `checks/p11a_t.json`'s layout from
  `tools/`. It isn't wired in as a table: 11 currently takes the first 11 of the 13 slots.
- **Performance didn't decide it.** 25 on the phone profile holds 60 fps even at CPU ×6 (see below).

## Sim reveal at 25

- The capsule crew is still one skinned mesh and one draw call: 25 × 16 = 400 bones, about 65k vertices, a 32-bit
  index, about 100k triangles. It's built in the body worker.
- **Tag rule.** With more than 9 dancers, only the 6 nearest the camera (the front-most slots, largest z) get a move
  tag. The rest of the tag elements are hidden. At 9 or fewer, every dancer still gets one.
- **New: parked.** While the divider is parked (a 6 px sliver outside the camera's 94% fit), the capsule mesh isn't
  drawn. Only the checkerboard backdrop is. This saves about 100k triangles of vertex work on every parked frame. It
  still compiles before the first frame because it's visible during `compileAsync`.
- See `desktop_reveal_50_41.04s.png`.

## Build path

- The bodies are built in the worker (all 25) and cached for the session.
- **Main thread.** It does one body's skinning and retarget per idle period. It does another only while the period
  still has twice the last body's time left. The work is gated as before: none while the bar is full, and none for
  1.2 s after the release.
- **Time from the start of the hold until the kit is ready** (bodies + sim crew + plan; measured from the
  `dance-stage:kit-ready` mark):

| profile | worker bodies built | kit ready | hold until armed |
|---|---|---|---|
| desktop @2x | 486–512 ms | **720–747 ms** | 3.3 s |
| phone | 499–602 ms | 731–839 ms | 3.3 s |
| phone CPU ×4 | 482–503 ms | 1136–1148 ms | 3.3 s |
| phone CPU ×6 | 594–598 ms | 1639–1648 ms | 3.3 s |

  In every run the kit was ready before the bar was even full. Each run used the quickest real hold: let go the moment
  the bar armed.
- **Bodies not ready yet** (forced: `finale.bin` delayed 7 s, `perf/late_bodies_desktop.json`):
  - The drop played normally, with no long tasks and 60 fps.
  - The crew canvas mounted 4.1 s after the release.
  - Its first frame drew all 27 draw calls (all 25 dancers at once), then the usual fade-in ran.
  - Nothing popped in one by one, because DanceStage mounts only once the whole kit is built.

## Performance

**Measured** on the production build (`vite preview`), with the real flow: load, click, hold space, let go when armed,
drop, stage. headless Chrome (ANGLE/Metal) on the M1 Pro.

- The stage window is 5 s, starting 3.5 s after the crew becomes visible (after the auto-sweep). The drop window is
  release → +4.4 s.
- Draw calls and triangles come from wrapping the WebGL2 draw calls, per frame.
- Heap is `Runtime.getHeapUsage` after a forced GC.
- Raw runs are in `perf/`.

| profile | runs | stage fps / p95 / max | draw calls | triangles | drop window fps / max frame | long tasks: hold / drop | heap before hold → on stage |
|---|---|---|---|---|---|---|---|
| 1920×1080 @2x, 25 dancers | 3 | 60.0 / 16.8 / 16.8 ms | 27 | 195,525 | 59.8–60.0 / 16.8–33.4 ms | none / none | 6.4 → 12.2 MB |
| 390×844 @3x, 13 (default) | 3 | 60.0 / 16.7–16.8 / 16.8 ms | 15 | 102,648 | 60.0 / 16.8 ms | none / none | 6.4 → 12.2 MB |
| same, CPU ×4 | 2 | 60.0 / 16.7–16.8 / 16.8 ms | 15 | 102,648 | 59.3–59.5 / 33.3 ms | none / none (an earlier pair: 54, 72 ms at the canvas's first frame) | 6.4 → 12.2 MB |
| same, CPU ×6 | 2 | 60.0 / 16.8 / 16.8 ms | 15 | 102,648 | 58.2 / 66.7 ms | 50–53 ms at +3 ms and +0.61 s / 76–77 ms at the canvas's first frame | 6.4 → 12.2 MB |
| 390×844 @3x, **25** (test build) | 2 | 60.0 / 16.7–16.8 / 16.8 ms | 27 | 195,525 | 60.0 / 16.8 ms | none / none | 6.4 → 12.3 MB |
| same, CPU ×4 | 2 | 60.0 / 16.7–16.8 / 16.8 ms | 27 | 195,525 | 58.4–59.1 / 66.7–99.9 ms | none / 66–101 ms at the first frame | 6.4 → 12.2 MB |
| same, CPU ×6 | 2 | 59.4–60.0 / 16.8 / 33.4 ms (3 frames of 33 ms in one run) | 27 | 195,525 | 55.7–57.0 / 133 ms | 55–68 ms / 52–65 + 133–139 ms at the first frame | 6.4 → 12.3 MB |

- **Uncapped** (`--disable-gpu-vsync --disable-frame-rate-limit`; headless is then CPU/compositor-bound):

| profile | stage fps | p95 | max |
|---|---|---|---|
| desktop @2x, 25 | **490–522** | 3.8–4.1 ms | 11–41 ms |
| phone, 13 | **619–651** | 2.8–3.0 ms | 7–10 ms |

  The 9-dancer crew measured 593–617 and 629–636 fps in the reveal README. In the uncapped runs only, the canvas mount
  shows a 224–373 ms task, which is shader compiling without vsync pacing; the capped runs don't.
- **The canvas's first frame.** On throttled profiles the one long task at the drop is the crew canvas's first frame.
  It uploads the bodies' buffers and bone textures. It lands about 1.0 s after the release, after the drop, and before
  the fade-in starts. The 9-dancer crew had about 57 ms there at ×4.
- **Fallbacks.** The phone profile holds 60 fps at ×4 and ×6 at the default 13, and even at 25. None of the listed
  fallbacks were needed: no lower DPR cap (it stays at 1.5), no dancer LOD, and no fewer dancers for speed.
- **Estimated, not measured.** A real phone GPU has much less fill rate and vertex throughput than the M1 Pro behind
  these headless runs. At 25 dancers (195k skinned triangles, 25 skinned draws) a mid-range phone may not hold 60.
  13 dancers (103k) is close to the live site's 9 (71k). This is another reason to keep 13 on phones until it's tried
  on a real device.
- **Chunks** (`npm run build` passes):
  - `DanceStage-*.js` 106.98 kB / 41.80 kB gzip (dev before this change: 94.95 / 36.79 at the reveal commit)
  - `bodyWorker-*.js` 113.38 kB
- Data is unchanged.

## Files

- **Stills:**
  - `desktop_1920x1080_41.04s.png`
  - `phone13_390x844@2x_41.04s.png` (the default)
  - `phone25_390x844@2x_41.04s.png`
  - All are real page flow, with the song clock frozen at 41.04 s.
- **Clips:** `desktop_clip_1280x720_release-to-drop_12s.mp4` and `phone13_clip_390x844@2x_release-to-drop_12s.mp4`.
  - 12 s from the release, an off-beat release (0.4 s after the hit point), so the crew shows 0.77 s before the drop.
  - They show the crew moving as it fades in, unison through the drop, and the auto-sweep.
  - Frozen frames at 30 fps. Audio was added afterwards from the mp3 at the clip's song time. Before the drop, the
    real page plays the intro loop instead.
- `desktop_reveal_50_41.04s.png`: the reveal at 50%, with tags on the front 6 only (2 of them fall on the sim side).
- `compare_live_vs_new_desktop.png`: a3f13d5 with 9 dancers (its lab render, which matches its page) | the new page
  with 25, both at 41.04 s.
- `lineup25.png`: all 25 looks, front row 0–12 and back row 13–24.
- **`checks/`:**
  - occlusion and height runs (`d25b_t`, `p13a_t`, `p15a_t`, `p25a_t`, `p11a_t`)
  - spacing and neighbours
  - the n=9 restore
  - the pixel-diff image (all black)
  - the flow info for both clips
- `tools/`: the scripts used. They point at the session scratchpad and the dev server port and are kept for reference.

## Things that look off at 25

- **Desktop dancers are much smaller.** Mean 188 px, against about 295 px for 9. The back rows (about 140 px) read as
  a crowd, not as individuals.
- **The camera is steeper.** It sits at 18° instead of 13°. That's still flat-ish, but it's a visible change from the
  approved framing.
- **The lead stands alone at the front** (z +7.1 m), clearly ahead of everyone else. The optimiser kept it front-most.
  Pull it back about 1.5 m if it reads as detached.
- **The crew reads as more synchronised than chaotic, as intended.** On the 2-unit sections all 25 share one of two
  moves. Groups of three dancers do identical moves (same offset and mirror). They're spread apart, except one
  neighbour pair per 25 layout.
- **Lineup labels.** In the lineup the front row's labels sit partly under their own shoes.
