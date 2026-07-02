// Thin wrapper around the DOM HUD elements.
import { GHOST_NAMES } from './config.js';

export class HUD {
  constructor() {
    this.scoreEl = document.getElementById('score');
    this.pelletEl = document.getElementById('pellet-info');
    this.livesEl = document.getElementById('lives');
    this.levelEl = document.getElementById('level');
    this.messageEl = document.getElementById('message');
    this.overlay = document.getElementById('overlay');
    this.startBtn = document.getElementById('start-btn');
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
}
