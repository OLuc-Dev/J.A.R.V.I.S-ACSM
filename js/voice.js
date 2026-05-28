/* Voice — Web Audio API oscillators + Web Speech API TTS/STT
 *
 * During JARVIS speech:
 *  - SpeechSynthesis handles audible TTS
 *  - Silent oscillators (routed into AnalyserNode only) provide
 *    real frequency data for the visualizer
 */
(function () {
  /* ── Frequency canvas ── */
  const freqCanvas = document.getElementById('freq-canvas');
  const orbCanvas  = document.getElementById('voice-orb-canvas');
  if (!freqCanvas) return;

  const fCtx = freqCanvas.getContext('2d');
  const oCtx = orbCanvas?.getContext('2d') || null;
  let fW, fH, oW = 0, oH = 0;
  let voiceLevel = 0;
  let spectralCentroid = 0;

  function resizeFreq() {
    const dpr = window.devicePixelRatio || 1;
    fW = freqCanvas.offsetWidth;
    fH = freqCanvas.offsetHeight;
    freqCanvas.width  = fW * dpr;
    freqCanvas.height = fH * dpr;
    fCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function resizeOrb() {
    if (!orbCanvas || !oCtx) return;
    const dpr = window.devicePixelRatio || 1;
    oW = orbCanvas.offsetWidth;
    oH = orbCanvas.offsetHeight;
    orbCanvas.width  = oW * dpr;
    orbCanvas.height = oH * dpr;
    oCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  const freqObserver = new ResizeObserver(resizeFreq);
  freqObserver.observe(freqCanvas);
  resizeFreq();

  if (orbCanvas) {
    const orbObserver = new ResizeObserver(resizeOrb);
    orbObserver.observe(orbCanvas);
    resizeOrb();
  }

  /* ── Audio context (lazy init on first interaction) ── */
  let audioCtx   = null;
  let analyser   = null;
  let freqData   = null;
  let oscGroup   = [];
  let isSpeaking = false;

  const orbParticles = Array.from({ length: 150 }, (_, i) => ({
    a: (i / 150) * Math.PI * 2,
    r: 0.16 + Math.random() * 0.42,
    s: 0.0015 + Math.random() * 0.004,
    p: Math.random() * Math.PI * 2,
    z: 0.45 + Math.random() * 0.85
  }));

  function initAudio() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    analyser = audioCtx.createAnalyser();
    analyser.fftSize            = 2048;
    analyser.smoothingTimeConstant = 0.88;

    /* Silent output — analyser taps the signal before the muted gain */
    const silentGain = audioCtx.createGain();
    silentGain.gain.value = 0;
    analyser.connect(silentGain);
    silentGain.connect(audioCtx.destination);

    freqData = new Uint8Array(analyser.frequencyBinCount);
  }

  /* ── Voice oscillator bank ── */
  function buildVoice(text) {
    stopOscillators();
    if (!audioCtx) return;

    const f0 = 115 + Math.random() * 35;           // 115–150 Hz fundamental
    const harmonics = [1, 2, 3, 4, 5, 6, 7];
    const amps      = [1, 0.55, 0.38, 0.22, 0.14, 0.08, 0.04];
    const types     = ['sawtooth','sine','sine','sine','sine','sine','sine'];

    oscGroup = harmonics.map((h, i) => {
      const osc  = audioCtx.createOscillator();
      const gain = audioCtx.createGain();

      osc.type            = types[i];
      osc.frequency.value = f0 * h;
      osc.detune.value    = (Math.random() - 0.5) * 8;
      gain.gain.value     = amps[i] * 0.4;

      osc.connect(gain);
      gain.connect(analyser);
      osc.start();

      return { osc, gain };
    });

    /* Noise layer for consonants */
    const hasSibilant = text && /[szfvʃʒ]/i.test(text);
    if (hasSibilant || Math.random() < 0.4) {
      const buf  = audioCtx.createBuffer(1, audioCtx.sampleRate * 0.5, audioCtx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

      const ns    = audioCtx.createBufferSource();
      ns.buffer   = buf;
      ns.loop     = true;

      const bp    = audioCtx.createBiquadFilter();
      bp.type     = 'bandpass';
      bp.frequency.value = 3000 + Math.random() * 3000;
      bp.Q.value  = 1.5;

      const ng    = audioCtx.createGain();
      ng.gain.value = 0.06;

      ns.connect(bp); bp.connect(ng); ng.connect(analyser);
      ns.start();
      oscGroup.push({ osc: ns, gain: ng });
    }

    modulateVoice(text);
  }

  function modulateVoice(text) {
    if (!oscGroup.length || !audioCtx) return;
    const duration = Math.max(2, (text?.length || 0) * 0.06);
    const baseF = oscGroup[0]?.osc?.frequency?.value || 130;

    for (let i = 0; i < Math.min(3, oscGroup.length); i++) {
      const freq = oscGroup[i].osc.frequency;
      if (!freq) continue;
      const h = i + 1;
      for (let step = 0; step < duration; step += 0.15) {
        const vib   = Math.sin(step * 5.5 * Math.PI * 2) * 6;
        const drift = (Math.random() - 0.5) * 18;
        freq.linearRampToValueAtTime(
          baseF * h + vib + drift,
          audioCtx.currentTime + step
        );
      }
    }
  }

  function stopOscillators() {
    oscGroup.forEach(({ osc }) => { try { osc.stop(); } catch (_) {} });
    oscGroup = [];
    isSpeaking = false;
  }

  /* ── Frequency visualizer draw loop ── */
  function drawFreq() {
    requestAnimationFrame(drawFreq);

    const dw = fW, dh = fH;
    fCtx.clearRect(0, 0, dw, dh);

    if (!analyser || !freqData) {
      updateVoiceMetrics();
      drawVoiceOrb();
      drawFlatLine(dw, dh);
      return;
    }

    analyser.getByteFrequencyData(freqData);
    updateVoiceMetrics();
    drawVoiceOrb();

    const numBins = 96;
    const binStep = Math.max(1, Math.floor(analyser.frequencyBinCount * 0.42 / numBins));
    const centerY = dh * 0.62;
    const maxAmp  = dh * 0.62;

    /* Build smooth-curve points */
    const pts = [];
    for (let i = 0; i < numBins; i++) {
      const idx = i * binStep;
      const raw = freqData[idx] / 255;
      const shimmer = isSpeaking ? Math.sin(performance.now() * 0.006 + i * 0.55) * 0.055 : 0;
      const val = Math.min(1, raw * 1.15 + shimmer);
      pts.push({
        x: (i / (numBins - 1)) * dw,
        y: centerY - val * maxAmp
      });
    }

    /* Upper fill */
    const grad = fCtx.createLinearGradient(0, centerY - maxAmp, 0, centerY);
    const hot = isSpeaking || voiceLevel > 0.04;
    grad.addColorStop(0, hot ? 'rgba(255,185,74,0.72)' : 'rgba(77,157,224,0.55)');
    grad.addColorStop(0.6, hot ? 'rgba(245,154,61,0.22)' : 'rgba(77,157,224,0.15)');
    grad.addColorStop(1, 'rgba(77,157,224,0)');

    drawSmoothArea(pts, centerY, grad, false);

    /* Mirror fill (reflection below center) */
    const reflGrad = fCtx.createLinearGradient(0, centerY, 0, centerY + maxAmp * 0.35);
    reflGrad.addColorStop(0, hot ? 'rgba(245,154,61,0.16)' : 'rgba(77,157,224,0.12)');
    reflGrad.addColorStop(1, 'rgba(77,157,224,0)');

    const reflPts = pts.map(p => ({ x: p.x, y: centerY + (centerY - p.y) * 0.3 }));
    drawSmoothArea(reflPts, centerY, reflGrad, true);

    /* Center line */
    fCtx.beginPath();
    fCtx.moveTo(0, centerY);
    fCtx.lineTo(dw, centerY);
    fCtx.strokeStyle = hot ? 'rgba(255,185,74,0.16)' : 'rgba(255,255,255,0.04)';
    fCtx.lineWidth = 1;
    fCtx.stroke();

    /* Edge fade */
    const fadeL = fCtx.createLinearGradient(0, 0, dw * 0.1, 0);
    fadeL.addColorStop(0, 'rgba(4,4,4,1)');
    fadeL.addColorStop(1, 'rgba(4,4,4,0)');
    fCtx.fillStyle = fadeL;
    fCtx.fillRect(0, 0, dw * 0.1, dh);

    const fadeR = fCtx.createLinearGradient(dw * 0.9, 0, dw, 0);
    fadeR.addColorStop(0, 'rgba(4,4,4,0)');
    fadeR.addColorStop(1, 'rgba(4,4,4,1)');
    fCtx.fillStyle = fadeR;
    fCtx.fillRect(dw * 0.9, 0, dw * 0.1, dh);
  }


  function updateVoiceMetrics() {
    if (!freqData?.length) {
      voiceLevel *= 0.88;
      spectralCentroid *= 0.9;
      return;
    }

    let sum = 0;
    let weighted = 0;
    const limit = Math.floor(freqData.length * 0.46);
    for (let i = 1; i < limit; i++) {
      const v = freqData[i] / 255;
      sum += v;
      weighted += v * (i / limit);
    }

    const analyserTarget = Math.min(1, (sum / limit) * 8.5);
    const speechPulse = 0.48 + Math.sin(performance.now() * 0.008) * 0.16;
    const target = isSpeaking ? Math.max(analyserTarget, speechPulse) : analyserTarget;
    voiceLevel += (target - voiceLevel) * (isSpeaking ? 0.36 : 0.08);
    spectralCentroid += ((sum ? weighted / sum : 0) - spectralCentroid) * 0.18;

    document.documentElement.style.setProperty('--voice-level', voiceLevel.toFixed(3));
    document.documentElement.style.setProperty('--voice-frequency', spectralCentroid.toFixed(3));
  }

  function drawVoiceOrb() {
    if (!oCtx || !oW || !oH) return;

    const t = performance.now();
    const cx = oW / 2;
    const cy = oH / 2;
    const radius = Math.min(oW, oH) * 0.34;
    const level = Math.max(voiceLevel, isSpeaking ? 0.42 : 0);

    oCtx.clearRect(0, 0, oW, oH);

    const aura = oCtx.createRadialGradient(cx, cy, radius * 0.08, cx, cy, radius * (1.45 + level));
    aura.addColorStop(0, `rgba(255,220,126,${0.20 + level * 0.25})`);
    aura.addColorStop(0.28, `rgba(245,154,61,${0.11 + level * 0.18})`);
    aura.addColorStop(1, 'rgba(245,154,61,0)');
    oCtx.fillStyle = aura;
    oCtx.beginPath();
    oCtx.arc(cx, cy, radius * (1.5 + level * 0.6), 0, Math.PI * 2);
    oCtx.fill();

    drawOrbRays(cx, cy, radius, level, t);
    drawOrbParticles(cx, cy, radius, level, t);
    drawOrbWaveform(cx, cy, radius, level, t);
  }

  function drawOrbRays(cx, cy, radius, level, t) {
    const rays = 42;
    oCtx.save();
    oCtx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < rays; i++) {
      const a = (i / rays) * Math.PI * 2 + t * 0.00018;
      const bin = freqData ? freqData[(i * 11) % freqData.length] / 255 : 0;
      const length = radius * (0.42 + bin * 0.74 + level * 0.32);
      const inner = radius * (0.46 + Math.sin(t * 0.002 + i) * 0.03);
      oCtx.strokeStyle = `rgba(255,184,76,${0.04 + bin * 0.32 + level * 0.12})`;
      oCtx.lineWidth = 0.7 + bin * 1.5;
      oCtx.beginPath();
      oCtx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
      oCtx.lineTo(cx + Math.cos(a) * (inner + length), cy + Math.sin(a) * (inner + length));
      oCtx.stroke();
    }
    oCtx.restore();
  }

  function drawOrbParticles(cx, cy, radius, level, t) {
    oCtx.save();
    oCtx.globalCompositeOperation = 'lighter';
    for (const p of orbParticles) {
      p.a += p.s * (0.35 + level * 2.2);
      const wobble = Math.sin(t * 0.0025 + p.p) * radius * 0.035;
      const pulse = 1 + level * 0.34 + Math.sin(t * 0.004 + p.p) * 0.035;
      const x = cx + Math.cos(p.a) * (radius * p.r * pulse + wobble);
      const y = cy + Math.sin(p.a) * (radius * p.r * pulse - wobble);
      const alpha = 0.12 + level * 0.48 * p.z;
      oCtx.fillStyle = `rgba(255,211,126,${alpha})`;
      oCtx.beginPath();
      oCtx.arc(x, y, 0.7 + p.z * 1.2 + level * 1.4, 0, Math.PI * 2);
      oCtx.fill();
    }
    oCtx.restore();
  }

  function drawOrbWaveform(cx, cy, radius, level, t) {
    const points = 180;
    oCtx.save();
    oCtx.globalCompositeOperation = 'lighter';
    oCtx.beginPath();
    for (let i = 0; i <= points; i++) {
      const a = (i / points) * Math.PI * 2;
      const bin = freqData ? freqData[(i * 7) % freqData.length] / 255 : 0;
      const noise = Math.sin(a * 8 + t * 0.004) * 0.025 + Math.sin(a * 17 - t * 0.002) * 0.015;
      const r = radius * (0.76 + bin * 0.24 + level * 0.18 + noise);
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (i === 0) oCtx.moveTo(x, y);
      else oCtx.lineTo(x, y);
    }
    oCtx.closePath();
    oCtx.strokeStyle = `rgba(255,202,106,${0.18 + level * 0.48})`;
    oCtx.lineWidth = 1 + level * 2.4;
    oCtx.shadowColor = 'rgba(255,176,66,0.7)';
    oCtx.shadowBlur = 10 + level * 18;
    oCtx.stroke();
    oCtx.restore();
  }

  function drawSmoothArea(pts, baseY, fillStyle, mirrored) {
    if (pts.length < 2) return;

    fCtx.beginPath();
    fCtx.moveTo(pts[0].x, baseY);
    fCtx.lineTo(pts[0].x, pts[0].y);

    for (let i = 0; i < pts.length - 1; i++) {
      const cx = (pts[i].x + pts[i+1].x) / 2;
      const cy = (pts[i].y + pts[i+1].y) / 2;
      fCtx.quadraticCurveTo(pts[i].x, pts[i].y, cx, cy);
    }

    const last = pts[pts.length - 1];
    fCtx.lineTo(last.x, last.y);
    fCtx.lineTo(last.x, baseY);
    fCtx.closePath();

    fCtx.fillStyle = fillStyle;
    fCtx.fill();
  }

  function drawFlatLine(dw, dh) {
    const cy = dh * 0.62;
    fCtx.beginPath();
    fCtx.moveTo(0, cy);
    /* Tiny noise */
    for (let x = 0; x <= dw; x += 4) {
      fCtx.lineTo(x, cy + (Math.random() - 0.5) * 2);
    }
    fCtx.strokeStyle = 'rgba(255,255,255,0.04)';
    fCtx.lineWidth = 1;
    fCtx.stroke();
  }

  drawFreq();

  /* ── Speech Synthesis ── */
  const synth = window.speechSynthesis;
  let voices  = [];

  function loadVoices() {
    voices = synth?.getVoices() || [];
  }

  if (synth) {
    loadVoices();
    synth.onvoiceschanged = loadVoices;
  }

  function pickVoice(lang) {
    const pref = voices.find(v =>
      (v.lang.includes(lang) || v.lang.includes('en')) &&
      (v.name.includes('Male') || v.name.includes('David') || v.name.includes('Mark') || v.name.includes('Google'))
    );
    return pref || voices.find(v => v.lang.includes('en')) || null;
  }

  /* ── Speech Recognition ── */
  let recog = null;
  const SR  = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SR) {
    recog = new SR();
    recog.continuous      = false;
    recog.interimResults  = true;
    recog.lang            = 'pt-BR';
  }

  /* ── Public API ── */
  window.JARVIS_VOICE = {
    speak(text, onDone) {
      initAudio();
      document.body.classList.add('jarvis-speaking');
      voiceLevel = Math.max(voiceLevel, 0.5);
      buildVoice(text);
      isSpeaking = true;

      if (!synth) {
        setTimeout(() => {
          stopOscillators();
          document.body.classList.remove('jarvis-speaking');
          onDone?.();
        }, text.length * 60);
        return;
      }

      synth.cancel();
      const utt     = new SpeechSynthesisUtterance(text);
      utt.rate      = 0.88;
      utt.pitch     = 0.80;
      utt.volume    = 0.9;
      const v       = pickVoice('pt');
      if (v) utt.voice = v;

      let pulseTimer = null;

      utt.onstart = () => {
        pulseTimer = setInterval(() => {
          if (!isSpeaking) { clearInterval(pulseTimer); return; }
          window.JARVIS_BG?.pulse(0.5 + Math.random() * 0.4);
        }, 180);
      };

      utt.onboundary = e => {
        if (e.name === 'word') {
          const prog = (e.charIndex || 0) / (text.length || 1);
          const freq = 90 + prog * 260;
          const el   = document.getElementById('sr-freq');
          if (el) el.textContent = Math.round(freq) + ' Hz';
          window.JARVIS_BG?.pulse(0.6);
        }
      };

      utt.onend = () => {
        clearInterval(pulseTimer);
        stopOscillators();
        window.JARVIS_BG?.stop();
        document.body.classList.remove('jarvis-speaking');
        const el = document.getElementById('sr-freq');
        if (el) el.textContent = '— Hz';
        onDone?.();
      };

      utt.onerror = () => {
        clearInterval(pulseTimer);
        stopOscillators();
        window.JARVIS_BG?.stop();
        document.body.classList.remove('jarvis-speaking');
        onDone?.();
      };

      synth.speak(utt);
    },

    listen(onResult, onEnd) {
      if (!recog) { onEnd?.(null); return; }
      initAudio();

      recog.onresult = e => {
        const transcript = Array.from(e.results)
          .map(r => r[0].transcript).join('');
        const isFinal = e.results[e.results.length - 1].isFinal;
        onResult?.(transcript, isFinal);
      };

      recog.onend   = () => { document.body.classList.remove('jarvis-listening'); onEnd?.(); };
      recog.onerror = () => { document.body.classList.remove('jarvis-listening'); onEnd?.(null); };

      document.body.classList.add('jarvis-listening');
      try { recog.start(); }
      catch (_) { document.body.classList.remove('jarvis-listening'); onEnd?.(null); }
    },

    stopListening() {
      try { recog?.stop(); } catch (_) {}
      document.body.classList.remove('jarvis-listening');
    },

    hasRecognition: !!SR,
    hasSpeech:      !!synth
  };
})();
