(() => {
  const c = window.__crew, tr = c.track(8.37, 141.5, 10), n = tr.length;
  let gap = 1e9, at = null;
  for (let k = 0; k < tr[0].root.length; k++) for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const a = tr[i].root[k], b = tr[j].root[k], d = Math.hypot(a[0] - b[0], a[2] - b[2]);
    if (d < gap) { gap = d; at = [i, j, +(8.37 + k / 10).toFixed(1)]; }
  }
  const S = c.slots, L = c.looks.slice(0, n);
  const key = (i) => `${L[i].template}:${L[i].outfit.top}`;
  const cls = (i) => (i === 0 ? 'L' : `${(Math.ceil(i / 2) - 1) % 4}${i % 2}`);
  const D = (i, j) => Math.hypot(S[i][0] - S[j][0], S[i][1] - S[j][1]);
  const nbr = [];
  for (let i = 0; i < n; i++) { const o = [...Array(n).keys()].filter((j) => j !== i).sort((a, b) => D(i, a) - D(i, b)); nbr.push(o.filter((j, k) => k < 2 || D(i, j) < 1.6)); }
  const isN = (i, j) => nbr[i].includes(j) || nbr[j].includes(i);
  const sameOutfit = [], sameMotion = [], black = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (!isN(i, j)) continue;
    if (key(i) === key(j)) sameOutfit.push([i, j]);
    if (cls(i) === cls(j)) sameMotion.push([i, j]);
  }
  const bl = L.map((l, i) => (l.template === 'allblack' ? i : -1)).filter((i) => i >= 0);
  for (let a = 0; a < bl.length; a++) for (let b = a + 1; b < bl.length; b++) black.push([bl[a], bl[b], +D(bl[a], bl[b]).toFixed(2), isN(bl[a], bl[b])]);
  const sideOK = S.every((s, i) => i === 0 || (i % 2 ? s[0] > 0 : s[0] < 0));
  let slotMin = 1e9; for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) slotMin = Math.min(slotMin, D(i, j));
  return { n, minRootGap: +gap.toFixed(3), at, slotMin: +slotMin.toFixed(2), neighbourSameOutfit: sameOutfit, neighbourSameMotion: sameMotion, allBlack: black, oddRightEvenLeft: sideOK, yawRange: [Math.min(...S.map((s) => s[2])), Math.max(...S.map((s) => s[2]))] };
})()
