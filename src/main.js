// 3D Pac-Cube — entry point. Wires renderer, scene, lighting, world, player,
// ghosts, input, HUD and the game state machine together.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

import {
  LIVES_START, SCORE, FRIGHT_TIME, GHOST_NAMES, HALF, MID, themeForLevel
} from './config.js';
import { FACE_IDS, FACE_ADJ } from './cube.js';
import { generateWorld, isPath } from './maze.js';
import { World } from './world.js';
import { Player } from './player.js';
import { Ghost } from './ghost.js';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { HUD } from './hud.js';
import { FollowCamera } from './camera.js';
import { createComposer } from './postfx.js';
import { Background } from './background.js';
import { MiniMap } from './minimap.js';

const START_FACE = 'PY';
const GHOST_FACES = ['PX', 'NX', 'PZ', 'NZ'];

class Game {
  constructor() {
    this.hud = new HUD();
    this.audio = new Audio();
    this._initThree();
    this._initInput();
    this.state = 'menu';
    this.timer = 0;
    this.level = 1;
    this.score = 0;
    this.lives = LIVES_START;
    this.frightTimer = 0;
    this.ghostChain = 0;
    this.reviveGrace = false;

    this.hud.setScore(0);
    this.hud.setLives(this.lives);
    this.hud.setLevel(this.level);

    this.hud.startBtn.addEventListener('click', () => this.startGame());
    window.addEventListener('resize', () => this._onResize());

    this.clock = new THREE.Clock();
    this._animate = this._animate.bind(this);
    requestAnimationFrame(this._animate);
  }

  _initThree() {
    const app = document.getElementById('app');
    const isTouch = window.matchMedia('(pointer: coarse)').matches || ('ontouchstart' in window);
    this.renderer = new THREE.WebGLRenderer({ antialias: !isTouch, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, isTouch ? 1.5 : 2));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.9;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    app.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05060c);
    this.scene.fog = new THREE.Fog(0x05060c, 120, 260);

    this.camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 1000);
    this.camera.position.set(0, 60, 60);

    // Image-based lighting for nice PBR reflections.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    const hemi = new THREE.HemisphereLight(0x8faaff, 0x0a0a20, 0.32);
    this.scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 0.6);
    dir.position.set(60, 90, 40);
    dir.castShadow = true;
    dir.shadow.mapSize.set(1024, 1024);
    const d = HALF + 20;
    dir.shadow.camera.left = -d; dir.shadow.camera.right = d;
    dir.shadow.camera.top = d; dir.shadow.camera.bottom = -d;
    dir.shadow.camera.near = 10; dir.shadow.camera.far = 260;
    dir.shadow.bias = -0.0006;
    this.scene.add(dir);
    this.scene.add(new THREE.AmbientLight(0x334066, 0.22));

    // Intentional character follow light: a soft, restrained pool on the player.
    this.followLight = new THREE.SpotLight(0xfff2d0, 1.5, 0, 0.5, 0.75, 0);
    this.followLight.castShadow = false;
    this.scene.add(this.followLight);
    this.scene.add(this.followLight.target);

    this.background = new Background(this.scene);
    this.background.setTheme(themeForLevel(1));

    this.followCam = new FollowCamera(this.camera);
    this.minimap = new MiniMap();
    const { composer, bloom } = createComposer(this.renderer, this.scene, this.camera);
    this.composer = composer; this.bloom = bloom;
  }

  _initInput() {
    this.input = new Input(this.renderer.domElement);
  }

  buildLevel() {
    if (this.world) { this.scene.remove(this.world.group); }
    this.reviveGrace = false;
    const theme = themeForLevel(this.level);
    this.background.setTheme(theme);
    Ghost.speedMul = theme.ghostSpeedMul;

    const data = generateWorld(1000 + this.level * 131);
    this.worldData = data;
    this.world = new World(this.scene, data);
    this.world.setActiveFaceImmediate(START_FACE);
    this.world.setTheme(theme);

    const isWallFn = (face, x, y) => !isPath(this.worldData.faces[face], x, y);
    const isPathFn = (face, x, y) => isPath(this.worldData.faces[face], x, y);

    this.player = new Player(this.world.group, START_FACE, isWallFn);

    this.ghosts = GHOST_FACES.map((f, i) => new Ghost(this.world.group, i, { face: f, x: MID, y: MID }, isPathFn));

    this.hud.setPellets(this.world.remaining, this.worldData.totalDots);
    this.followCam.snap(this.player);
  }

  startGame() {
    this.audio.start();
    this.level = 1; this.score = 0; this.lives = LIVES_START;
    this.reviveGrace = false;
    this.hud.setScore(0); this.hud.setLevel(1); this.hud.setLives(this.lives);
    this.hud.hideOverlay();
    this.buildLevel();
    this._enterReady();
  }

  _enterReady() {
    this.state = 'ready';
    this.timer = 1.5;
    this.hud.message('READY!', '#ffd21a');
  }

  _faceDistance(from, to) {
    if (from === to) return 0;
    const seen = new Set([from]);
    const q = [[from, 0]];
    while (q.length) {
      const [cur, d] = q.shift();
      for (const e of Object.keys(FACE_ADJ[cur])) {
        const nb = FACE_ADJ[cur][e];
        if (seen.has(nb)) continue;
        if (nb === to) return d + 1;
        seen.add(nb);
        q.push([nb, d + 1]);
      }
    }
    return 99;
  }

  _chooseRespawnFace() {
    const candidates = FACE_IDS.filter(id => (this.world.faceRemaining[id] || 0) > 0);
    if (!candidates.length) return START_FACE;
    let best = candidates[0];
    let bestScore = -Infinity;
    for (const face of candidates) {
      const minGhostDist = Math.min(...this.ghosts.map(g => this._faceDistance(face, g.face)));
      const score = minGhostDist * 100 + this.world.faceRemaining[face];
      if (score > bestScore) { bestScore = score; best = face; }
    }
    return best;
  }

  resetPositions() {
    const safeFace = this._chooseRespawnFace();
    this.player.respawn(safeFace, MID, MID);
    this.world.setActiveFaceImmediate(safeFace);
    this.ghosts.forEach(g => g.respawn());
    this.frightTimer = 0;
    this.reviveGrace = true;
    this.followCam.snap(this.player);
  }

  _playerDies() {
    this.state = 'dying';
    this.timer = 1.4;
    this.audio.death();
    this.hud.message('OUCH!', '#ff5b7b');
  }

  _levelClear() {
    this.state = 'levelclear';
    this.timer = 2.2;
    this.score += SCORE.clearBonus;
    this.hud.setScore(this.score);
    this.audio.win();
    this.hud.message('YOU WIN! 🎉', '#8dff9b');
  }

  _gameOver() {
    this.state = 'gameover';
    this.timer = 2.4;
    this.hud.message('GAME OVER', '#ff5b7b');
  }

  _eatPellets() {
    const kind = this.world.eatPelletAt(this.player.face, this.player.cellX, this.player.cellY);
    if (!kind) return;
    if (this.reviveGrace) {
      this.reviveGrace = false;
      this.hud.hideMessage();
    }
    if (kind === 1) { this.score += SCORE.pellet; this.audio.chomp(); }
    else { // POWER
      this.score += SCORE.power; this.audio.power();
      this.frightTimer = FRIGHT_TIME; this.ghostChain = 0;
      this.ghosts.forEach(g => g.enterFrightened(FRIGHT_TIME));
    }
    this.hud.setScore(this.score);
    this.hud.setPellets(this.world.remaining, this.worldData.totalDots);
    if (this.world.remaining <= 0) this._levelClear();
  }

  _handleCollisions() {
    const pp = this.player.getWorldPosition(new THREE.Vector3());
    const gp = new THREE.Vector3();
    for (const g of this.ghosts) {
      g.getWorldPosition(gp);
      if (pp.distanceTo(gp) < 2.0) {
        if (this.reviveGrace && g.isDangerous()) continue;
        if (g.isEdible()) {
          g.getEaten();
          this.ghostChain++;
          const gain = SCORE.ghost * Math.pow(2, this.ghostChain - 1);
          this.score += gain;
          this.hud.setScore(this.score);
          this.audio.eatGhost();
        } else if (g.isDangerous()) {
          this._playerDies();
          return;
        }
      }
    }
  }

  update(dt) {
    const { dx, dy } = this.input.consumeMouse();
    const move = this.input.moveVector();
    if (this.player) this.followCam.applyInput(dx, dy);
    this.background.update(dt);
    this.world && this.world.update(dt);

    if (this.state === 'playing') {
      this.player.update(dt, move, this.world, this.followCam.getFlatForward(new THREE.Vector3()), this.followCam.getFlatRight(new THREE.Vector3()));
      this._eatPellets();
      if (this.state !== 'playing') { /* level cleared during eat */ }
      else {
        const flash = this.frightTimer > 0 && this.frightTimer < 2.2;
        for (const g of this.ghosts) g.update(dt, this.player, flash, this.reviveGrace);
        this._handleCollisions();
        if (this.frightTimer > 0) {
          this.frightTimer -= dt;
          if (this.frightTimer <= 0) this.ghosts.forEach(g => g.endFrightened());
        }
      }
    } else if (this.state === 'ready') {
      this.player.update(dt, { f: 0, s: 0 }, this.world, this.followCam.getFlatForward(new THREE.Vector3()), this.followCam.getFlatRight(new THREE.Vector3()));
      this.timer -= dt;
      if (this.timer <= 0) {
        this.state = 'playing';
        if (this.reviveGrace) this.hud.message('SAFE UNTIL NEXT DOT', '#8dff9b');
        else this.hud.hideMessage();
      }
    } else if (this.state === 'dying') {
      // shrink pac for feedback
      const s = Math.max(0.05, this.timer / 1.4);
      this.player.mesh.scale.setScalar(s);
      this.timer -= dt;
      if (this.timer <= 0) {
        this.player.mesh.scale.setScalar(1);
        this.lives--;
        this.hud.setLives(Math.max(0, this.lives));
        if (this.lives <= 0) this._gameOver();
        else { this.resetPositions(); this._enterReady(); }
      }
    } else if (this.state === 'levelclear') {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.level++;
        this.hud.setLevel(this.level);
        this.hud.hideMessage();
        this.buildLevel();
        this._enterReady();
      }
    } else if (this.state === 'gameover') {
      this.timer -= dt;
      if (this.timer <= 0) { this.hud.hideMessage(); this.hud.showOverlay(); this.state = 'menu'; }
    }

    if (this.player) {
      this.world.setPlayerCell(this.player.face, this.player.cellX, this.player.cellY);
      this.followCam.update(this.player, dt);
      // follow light: a soft pool directly above the player in world space
      const pp = this.player.getWorldPosition(new THREE.Vector3());
      this.followLight.position.set(pp.x, pp.y + 45, pp.z);
      this.followLight.target.position.copy(pp);
      this.minimap.update(this.player, this.ghosts, this.world);
    }
  }

  _onResize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
    this.composer.setSize(innerWidth, innerHeight);
    this.bloom.setSize(innerWidth, innerHeight);
  }

  _animate() {
    requestAnimationFrame(this._animate);
    const dt = Math.min(0.05, this.clock.getDelta());
    this.update(dt);
    this.composer.render();
    if (this.player) this.minimap.render(this.renderer);
  }
}

new Game();
