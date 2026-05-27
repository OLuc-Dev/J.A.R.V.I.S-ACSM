/* Cursor — ring follows with lag, dot follows exactly */
(function () {
  const ring = document.getElementById('cursor-ring');
  const dot  = document.getElementById('cursor-dot');
  if (!ring || !dot) return;

  let mx = -200, my = -200;
  let rx = -200, ry = -200;

  document.addEventListener('mousemove', e => {
    mx = e.clientX;
    my = e.clientY;
    dot.style.left = mx + 'px';
    dot.style.top  = my + 'px';
  });

  (function animateRing() {
    rx += (mx - rx) * 0.12;
    ry += (my - ry) * 0.12;
    ring.style.left = rx + 'px';
    ring.style.top  = ry + 'px';
    requestAnimationFrame(animateRing);
  })();

  const HOVER = 'a, button, input, [data-hover]';

  document.addEventListener('mouseover', e => {
    if (e.target.matches(HOVER) || e.target.closest(HOVER))
      ring.classList.add('hover');
  });

  document.addEventListener('mouseout', e => {
    if (e.target.matches(HOVER) || e.target.closest(HOVER))
      ring.classList.remove('hover');
  });

  document.addEventListener('mousedown', () => ring.classList.add('click'));
  document.addEventListener('mouseup',   () => ring.classList.remove('click'));
})();
