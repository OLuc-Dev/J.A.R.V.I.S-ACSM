/* Background canvas — grid, mouse aura, speaking ripples */
(function () {
  const canvas = document.getElementById('bg-canvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const GRID = 55;

  let W, H, cols, rows;
  let mouse = { x: -9999, y: -9999 };
  let waves = [];
  let speakLevel = 0;
  let t = 0;

  /* ── Resize ── */
  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
    cols = Math.ceil(W / GRID) + 2;
    rows = Math.ceil(H / GRID) + 2;
  }

  window.addEventListener('resize', resize);
  resize();

  /* ── Mouse ── */
  document.addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });
  document.addEventListener('mouseleave', () => { mouse.x = -9999; mouse.y = -9999; });

  /* ── Wave emitter ── */
  function emitWave(intensity) {
    waves.push({ x: W / 2, y: H / 2, r: 0, op: intensity * 0.6 });
  }

  /* ── Draw ── */
  function draw() {
    t += 0.01;
    ctx.clearRect(0, 0, W, H);

    /* Very faint vignette */
    const vig = ctx.createRadialGradient(W/2, H/2, 0, W/2, H/2, Math.max(W,H) * 0.75);
    vig.addColorStop(0, 'rgba(8,8,8,0)');
    vig.addColorStop(1, 'rgba(4,4,4,0.75)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, W, H);

    /* Mouse aura */
    if (mouse.x > -999) {
      const aura = ctx.createRadialGradient(mouse.x, mouse.y, 0, mouse.x, mouse.y, 180);
      aura.addColorStop(0, 'rgba(77,157,224,0.045)');
      aura.addColorStop(1, 'rgba(77,157,224,0)');
      ctx.fillStyle = aura;
      ctx.fillRect(0, 0, W, H);
    }

    /* Ripple waves */
    waves = waves.filter(w => w.op > 0.005);
    for (const w of waves) {
      w.r  += 1.8 + speakLevel * 3;
      w.op *= 0.97;

      ctx.beginPath();
      ctx.arc(w.x, w.y, w.r, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(77,157,224,${w.op * 0.18})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    /* Grid lines */
    ctx.lineWidth = 0.5;
    ctx.strokeStyle = 'rgba(255,255,255,0.025)';
    for (let c = 0; c <= cols; c++) {
      ctx.beginPath();
      ctx.moveTo(c * GRID, 0);
      ctx.lineTo(c * GRID, H);
      ctx.stroke();
    }
    for (let r = 0; r <= rows; r++) {
      ctx.beginPath();
      ctx.moveTo(0, r * GRID);
      ctx.lineTo(W, r * GRID);
      ctx.stroke();
    }

    /* Intersection dots */
    const offsetX = (W % GRID) / 2;
    const offsetY = (H % GRID) / 2;

    for (let c = 0; c <= cols; c++) {
      for (let r = 0; r <= rows; r++) {
        const gx = c * GRID - offsetX + GRID / 2;
        const gy = r * GRID - offsetY + GRID / 2;

        /* Distance to mouse */
        const mdx = mouse.x - gx;
        const mdy = mouse.y - gy;
        const md  = Math.sqrt(mdx * mdx + mdy * mdy);

        /* Distance to center (for speaking effect) */
        const cdx = W/2 - gx;
        const cdy = H/2 - gy;
        const cd  = Math.sqrt(cdx * cdx + cdy * cdy);

        /* Base opacity + mouse proximity boost */
        let op = 0.05 + Math.max(0, 1 - md / 140) * 0.28;

        /* Speaking pulse: ripple outward from center */
        if (speakLevel > 0) {
          const wave = Math.sin(t * 4 - cd * 0.018) * speakLevel;
          op += wave * 0.15;
        }

        op = Math.max(0.02, Math.min(0.55, op));

        /* Dot displacement toward/away from mouse */
        let dx = gx, dy = gy;
        if (md < 130) {
          const force = (1 - md / 130) * 16;
          dx -= (mdx / (md || 1)) * force;
          dy -= (mdy / (md || 1)) * force;
        }

        ctx.beginPath();
        ctx.arc(dx, dy, 1, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${op})`;
        ctx.fill();
      }
    }

    /* Decay speak level */
    if (speakLevel > 0) speakLevel = Math.max(0, speakLevel - 0.008);

    requestAnimationFrame(draw);
  }

  draw();

  /* ── Public API ── */
  window.JARVIS_BG = {
    pulse(intensity = 0.7) {
      speakLevel = Math.min(1, speakLevel + intensity * 0.25);
      if (Math.random() < 0.25) emitWave(intensity);
    },
    stop() {
      speakLevel = 0;
    }
  };
})();
