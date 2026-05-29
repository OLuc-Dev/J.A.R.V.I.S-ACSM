/* ════════════════════════════════════════════════════════════
   JARVIS CORE — núcleo holográfico de partículas reativo
   Canvas 2D puro, sem dependências. Projeta uma esfera 3D de
   partículas e reage aos estados: idle / listening / thinking /
   speaking. Aceita amplitude de áudio (0..1) para pulsar com a voz.
   ════════════════════════════════════════════════════════════ */

class JarvisCore {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');
    this.dpr    = window.devicePixelRatio || 1;

    this.particleCount = opts.particles || 900;
    this.baseRadius    = opts.radius    || 0.42; // fraction of min(w,h)/2
    this.state         = 'idle';
    this.amp           = 0;     // live audio amplitude 0..1
    this._ampSmooth    = 0;
    this.t             = 0;

    // rotation
    this.rotY = 0;
    this.rotX = 0.35;

    // palette (golden JARVIS)
    this.colors = {
      idle:      { h: 38,  s: 92,  l: 56 },  // amber/gold
      listening: { h: 50,  s: 100, l: 70 },  // bright light gold (awake)
      thinking:  { h: 26,  s: 100, l: 54 },  // hot orange
      speaking:  { h: 45,  s: 100, l: 64 },  // bright gold
      alert:     { h: 0,   s: 90,  l: 58 },  // red
    };
    this._curColor = { ...this.colors.idle };

    this._buildParticles();
    this._resize();
    window.addEventListener('resize', () => this._resize());

    this._raf = null;
    this._last = performance.now();
  }

  _buildParticles() {
    // Fibonacci sphere distribution
    this.particles = [];
    const n = this.particleCount;
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < n; i++) {
      const y = 1 - (i / (n - 1)) * 2;        // -1..1
      const r = Math.sqrt(1 - y * y);
      const theta = golden * i;
      this.particles.push({
        x: Math.cos(theta) * r,
        y: y,
        z: Math.sin(theta) * r,
        // per-particle noise seed
        seed: Math.random() * Math.PI * 2,
        speed: 0.5 + Math.random(),
      });
    }
  }

  _resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.w = rect.width;
    this.h = rect.height;
    this.canvas.width  = this.w * this.dpr;
    this.canvas.height = this.h * this.dpr;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.cx = this.w / 2;
    this.cy = this.h / 2;
    this.R  = Math.min(this.w, this.h) * this.baseRadius;
  }

  setState(s) {
    if (this.colors[s]) this.state = s;
    else this.state = 'idle';
  }

  setAmplitude(a) { this.amp = Math.max(0, Math.min(1, a)); }

  start() {
    if (this._raf) return;
    const loop = (now) => {
      const dt = Math.min(0.05, (now - this._last) / 1000);
      this._last = now;
      this._update(dt);
      this._draw();
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }

  stop() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
  }

  _update(dt) {
    this.t += dt;

    // smooth amplitude
    this._ampSmooth += (this.amp - this._ampSmooth) * Math.min(1, dt * 12);

    // rotation speed by state
    let rotSpeed = 0.18;
    if (this.state === 'thinking')  rotSpeed = 0.95;
    if (this.state === 'listening') rotSpeed = 0.32;
    if (this.state === 'speaking')  rotSpeed = 0.5;
    this.rotY += dt * rotSpeed;
    this.rotX  = 0.32 + Math.sin(this.t * 0.25) * 0.12;

    // color lerp toward target
    const target = this.colors[this.state] || this.colors.idle;
    const k = Math.min(1, dt * 4);
    this._curColor.h += (target.h - this._curColor.h) * k;
    this._curColor.s += (target.s - this._curColor.s) * k;
    this._curColor.l += (target.l - this._curColor.l) * k;
  }

  _draw() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);

    const cosY = Math.cos(this.rotY), sinY = Math.sin(this.rotY);
    const cosX = Math.cos(this.rotX), sinX = Math.sin(this.rotX);

    const c = this._curColor;
    const baseHue = c.h, baseSat = c.s, baseLit = c.l;

    // pulse from amplitude + state breathing
    const breathe = this.state === 'idle'
      ? 1 + Math.sin(this.t * 1.4) * 0.015
      : 1 + Math.sin(this.t * 4) * 0.02;
    const ampPulse = 1 + this._ampSmooth * 0.28;
    const turbulence = this.state === 'thinking' ? 0.06
                     : this.state === 'speaking' ? 0.03 + this._ampSmooth * 0.05
                     : this.state === 'listening' ? 0.02 + this._ampSmooth * 0.06
                     : 0.012;

    const R = this.R * breathe * ampPulse;

    // glow halo behind
    const glow = ctx.createRadialGradient(this.cx, this.cy, 0, this.cx, this.cy, R * 1.7);
    const glowA = 0.18 + this._ampSmooth * 0.22;
    glow.addColorStop(0,   `hsla(${baseHue}, ${baseSat}%, ${baseLit}%, ${glowA})`);
    glow.addColorStop(0.5, `hsla(${baseHue}, ${baseSat}%, ${baseLit}%, ${glowA * 0.4})`);
    glow.addColorStop(1,   `hsla(${baseHue}, ${baseSat}%, ${baseLit}%, 0)`);
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, this.w, this.h);

    // particles
    const pts = [];
    for (const p of this.particles) {
      // turbulence wobble
      const wob = 1 + Math.sin(this.t * p.speed * 2 + p.seed) * turbulence;
      let x = p.x * wob, y = p.y * wob, z = p.z * wob;

      // rotate Y
      let x1 =  x * cosY + z * sinY;
      let z1 = -x * sinY + z * cosY;
      // rotate X
      let y1 =  y * cosX - z1 * sinX;
      let z2 =  y * sinX + z1 * cosX;

      // perspective projection
      const persp = 1.6 / (1.6 + z2);
      const sx = this.cx + x1 * R * persp;
      const sy = this.cy + y1 * R * persp;

      pts.push({ sx, sy, z: z2, persp });
    }

    // sort back-to-front for depth
    pts.sort((a, b) => a.z - b.z);

    ctx.globalCompositeOperation = 'lighter';
    for (const pt of pts) {
      const depth = (pt.z + 1) / 2;           // 0 (back) .. 1 (front)
      const alpha = 0.15 + depth * 0.7;
      const size  = (0.5 + depth * 1.6) * pt.persp;
      const lit   = baseLit + depth * 15;
      ctx.fillStyle = `hsla(${baseHue}, ${baseSat}%, ${lit}%, ${alpha})`;
      ctx.beginPath();
      ctx.arc(pt.sx, pt.sy, size, 0, Math.PI * 2);
      ctx.fill();
    }

    // bright core center
    const coreR = R * (0.16 + this._ampSmooth * 0.1);
    const coreGrad = ctx.createRadialGradient(this.cx, this.cy, 0, this.cx, this.cy, coreR);
    coreGrad.addColorStop(0, `hsla(${baseHue}, ${baseSat}%, 92%, 0.9)`);
    coreGrad.addColorStop(1, `hsla(${baseHue}, ${baseSat}%, ${baseLit}%, 0)`);
    ctx.fillStyle = coreGrad;
    ctx.beginPath();
    ctx.arc(this.cx, this.cy, coreR, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalCompositeOperation = 'source-over';
  }
}

window.JarvisCore = JarvisCore;
