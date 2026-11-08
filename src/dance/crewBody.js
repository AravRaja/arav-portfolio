// One crew dancer's body as plain data: the procedural body (proceduralBody.js) with its headphones merged in and
// skinned to the head bone, flattened to typed arrays + a bone list. Pure three.js (no React, no DOM), so the home
// page builds it in a worker (bodyWorker.js) while the lab and the fallback path build it in place.
import { Bone, BufferGeometry, Float32BufferAttribute, Group, Sphere, Uint16BufferAttribute, Vector3 } from 'three';
import { buildDancer, headphoneFit } from './proceduralBody.js';
import { headphonesGeometry } from './headphones.js';

const YELLOW = '#f0ff18';
const ATTRS = ['position', 'normal', 'color', 'skinIndex', 'skinWeight'];

export function buildCrewBodyData(o) {
  const B = buildDancer(o);
  const { geometry, bones } = B.build();
  let tris = B.tris;
  const A = Object.fromEntries(ATTRS.map((k) => [k, geometry.attributes[k].array]));
  if (o.headphones) {
    const fit = headphoneFit(o); // sized to the head and the hair under it
    const hp = headphonesGeometry({ c: fit.c, r: fit.r, cups: o.phonesCol || YELLOW, band: o.bandCol || '#14183a' });
    const n = hp.attributes.position.count;
    const cat = (a, extra) => { const out = new Float32Array(a.length + extra.length); out.set(a); out.set(extra, a.length); return out; };
    A.position = cat(A.position, hp.attributes.position.array);
    A.normal = cat(A.normal, hp.attributes.normal.array);
    A.color = cat(A.color, hp.attributes.color.array);
    const si = new Uint16Array(A.skinIndex.length + n * 4);
    si.set(A.skinIndex);
    const sw = new Float32Array(si.length);
    sw.set(A.skinWeight);
    for (let i = 0, b = A.skinIndex.length; i < n; i++) { si[b + i * 4] = B.idx.head; sw[b + i * 4] = 1; }
    A.skinIndex = si;
    A.skinWeight = sw;
    tris += n / 3;
  }
  // bind pose = rest pose (bones carry no rotation), so the plain geometry's bounding sphere is the skinned one
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(A.position, 3));
  g.computeBoundingSphere();
  const s = g.boundingSphere;
  return {
    attrs: A,
    bones: bones.map((b) => ({ name: b.name, parent: bones.indexOf(b.parent), pos: b.position.toArray() })),
    tris,
    sphere: [s.center.x, s.center.y, s.center.z, s.radius],
  };
}

export const transferables = (d) => ATTRS.map((k) => d.attrs[k].buffer);

export function bodyFromData({ attrs, bones: list, tris, sphere }) {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(attrs.position, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(attrs.normal, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(attrs.color, 3));
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(attrs.skinIndex, 4));
  geometry.setAttribute('skinWeight', new Float32BufferAttribute(attrs.skinWeight, 4));
  const bones = list.map(({ name, pos }) => { const b = new Bone(); b.name = name; b.position.fromArray(pos); return b; });
  const root = new Group();
  list.forEach(({ parent }, i) => (parent >= 0 ? bones[parent] : root).add(bones[i]));
  return { geometry, bones, root, tris, sphere: new Sphere(new Vector3(sphere[0], sphere[1], sphere[2]), sphere[3]) };
}
