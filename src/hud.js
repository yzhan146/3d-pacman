// Thin wrapper around the DOM HUD elements.
import { GHOST_NAMES } from './config.js';

export class HUD {
  constructor() {
    this.scoreEl = document.getElementById('score');
    this.pelletEl = document.getElementById('pellet-info');
    this.livesEl = document.getElementById('lives');
    this.levelEl = document.getElementById('level');
    this.rewardEl = document.getElementById('reward-info');
    this.messageEl = document.getElementById('message');
    this.overlay = document.getElementById('overlay');
    this.pauseOverlay = document.getElementById('pause-overlay');
    this.startBtn = document.getElementById('start-btn');
    this.jumpLv2OverlayBtn = document.getElementById('jump-lv2-btn-overlay');
    this.jumpLv2HudBtn = document.getElementById('jump-lv2-btn-hud');
    this.pauseBtn = document.getElementById('pause-btn');
    this.pauseResumeBtn = document.getElementById('pause-resume-btn');
    this.pauseRestartBtn = document.getElementById('pause-restart-btn');
    this.pauseMenuBtn = document.getElementById('pause-menu-btn');
    this.loadingEl = document.getElementById('loading');
  }
  setScore(v) { this.scoreEl.textContent = v; }
  setPellets(remaining, total) { this.pelletEl.textContent = `Dots ${total - remaining} / ${total}`; }
  setLevel(n) { this.levelEl.textContent = `Level ${n}`; }
  setLives(n) {
    this.livesEl.innerHTML = '';
    for (let i = 0; i < n; i++) {
      const d = document.createElement('div');
      d.className = 'life-dot';
      this.livesEl.appendChild(d);
    }
  }
  message(text, color = '#ffd21a') {
    this.messageEl.textContent = text;
    this.messageEl.style.color = color;
    this.messageEl.classList.add('show');
  }
  hideMessage() { this.messageEl.classList.remove('show'); }
  hideOverlay() { this.overlay.classList.add('hidden'); }
  showOverlay() { this.overlay.classList.remove('hidden'); }
  showPauseOverlay() { this.pauseOverlay.classList.add('show'); }
  hidePauseOverlay() { this.pauseOverlay.classList.remove('show'); }
  setLocalTestMode(enabled) {
    [this.jumpLv2OverlayBtn, this.jumpLv2HudBtn].forEach(btn => {
      if (!btn) return;
      btn.classList.toggle('show', enabled);
    });
  }
  setPauseEnabled(enabled) {
    if (!this.pauseBtn) return;
    this.pauseBtn.classList.toggle('show', enabled);
  }
  setRewards(cosmetics, shield) {
    if (!this.rewardEl) return;
    const map = { hat: '🎩', cape: '🦸', glasses: '🕶️', crown: '👑' };
    const parts = [...(cosmetics || [])].map(c => map[c] || '★');
    if (shield > 0) parts.push(`🛡️×${shield}`);
    this.rewardEl.textContent = parts.join(' ');
  }
}
