# Five layout options for the 25-dancer crew (13 on a phone)

This is lab only. The page still uses L4. `stageKit.js` is unchanged (`CREW_LAYOUT = 'L4'`), and nothing has been committed.

All runs were muted. Headless Chrome ran with `--mute-audio`, and stills and clips are frozen frames of the song clock.
Audio was added to the clips afterwards with ffmpeg, from `public/now-get-busy.mp3` at the clip's song time. Nothing
played through the speakers.

## Try them

- Open `/dance-lab?crew=V1` … `V5`.
- On a phone (portrait), the 13-dancer version is used automatically.
- Key **V** cycles V1→V5. **L** still steps through L1–L4, then V1–V5, then off. The panel also has a button for each
  layout.
- L1–L3 hold only 9 slots. The lab now cuts the crew to the layout's slot count, so stepping onto them no longer crashes
  at n=25.

## The options

Each option keeps the same rules:

- Slot i = dancer i, as in L4, so the choreography, offsets and mirror pairs are unchanged.
- Odd dancers stand right of x=0 and even (mirrored) dancers left. Checked for every layout.
- The lead is dancer 0.
- fov is 30 for all.

How the measurements were made:

- **Dancer px.** Per-dancer bounding-box height from ID renders at 1920×1080, frozen at 41.04 s. Phone figures are CSS
  px at 390×844.
- **Occlusion.** 1 − visible / alone pixels. Worst case is any dancer at any of 8 song times (10.6, 25.3, 41.04, 55.2,
  68.5, 85.4, 100.3, 121.7 s).
- **Min gap.** The existing `chk.js` check: hips paths from `__crew.track`, 10 Hz, from the drop to 141.5 s, crew mode.
- **Lead NN.** The lead's nearest neighbour, measured between slots.

| | what it is | camera elev (desktop / phone range) | desktop mean / min px @41.04 | desktop worst occl (mean) | desktop min gap | phone mean / min px | phone worst occl | phone min gap | lead NN d / p |
|---|---|---|---|---|---|---|---|---|---|
| **current L4** | even sparse scatter, 14.6 × 11.7 m | 18° | 197 / 141 (README said 188 / 138) | 11.5% (1.9%) | 0.90 m | 96 / 80 | 9.9% | 0.81 m | 2.2 m (desktop) |
| **V1 Tight club** | irregular clumps, 9.7 × 8 m. The lead is at the front edge of the crowd, not out alone. | 15° / 26–34 | **247 / 177** | 41.0% (13.9%) | 0.79 m | 117 / 97 | 30.0% | 0.78 m | 1.31 / 1.19 |
| **V2 Staggered rows** | 4 brick rows, 5-6-7-7, 10.1 × 6.3 m. The lead is front-centre of row 1. Desktop rows are jittered and loosened by the occlusion refine. | 17° / 26–40 | **258 / 208** | 33.9% (16.3%) | 0.81 m | 119 / 103 (3-2-3-2-3 bricks) | 18.5% | 0.78 m | 1.44 / 1.22 |
| **V3 Wedge** | 1-2-3-4-5-5-5 rows, lead at the point, 8.6 × 7.2 m | 16° / 26–34 | **275 / 217** | 48.3% (25.1%) | 0.92 m | 102 / 89 (1-2-3-4-3) | 19.8% | 0.78 m | 1.46 / 1.19 |
| **V4 Arc** | horseshoe 2 deep, opening to the camera (5 inner + 7 outer per side). The lead is inside, about 1.35 m from the inner ring's back. | 20° / 28–40 | 225 / 172 | 53.6% back of arc (22.0%) | 0.77 m | 102 / 85 (U shape: 4 inner + 2 outer per side) | 28.4% | 0.77 m | 1.35 / 1.17 |
| **V5 Two flanks** | two diagonal blocks (11 + 11, wider towards the front). A clear centre lane holds the lead plus 2 featured dancers. Flank spots mirror each other. | 19° / 26–40 | 222 / 174 | 57.8% flank rear (25.5%) | 0.78 m | 98 / 83 (5 + 5 columns, lead + 2 in lane) | 22.5% | 0.78 m | 1.38 / 1.39 |

### Frame and neighbour checks (all options)

- **Frame.** Everyone stays inside the frame between the header and the space key at 1920×1080, 1280×720 and 390×844,
  at every measured time. The smallest margins are in `checks/summary.json`.
- **Outfits.** No neighbours share template + top colour in any layout.
- **All-black looks.** The two all-black looks (4, 16) are never neighbours. They are 3.4–7.3 m apart.
- **Yaw.** Within ±35°.
- **Identical moves.** Neighbours doing the identical move (same offset and mirror) were a soft rule.
  - V1, V2 and V3 have 0–2 such pairs.
  - V5 has 4 pairs. Its flanks are mirrored rather than shuffled, so groups that share a move stand together.
- **Performance.** Draw calls and fps are unchanged. The meshes, materials and dancer counts are the same, and only slot
  positions and the camera angle differ.
- **Build.** `npm run build` passes (built to a scratch outDir, so `dist/` was left alone). eslint is clean on the two
  changed files.

## Ranking

1. **V3 Wedge.** It has the biggest dancers (mean 275 / min 217 px, against 188 / 138 now) and the clearest crew shape.
   The lead sits at the point, and unison moments read like a music-video crew. The cost is 25% mean occlusion in the
   back three rows.
2. **V1 Tight club.** It is the closest to the current idea, fixed. It is dense, the lead is inside the crowd, and the
   flatter 15° camera makes heads overlap in depth. It has the lowest occlusion of the new options (mean 14%; only the
   back row reaches 41%) and dancers about 30% larger.
3. **V5 Two flanks.** It is the most distinctive. The lane and the mirrored flanks match the choreography's mirror pairs.
   The flank rear is the most hidden of all the options (up to 58%).
4. **V2 Staggered rows.** Big dancers and moderate occlusion. After the occlusion refine and spacing repair, the rows
   read as a loose block more than crisp lines.
5. **V4 Arc.** It reads as a horseshoe. The lead can't sit in the true middle under the "within 1.6 m of someone" rule,
   so the open floor reads empty. The back of the arc is hidden behind the inner ring (54%) even at 20°.

## What didn't fully work

- **Occlusion is far higher than the current layout's** (11.5% → 34–58% worst-case), as expected when going this
  dense. Only V1 meets the "≤ 40% back rows" target, at 41%. In the others the worst cases are back-row dancers at
  specific moments with arms out.
- **Phone versions are deeper stacks seen from 34–40°.** They read as "a group" more than as the named shape,
  especially V3 and V4.
  - All five have a mean ≥ 98 px at 41.04 s.
  - At 68.5 s, with arms down, V4 and V5 drop to 85 / 81 px. V1–V3 stay at 86–99 px.
- **The planned spacing model was wrong.** It used rig root q, and the first checks found V4 at 0.64 m. Gaps are now
  planned on the lab's own hips track (`paths_local.json`), and the repaired tables all measure ≥ 0.77 m in `chk.js`.

## Files

- **Stills:** `V*_desktop_1920x1080_41.04s.png`, `V*_desktop_unison_68.50s.png`, `V*_phone13_390x844@2x_41.04s.png`, and
  `current_*` for the L4 baseline.
- **Clips:** `V*_desktop_clip_38.38-46.38s.mp4`. 1920×1080, 30 fps frozen frames, audio muxed in afterwards.
- **Overviews:** `overview_desktop.png` and `overview_unison.png` (current + V1–V5, 2×3), and `overview_phone.png`.
- **`checks/`:** raw ID-render results per layout and size (occlusion, heights, bounding boxes, frame margins, the
  `chk.js` gap and neighbour check), plus `summary.json`.
- **`tools/`:** the scripts used.
  - `gen.mjs`: templates, assignment, facings and gap repair.
  - `refine.cjs`: a greedy refine against real lab ID renders, which keeps a move only if gaps, sides and the lead rule
    still hold.
  - `repair.mjs`: the final gap repair on the lab's hips track.
  - `embed.mjs`: writes the tables into `layouts.js` between the `<VARIANTS>` markers.
  - `measure.cjs` / `capture.cjs` / `summary.py` / `overview.py`.
  - The scripts point at the dev server on port 5191.

## Code touched

- `src/dance/layouts.js`: the generated `VT` tables and `V1`–`V5` entries, added to `LAYOUTS`. L1–L4 and
  `layoutView` are unchanged.
- `src/danceLab/DanceLab.jsx`: the V key, docs, and the crew cut to the layout's slot count.
