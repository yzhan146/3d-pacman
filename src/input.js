// Keyboard + pointer-lock mouse input on desktop, and a virtual joystick +
// drag-to-look on touch devices. moveVector() / consumeMouse() present a single
// interface so the rest of the game does not care which is in use.
export class Input {
  constructor(domElement) {
    this.dom = domElement;
    this.keys = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.locked = false;
    this.isTouch = window.matchMedia('(pointer: coarse)').matches || ('ontouchstart' in window);

    this._bindKeyboard();
    if (this.isTouch) this._initTouch();
    else this._bindMouse();
  }

  _overlayVisible() {
    const o = document.getElementById('overlay');
    return o && !o.classList.contains('hidden');
  }

  _bindKeyboard() {
    this._onKeyDown = (e) => {
      if (['KeyW','KeyA','KeyS','KeyD','Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) e.preventDefault();
      this.keys.add(e.code);
    };
    this._onKeyUp = (e) => this.keys.delete(e.code);
    window.addEventListener('keydown', this._onKeyDown, { passive: false });
    window.addEventListener('keyup', this._onKeyUp);
  }

  _bindMouse() {
    this._onMouseMove = (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX || 0;
      this.mouseDY += e.movementY || 0;
    };
    this._onLockChange = () => { this.locked = document.pointerLockElement === this.dom; };
    this._onClick = () => { if (!this.locked && this.dom.requestPointerLock) this.dom.requestPointerLock(); };
    window.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('pointerlockchange', this._onLockChange);
    this.dom.addEventListener('click', this._onClick);
  }

  // ---------- Touch ----------
  _initTouch() {
    document.body.style.touchAction = 'none';
    this.dom.style.touchAction = 'none';

    this.joyId = null; this.joyDX = 0; this.joyDY = 0;
    this.joyBaseX = 0; this.joyBaseY = 0;
    this.joyRadius = 62;
    this.lookId = null; this.lookLastX = 0; this.lookLastY = 0;

    // joystick DOM
    this.joyBase = document.createElement('div');
    Object.assign(this.joyBase.style, {
      position: 'fixed', width: '124px', height: '124px', borderRadius: '50%',
      border: '2px solid rgba(255,255,255,0.22)', background: 'rgba(255,255,255,0.06)',
      transform: 'translate(-50%,-50%)', pointerEvents: 'none', zIndex: '6', display: 'none',
      boxShadow: '0 0 24px rgba(0,0,0,0.35)'
    });
    this.joyKnob = document.createElement('div');
    Object.assign(this.joyKnob.style, {
      position: 'fixed', width: '58px', height: '58px', borderRadius: '50%',
      background: 'radial-gradient(circle at 35% 30%, #fff2a8, #ffb020 72%)',
      transform: 'translate(-50%,-50%)', pointerEvents: 'none', zIndex: '7', display: 'none',
      boxShadow: '0 0 18px rgba(255,180,30,0.6)'
    });
    document.body.appendChild(this.joyBase);
    document.body.appendChild(this.joyKnob);

    const hint = document.querySelector('.hint');
    if (hint) hint.textContent = '左半屏拖动摇杆移动 · 右半屏拖动转视角';

    this._onTouchStart = (e) => {
      if (this._overlayVisible()) return;
      for (const t of e.changedTouches) {
        if (t.clientX < window.innerWidth * 0.5 && this.joyId === null) {
          this.joyId = t.identifier;
          this.joyBaseX = t.clientX; this.joyBaseY = t.clientY;
          this._showJoy(t.clientX, t.clientY, t.clientX, t.clientY);
        } else if (this.lookId === null) {
          this.lookId = t.identifier;
          this.lookLastX = t.clientX; this.lookLastY = t.clientY;
        }
      }
      e.preventDefault();
    };
    this._onTouchMove = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.joyId) {
          let dx = t.clientX - this.joyBaseX;
          let dy = t.clientY - this.joyBaseY;
          const len = Math.hypot(dx, dy);
          const max = this.joyRadius;
          if (len > max) { dx = dx / len * max; dy = dy / len * max; }
          this.joyDX = dx / max; this.joyDY = dy / max;
          this._showJoy(this.joyBaseX, this.joyBaseY, this.joyBaseX + dx, this.joyBaseY + dy);
        } else if (t.identifier === this.lookId) {
          this.mouseDX += (t.clientX - this.lookLastX);
          this.mouseDY += (t.clientY - this.lookLastY);
          this.lookLastX = t.clientX; this.lookLastY = t.clientY;
        }
      }
      e.preventDefault();
    };
    this._onTouchEnd = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.joyId) { this.joyId = null; this.joyDX = 0; this.joyDY = 0; this._hideJoy(); }
        else if (t.identifier === this.lookId) { this.lookId = null; }
      }
    };
    window.addEventListener('touchstart', this._onTouchStart, { passive: false });
    window.addEventListener('touchmove', this._onTouchMove, { passive: false });
    window.addEventListener('touchend', this._onTouchEnd);
    window.addEventListener('touchcancel', this._onTouchEnd);
  }

  _showJoy(bx, by, kx, ky) {
    this.joyBase.style.display = 'block';
    this.joyKnob.style.display = 'block';
    this.joyBase.style.left = bx + 'px'; this.joyBase.style.top = by + 'px';
    this.joyKnob.style.left = kx + 'px'; this.joyKnob.style.top = ky + 'px';
  }
  _hideJoy() { this.joyBase.style.display = 'none'; this.joyKnob.style.display = 'none'; }

  // ---------- Shared interface ----------
  moveVector() {
    if (this.isTouch) {
      if (this.joyId === null) return { f: 0, s: 0 };
      return { f: -this.joyDY, s: this.joyDX }; // up on stick = forward
    }
    let f = 0, s = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) f += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) f -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) s += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) s -= 1;
    return { f, s };
  }

  consumeMouse() {
    const dx = this.mouseDX, dy = this.mouseDY;
    this.mouseDX = 0; this.mouseDY = 0;
    return { dx, dy };
  }
}
