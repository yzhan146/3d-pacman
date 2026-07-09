// 3D Pac-Cube — entry point. Wires renderer, scene, lighting, world, player,
// ghosts, input, HUD and the game state machine together.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

import {
  LIVES_START, SCORE, FRIGHT_TIME, GHOST_NAMES, HALF, MID, themeForLevel
} from './config.js';
import { specForLevel, FINAL_LEVEL } from './topology.js';
import { generateWorld } from './maze.js';
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

class Game {
  constructor() {
    this.hud = new HUD();
    this.audio = new Audio();
    this.isLocalTest = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
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
    this.collectedCosmetics = new Set();
    this.shieldCharges = 0;

    this.hud.setScore(0);
    this.hud.setLives(this.lives);
    this.hud.setLevel(this.level);
    this.hud.setLocalTestMode(this.isLocalTest);
    this.hud.setPauseEnabled(false);

    this.hud.startBtn.addEventListener('click', () => this.startGame());
    this.hud.pauseBtn?.addEventListener('click', () => this.togglePause());
    this.hud.pauseResumeBtn?.addEventListener('click', () => this.resumeGame());
    this.hud.pauseRestartBtn?.addEventListener('click', () => this.restartGame());
    this.hud.pauseMenuBtn?.addEventListener('click', () => this.returnToMenu());
    if (this.isLocalTest) {
      this.hud.jumpLv2OverlayBtn?.addEventListener('click', () => this.jumpToLevel(2));
      this.hud.jumpLv2HudBtn?.addEventListener('click', () => this.jumpToLevel(2));
    }
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Escape' && e.code !== 'KeyP') return;
      if (e.repeat) return;
      if (this.state === 'playing' || this.state === 'ready' || this.state === 'paused') {
        e.preventDefault();
        this.togglePause();
      }
    }, { passive: false });
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
    const { composer, bloom } = createComposer(this.renderer, this.scene, this.camera);
    this.composer = composer; this.bloom = bloom;
  }

  _initInput() {
    this.input = new Input(this.renderer.domElement);
  }

  buildLevel() {
    if (this.world) { this.scene.remove(this.world.group); }
    this.reviveGrace = false;
    this.levelSpec = specForLevel(this.level);
    const theme = themeForLevel(this.level);
    this.background.setTheme(theme);
    Ghost.speedMul = theme.ghostSpeedMul;

    const data = generateWorld(1000 + this.level * 131, this.levelSpec.topology, this.levelSpec.mechanicSet);
    this.worldData = data;
    this.world = new World(this.scene, data, this.levelSpec);
    this.world.setActiveFaceImmediate(this.levelSpec.startFace);
    this.world.setTheme(theme);
    this.minimap = new MiniMap(this.levelSpec.topology);

    const isWallFn = (face, x, y) => this.world.isBlocked(face, x, y);
    const isPathFn = (face, x, y) => this.world.isPassable(face, x, y);

    this.player = new Player(this.world.group, this.levelSpec.startFace, isWallFn, this.levelSpec.topology);

    // Level 1 keeps its ghosts; the level-5 finale re-introduces them. Levels 2-4
    // are ghost-free skill stages.
    this.ghosts = this.levelSpec.ghostsEnabled
      ? this.levelSpec.ghostFaces.map((f, i) => new Ghost(this.world.group, i, { face: f, x: MID, y: MID }, isPathFn, this.levelSpec.topology))
      : [];

    this._applyRewardsToPlayer();

    this.hud.setPellets(this.world.remaining, this.worldData.totalDots);
    this.followCam.snap(this.player);
  }

  _applyRewardsToPlayer() {
    for (const c of this.collectedCosmetics) this.player.setCosmetic(c);
    this.player.setShield(this.shieldCharges);
    this.hud.setRewards(this.collectedCosmetics, this.shieldCharges);
  }

  startGame() {
    this.audio.start();
    this.level = 1; this.score = 0; this.lives = LIVES_START;
    this.stateBeforePause = null;
    this.reviveGrace = false;
    this.collectedCosmetics.clear();
    this.shieldCharges = 0;
    this.hud.setScore(0); this.hud.setLevel(1); this.hud.setLives(this.lives);
    this.hud.hideOverlay();
    this.hud.hidePauseOverlay();
    this.hud.setPauseEnabled(true);
    this.buildLevel();
    this._enterReady();
  }

  jumpToLevel(level) {
    this.audio.start();
    this.level = level;
    this.stateBeforePause = null;
    this.score = 0;
    this.lives = LIVES_START;
    this.reviveGrace = false;
    this.frightTimer = 0;
    this.ghostChain = 0;
    this.collectedCosmetics.clear();
    this.shieldCharges = 0;
    this.hud.setScore(0);
    this.hud.setLevel(level);
    this.hud.setLives(this.lives);
    this.hud.hideOverlay();
    this.hud.hidePauseOverlay();
    this.hud.setPauseEnabled(true);
    this.buildLevel();
    this._enterReady();
  }

  togglePause() {
    if (this.state === 'paused') { this.resumeGame(); return; }
    if (this.state !== 'playing' && this.state !== 'ready') return;
    this.pauseGame();
  }

  pauseGame() {
    this.stateBeforePause = this.state;
    this.state = 'paused';
    this.input.resetMovement();
    this.hud.showPauseOverlay();
    if (document.pointerLockElement) document.exitPointerLock();
  }

  resumeGame() {
    if (this.state !== 'paused') return;
    this.state = this.stateBeforePause || 'playing';
    this.stateBeforePause = null;
    this.hud.hidePauseOverlay();
  }

  restartGame() {
    this.hud.hidePauseOverlay();
    this.startGame();
  }

  returnToMenu() {
    this.stateBeforePause = null;
    this.state = 'menu';
    this.hud.hidePauseOverlay();
    this.hud.hideMessage();
    this.hud.showOverlay();
    this.hud.setPauseEnabled(false);
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
      for (const e of Object.keys(this.levelSpec.topology.faceAdj[cur])) {
        const nb = this.levelSpec.topology.faceAdj[cur][e];
        if (seen.has(nb)) continue;
        if (nb === to) return d + 1;
        seen.add(nb);
        q.push([nb, d + 1]);
      }
    }
    return 99;
  }

  _chooseRespawnFace() {
    const candidates = this.levelSpec.topology.faceIds.filter(id => (this.world.faceRemaining[id] || 0) > 0);
    if (!candidates.length) return this.levelSpec.startFace;
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
    this.hud.message(this.level >= FINAL_LEVEL ? 'FACE CLEAR!' : 'YOU WIN! 🎉', '#8dff9b');
  }

  _gameComplete() {
    this.state = 'gamecomplete';
    this.timer = 3.2;
    this.audio.win();
    this.hud.setPauseEnabled(false);
    this.hud.message('🎉 恭喜通关! 🎉', '#ffd24a');
  }

  _gameOver() {
    this.state = 'gameover';
    this.timer = 2.4;
    this.hud.setPauseEnabled(false);
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

  _collectRewards() {
    const r = this.world.collectRewardAt(this.player.face, this.player.cellX, this.player.cellY);
    if (!r) return;
    this.audio.power();
    if (r.kind === 'shield') {
      this.shieldCharges = Math.min(3, this.shieldCharges + 1);
      this.player.setShield(this.shieldCharges);
      this.hud.message('SHIELD +1', '#8dff9b');
    } else {
      this.collectedCosmetics.add(r.cosmetic);
      this.player.setCosmetic(r.cosmetic);
      const names = { hat: '礼帽', cape: '披风', glasses: '墨镜', crown: '皇冠' };
      this.hud.message(`获得 ${names[r.cosmetic] || '战利品'}!`, '#ffd24a');
    }
    this.hud.setRewards(this.collectedCosmetics, this.shieldCharges);
  }

  _absorbWithShield(message) {
    if (this.shieldCharges <= 0) return false;
    this.shieldCharges--;
    this.player.setShield(this.shieldCharges);
    this.hud.setRewards(this.collectedCosmetics, this.shieldCharges);
    this.player.portalGrace = 1.1;
    this.audio.power();
    this.hud.message(message, '#8dff9b');
    return true;
  }

  _handleCollisions() {
    const pp = this.player.getWorldPosition(new THREE.Vector3());
    if (this.world.isHidden(this.player.face, this.player.u, this.player.v)) return;
    const gp = new THREE.Vector3();
    for (const g of this.ghosts) {
      g.getWorldPosition(gp);
      if (pp.distanceTo(gp) < 2.0) {
        if ((this.reviveGrace && g.isDangerous()) || this.player.portalGrace > 0 || g.mode === 'recover') continue;
        if (g.isEdible()) {
          g.getEaten();
          this.ghostChain++;
          const gain = SCORE.ghost * Math.pow(2, this.ghostChain - 1);
          this.score += gain;
          this.hud.setScore(this.score);
          this.audio.eatGhost();
        } else if (g.isDangerous()) {
          if (this._absorbWithShield('SHIELD BLOCKED!')) continue;
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
    if (this.state !== 'paused') {
      this.background.update(dt);
      this.world && this.world.update(dt, this.player, this.ghosts);
    }

    if (this.state === 'playing') {
      this.player.update(dt, move, this.world, this.followCam.getFlatForward(new THREE.Vector3()), this.followCam.getFlatRight(new THREE.Vector3()));
      this._eatPellets();
      this._collectRewards();
      if (this.state !== 'playing') { /* level cleared during eat */ }
      else {
        const flash = this.frightTimer > 0 && this.frightTimer < 2.2;
        const hidden = this.world.isHidden(this.player.face, this.player.u, this.player.v);
        for (const g of this.ghosts) g.update(dt, this.player, flash, this.reviveGrace || hidden, this.world);
        if (!this.reviveGrace && !hidden && this.player.portalGrace <= 0 && this.world.checkPlayerHazardHit(this.player)) {
          if (!this._absorbWithShield('SHIELD BLOCKED!')) {
            this._playerDies();
            return;
          }
        }
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
    } else if (this.state === 'paused') {
      // Freeze gameplay while the pause menu is open.
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
        if (this.level >= FINAL_LEVEL) {
          this._gameComplete();
        } else {
          this.level++;
          this.hud.setLevel(this.level);
          this.hud.hideMessage();
          this.buildLevel();
          this._enterReady();
        }
      }
    } else if (this.state === 'gamecomplete') {
      this.timer -= dt;
      if (this.timer <= 0) { this.hud.hideMessage(); this.hud.showOverlay(); this.state = 'menu'; }
    } else if (this.state === 'gameover') {
      this.timer -= dt;
      if (this.timer <= 0) { this.hud.hideMessage(); this.hud.showOverlay(); this.hud.setPauseEnabled(false); this.state = 'menu'; }
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
