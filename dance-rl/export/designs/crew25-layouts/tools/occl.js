// page-side: occlusion + on-screen size per dancer by ID renders (window.__occl(scale))
window.__occl = async (scale = 1) => {
  const u = performance.getEntriesByType('resource').map((r) => r.name).find((n) => /\.vite\/deps\/three\.js/.test(n));
  const T = await import(u);
  const { gl, scene, camera, size } = window.__labThree();
  const c = window.__crew, M = c.meshes;
  const W = Math.round(size.width * scale), H = Math.round(size.height * scale);
  const rt = new T.WebGLRenderTarget(W, H);
  const buf = new Uint8Array(W * H * 4);
  const saved = [];
  scene.traverse((o) => { if ((o.isMesh || o.isInstancedMesh || o.isSkinnedMesh) && !M.includes(o)) { saved.push([o, o.visible]); o.visible = false; } });
  const mats = M.map((m) => m.material);
  const basic = M.map((m, i) => { const b = new T.MeshBasicMaterial(); b.color.setRGB((i + 1) * 9 / 255, 0, 0, T.LinearSRGBColorSpace); return b; });
  M.forEach((m, i) => { m.material = basic[i]; m.visible = true; });
  const prevClip = gl.localClippingEnabled; gl.localClippingEnabled = false;
  const prevBg = scene.background; scene.background = null;
  const render = () => { gl.setRenderTarget(rt); gl.setClearColor(0x000000, 0); gl.clear(); gl.render(scene, camera); gl.readRenderTargetPixels(rt, 0, 0, W, H, buf); gl.setRenderTarget(null); };
  const stats = (only) => { const cnt = new Array(M.length).fill(0), bb = M.map(() => [1e9, -1e9, 1e9, -1e9]);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const r = buf[(y * W + x) * 4]; if (!r) continue; const id = Math.round(r / 9) - 1; if (id < 0 || id >= M.length) continue; cnt[id]++; const b = bb[id]; if (x < b[0]) b[0] = x; if (x > b[1]) b[1] = x; const yy = H - 1 - y; if (yy < b[2]) b[2] = yy; if (yy > b[3]) b[3] = yy; }
    return { cnt, bb }; };
  render(); const all = stats();
  const alone = [], abb = [];
  for (let i = 0; i < M.length; i++) { M.forEach((m, j) => { m.visible = j === i; }); render(); const s = stats(); alone.push(s.cnt[i]); abb.push(s.bb[i]); }
  M.forEach((m, i) => { m.visible = true; m.material = mats[i]; });
  basic.forEach((b) => b.dispose()); rt.dispose();
  for (const [o, v] of saved) o.visible = v;
  gl.localClippingEnabled = prevClip; scene.background = prevBg;
  const occ = alone.map((a, i) => +(1 - all.cnt[i] / Math.max(1, a)).toFixed(4));
  const h = abb.map((b) => (b[3] - b[2] + 1) / scale);
  return { occ, worst: Math.max(...occ), worstIdx: occ.indexOf(Math.max(...occ)), heightPx: h.map((v) => +v.toFixed(1)), minH: Math.min(...h), meanH: +(h.reduce((a, b) => a + b, 0) / h.length).toFixed(1), bbox: abb.map((b) => b.map((v) => Math.round(v / scale))) };
};
