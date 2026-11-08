# Crew mock-ups: 9 procedural dancers on the music stage

## Round 3: L4 final (`L4-final/`), round-1 desktop framing + round-2 cast
The user preferred the round-1 desktop framing. Desktop L4 is back to the round-1 values; the phone framing and the
round-2 cast (seed 7, 5 women / 4 men) are unchanged.
- Desktop slots: the round-1 scatter, no longer x ×0.8 / z ×1.8. Elevation is a fixed 13° again, not the 12–18° auto
  pick. `desktopFrame: { top: 112, bottom: 150 }` restores the round-1 margins for L4 on desktop only.
- Measured against `L4/still_landscape_1920x1080_41.04s.png`: crew span 82.9% vs 83.0% of the width; crew box height
  37.6% vs 37.2%; top/bottom edges 33.2–70.8% vs 32.7–69.9%; group x-centres within 0.5%. The fit is width-limited, so
  the camera is the same at 1280×720 and 1920×1080 (dist 11.55 m, fov 30°, 13°).
- Phone: the camera is identical (390×844: 28°, dist 16.50 m), and the crew pixels match before/after
  (`phone_390x844_before_after.png`).
- Files: `desktop_1920x1080_41.04s.png` (1920×1080 CSS at 2×, downscaled), `desktop_clip_1280x720_38.38-46.38s.mp4`
  (8 s, 30 fps, frames rendered frozen in headless Chrome with `--mute-audio`, song muxed with ffmpeg),
  `compare_desktop.png` (round 1 | final).

## Round 2: L4 Club with a more diverse crew (`L4-diverse/`)
The user picked **L4 Club**. This round adds women, more hairstyles and two more outfits, and reframes L4 for phones.
Open `/dance-lab?crew=L4` (`&seed=N` re-rolls). `&lineup=front|back` shows the 9 looks in a row in the bind pose.

**Files in `L4-diverse/`.** All frames were rendered frozen in headless Chrome with `--mute-audio`; nothing played
through the speakers. The song was muxed in with ffmpeg afterwards.
- `mobile_portrait_1080x1920_41.04s.png`: 360×640 CSS px at 3×.
- `mobile_portrait_390x844@2x_41.04s.png`: the 390×844 phone the framing was tuned on.
- `desktop_1920x1080_41.04s.png`: 1920×1080 CSS at 2×, downscaled.
- `mobile_clip_720x1280_38.38-46.38s.mp4`: 360×640 at 2×. `desktop_clip_1280x720_38.38-46.38s.mp4`: 1920×1080 CSS,
  scaled to 1280×720. Both are 8 s at 30 fps, with the split in unit 7 and then unison at 42.63 s.
- `lineup.png`: the 9 looks, front row and back row, labelled `id body template / hair + headwear`.
- `looks.json`: seed 7, also written to `../looks.json` (format `dance-crew-looks/2`).

**Female body (`proceduralBody.js`, `o.body = 'f'`).** It uses the same 22-bone skeleton and the same retargeter.
Only the proportions change (`BODY_SHAPES.f`):
- shoulder joints ×0.9 and hip joints ×1.07
- trunk loft: waist ×0.84, hips ×1.1, chest ×0.93
- bust implied by two extra torso rings and a soft forward bulge of at most 1.8 cm, pushed forward only
- slimmer arms, neck and hands; thighs ×1.05, calves ×0.9; head ×0.95; feet ×0.9

Oversized tops damp the waist and bust shaping (`fit`). Height comes from the look: women 0.915–0.97, men 0.97–1.04.
The default `'m'` body is bit-identical to before (checked vertex by vertex on D4, D5 and a cap look), so D4–D6 are
unchanged.

**Hair (`o.hairStyle`).** Every style is vertex-coloured geometry skinned to the head.
- `crop` (default) and `none` (buzz): as before.
- `afro`: a large ellipsoid set back so the face stays clear.
- `curtains`: two locks either side of a centre parting.
- `ponytail`: a hair tie plus a Catmull-Rom strand that blends head → neck/chest towards the tip.
- `bob`: a chin-length bell with a face window and an inward-facing liner, so no stage shows through the gaps.
- `puffs`: two buns with ties.
- `braids`: a bundle of 3 plaits lying on the upper back, blending head → chest.

Hats and headphones scale up over bigger hair (`HAIR_VOLUME`, `headphoneFit`). Hair above a hat line is dropped. The
cap's saw-tooth edge is fixed by keeping whole latitude bands.

**Outfits (`looks.js`).** The 4 templates stay. Two new ones were added:
- `cropHoodie`: a cropped hoodie with a 2 cm strip of midriff, over high-waisted cargos with a waistband. The top two
  trouser rings follow the spine.
- `teeDress`: an oversized tee as a mid-thigh dress over leggings. The skirt's lower rings blend into the thighs, split
  left/right by x, so kicks lift the skirt instead of poking through it. The leggings get thinner socks.

**Crew mix (`generateCrew(seed, n, { women })`).** By default 5 women and 4 men, shuffled over the slots by the seed.
The lead can be either: a man gets the D4 white hoodie; a woman gets a white crop hoodie with a ponytail. Both wear
yellow headphones.
- Templates: the 2 feminine templates go to the first 2 women. Everyone else is dealt 2 tracksuits, 2 all-black,
  1 hoodie and 1 tee. Women's tracksuits are fitted.
- Hairstyles are dealt without repeats per body (women: ponytail / bob / puffs / braids / crop; men: crop / afro /
  curtains / buzz), so 9 dancers show 8–9 different heads.
- Headwear (1 bucket, 1 cap, 2 headphones, 4 bare) only goes on styles it fits over. Afros and puffs never get any;
  bobs only get the bucket.
- Top colours are dealt with the most constrained template first, and no two looks share both template and colour.
  The palette and the one-loud-colour rule are unchanged.
- Seed 7 is `mmffffmmf`: lead M hoodie + phones, M yellow tee + afro, W blue-grey crop hoodie + crop + phones, W red tee
  dress + bob + bucket, W all black + puffs, W blue-grey tracksuit + ponytail + phones, M off-white hoodie + buzz + cap,
  M red tracksuit + curtains, W all black + braids.

**Framing.** The crew margins are now measured from the DOM (header text ends at 136 px on a phone and 99 px on
desktop; the caption starts 106–110 px above the bottom): top 146 / 108, bottom 118.
- `fitCamera` takes an elevation range and picks the angle per viewport that fills both width and height. L4 uses
  12–18° on desktop and 18–28° in portrait. It lands on 28° at 390×844, 18° at 360×640 and 18° at 1920×1080.
- Portrait slots: narrow at the front, wider at the back, 6.3 m deep. Desktop slots: x ×0.8, z ×1.8 compared with
  round 1.
- **9 dancers stay on the phone; `mobileCount` is supported but not used.** The width sets the scale: each dancer needs
  ±0.9 m for arms plus root wander, and the measured wander is up to 0.33 m forwards and back and 0.30 m sideways. So
  dropping to 7 only makes dancers 8% taller (163 vs 151 px), while the deep layout fills the height instead.
- 390×844: the dance-box height fill went from 0.60 to 0.97, and dancers are about 26% taller than in round 1. The
  remaining band is about 75 px under the header, kept as headroom for jumps and raised arms.
- 1920×1080: box height fill went from 0.58 to 0.80, with dancers about 6% taller.

**Perf** (headless Chrome, ANGLE Metal, M1 Pro, song clock driven by rAF with no audio, 4 s from 30 s):
- 1920×1080 @2×: 60.1 fps, p95 16.7 ms.
- 390×844 @2×: 60.0 fps, p95 16.7 ms (seed 3 with a woman lead: 60.1 fps).
- 10 draw calls; 70.8k triangles for seed 7 (round 1: 65.7k).

**Rough edges.**
- The bodies have no faces, so the hair and silhouette do the reading. In motion, women read mainly by hair and size.
- A bob under the bucket hat (seed 7, #3) mostly disappears on dark skin.
- The skirt blends to the thighs, so in a wide lunge it stretches between the legs like a dress. It never gets
  physics.
- The portrait crowd overlaps in the middle at times (it's a club).

---

# Round 1

These are rough mock-ups, built for speed rather than polish. All nine dancers use the procedural toon body from D4–D6
(`proceduralBody.js`). The Rocketbox characters are not used. Open it at `/dance-lab?crew=L1` (`L2`, `L3`, `L4`).
Key `L` cycles L1 → L2 → L3 → L4 → solo, and the panel has a button for each. `&seed=N` re-rolls the looks. The caption
defaults to `[RL] FIRST JUST THE SONG, THEN REAL DANCERS`.

Each `L*/` folder holds three files, all rendered frozen. Nothing was played, and headless Chrome ran with `--mute-audio`.
The song was added with ffmpeg afterwards.
- `still_portrait_1080x1920_41.04s.png`: 360×640 CSS px at 3×
- `still_landscape_1920x1080_41.04s.png`: 1280×720 at 1.5×
- `clip_720p_38.38-46.38s.mp4`: 8 s. Unit 7 is split, then everyone snaps into unison on the section start at 42.63 s.

`overview_portrait.png` shows L1–L4 side by side. `overview_landscape.png` shows them 2×2. `looks.json` holds the 9 outfits
(seed 7).

## Looks (`src/danceLab/crew/looks.js`)
`generateCrew(seed)` is a seeded generator (mulberry32) that outputs the plain outfit params `buildDancer()` takes, so a
look can be reproduced from its seed.
- **Palette:** yellow `#f0ff18`, white, black, red `#d8232c`, off-white `#e9e2cf`, and blue-grey `#6b7690`.
- **Templates:** hoodie, tracksuit, tee + jeans, all-black. Look 0 is the lead (the D4 hoodie: white, yellow strings, soles
  and headphones). The other 8 are 2 of each template.
- **Top colours** are dealt from a deck (2 red, 2 blue-grey, 1 off-white, 1 yellow) so the crew spreads over the palette.
  Each look gets at most one loud garment colour. Yellow otherwise only appears as accents: drawstrings, soles, laces,
  belts and headphones.
- **Accessories:** 3 hats (bucket or cap) and 2 more pairs of headphones, never a hat and headphones together.
- **Variation:** skin tones are shuffled, and height varies from 0.95 to 1.03.

## Motion: fast path only, no new training (`src/danceLab/crew/motion.js`)
Every dancer plays `public/dance/finale.{json,bin}`. Each one is shifted by a whole number of 8-counts **within the
current section**: unit = section start + (k + off) mod section length. That keeps everyone on the beat and in the
section's energy tier. Odd/even dancer pairs add a left↔right mirror (the `dance_rl/mirror.py` map plus the root
reflection), and the layouts put each mirrored dancer on the other side of the centre.

| dancer | off | mirror | role |
|---|---|---|---|
| 0 | 0 | no | lead |
| 1 / 2 | 2 | no / yes | B while the lead does A (6-unit sections) |
| 3 / 4 | 1 | no / yes | one 8-count ahead (canon) |
| 5 / 6 | 3 | no / yes | three ahead (one behind in 4-unit sections) |
| 7 / 8 | 4 | no / yes | the lead / its mirror in 4-unit sections |

**What synchronises when.** On the sync units, all 9 dancers snap to exactly the lead: the same unit of the finale,
not mirrored.
- The sync units are the drop's first 8-count (8.63 s) and the first 8-count of every section: units 0, 6, 8, 14, 16,
  20, 26 and 28, starting at 8.63, 34.13, 42.63, 68.13, 76.63, 93.63, 119.13 and 127.63 s.
- All four 1-bar breakdowns (34.14, 68.14, 93.64 and 121.26 s) fall inside these units.
- The sections come from `track_ref.song_units` (v2 section ids). finale.json's header has the unit table but no section
  ids, so `public/dance/crew.json` carries the sections, sync units and breakdowns.
- Between sync units the crew splits.
- Whenever a dancer's (track, unit, mirror) changes at an 8-count boundary, the two continuous trajectories are
  crossfaded over ±0.2 s (hinge lerp + root slerp). In the clips this shows no pops.

**Extra rollouts (tried, not used).** `alt_schedule.py` (in this folder) re-runs the finale show
(`configs/s9/c_show.yaml`, same deterministic checkpoints) on the Mac CPU venv with the choreographer's tier cursors
started at `CHOREO_OFF`, which gives a different A/B move pair in every section. Each run takes about 35 s
(17 s of rollout).
- Offsets 1–6 (seed 0) all **fell**, at 10–20 s into the song.
- Offset 1 with seeds 1–3 fell at 19.7–22 s. It is the same move each time (`gLH_sBM_d16_mLH2_ch02_s0` and its
  neighbours), so the problem is the policy, not luck.
- The finale's schedule is the one that survives. Real alternate schedules would need move filtering or training, so
  this is not cheap.
- The loader still supports extra tracks (`crew.json` `tracks: [{base: "/dance/<name>"}]`, exported with
  `export_web.py`), and a dancer's recipe can point at one.
- The failed rollouts were deleted.

## Layouts (`src/danceLab/crew/layouts.js`) and framing
A slot is [x, z, yaw, scale]. The camera (`fitCamera` in `Crew.jsx`) binary-searches its distance so that every
dancer's dance box fits between the header/intro text (112 px on desktop, 150 px at ≤ 900 px wide) and the space key
(150 px). The box is ±0.75 m (±0.6 m on a phone), 2.05 m tall, plus root wander. The view is then offset so the box
sits centred in that gap. On a phone the width is the limit, so the portrait versions go deeper and the camera looks
down more (elevation 16–25° against 9–18° on desktop).

| | desktop (1920×1080) | phone portrait | fov / elevation | root wander kept |
|---|---|---|---|---|
| **L1 Formation** | Skewed 3×3: lead in the centre of the middle row, front row shifted left by s/2.5, back row right by s/2.5 (point-symmetric, nobody directly behind anybody); back row at 0.96 scale | Same, tighter and deeper | 22° / 18°, 25° | 40% |
| **L2 Line** | One line of 9, 0.95 m apart (shoulder to shoulder) | Two staggered rows: lead + 4 in front, 4 behind in the gaps | 26° / 9°, 16° | 40% |
| **L3 Wedge** | V: lead front-centre, 4 pairs behind (0.95 m out, 0.85 m back each) | Narrow and deep (0.45 / 1.45 m) | 28° / 12°, 24° | 55% |
| **L4 Club** | Hand-scattered, yaw ±12–30°, varied depth, mild overlap | Same idea, compressed and deeper | 30° / 13°, 22° | 100% |

**Perf.** Measured in headless Chrome (ANGLE Metal, M1 Pro) by driving the song clock from rAF (no audio), for 4 s at
30 s into the song.

| | 1920×1080 @2× | 390×844 @3× (lab caps at 2×) | draw calls |
|---|---|---|---|
| L1 | 60.2 fps, p95 16.7 ms | 60.1 fps, p95 16.7 ms | 10 |
| L2 | 60.1 fps, p95 16.8 ms | 60.1 fps, p95 16.7 ms | 10 |
| L3 | 60.1 fps, p95 16.7 ms | 60.1 fps, p95 16.7 ms | 10 |
| L4 | 60.1 fps, p95 16.7 ms | 60.1 fps, p95 16.7 ms | 10 |

The draw calls break down as one skinned mesh per dancer (the headphones are merged into the body and skinned to the
head bone) plus one instanced mesh for all 27 contact-shadow blobs. The full crew is 65.7k triangles. All 9 retargets
run on one CPU poser rig, one after another.

**Take.** Portrait: L3 Wedge or L1. Both use the phone's height, and the lead reads as the lead. L2's two rows end up
small. Desktop: L2 Line, which is the cleanest read of "crew in sync" across the wide stage. L4 Club is the most alive.

## Rough edges to fix in the real build
- Phone portraits leave empty bands above and below the crew, because the width sets the scale. A slightly lower
  camera or fewer dancers on a phone (5–6) would help.
- 41.04 s is an arms-out move for most offsets, so the stills look busier than the clips. L1 desktop overlaps the most.
- Only one trajectory, so the variety is A/A′/B/B′ × mirror within a section. In the 2-unit sections, half the crew
  matches the lead anyway. Real variety needs alternate schedules that don't fall (see above).
- Root wander is scaled down (`travel`) for tight layouts. This makes the feet slide a little, and dancers can still
  graze each other in L2.
- Idle (before the drop) is the same breathing pose for all 9, with staggered breath phases.
- The skewed L1 grid reads more like a lattice than a square grid.
- All looks are generated on the main thread at mount (about 9 × buildDancer). That should be cached or done once per
  seed if it ships.

## Files
- `src/danceLab/crew/`: `Crew.jsx` (component, camera fit, instanced shadows), `looks.js`, `motion.js`, `layouts.js`.
- `src/danceLab/DanceLab.jsx`: registration (`?crew=`, key `L`, panel row, `window.__lab.setCrew`, `window.__crew`).
- `public/dance/crew.json`: sections, sync units, breakdowns and extra tracks (none).
- This folder also holds `alt_schedule.py` (the alternate-schedule rollout wrapper) and `looks.json`.
