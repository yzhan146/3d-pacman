import * as THREE from 'three';
import { GRID } from './config.js';

export class MiniMap {
  constructor(topology) {
    this.topology = topology;
    this.scene = new THREE.Scene();
    this.cam = new THREE.PerspectiveCamera(42, 1, 0.1, 20);
    this.cam.position.set(0.95, 1.15, 1.95);
    this.cam.lookAt(0, 0, 0);

    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.faceMats = {};
    this._buildShell();

    const pacGeo = new THREE.SphereGeometry(0.09, 20, 14, 0.35, Math.PI * 2 - 0.7);
    pacGeo.rotateZ(-Math.PI / 2);
    this.player = new THREE.Mesh(pacGeo, new THREE.MeshBasicMaterial({ color: 0xffd21a, side: THREE.DoubleSide }));
    this.root.add(this.player);

    this.ghostDots = [];
    const gcolors = [0xff3b6b, 0xff9bd0, 0x53e0ff, 0xffab4d];
    for (let i = 0; i < 4; i++) {
      const d = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 12), new THREE.MeshBasicMaterial({ color: gcolors[i] }));
      this.ghostDots.push(d);
      this.root.add(d);
    }

    this._tmp = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
  }

  _buildShell() {
    const Z = new THREE.Vector3(0, 0, 1);
    for (const id of this.topology.faceIds) {
      const mat = new THREE.MeshBasicMaterial({ color: 0x1b2350, transparent: true, opacity: 0.9, side: THREE.DoubleSide });
      this.faceMats[id] = mat;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.92, 0.92), mat);
      const f = this.topology.faces[id];
      m.position.copy(f.n).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(Z, f.n);
      this.root.add(m);
    }

    this.root.add(new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
      new THREE.LineBasicMaterial({ color: 0x9fb4ff, transparent: true, opacity: 0.5 })
    ));
  }

  update(player, ghosts, world) {
    this.root.quaternion.copy(world.group.quaternion);
    for (const id of this.topology.faceIds) {
      const mat = this.faceMats[id];
      if (world.faceRemaining[id] <= 0) mat.color.setHex(0x2ecb74);
      else if (id === player.face) mat.color.setHex(0x4a6bff);
      else mat.color.setHex(0x1b2350);
      mat.opacity = id === player.face ? 0.95 : 0.72;
    }

    this.topology.miniLocal(player.face, player.u, player.v, 0.06, this._tmp);
    this.player.position.copy(this._tmp);
    const f = this.topology.faces[player.face];
    const s = Math.sin(player.heading), c = Math.cos(player.heading);
    this._fwd.copy(f.r).multiplyScalar(s).addScaledVector(f.u, c).normalize();
    this.player.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), this._fwd);

    ghosts.forEach((g, i) => {
      this.topology.miniLocal(g.face, g.cx, g.cy, 0.05, this._tmp);
      this.ghostDots[i].position.copy(this._tmp);
      this.ghostDots[i].visible = g.mode !== 'eaten';
    });
    for (let i = ghosts.length; i < this.ghostDots.length; i++) this.ghostDots[i].visible = false;
  }

  render(renderer) {
    const W = window.innerWidth, H = window.innerHeight;
    const size = Math.round(Math.min(W, H) * 0.22);
    const margin = 18;
    const x = W - size - margin;
    const y = margin;
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.setScissorTest(true);
    renderer.setViewport(x, y, size, size);
    renderer.setScissor(x, y, size, size);
    renderer.render(this.scene, this.cam);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, W, H);
    renderer.autoClear = prevAutoClear;
  }
}
