// Cosmic backdrop: a starfield plus a themed nebula background. setTheme() lets
// levels swap the mood, supporting multi-level "worlds".
import * as THREE from 'three';

function makeNebulaTexture(colorA, colorB) {
  const s = 512;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s * 0.5, s * 0.42, s * 0.05, s * 0.5, s * 0.5, s * 0.72);
  g.addColorStop(0, colorA);
  g.addColorStop(1, colorB);
  ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  // faint drifting cloud blobs for depth
  for (let i = 0; i < 26; i++) {
    const x = Math.random() * s, y = Math.random() * s, r = 40 + Math.random() * 120;
    const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
    const a = 0.05 + Math.random() * 0.07;
    rg.addColorStop(0, `rgba(255,255,255,${a})`);
    rg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Background {
  constructor(scene) {
    this.scene = scene;
    this._buildStars();
  }

  _buildStars() {
    const N = 2600;
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    const R = 620;
    for (let i = 0; i < N; i++) {
      // random point on a large sphere shell
      const u = Math.random() * 2 - 1;
      const t = Math.random() * Math.PI * 2;
      const r = R * (0.8 + Math.random() * 0.2);
      const s = Math.sqrt(1 - u * u);
      pos[i * 3] = r * s * Math.cos(t);
      pos[i * 3 + 1] = r * u;
      pos[i * 3 + 2] = r * s * Math.sin(t);
      const b = 0.6 + Math.random() * 0.4;
      col[i * 3] = b; col[i * 3 + 1] = b; col[i * 3 + 2] = b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({
      size: 2.2, sizeAttenuation: true, vertexColors: true,
      transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending
    });
    this.stars = new THREE.Points(geo, mat);
    this.stars.frustumCulled = false;
    this.scene.add(this.stars);
    this._starMat = mat;
  }

  setTheme(theme) {
    if (this._bgTex) this._bgTex.dispose();
    this._bgTex = makeNebulaTexture(theme.nebula[0], theme.nebula[1]);
    this.scene.background = this._bgTex;
    const fog = new THREE.Color(theme.fog);
    if (this.scene.fog) this.scene.fog.color.copy(fog); else this.scene.fog = new THREE.Fog(fog, 140, 320);
    this._starMat.color = new THREE.Color(theme.star);
  }

  update(dt) {
    if (this.stars) { this.stars.rotation.y += dt * 0.006; this.stars.rotation.x += dt * 0.002; }
  }
}
