# Sim reveal

The music stage's crew now has a wipe. A 1 px divider is parked at the right edge of the stage. Drag it left and the
same nine dancers appear as the MuJoCo capsule humanoid the policy was trained in. They stand on the simulator's
checkerboard floor under its grey-blue starry sky, and use the same joint angles, the same roaming and the same frame.

Everything here was muted. Headless Chrome ran with `--mute-audio`. Clips were rendered as stepped, frozen frames, and
the song was muxed in afterwards with ffmpeg.

## Caption

`src/dance/captions.js` has a new entry, index 4, which is now `DEFAULT_CAPTION` (the home page uses it). The lab still
cycles through all five with `C`.

- Text content: `[RL] RL-trained in MuJoCo · I think dancers are safe for now...`
- Rendered (the caption CSS uppercases it): `[RL] RL-TRAINED IN MUJOCO · I THINK DANCERS ARE SAFE FOR NOW...`
- Desktop: one line. 390 px phone: two lines, broken at the dot (`… IN MUJOCO ·` / `I THINK … NOW...`). Each ` · `
  part is a `nowrap` span (`CaptionText.jsx`), so the text content is still exactly the string above.

## How it's drawn: one scene, clipping planes

- **The plane.** Every frame, Crew builds a plane through the camera centre and the divider's screen line. It goes
  through the camera origin and the two near-plane points at the divider's NDC x, using
  `camera.projectionMatrixInverse`, so it includes the view offset. The plane is then moved to world space.
  - The toon materials (`base` and `black`) get `clippingPlanes = [toon]`.
  - The sim crew's material and the floor/sky quad get the negated plane, `[sim]`.
  - `renderer.localClippingEnabled = true`.
  - This is three's standard clipping: one dot product and a discard per fragment. There's no second pass and no render
    target. The DOM divider line covers the aliased seam.
- **The sim crew (`simBody.js`).** All nine MuJoCo bodies are merged into one `SkinnedMesh`: 16 bodies × 20 capsule and
  sphere geoms each, with the MJX sizes from `finale.json`.
  - There are 144 bones (9 dancers × 16 bodies). Each vertex is bound rigidly to one bone, at the identity.
  - Crew writes each bone's `matrixWorld` straight from the rig's FK, inside the same loop that drives the toon retarget:
    `outer.matrixWorld · T(hip shift) · S(k·1.084) · MJ→three · rig.world[body]`.
  - Size: 36.3k triangles, 22.2k vertices, 1.28 MB, one draw call.
  - Material: `MeshLambertMaterial #eca55a`, matte sim orange, pre-warmed so it reads like the contact sheets under the
    stage's blue-tinted lights.
- **The floor and sky.** One full-screen quad, a `ShaderMaterial` with `clipping: true` and three's clipping chunks.
  - Each pixel casts a ray against y = 0. The checker is box-filtered so it doesn't shimmer, 0.9 m squares, in the
    contact sheets' colours: lit near the crew, darkening with distance, fogging into the dark band at the horizon.
  - The sky is the sheets' grey-blue gradient with 1–2 px stars on a fixed 7 px screen grid.
  - On a phone the camera looks down 30°, so there's no real horizon in view. There, the floor ends where the top 20%
    of the screen begins, so the sky still shows.
  - The quad draws first (`renderOrder -100`, no depth test), so it replaces the blue page only right of the divider.
- **Draw calls: 12** (was 10): 9 toon bodies, 1 instanced shadow mesh, 1 sim crew, 1 floor/sky quad. This holds parked,
  at 50% and fully revealed.
- **Compiling before the first frame (`primeClipping`).** `renderer.compileAsync()` builds every program with the
  renderer's *current* clipping-plane count. That count is only set while rendering, so before the first frame it's 0,
  and the first real frame would recompile every clipped program synchronously.
  - Measured without the fix (phone, CPU ×4): 5 programs re-linked on the first frame, an 81 ms long task.
  - The fix: DanceStage's warm-up renders an empty scene with one global plane, so the count is 1, then calls
    `compileAsync`. Every crew material has exactly one local plane (the contact shadows get a never-clipping one), so
    the programs it builds are the ones the first frame uses.
  - Measured with the fix: 7 programs, all linked before the first frame, 0 after, in every run.
  - This relies on three r177's internals (`WebGLClipping.numPlanes` lingering). If three changes it, the cost is one
    slow first frame, not wrong pixels.
- **Built off the drop.** `stageKit.js` posts the sim-crew job to the same body worker, right after the 9 toon bodies,
  once `finale.json` has the geoms. The main thread then only wraps the arrays into the mesh, in one more idle slot
  (0.8 ms).
  - If the worker isn't available, it builds on the main thread in an idle slot (3.4 ms).
  - The lab builds it in place.
  - The kit is ready 0.46–0.51 s after the hold starts (HEAD: 0.44–0.49 s), and 0.86–0.89 s at CPU ×4 (HEAD:
    0.84–0.85 s). Building still pauses while the bar is full and for 1.2 s after the release.
  - GPU resources are released on unmount, like the toon bodies.

## Same pose, frame for frame (`pose_check.json`, `pose_overlay_41.04s.png`)

Both bodies are posed from the same `rig.fk(q)` call, per dancer per frame, so the joint angles are identical by
construction. Measured in the lab (frozen frames at 41.04, 60.2, 97.3 and 118 s; 9 dancers × 8 limb segments):

| | max | mean |
|---|---|---|
| toon limb vs the capsule body's rigid limb direction | 1.5e-6° | 3e-7° |
| hip midpoint, floor plane (x, z) | 3e-14 m | |
| hip height | ≤ 6 mm (most frames 0–2 mm) | |

- The capsule bodies are scaled k × 1.084, not plain k. The toon retarget puts its root at the rig's hip midpoint × k
  and its lowest sole on the rig's. But the rig's legs are measured body origin to body origin, and MuJoCo's foot origin
  sits 8 cm under the ankle hinge. So at plain k the capsule hips rode 6–8 cm under the toon's, which showed as a step
  at the divider.
- A least-squares fit over the whole song (every dancer, 9–140 s at 4 Hz) gives 1.084 for all nine (±0.0003):
  - mean hip gap 2 mm, worst 2.6 cm;
  - both bodies' soles stay on the floor;
  - a per-frame floor shift keeps the capsule hip midpoint exactly on the toon's.
- The capsule arms run slightly past the toon hands. They're the sim's proportions.
- `pose_overlay_41.04s.png`, top to bottom: toon only (`&reveal=0`), sim only (`&reveal=1`), then a 50/50 blend. Same
  frozen frame, same camera.

## Handle and sweep (`simReveal.js`, `RevealOverlay.jsx`)

- **The handle.** A 1 px white line, plus a 20 px round knob in the site blue with a 1 px white ring and two chevrons.
  To its left is the mono tag `← SIM` (9 px, 0.18 em tracking, the caption's type).
  - Parked, the divider sits 6 px from the right edge, showing a sliver of sky and checkerboard. The knob is kept fully
    on screen.
  - Nothing in the overlay takes pointer events. Crew's frame loop writes the positions, the clip and the tag texts
    straight into the elements, so nothing re-renders per frame.
- **Desktop.**
  - A press within 22 px of the divider grabs it straight away. That press is stopped from reaching the invisible deck
    under the stage.
  - A press anywhere else becomes a drag after 6 px of mostly horizontal movement, and the divider jumps to the
    pointer. The click that ends a drag is swallowed, so the deck never gets it.
  - Presses on links, buttons, the space key, the header and the lab panel are ignored.
  - Near the divider the cursor turns to `ew-resize`. While dragging, text selection is off.
- **Phone.** Touch-drag anywhere works the same way. The deck's canvas on top of the stage is already
  `touch-action: none`. On top of that, `touchmove` is prevented only while a reveal drag is active, so nothing else on
  the page is affected. The lab's canvas got `touch-action: none` too.
- **Space.** The space key isn't touched. Pointer listeners are on the window (in the capture phase) only while the
  stage is visible.
- **Auto-sweep.**
  - Once per stage entry (each mount of the crew canvas, so a revival counts as a new entry), 0.9 s after the crew
    fades in, the divider sweeps from parked to 35% and back over 1.6 s, with a cubic ease-in-out on each half.
  - Grabbing or dragging cancels it.
  - It never repeats in the same visit, and it's skipped if the divider is already at 30% or more.
  - It's driven by `performance.now()` in the frame loop.

## Sim-side readouts

These are clipped to the revealed region (`clip-path: inset(0 0 0 Xpx)` on the overlay layer, written per frame), in
the contact sheets' label colours:

- **Stats.** Top-left of the sim area, 14 px right of the divider, 116 px from the top (150 px on a phone, below the
  intro text). They fade in once more than 15% is revealed. Font: IBM Plex Mono, 9 px (8 px on a phone).
  - `MUJOCO MJX · PPO · 400M STEPS` (sheet yellow `#f2d27c`)
  - `JOINT ERR 2.4° · FALLS 0/100`
  - `602 HIP-HOP MOVES (AIST++)`
- **Move tags.** One per dancer, floating over the capsule head (projected each frame):
  - The short move id, e.g. `gMH_sFM_d24 ch20`, then `MIRROR` on a second line when the dancer is mirrored as seen. That
    means the unit's own `_M` combined with the dancer's mirror recipe.
  - On a trip, the tag shows the travelling clip's move.
  - The data comes from the new `CrewMotion.moveAt(i, t)`, which reads the same state the lab panel's `describe()` uses.
  - Text only changes when the 8-count changes.
  - Where dancers bunch up, the tags behind step up over the ones in front, with eased offsets so they don't jump.

## Lab

- `/dance-lab?crew=L4&reveal=0..1` sets the divider (the revealed fraction from the right; the default is parked).
- `&sweep=0` turns the auto-sweep off.
- The panel has a `sim reveal` slider plus `park` and `sweep` buttons.
- Capture hooks: `__lab.setReveal(r)` and `__lab.reveal`.
- In dev, `window.__crew` also exposes `sim`, `rts`, `simK` and `motion`, which is what the pose check uses.
- Checked: designs A–D and D1–D6, crew L1–L4, `lineup=front`, `view=verify`, and `L` / `C` cycling. No errors. Solo
  designs and the lineup have no reveal.

## Performance

These were measured on the production build (`vite preview`) in headless Chrome (ANGLE/Metal) on an M1 Pro, using the
real page flow: hold space for 9 s, release, stage.

- fps comes from rAF intervals over 5 s.
- Draw calls come from wrapping `WebGL2RenderingContext` draw calls, per frame.
- The parked window starts 3.5 s after the stage appears, after the sweep.
- For the 50% window, the divider was dragged there with real input: the mouse on the handle on desktop, CDP touch
  from elsewhere on the stage on the phone.
- "HEAD" is the same flow on a build of `bd6bbd1` (before this change).

| profile | parked: fps / p95 / max | 50% revealed: fps / p95 / max | draw calls | drop → +4.4 s | long tasks: hold / drop |
|---|---|---|---|---|---|
| 1920×1080 @1x (5 runs) | 60.0 / 16.7–16.8 / 16.8 ms | 60.0 / 16.7–16.8 / 16.8 ms | 12 / 12 | 60 fps, max 16.8 ms | none / none |
| 1920×1080 @2x (3 runs) | 60.0 / 16.7–16.8 / 16.8 ms | 60.0 / 16.7–16.8 / 16.8 ms | 12 / 12 | 60 fps, max 16.8 ms | none / none |
| 390×844 @3x phone (5 runs) | 60.0 / 16.7–16.8 / 16.8 ms | 60.0 / 16.7–16.8 / 16.8 ms | 12 / 12 | 60 fps, max 16.8 ms | none / none |
| 390×844 phone, CPU ×4 (2 runs) | 60.0 / 16.7–16.8 / 16.8 ms | 60.0 / 16.7 / 16.8 ms | 12 / 12 | 59.6–59.8 fps, max 33–50 ms | 169–172 + 120–126 ms / 57 ms in 1 of 2 |
| HEAD, phone, CPU ×4 (2 runs) | 60.0 / – / 16.8 ms | – | 10 | 59.8 fps, max 33 ms | 160–164 + 124–126 ms / none (53 ms in 1 of 2 in an earlier pair) |

- **The drop.**
  - With no throttling there are no long tasks at the drop, and no frame over 16.8 ms from the release through the
    stage's first 4.4 s, in any run.
  - The crew canvas mounts 0.81 s after the release (the deck's zoom and pause, unchanged). The first frame is drawn at
    +0.92–0.93 s (HEAD: +0.93–0.95 s).
  - 7 programs are linked, all before the first frame.
- **CPU ×4.** The two hold-phase long tasks (about 0.5 and 0.7 s into the hold) and the occasional ~55 ms task at the
  crew's first frame are also on HEAD, at the same sizes. This change doesn't add any.
  - The earlier integration README listed "none" for this profile. That claim doesn't reproduce on HEAD with this
    harness (`perf/baseline_HEAD_*`).
  - One early ×4 run (out of about 9) never reached the stage within 15 s of the release. It didn't recur.
- **Uncapped** (`--disable-gpu-vsync --disable-frame-rate-limit`, which headless runs CPU/compositor-bound):
  - desktop @2x: 593–617 fps (HEAD 597–626)
  - phone: 629–636 fps (HEAD 643–653)

  The reveal's cost is within noise to about 2%.
- **Chunks.**
  - `DanceStage-*.js`: 94.95 kB raw / 36.79 kB gzip (HEAD: 80.46 / 31.31)
  - `bodyWorker-*.js`: 113.4 kB (HEAD: 110.7)
  - `DanceStage-*.css`: 3.30 kB (HEAD: 1.14)
  - `npm run build` passes.
- Raw runs are in `perf/`. `experiment_no_clip_primer_phone_cpu4x.json` is the run without `primeClipping`.

## Files

- `desktop/` (1280×720 @1.5 = 1920×1080) and `phone/` (390×844 @3x, saved at 50%): the real page flow (hold → drop →
  stage), song clock frozen at 41.04 s.
  - `01_parked`
  - `02_sweep_35`: the auto-sweep at its peak (clock pinned 0.8 s into the sweep)
  - `03_reveal_50`
  - `04_reveal_85`
  - `05_reveal_100`
- `desktop_clip_1920x1080_10s.mp4` and `phone_clip_390x844@2x_10s.mp4`: 10 s from the stage's first second, song time
  8.52 → 18.52 s / 8.55 → 18.55 s.
  - The auto-sweep runs at the start.
  - At 5.0–6.5 s comes a manual drag to 70%: the mouse grabbing the handle on desktop, a CDP touch-drag starting
    anywhere on the stage (at 82%) on the phone.
  - Then it holds.
  - Frames were stepped: the song clock and `performance.now()` were pinned per frame, and the drag is real input
    events. The audio is `now-get-busy.mp3` from the same song time, muxed in afterwards.
- `pose_overlay_41.04s.png` and `pose_check.json`: the pose-identity check above.
- `perf/`: raw perf runs, including the HEAD baselines and the uncapped and no-primer experiments.

## Code

- New:
  - `src/dance/simBody.js`: the sim crew geometry (used in the worker too), the skinned mesh, `SIM_SCALE`, the root
    matrix
  - `src/dance/simReveal.js`: store, sweep, clip planes, `primeClipping`, the floor/sky quad, pointer handling, short
    move ids, stats text
  - `src/dance/RevealOverlay.jsx`: the DOM divider, handle, stats and tags
  - `src/dance/CaptionText.jsx`: the caption contents, shared by the page and the lab
- Changed:
  - `src/dance/Crew.jsx`: the `reveal` prop, sim posing, planes, tags
  - `src/dance/DanceStage.jsx`: store per entry, drag, sweep, primer, caption
  - `src/dance/DanceStage.css`
  - `src/dance/stageKit.js`: one worker for the toon bodies and the sim crew
  - `src/dance/bodyWorker.js`
  - `src/dance/motion.js`: `moveAt`
  - `src/dance/captions.js`
  - `src/danceLab/DanceLab.jsx`
  - `src/danceLab/DanceLab.css`

## Known limits

- On a phone with a narrow reveal (around 35%), the stats run past the screen's right edge rather than wrapping.
- With all nine dancers bunched on a phone, the tags stack but still crowd the top of the crew.
- The revealed region also covers the header strip, so the sky shows behind the nav and the mute button.
- The divider always follows the pointer's x. A press-and-drag away from the handle jumps it to the finger or pointer;
  a grab on the handle moves it by at most the 22 px grab radius.
- Not tried on a real phone. The phone numbers come from 390×844 emulation on the M1.
