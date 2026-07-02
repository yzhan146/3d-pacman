// Node logic tests for cube topology. Run: npm run test:topology
import * as THREE from 'three';
import {
  FACES, FACE_IDS, EDGES, crossEdge, canonicalQuaternion,
  faceGridToLocal, FACE_NEXT_HOP, FACE_ADJ, edgeInfo
} from '../src/cube.js';

let pass = 0, fail = 0;
const approx = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + msg); } }

// 1) Right-handed frames: r x u == n
for (const id of FACE_IDS) {
  const f = FACES[id];
  const cross = new THREE.Vector3().crossVectors(f.r, f.u);
  ok(cross.distanceTo(f.n) < 1e-6, `${id}: r x u == n (got ${cross.toArray()})`);
  ok(approx(f.r.length(), 1) && approx(f.u.length(), 1) && approx(f.n.length(), 1), `${id}: unit basis`);
}

// 2) Crossing inverse consistency: F --edge--> G, then G --entryEdge--> should return to F.
for (const id of FACE_IDS) {
  for (const e of EDGES) {
    const a = crossEdge(id, e);
    const back = crossEdge(a.face, a.edge);
    ok(back.face === id, `${id} via ${e} -> ${a.face} via ${a.edge} -> back ${back.face} (expected ${id})`);
    // arrival cell must be an edge midpoint (one coord == MID)
  }
}

// 3) Canonical orientation: normal -> +Y, up -> -Z, right -> +X
const Y = new THREE.Vector3(0, 1, 0);
const Zn = new THREE.Vector3(0, 0, -1);
const X = new THREE.Vector3(1, 0, 0);
for (const id of FACE_IDS) {
  const q = canonicalQuaternion(id);
  const f = FACES[id];
  const n2 = f.n.clone().applyQuaternion(q);
  const u2 = f.u.clone().applyQuaternion(q);
  const r2 = f.r.clone().applyQuaternion(q);
  ok(n2.distanceTo(Y) < 1e-6, `${id}: normal -> +Y (got ${n2.toArray().map(x=>x.toFixed(2))})`);
  ok(u2.distanceTo(Zn) < 1e-6, `${id}: up -> -Z (got ${u2.toArray().map(x=>x.toFixed(2))})`);
  ok(r2.distanceTo(X) < 1e-6, `${id}: right -> +X (got ${r2.toArray().map(x=>x.toFixed(2))})`);
}

// 4) faceGridToLocal midpoints lie on the correct plane (|coord along normal| == HALF)
import { HALF, MID } from '../src/config.js';
for (const id of FACE_IDS) {
  const p = faceGridToLocal(id, MID, MID);
  const along = p.dot(FACES[id].n);
  ok(approx(along, HALF), `${id}: face centre distance == HALF (got ${along.toFixed(3)})`);
}

// 5) Face routing reaches every face and first hop is a real neighbour
for (const from of FACE_IDS) {
  for (const to of FACE_IDS) {
    if (from === to) { ok(FACE_NEXT_HOP[from][to] === null, `${from}->${to} nextHop null`); continue; }
    const e = FACE_NEXT_HOP[from][to];
    ok(EDGES.includes(e), `${from}->${to} has a valid first edge (${e})`);
    ok(FACE_ADJ[from][e] != null, `${from} edge ${e} has a neighbour`);
  }
}

console.log(`\ntopology tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
