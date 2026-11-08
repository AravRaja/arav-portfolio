# The crew on the real home page

The 9-dancer crew (L4, seed 7, caption 4) now runs on the home page's music stage, the blue page that appears after the
hold-release drop. `/dance-lab` is still dev-only and still works.

All runs here were muted. Headless Chrome ran with `--mute-audio`. The built-in browser pane only ran with the site's
mute on (`dj-muted=1`, the mute button pressed). Nothing played through the speakers.

## How it works
- **Where it's mounted.** `src/welcomePage/Welcome.jsx` renders `src/dance/DanceStage.jsx` only while the stage is up,
  plus its 0.38 s fade-out.
  - The crew is active when `stageZoom.inward && deckPaused`. `DJScene` reports its existing `paused` state through a
    new `onPausedChange` prop. The deck still pauses 0.1 s after the zoom-in ends, exactly as before.
  - The crew's `<Canvas>` is created only once the deck has stopped drawing. Programs compile with
    `renderer.compileAsync`, then the crew fades and scales in.
  - On leaving (the song fades, `backToIntro`, or a page change) the crew stops on its last frame and fades out while
    the deck takes over. Then the canvas unmounts: `releaseGpu` disposes the geometries, materials, textures and bone
    textures, and r3f disposes the renderer and calls `forceContextLoss`. Only one WebGL scene ever renders at a time.
- **Time source.** `holdSync.songTime()` is set in `Header.jsx`. It returns the Tone player's position in
  now-get-busy.mp3 *as heard*:
  - The time comes from the native context's `getOutputTimestamp()`. That is smooth between audio callbacks and
    already includes output latency. If it's missing, it falls back to `currentTime - outputLatency`.
  - Before the drop hit it returns the intro loop's `loopPosition(t)`.
  - `drop()` now records `songAnchor = { time: now + wait, offset: dropHit }`, so from the hit onwards it returns
    `dropHit + elapsed`. That holds through 'fading' and 'reviving', which never lose their place.
  - `backToIntro` clears the anchor. Any `playIntro` (for example a loop retune from the tuner) moves the intro anchor
    as before.
  - It returns `null` when nothing is playing.
  - The crew stands and breathes before 8.37 s and dances from 8.37 s on. The lab's offsets, mirrors, unison units
    and crossfades are unchanged.
  - Measured drift: song time advanced 3.002 s over 3.002 s of wall time (desktop) and 3.003 s over 3.003 s (phone).
- **Prefetch.** The first `dj-hold-change` with `held` calls `prefetchDanceStage()` (`src/dance/prefetch.js`, which
  lives in the Welcome chunk). It starts four things at once:
  - the DanceStage chunk
  - `finale.json`, `finale.bin` and `crew.json` (one memoised download each, `src/dance/data.js`)
  - the body worker (`bodyWorker.js`), which builds all 9 body geometries off the main thread
  - after that, the skinning and retargeting, one body per idle callback (a few ms each)

  Main-thread building pauses while the bar is full and for 1.2 s after the release, so it never lands on the drop or
  on the zoom. The built bodies are cached for the session, so later stage entries don't rebuild anything. If workers
  aren't available, it falls back to building on the main thread, half a body per idle callback. If the chunk fails to
  load, the stage simply has no crew; nothing throws.
- **Framing.** It uses the same margins as the lab: the crew fits between the intro text and the caption, and the
  caption sits above the space key. Desktop uses the L4 desktop slots (13°). Portrait uses the new phone slots. The
  caption CSS moved to `src/dance/DanceStage.css` and the lab imports it from there.
- **Pixel ratio.** Capped at 1.5 on phones (measured: 585×1266 buffer for 390×844) and at 2 on desktop. There is one
  instanced shadow mesh, so the crew is 10 draw calls and 71.4k triangles.

## Phone fixes (Part A)
- **Yellow top.** Slot 8 (W, braids) is now in a **yellow hoodie** with white strings, black trousers and off-white
  shoes. This is a rule in `generateCrew`: a second all-black look on the same body is re-dressed in a yellow hoodie,
  from its own RNG stream. Every other look is unchanged, and so are slot 8's body, skin, hair, headwear and height.
  Slot 4 is the crew's only all-black look now. In the new phone layout, 4 and 8 aren't neighbours either.
- **Phone spacing.** New L4 portrait slots: x −1.28..1.28 and 7.7 m deep, camera elevation 24–30° (it lands on 30° at
  390×844). Desktop is unchanged: the same camera, dist 12.12 m, 13°. Measured at 390×844 over 8.6 / 41.04 / 100 s:

| | before | after |
|---|---|---|
| mean dancer height | 158.5 px | 135.7 px (−14%) |
| nearest neighbour (centre distance / body height) | 0.49 | 0.66 (+35%) |
| bbox pairs overlapping > 20% | 10 | 5 |
| worst occlusion | 18.1% | 6.3% |

  Worst occlusion is 13.5% at 375×667 and 13.9% at 360×640, where the 24° floor keeps the rows apart; the old layout
  hit 41% at 360×640. Occlusion is measured per dancer as 1 − visible pixels / pixels when drawn alone (an ID render).
  See `phone_layout_before_after_390x844_41.04s.png`.

## Performance
Measured on the production build (`vite preview`) in headless Chrome (ANGLE/Metal) on an M1 Pro. Each profile ran 5
full enter/leave cycles. The fps figures come from rAF intervals.

| profile | hold (build-up) | drop + zoom + crew reveal | on stage (5 s) | long tasks hold / drop |
|---|---|---|---|---|
| 1920×1080 @1x | 60 fps, max 16.8 ms | 60 fps, max 16.8 ms (one 33 ms frame in 1 of 5) | 60.0 fps, p95 16.7, p99 16.8, max 16.8 ms | none / none |
| 1920×1080 @2x (crew dpr 2) | 60 fps | 60 fps | 60.0 fps, p95 16.7–16.8, max 16.8 ms | none / none |
| 390×844 @3x phone (crew dpr 1.5) | 60 fps | 60 fps | 60.0 fps, p95 16.7–16.8, max 16.8 ms | none / none |
| 390×844 phone, **CPU ×4 throttle** | 60 fps | 59.4 fps (one 33 ms frame) | 60.0 fps | none / none |

- **Timeline after the release.** The deck pauses at +0.80 s and the crew canvas mounts on the same tick. Programs are
  compiled at +0.89 s (+0.97 s at 4× CPU), the first frame is drawn at +0.90 s, and the fade-in starts at
  +0.93–0.99 s. The bodies were ready 0.35–0.38 s after the hold started (0.59 s at 4× CPU).
- **Long tasks found and fixed on the way.**
  - The first render read every program's info log: 30 ms on a cold shader cache. `checkShaderErrors` is now off in
    production.
  - three computed each skinned mesh's bounding sphere on first render: about 15 ms. It is now precomputed at build.
  - React 19's Suspense reveal throttle added +300 ms on the first entry. The crew is no longer behind `React.lazy`.
  - Before the worker, cold main-thread builds made 52–119 ms tasks during the hold at 4× CPU.
- **Chunks** (`npm run build`, default config):

| chunk | raw | gzip |
|---|---|---|
| `DanceStage-*.js` (crew, lazy) | 66.07 kB | 25.30 kB |
| `bodyWorker-*.js` (worker) | 110.73 kB | 33.9 kB |
| `DanceStage-*.css` | 1.14 kB | 0.51 kB |
| `Welcome-*.js` | 986.21 kB (was 984.16) | 272.50 kB (was 271.67) |
| `index-*.js` | 478.23 kB (was 477.67) | 139.13 kB (was 138.92) |

  Data fetched on the first hold: `finale.bin` 494 kB, `finale.json` 16 kB, `crew.json` 0.6 kB. The production bundle
  contains no `danceLab` code.
- **Memory and contexts.**
  - Every cycle in every run left exactly 1 live WebGL context, the deck's (created − lost). After 5 cycles
    `Runtime.queryObjects` found 1 `WebGL2RenderingContext`.
  - The crew renderer shows the same `renderer.info` on every entry: 10 geometries, 11 textures, 3 programs, 10 draw
    calls. The deck's stays at 22 geometries, 1 texture and 2 programs.
  - JS heap after GC over 10 cycles: about +2.3 MB on the first entry (the cached bodies), then +0.15 MB per cycle,
    flattening towards the end. With the crew's data blocked, the stage alone grows +0.12 MB per cycle, so about
    0.03 MB per cycle is the crew's.
  - The only console output is three's `THREE.WebGLRenderer: Context Lost.`, once per stage exit (the expected
    dispose). There were no errors or warnings from this code.

## Screenshots
- `desktop/` (1920×1080) and `phone/` (390×844 @3x, saved at 50%), one file per step:
  01 home → 02 build-up → 03 bar full → 04 drop zoom → 05 stage with the crew → 06 frame at 41.04 s → 07 fading →
  08 deck zooming back out → 09 revived (crew back, song still in place) → 10 left the stage (deck back, crew
  unmounted). `flow_report.json` holds the state at each step and the 5 enter/leave cycles.
  For 06 the song clock was frozen at 41.04 s on the dev server; this is a test hook only, not part of the page.
- `compare_desktop_41.04s_lab-vs-home.png`: the lab still from `crew/L4-natural` above the home page.
  - Against a fresh lab render of the same cast, the crew area is pixel-identical (0 differing pixels at 8% fuzz).
  - Against the old still, 1.06% of pixels differ, which is slot 8's new yellow hoodie.
- `compare_phone_41.04s_before-lab-home.png`: the old phone layout | the lab with the new layout | the home page. The
  last two differ only by render resolution (lab dpr 2, home dpr 1.5).
- `pane_stage_416x795_muted.jpg`: the built-in browser pane, site muted.
- `route_about.png`: /about. /projects, /experience, /contact, /imageboard and unknown routes (which redirect to /) all
  load. /imageboard logs its existing `/api/get-drawings` error under `vite preview`, because there's no API server.
- `perf_*.json`: raw perf runs.

## Known differences and limits
- On the home page the key reads "PRESS SPACE TO STOP" in white: the existing `.music-stage svg#rectangle text` rule
  sets it. The lab draws it red. I left the site's styling alone.
- The crew appears about 0.95 s after the release: 0.80 s is the deck's existing zoom and pause, then about 0.1 s of
  compiling and 0.05 s to the first frame. Between the deck fading out and the crew fading in there are about 0.25 s
  of plain blue.
- When leaving, the crew fades out on a frozen frame over 0.38 s, because the deck resumes immediately and two
  scenes must not render at once.
- Not measured on a real phone. The phone numbers come from 390×844 emulation on the M1, with and without 4× CPU
  throttling.
