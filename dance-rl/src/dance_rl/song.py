"""Music analysis -> 50 Hz feature table (PLAN section 2).

    python -m dance_rl.song --mp3 now-get-busy.mp3 --out features/now-get-busy.features.npz

Feature table columns (COLUMNS below) are what the env indexes. The beat grid comes from the
known tempo (bar = 2.125 s, beat = 0.53125 s) anchored on the drop at 8.37 s (a downbeat);
librosa's beat tracker is only printed as a cross-check.

v2 (round 4) lives alongside v1 and does not change any v1 name, column or default:

    python -m dance_rl.song --version 2 --mp3 now-get-busy.mp3 \
        --out features/now-get-busy.v2.features.npz

v2 re-anchors the grid half a beat later (snapped to the claps, beat 1 = strongest kick,
GRID_ANCHOR_V2), keeps after_drop/drop_window at 8.37 s, and adds the V2_NEW_COLUMNS
(snare, grid pulses, audio-synced 8-count/32-count position, breakdown, half-time).
v2 table layout = SCALAR_COLUMNS_V2 then the 25 lookahead columns (lookahead still last;
the first 7 columns have the same names and indices as v1). Use COL_V2 / SCALAR_COLUMNS_V2,
or `layout(table.shape[1])`. See research/grid-v2-validation.md.
"""
from __future__ import annotations

import argparse

import numpy as np

FPS = 50
BAR = 2.125
BEAT = BAR / 4.0
DROP = 8.37
DROP_BONUS_WINDOW = 0.25
N_LOOKAHEAD = 25  # 0.5 s at 50 Hz

# Order of the columns in the env feature table. lookahead occupies the last N_LOOKAHEAD.
SCALAR_COLUMNS = ["beat_phase", "bar_phase", "onset", "kick", "energy", "after_drop", "drop_window"]
COLUMNS = SCALAR_COLUMNS + [f"lookahead_{i}" for i in range(N_LOOKAHEAD)]
COL = {name: i for i, name in enumerate(COLUMNS)}
N_FEATURES = len(COLUMNS)

# v2: same 7 leading columns, new scalars after them, lookahead still last.
GRID_ANCHOR_V2 = 8.6304   # beat 1 of the v2 grid (measured by analyze_v2; drop 8.37 is the "and" of 4)
EIGHT = 2.0 * BAR         # one 8-count = 2 bars = 4.25 s
PULSE_SIGMA = 0.04        # s, width of the downbeat/beat/backbeat gaussian pulses
# Band flux from a centred STFT peaks before the transient (the window sees it early).
# Measured: 2048-pt snare bands lead 39-41 ms; the 4096-pt kick band leads ~44 ms on this song
# (83 ms on synthetic clicks). v2 delays both by 40 ms (2 rows); v1 `kick` is left as it was.
FLUX_LEAD = 0.040
V2_NEW_COLUMNS = ["snare", "downbeat", "beat_pulse", "backbeat_pulse", "eight_count_idx",
                  "count_in_32", "section_phase", "is_breakdown", "halftime"]
SCALAR_COLUMNS_V2 = SCALAR_COLUMNS + V2_NEW_COLUMNS
COLUMNS_V2 = SCALAR_COLUMNS_V2 + [f"lookahead_{i}" for i in range(N_LOOKAHEAD)]
COL_V2 = {name: i for i, name in enumerate(COLUMNS_V2)}
N_FEATURES_V2 = len(COLUMNS_V2)


def layout(n_features: int):
    """(column-index dict, number of scalar columns) for a v1 or v2 table width."""
    if n_features == N_FEATURES:
        return COL, len(SCALAR_COLUMNS)
    if n_features == N_FEATURES_V2:
        return COL_V2, len(SCALAR_COLUMNS_V2)
    raise ValueError(f"unknown feature table width {n_features}")


def _lowpass(x: np.ndarray, cutoff_hz: float, fps: int = FPS) -> np.ndarray:
    from scipy.signal import butter, filtfilt

    b, a = butter(2, cutoff_hz / (fps / 2.0))
    return filtfilt(b, a, x)


def _norm01(x: np.ndarray, pct: float = 99.0) -> np.ndarray:
    x = np.maximum(x, 0.0)
    hi = np.percentile(x, pct)
    return np.clip(x / max(hi, 1e-8), 0.0, 1.0)


def grid_phases(t: np.ndarray, beat: float = BEAT, anchor: float = DROP):
    """beat_phase, bar_phase in [0,1) for times t, grid anchored at `anchor` (a downbeat)."""
    rel = t - anchor
    beat_phase = np.mod(rel / beat, 1.0)
    bar_phase = np.mod(rel / (4.0 * beat), 1.0)
    return beat_phase, bar_phase


def beat_times(duration: float, beat: float = BEAT, anchor: float = DROP) -> np.ndarray:
    k0 = -int(np.floor(anchor / beat))
    k1 = int(np.floor((duration - anchor) / beat))
    return anchor + beat * np.arange(k0, k1 + 1)


def _lookahead(onset: np.ndarray) -> np.ndarray:
    n = len(onset)
    pad = np.concatenate([onset, np.zeros(N_LOOKAHEAD)])
    return np.stack([pad[1 + i: 1 + i + n] for i in range(N_LOOKAHEAD)], axis=1)


def build_table(beat_phase, bar_phase, onset, kick, energy, after_drop, drop_window) -> np.ndarray:
    cols = [beat_phase, bar_phase, onset, kick, energy, after_drop, drop_window]
    tab = np.stack([np.asarray(c, np.float32) for c in cols], axis=1)
    return np.concatenate([tab, _lookahead(onset).astype(np.float32)], axis=1)


def analyze(mp3: str, out_npz: str, sr: int = 22050) -> dict:
    import librosa

    y, sr = librosa.load(mp3, sr=sr, mono=True)
    duration = len(y) / sr
    hop = sr // FPS  # 441 -> exactly 50 Hz at 22050
    n = int(np.floor(duration * FPS))
    t = np.arange(n) / FPS

    def fit(x):
        x = np.asarray(x, np.float64)
        return x[:n] if len(x) >= n else np.pad(x, (0, n - len(x)), mode="edge")

    # onset: full-band onset strength, normalised 0-1, low-passed (8 Hz)
    onset_raw = fit(librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop))
    onset = _norm01(_lowpass(_norm01(onset_raw), 8.0))

    # kick: spectral flux restricted to 40-120 Hz (long FFT for bass resolution)
    S = np.abs(librosa.stft(y, n_fft=4096, hop_length=hop))
    freqs = librosa.fft_frequencies(sr=sr, n_fft=4096)
    band = (freqs >= 40) & (freqs <= 120)
    low = np.log1p(100.0 * S[band]).sum(axis=0)
    flux = np.maximum(np.diff(low, prepend=low[:1]), 0.0)
    kick = _norm01(_lowpass(_norm01(fit(flux)), 8.0))

    # energy: RMS, 1-bar centred moving average, normalised by its max
    rms = fit(librosa.feature.rms(y=y, hop_length=hop)[0])
    w = int(round(BAR * FPS))
    energy = np.convolve(rms, np.ones(w) / w, mode="same")
    energy = np.clip(energy / energy.max(), 0.0, 1.0)

    beat_phase, bar_phase = grid_phases(t)
    after_drop = (t >= DROP).astype(np.float32)
    drop_window = ((t >= DROP) & (t < DROP + DROP_BONUS_WINDOW)).astype(np.float32)
    table = build_table(beat_phase, bar_phase, onset, kick, energy, after_drop, drop_window)

    beats = beat_times(duration)
    tempo, lb_beats = librosa.beat.beat_track(y=y, sr=sr, hop_length=hop, units="time")
    out = dict(
        table=table, columns=np.array(COLUMNS), fps=np.int32(FPS), duration=np.float32(duration),
        t=t.astype(np.float32), beat_phase=beat_phase.astype(np.float32),
        bar_phase=bar_phase.astype(np.float32), onset=onset.astype(np.float32),
        kick=kick.astype(np.float32), energy=energy.astype(np.float32), after_drop=after_drop,
        drop_window=drop_window, lookahead=table[:, len(SCALAR_COLUMNS):],
        beat_times=beats.astype(np.float32), librosa_beats=np.asarray(lb_beats, np.float32),
        librosa_tempo=np.float32(np.atleast_1d(tempo)[0]),
    )
    np.savez_compressed(out_npz, **out)

    # sanity print
    nearest = beats[np.argmin(np.abs(beats - DROP))]
    print(f"duration {duration:.2f}s rows {n} features {table.shape}")
    print(f"grid beats {len(beats)}  (BPM {60 / BEAT:.2f}); beat nearest drop = {nearest:.3f}s")
    print(f"librosa tempo {float(np.atleast_1d(tempo)[0]):.2f} BPM, {len(lb_beats)} tracked beats")
    if len(lb_beats):
        ph = np.mod((np.asarray(lb_beats) - DROP) / BEAT, 1.0)
        plv = np.abs(np.mean(np.exp(2j * np.pi * ph)))
        print(f"librosa beats vs grid: PLV {plv:.3f}, mean phase {np.angle(np.mean(np.exp(2j*np.pi*ph)))/(2*np.pi):+.3f} beat")
    print(f"kick>0.5 frames {(kick > 0.5).sum()}, onset mean {onset.mean():.3f}, energy mean {energy.mean():.3f}")
    return out


# ---------------------------------------------------------------- feature table v2 (round 4)
def _delay(x: np.ndarray, k: int) -> np.ndarray:
    """Shift a frame signal k rows later (edge-padded at the start)."""
    return np.concatenate([np.full(k, x[0]), x[:len(x) - k]]) if k > 0 else x


def _phase_pulse(phase: np.ndarray, period: float, sigma: float = PULSE_SIGMA) -> np.ndarray:
    """Gaussian of the time distance (s) to the nearest phase-0 instant of a cycle of `period` s."""
    dist = (np.mod(phase + 0.5, 1.0) - 0.5) * period
    return np.exp(-0.5 * (dist / sigma) ** 2)


def grid_pulses(t: np.ndarray, beat: float, anchor: float, sigma: float = PULSE_SIGMA):
    """downbeat (beat 1), beat_pulse (every beat), backbeat_pulse (beats 2 and 4); anchor = a beat 1."""
    beat_phase, bar_phase = grid_phases(t, beat=beat, anchor=anchor)
    downbeat = _phase_pulse(bar_phase, 4 * beat, sigma)
    beat_pulse = _phase_pulse(beat_phase, beat, sigma)
    backbeat = _phase_pulse(np.mod(2.0 * bar_phase - 0.5, 1.0), 2 * beat, sigma)
    return downbeat, beat_pulse, backbeat


def _peak_offsets(x, tx, times, win):
    """Per grid time: offset (s) of the max of x within +-win (parabolic interpolation) and its value."""
    offs, vals = [], []
    dt = tx[1] - tx[0]
    for g in times:
        w = np.where((tx >= g - win) & (tx <= g + win))[0]
        if len(w) < 3:
            continue
        i = w[np.argmax(x[w])]
        p = 0.0
        if 0 < i < len(x) - 1:
            a, b, c = x[i - 1], x[i], x[i + 1]
            den = a - 2 * b + c
            p = 0.5 * (a - c) / den if den < 0 else 0.0
        offs.append(tx[i] + p * dt - g)
        vals.append(x[i])
    return np.array(offs), np.array(vals)


def _slot_hist(x, t, anchor, beat, t0, t1, nslot=8, win=0.02):
    """Mean over the song of max(x within +-win) at each of `nslot` equal bar positions."""
    step = 4 * beat / nslot
    g = anchor + step * np.arange(np.ceil((t0 - anchor) / step), np.floor((t1 - anchor) / step))
    out, cnt = np.zeros(nslot), np.zeros(nslot)
    for gi in g:
        s = int(np.round((gi - anchor) / step)) % nslot
        w = (t >= gi - win) & (t <= gi + win)
        if w.any():
            out[s] += x[w].max()
            cnt[s] += 1
    return out / np.maximum(cnt, 1)


def _checkerboard_novelty(F: np.ndarray, half: int) -> np.ndarray:
    """Foote novelty of row-feature matrix F (one row per beat), cosine SSM, kernel half-width `half`."""
    Fn = F / (np.linalg.norm(F, axis=1, keepdims=True) + 1e-8)
    S = Fn @ Fn.T
    r = np.r_[-np.ones(half), np.ones(half)]
    K = np.outer(r, r)  # + on the diagonal blocks, - across the boundary
    nov = np.zeros(len(F))
    for i in range(half, len(F) - half):
        nov[i] = (K * S[i - half:i + half, i - half:i + half]).sum()
    return nov


def phrase_structure(t, boundaries, breakdowns, eight: float = EIGHT):
    """8-count units restarted at every section boundary.

    boundaries: sorted section-start times (s), boundaries[0] = start of 8-count 0 (first downbeat
    after the drop). Units run every `eight` s from each boundary; a unit cut by the next boundary
    stays short. Returns eight_count_idx (0.., 0 before the first unit), count_in_32 (unit index
    within its section mod 4; before the drop it free-runs backwards from unit 0), section_phase
    ((t - unit start)/eight, so a short unit stops early; free-running before the drop),
    is_breakdown, and the unit start times.
    """
    t = np.asarray(t, np.float64)
    b = np.asarray(boundaries, np.float64)
    ends = np.r_[b[1:], np.inf]
    starts, k32 = [], []
    for s, e in zip(b, ends):
        n_units = int(np.ceil((min(e, t[-1] + 1e-6) - s) / eight - 1e-6))
        for j in range(max(n_units, 1)):
            starts.append(s + j * eight)
            k32.append(j % 4)
    starts, k32 = np.array(starts), np.array(k32)
    u = np.searchsorted(starts, t, side="right") - 1          # unit containing t (-1 = before)
    pre = u < 0
    uc = np.maximum(u, 0)
    eight_count_idx = uc.astype(np.float64)
    count_in_32 = k32[uc].astype(np.float64)
    section_phase = np.clip((t - starts[uc]) / eight, 0.0, 1.0 - 1e-6)
    rel = (t[pre] - b[0]) / eight
    count_in_32[pre] = np.mod(np.floor(rel), 4)
    section_phase[pre] = np.mod(rel, 1.0)
    is_breakdown = np.zeros_like(t)
    for s, e in breakdowns:
        is_breakdown[(t >= s) & (t < e)] = 1.0
    return eight_count_idx, count_in_32, section_phase, is_breakdown, starts


def build_table_v2(cols: dict) -> np.ndarray:
    """cols: name -> (n,) array for every name in SCALAR_COLUMNS_V2; lookahead is built from onset."""
    tab = np.stack([np.asarray(cols[c], np.float32) for c in SCALAR_COLUMNS_V2], axis=1)
    return np.concatenate([tab, _lookahead(np.asarray(cols["onset"])).astype(np.float32)], axis=1)


def analyze_v2(mp3: str, out_npz, sr: int = 22050, beat: float = BEAT, anchor: float | None = None,
               log=print) -> dict:
    """v2 feature table. anchor=None -> measure it (shift v1 grid +0.5 beat, snap to the claps,
    beat 1 = strongest-kick bar position). out_npz may be a path or a binary file object."""
    import librosa
    from scipy.signal import find_peaks

    y, sr = librosa.load(mp3, sr=sr, mono=True)
    duration = len(y) / sr
    hop = sr // FPS
    n = int(np.floor(duration * FPS))
    t = np.arange(n) / FPS
    lead = int(round(FLUX_LEAD * FPS))

    def fit(x):
        x = np.asarray(x, np.float64)
        return x[:n] if len(x) >= n else np.pad(x, (0, n - len(x)), mode="edge")

    def band_flux(M, f, lo, hi):
        b = (f >= lo) & (f < hi)
        L = np.log1p(100.0 * M[b]).sum(axis=0)
        return np.maximum(np.diff(L, prepend=L[:1]), 0.0)

    # ---- v1 signals (same recipe as analyze)
    onset_raw = fit(librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop))
    onset = _norm01(_lowpass(_norm01(onset_raw), 8.0))
    S4 = np.abs(librosa.stft(y, n_fft=4096, hop_length=hop))
    kflux = fit(band_flux(S4, librosa.fft_frequencies(sr=sr, n_fft=4096), 40, 121))
    kflux = _delay(_norm01(kflux), lead)                       # v2: lead-compensated
    kick = _norm01(_lowpass(kflux, 8.0))
    rms = fit(librosa.feature.rms(y=y, hop_length=hop)[0])
    w = int(round(BAR * FPS))
    energy = np.convolve(rms, np.ones(w) / w, mode="same")
    energy = np.clip(energy / energy.max(), 0.0, 1.0)

    # ---- snare: percussive 150-400 Hz body x 2-5 kHz crack flux (geometric mean)
    S = np.abs(librosa.stft(y, n_fft=2048, hop_length=hop))
    f2 = librosa.fft_frequencies(sr=sr, n_fft=2048)
    _, P = librosa.decompose.hpss(S)
    sflux = np.sqrt(_norm01(fit(band_flux(P, f2, 150, 400))) * _norm01(fit(band_flux(P, f2, 2000, 5000))))
    sflux = _delay(sflux, lead)
    snare = _norm01(_lowpass(sflux, 8.0))
    crack = _delay(_norm01(fit(band_flux(P, f2, 2000, 5000))), lead)

    # ---- grid anchor
    t_post0, t_post1 = DROP + 0.3, duration - 0.1
    if anchor is None:
        # fine-hop snare flux for sub-frame clap timing
        hop_hi = 105
        Sh = np.abs(librosa.stft(y, n_fft=2048, hop_length=hop_hi))
        _, Ph = librosa.decompose.hpss(Sh)
        crh = _norm01(band_flux(Ph, f2, 2000, 5000))
        sh = np.sqrt(_norm01(band_flux(Ph, f2, 150, 400)) * crh)
        th = np.arange(len(sh)) * hop_hi / sr + FLUX_LEAD
        a = DROP + 0.5 * beat                                  # the ear-confirmed half-beat shift
        grid = lambda a_: a_ + beat * np.arange(np.ceil((t_post0 - a_) / beat), np.floor((t_post1 - a_) / beat))
        g = grid(a)
        par = np.mod(np.round((g - a) / beat).astype(int), 2)
        # which beat parity carries the clap: decided on the 2-5 kHz crack alone (the 150-400 Hz
        # body band also catches the kick, so the combined snare is ambiguous here); snap on snare
        _, v0 = _peak_offsets(crh, th, g[par == 0], 0.02)
        _, v1 = _peak_offsets(crh, th, g[par == 1], 0.02)
        clap_par = int(v1.mean() > v0.mean())
        log(f"clap parity {clap_par}: crack peak mean {v1.mean() if clap_par else v0.mean():.3f} vs "
            f"{v0.mean() if clap_par else v1.mean():.3f} on the other beats")
        for _ in range(6):
            g = grid(a)
            par = np.mod(np.round((g - a) / beat).astype(int), 2)
            o, v = _peak_offsets(sh, th, g[par == clap_par], 0.1)
            a += float(np.median(o[v >= 0.25]))
        g = grid(a)
        par = np.mod(np.round((g - a) / beat).astype(int), 2)
        claps = g[par == clap_par]
        clap_off, clap_val = _peak_offsets(sh, th, claps, 0.1)
        keep = clap_val >= 0.25
        # downbeat: the bar position (of 4) with the strongest kick
        khist = _slot_hist(kflux, t, a, beat, t_post0, t_post1, nslot=4)
        down = int(np.argmax(khist))
        a = a + down * beat
        if (down % 2) == clap_par:
            log("WARNING: strongest-kick beat coincides with the clap parity")
        anchor = a + beat * 4 * np.ceil((DROP - a) / (4 * beat))  # first beat 1 at/after the drop
        co = clap_off[keep]
        log(f"anchor {anchor:.4f}s (v1 8.37 + 0.5 beat = {DROP + 0.5 * beat:.4f}); claps n={keep.sum()}: "
            f"mean {co.mean() * 1e3:+.1f} ms median {np.median(co) * 1e3:+.1f} sd {co.std() * 1e3:.1f} "
            f"p10..p90 {np.percentile(co, 10) * 1e3:+.0f}..{np.percentile(co, 90) * 1e3:+.0f} "
            f"|off|<=30ms {100 * np.mean(np.abs(co) <= 0.03):.0f}%")
        ct = claps[keep]
        for lo, hi in [(8, 42), (42, 75), (75, 109), (109, 142)]:
            m = (ct >= lo) & (ct < hi)
            log(f"  claps {lo:3d}-{hi:3d}s n={m.sum():3d} median {np.median(co[m]) * 1e3:+5.1f} ms")
        sl = np.polyfit(ct, co, 1)[0]
        log(f"  clap drift {sl * 1e3:+.3f} ms/s -> implied beat {beat * (1 + sl):.6f} s ({60 / (beat * (1 + sl)):.3f} BPM)")
        clap_stats = dict(times=ct, offsets=co)
    else:
        clap_stats = dict(times=np.zeros(0), offsets=np.zeros(0))

    beat_phase, bar_phase = grid_phases(t, beat=beat, anchor=anchor)
    downbeat, beat_pulse, backbeat_pulse = grid_pulses(t, beat, anchor)
    lab = ["1", "1&", "2", "2&", "3", "3&", "4", "4&"]
    kh = _slot_hist(kflux, t, anchor, beat, t_post0, t_post1)
    sh8 = _slot_hist(sflux, t, anchor, beat, t_post0, t_post1)
    ch8 = _slot_hist(crack, t, anchor, beat, t_post0, t_post1)
    log("bar pos " + " ".join(f"{s:>5s}" for s in lab))
    log("kick    " + " ".join(f"{v:5.2f}" for v in kh))
    log("snare   " + " ".join(f"{v:5.2f}" for v in sh8))
    log("crack   " + " ".join(f"{v:5.2f}" for v in ch8))

    # ---- sections: breakdown bars (RMS dropout) + timbre novelty
    bars = anchor + 4 * beat * np.arange(np.ceil(-anchor / (4 * beat)), np.floor((duration - anchor) / (4 * beat)))
    bar_rms = np.array([rms[(t >= s) & (t < s + 4 * beat)].mean() for s in bars])
    post_bars = bars >= anchor - 1e-6
    rel_rms = bar_rms / np.median(bar_rms[post_bars])
    bd = post_bars & (rel_rms < 0.6)
    breakdowns = []
    for i in np.where(bd)[0]:
        if breakdowns and abs(breakdowns[-1][1] - bars[i]) < 1e-6:
            breakdowns[-1][1] = bars[i] + 4 * beat
        else:
            breakdowns.append([bars[i], bars[i] + 4 * beat])
    mf = librosa.feature.mfcc(y=y, sr=sr, hop_length=hop, n_mfcc=20)[1:]
    sc = librosa.feature.spectral_contrast(S=S, sr=sr)
    F = np.vstack([fit(r) for r in np.vstack([mf, sc])]).T
    F = (F - F.mean(0)) / (F.std(0) + 1e-8)
    bk = np.arange(np.ceil(-anchor / beat), np.floor((duration - anchor) / beat))
    bt = anchor + bk * beat
    B = np.array([F[(t >= s) & (t < s + beat)].mean(0) for s in bt])
    nov = _checkerboard_novelty(B, 4)
    nov = nov / nov[bt >= DROP].max()
    pk, _ = find_peaks(nov, height=0.6, distance=6)
    bounds = [anchor] + [s for s, _ in breakdowns]
    added = []
    for p in pk:
        tb = bt[p]
        if int(bk[p]) % 4 != 0 or tb <= anchor + 1e-6:
            continue                                            # downbeats after the drop only
        prev = max([x for x in bounds if x < tb + 1e-6], default=anchor)
        near = min(abs(tb - x) for x in bounds)
        bars_after = (tb - prev) / (4 * beat)
        if near < 2 * 4 * beat - 1e-6 or abs(bars_after / 2 - round(bars_after / 2)) > 1e-3:
            continue                                            # breakdown edge / not on the 8-count grid
        bounds.append(tb)
        added.append((tb, float(nov[p])))
    bounds = sorted(bounds)
    log("breakdowns: " + ", ".join(f"{s:.2f}-{e:.2f}s (rms {rel_rms[np.argmin(np.abs(bars - s))]:.2f})" for s, e in breakdowns))
    log("novelty peaks (>=0.6): " + ", ".join(f"{bt[p]:.2f}s {nov[p]:.2f}" for p in pk))
    log("novelty boundaries added: " + ", ".join(f"{x:.2f}s ({h:.2f})" for x, h in added))
    log("section boundaries: " + ", ".join(f"{x:.2f}" for x in bounds))

    eight_count_idx, count_in_32, section_phase, is_breakdown, unit_starts = phrase_structure(
        t, bounds, breakdowns, 8 * beat)

    # ---- half-time heuristic, per 8-count unit (breakdown bars excluded)
    pk_on, _ = find_peaks(onset_raw, height=np.percentile(onset_raw, 75), distance=int(0.08 * FPS))
    on_peaks = np.zeros(n)
    on_peaks[pk_on] = 1.0
    unit_ends = np.r_[unit_starts[1:], duration]
    dens, s3r = [], []
    for s, e in zip(unit_starts, unit_ends):
        m = (t >= s) & (t < e) & (is_breakdown == 0)
        dens.append(on_peaks[m].sum() / max(m.sum() / FPS / beat, 1e-6))
        cm = crack * m
        bar0 = s + 4 * beat * np.arange(int(np.ceil((e - s) / (4 * beat) - 1e-6)))

        def cs(q):  # mean crack peak (+-20 ms) at bar beat q (0-based) inside this unit
            v = [cm[(t >= g - 0.02) & (t <= g + 0.02)].max() for g in bar0 + q * beat if g < e]
            return float(np.mean(v)) if v else 0.0
        s3r.append(cs(2) / max(0.5 * (cs(1) + cs(3)), 1e-6))
    dens, s3r = np.array(dens), np.array(s3r)
    ht_unit = (s3r > 1.25) & (dens < 0.6 * np.median(dens))
    u = np.clip(np.searchsorted(unit_starts, t, side="right") - 1, 0, len(unit_starts) - 1)
    halftime = np.where(t >= unit_starts[0], ht_unit[u], 0).astype(np.float64)
    log(f"half-time units: {int(ht_unit.sum())}/{len(ht_unit)}  (onset peaks/beat median {np.median(dens):.2f}, "
        f"min {dens.min():.2f}; crack beat3/(2,4) max {s3r.max():.2f})")

    after_drop = (t >= DROP).astype(np.float32)
    drop_window = ((t >= DROP) & (t < DROP + DROP_BONUS_WINDOW)).astype(np.float32)
    cols = dict(beat_phase=beat_phase, bar_phase=bar_phase, onset=onset, kick=kick, energy=energy,
                after_drop=after_drop, drop_window=drop_window, snare=snare, downbeat=downbeat,
                beat_pulse=beat_pulse, backbeat_pulse=backbeat_pulse, eight_count_idx=eight_count_idx,
                count_in_32=count_in_32, section_phase=section_phase, is_breakdown=is_breakdown,
                halftime=halftime)
    table = build_table_v2(cols)
    beats = beat_times(duration, beat=beat, anchor=anchor)
    dbp = np.mod((DROP - anchor) / (4 * beat), 1.0)
    log(f"drop {DROP}s under v2 grid: bar_phase {dbp:.4f} (beat {4 * dbp + 1:.3f} of the bar), "
        f"beat_phase {np.mod((DROP - anchor) / beat, 1.0):.4f}")
    out = dict(
        table=table, columns=np.array(COLUMNS_V2), version=np.int32(2), fps=np.int32(FPS),
        duration=np.float32(duration), t=t.astype(np.float32), beat=np.float32(beat),
        grid_anchor=np.float64(anchor), drop=np.float32(DROP), beat_times=beats.astype(np.float32),
        downbeat_times=beats[np.isclose(np.mod((beats - anchor) / beat + 1e-6, 4.0), 0, atol=1e-3)].astype(np.float32),
        section_boundaries=np.array(bounds, np.float64), breakdowns=np.array(breakdowns, np.float64).reshape(-1, 2),
        eight_count_starts=unit_starts.astype(np.float64), novelty=np.c_[bt, nov].astype(np.float32),
        clap_times=clap_stats["times"].astype(np.float32), clap_offsets=clap_stats["offsets"].astype(np.float32),
        kick_hist8=kh.astype(np.float32), snare_hist8=sh8.astype(np.float32), crack_hist8=ch8.astype(np.float32),
        lookahead=table[:, len(SCALAR_COLUMNS_V2):],
        **{c: table[:, COL_V2[c]] for c in SCALAR_COLUMNS_V2},
    )
    np.savez_compressed(out_npz, **out)
    log(f"duration {duration:.2f}s rows {n} table {table.shape}")
    return out


# ---------------------------------------------------------------- loading for the env
class SongFeatures:
    """Feature table + lookup at arbitrary song times (nearest 50 Hz row, clipped)."""

    def __init__(self, npz_path: str):
        d = np.load(npz_path)
        self.table = d["table"].astype(np.float32)
        self.fps = int(d["fps"])
        self.duration = float(d["duration"])
        self.beat_times = d["beat_times"]
        self.col, self.n_scalar = layout(self.table.shape[1])  # v1 file -> COL, as before

    def index(self, t):
        return np.clip(np.round(np.asarray(t) * self.fps).astype(np.int64), 0, len(self.table) - 1)

    def at(self, t) -> np.ndarray:
        return self.table[self.index(t)]

    def column(self, name: str) -> np.ndarray:
        return self.table[:, self.col[name]]


def load_table(npz_path: str) -> np.ndarray:
    return SongFeatures(npz_path).table


# ---------------------------------------------------------------- synthetic metronome (stage 2)
def metronome_features(bpm: float, duration: float, rng: np.random.Generator) -> np.ndarray:
    """Click track at `bpm`: a click every beat (downbeat louder); the click is also the kick.
    The grid is anchored at a random offset; after_drop = 1 throughout, energy random constant."""
    n = int(np.ceil(duration * FPS))
    t = np.arange(n) / FPS
    beat = 60.0 / bpm
    anchor = rng.uniform(0.0, 4 * beat)
    beat_phase, bar_phase = grid_phases(t, beat=beat, anchor=anchor)
    since = beat_phase * beat  # seconds since last click
    beat_idx = np.floor((t - anchor) / beat).astype(int)
    accent = np.where(np.mod(beat_idx, 4) == 0, 1.0, 0.7)
    click = accent * np.exp(-since / 0.04)
    onset = _norm01(_lowpass(click, 8.0), 99.5)
    kick = onset.copy()
    energy = np.full(n, rng.uniform(0.4, 1.0))
    ones = np.ones(n)
    return build_table(beat_phase, bar_phase, onset, kick, energy, ones, np.zeros(n))


def metronome_features_v2(bpm: float, duration: float, rng: np.random.Generator) -> np.ndarray:
    """v2 click track: kick click on beats 1 and 3, snare click on 2 and 4 (onset = both, beat 1
    loudest), grid pulses from the same grid, 8-counts free-running from t=0 (unit 0 is partial),
    no breakdowns, no half-time. Random grid offset; after_drop = 1, energy random constant."""
    n = int(np.ceil(duration * FPS))
    t = np.arange(n) / FPS
    beat = 60.0 / bpm
    anchor = rng.uniform(0.0, 4 * beat)
    beat_phase, bar_phase = grid_phases(t, beat=beat, anchor=anchor)
    since = beat_phase * beat
    pos = np.mod(np.floor((t - anchor) / beat).astype(int), 4)   # 0..3 = beats 1..4
    env = np.exp(-since / 0.04)
    k_click = np.where(pos == 0, 1.0, np.where(pos == 2, 0.8, 0.0)) * env
    s_click = np.where((pos == 1) | (pos == 3), 0.85, 0.0) * env
    onset = _norm01(_lowpass(k_click + s_click, 8.0), 99.5)
    kick = _norm01(_lowpass(k_click, 8.0), 99.5)
    snare = _norm01(_lowpass(s_click, 8.0), 99.5)
    downbeat, beat_pulse, backbeat_pulse = grid_pulses(t, beat, anchor)
    rel = (t - anchor) / (8 * beat)
    unit = np.floor(rel)
    eight_count_idx = unit - np.floor(-anchor / (8 * beat))
    zeros, ones = np.zeros(n), np.ones(n)
    cols = dict(beat_phase=beat_phase, bar_phase=bar_phase, onset=onset, kick=kick,
                energy=np.full(n, rng.uniform(0.4, 1.0)), after_drop=ones, drop_window=zeros,
                snare=snare, downbeat=downbeat, beat_pulse=beat_pulse, backbeat_pulse=backbeat_pulse,
                eight_count_idx=eight_count_idx, count_in_32=np.mod(eight_count_idx, 4),
                section_phase=np.mod(rel, 1.0), is_breakdown=zeros, halftime=zeros)
    return build_table_v2(cols)


def metronome_bank(n_tracks: int, duration: float, seed: int = 0, bpm_range=(90.0, 130.0), version: int = 1):
    """version=1 (default): the v1 table, unchanged. version=2: metronome_features_v2 tables."""
    rng = np.random.default_rng(seed)
    bpms = rng.uniform(*bpm_range, size=n_tracks)
    gen = metronome_features if version == 1 else metronome_features_v2
    return np.stack([gen(b, duration, rng) for b in bpms]).astype(np.float32), bpms


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mp3", default="now-get-busy.mp3")
    ap.add_argument("--out", default=None, help="default features/now-get-busy[.v2].features.npz")
    ap.add_argument("--version", type=int, default=1, choices=[1, 2])
    a = ap.parse_args()
    out = a.out or ("features/now-get-busy.features.npz" if a.version == 1
                    else "features/now-get-busy.v2.features.npz")
    import os
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    (analyze if a.version == 1 else analyze_v2)(a.mp3, out)


if __name__ == "__main__":
    main()
