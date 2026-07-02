// Minimal original sound effects via the Web Audio API (no external assets).
export class Audio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this._chompFlip = false;
  }
  _ensure() {
    if (!this.ctx) {
      try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch (e) { this.enabled = false; }
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }
  _blip(freq, dur, type = 'square', gain = 0.08) {
    if (!this.enabled) return;
    this._ensure();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type; osc.frequency.value = freq;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.ctx.destination);
    osc.start(t); osc.stop(t + dur + 0.02);
  }
  chomp() { this._chompFlip = !this._chompFlip; this._blip(this._chompFlip ? 300 : 220, 0.06, 'square', 0.05); }
  power() { this._blip(180, 0.18, 'sawtooth', 0.09); }
  eatGhost() { this._blip(520, 0.12, 'triangle', 0.1); setTimeout(() => this._blip(780, 0.14, 'triangle', 0.1), 90); }
  death() {
    const notes = [440, 392, 330, 262, 196];
    notes.forEach((n, i) => setTimeout(() => this._blip(n, 0.22, 'sawtooth', 0.09), i * 150));
  }
  start() { [392, 523, 659, 784].forEach((n, i) => setTimeout(() => this._blip(n, 0.12, 'triangle', 0.08), i * 90)); }
  win() { [523, 659, 784, 1047, 1319].forEach((n, i) => setTimeout(() => this._blip(n, 0.16, 'triangle', 0.09), i * 120)); }
  turn() { this._blip(140, 0.14, 'sine', 0.06); }
}
