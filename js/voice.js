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
  if (!freqCanvas) return;

  const fCtx = freqCanvas.getContext('2d');
  let fW, fH;

  function resizeFreq() {
    const dpr = window.devicePixelRatio || 1;
    fW = freqCanvas.offsetWidth;
    fH = freqCanvas.offsetHeight;
    freqCanvas.width  = fW * dpr;
    freqCanvas.height = fH * dpr;
    fCtx.scale(dpr, dpr);
  }

  const freqObserver = new ResizeObserver(resizeFreq);
  freqObserver.observe(freqCanvas);
  resizeFreq();

  /* ── Audio context (lazy init on first interaction) ── */
  let audioCtx   = null;
  let analyser   = null;
  let freqData   = null;
  let oscGroup   = [];
  let isSpeaking = false;

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
      drawFlatLine(dw, dh);
      return;
    }

    analyser.getByteFrequencyData(freqData);

    const numBins = 80;
    const binStep = Math.floor(analyser.frequencyBinCount * 0.35 / numBins);
    const centerY = dh * 0.62;
    const maxAmp  = dh * 0.55;

    /* Build smooth-curve points */
    const pts = [];
    for (let i = 0; i < numBins; i++) {
      const idx = i * binStep;
      const val = freqData[idx] / 255;
      pts.push({
        x: (i / (numBins - 1)) * dw,
        y: centerY - val * maxAmp
      });
    }

    /* Upper fill */
    const grad = fCtx.createLinearGradient(0, centerY - maxAmp, 0, centerY);
    grad.addColorStop(0, 'rgba(77,157,224,0.55)');
    grad.addColorStop(0.6, 'rgba(77,157,224,0.15)');
    grad.addColorStop(1, 'rgba(77,157,224,0)');

    drawSmoothArea(pts, centerY, grad, false);

    /* Mirror fill (reflection below center) */
    const reflGrad = fCtx.createLinearGradient(0, centerY, 0, centerY + maxAmp * 0.35);
    reflGrad.addColorStop(0, 'rgba(77,157,224,0.12)');
    reflGrad.addColorStop(1, 'rgba(77,157,224,0)');

    const reflPts = pts.map(p => ({ x: p.x, y: centerY + (centerY - p.y) * 0.3 }));
    drawSmoothArea(reflPts, centerY, reflGrad, true);

    /* Center line */
    fCtx.beginPath();
    fCtx.moveTo(0, centerY);
    fCtx.lineTo(dw, centerY);
    fCtx.strokeStyle = 'rgba(255,255,255,0.04)';
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
      buildVoice(text);
      isSpeaking = true;

      if (!synth) {
        setTimeout(() => { stopOscillators(); onDone?.(); }, text.length * 60);
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

      document.body.classList.add('jarvis-speaking');
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
