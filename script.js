(function () {
  'use strict';

  // Audio Context & Nodes Setup
  let audioCtx = null;
  let masterGain = null;
  let isPlaying = false;

  // Generator Audio Nodes State
  const generators = {
    drone: { active: false, gain: null, osc1: null, osc2: null, filter: null, vol: 0.5, param1: 800 },
    rain: { active: false, gain: null, source: null, filter: null, vol: 0.4, param1: 2000 },
    wind: { active: false, gain: null, source: null, filter: null, lfo: null, lfoGain: null, vol: 0.3, param1: 0.2 },
    chime: { active: false, gain: null, timer: null, vol: 0.5, param1: 3 }
  };

  // Canvas & Visualizer State
  const canvas = document.getElementById('flowCanvas');
  const ctx = canvas ? canvas.getContext('2d') : null;
  let particles = [];
  let animationFrameId = null;
  let canvasWidth = 0;
  let canvasHeight = 0;

  // Timer State
  let timerInterval = null;
  let timerSecondsLeft = 25 * 60;
  let timerRunning = false;

  function initAudio() {
    if (audioCtx) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioContext();

    masterGain = audioCtx.createGain();
    masterGain.gain.value = parseFloat(document.getElementById('masterVolume').value);
    masterGain.connect(audioCtx.destination);

    initDroneNodes();
    initRainNodes();
    initWindNodes();
  }

  // --- Generator 1: Cosmic Drone (Dual detuned saw/sine oscillators through lowpass filter) ---
  function initDroneNodes() {
    const g = generators.drone;
    g.gain = audioCtx.createGain();
    g.gain.gain.value = g.vol;

    g.filter = audioCtx.createBiquadFilter();
    g.filter.type = 'lowpass';
    g.filter.frequency.value = g.param1;
    g.filter.Q.value = 4;

    g.filter.connect(g.gain);
    g.gain.connect(masterGain);
  }

  function startDrone() {
    const g = generators.drone;
    if (g.osc1) return;

    g.osc1 = audioCtx.createOscillator();
    g.osc2 = audioCtx.createOscillator();

    // Gentle fifth chord in Hz (C3 and G3)
    g.osc1.type = 'sine';
    g.osc1.frequency.value = 130.81; // C3
    g.osc2.type = 'triangle';
    g.osc2.frequency.value = 196.00; // G3

    g.osc1.connect(g.filter);
    g.osc2.connect(g.filter);

    g.osc1.start();
    g.osc2.start();
  }

  function stopDrone() {
    const g = generators.drone;
    if (g.osc1) {
      try { g.osc1.stop(); g.osc2.stop(); } catch (e) {}
      g.osc1.disconnect();
      g.osc2.disconnect();
      g.osc1 = null;
      g.osc2 = null;
    }
  }

  // --- Generator 2: Velvet Rain (Pink noise filtered) ---
  function initRainNodes() {
    const g = generators.rain;
    g.gain = audioCtx.createGain();
    g.gain.gain.value = g.vol;

    g.filter = audioCtx.createBiquadFilter();
    g.filter.type = 'bandpass';
    g.filter.frequency.value = g.param1;
    g.filter.Q.value = 1.0;

    // Create procedural pink noise buffer
    const bufferSize = audioCtx.sampleRate * 2;
    const noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      output[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
      output[i] *= 0.11;
      b6 = white * 0.115926;
    }

    g.source = audioCtx.createBufferSource();
    g.source.buffer = noiseBuffer;
    g.source.loop = true;

    g.source.connect(g.filter);
    g.filter.connect(g.gain);
    g.gain.connect(masterGain);
    g.source.start();
  }

  // --- Generator 3: Solar Wind (Modulated noise) ---
  function initWindNodes() {
    const g = generators.wind;
    g.gain = audioCtx.createGain();
    g.gain.gain.value = g.vol;

    g.filter = audioCtx.createBiquadFilter();
    g.filter.type = 'lowpass';
    g.filter.frequency.value = 400;
    g.filter.Q.value = 6;

    // White noise source for wind
    const bufferSize = audioCtx.sampleRate * 2;
    const noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }

    g.source = audioCtx.createBufferSource();
    g.source.buffer = noiseBuffer;
    g.source.loop = true;

    // LFO to sweep filter frequency
    g.lfo = audioCtx.createOscillator();
    g.lfo.frequency.value = g.param1;
    g.lfoGain = audioCtx.createGain();
    g.lfoGain.gain.value = 300;

    g.lfo.connect(g.lfoGain);
    g.lfoGain.connect(g.filter.frequency);

    g.source.connect(g.filter);
    g.filter.connect(g.gain);
    g.gain.connect(masterGain);

    g.source.start();
    g.lfo.start();
  }

  // --- Generator 4: Crystal Chimes (Procedural interval notes) ---
  const pentatonicScale = [261.63, 293.66, 329.63, 392.00, 440.00, 523.25, 587.33, 659.25, 783.99, 880.00];

  function triggerChime() {
    if (!isPlaying || !generators.chime.active) return;
    const g = generators.chime;

    const osc = audioCtx.createOscillator();
    const chimeGain = audioCtx.createGain();

    const freq = pentatonicScale[Math.floor(Math.random() * pentatonicScale.length)];
    osc.type = 'sine';
    osc.frequency.value = freq;

    const now = audioCtx.currentTime;
    chimeGain.gain.setValueAtTime(0, now);
    chimeGain.gain.linearRampToValueAtTime(g.vol * 0.3, now + 0.1);
    chimeGain.gain.exponentialRampToValueAtTime(0.0001, now + 3.0);

    osc.connect(chimeGain);
    chimeGain.connect(masterGain);

    osc.start(now);
    osc.stop(now + 3.1);
  }

  function updateChimeInterval() {
    const g = generators.chime;
    if (g.timer) clearInterval(g.timer);
    if (g.active && isPlaying) {
      const intervalMs = (10 / g.param1) * 1000;
      g.timer = setInterval(triggerChime, intervalMs);
    }
  }

  // --- Visualizer Particle Flow Field ---
  class Particle {
    constructor() {
      this.reset();
    }
    reset() {
      this.x = Math.random() * canvasWidth;
      this.y = Math.random() * canvasHeight;
      this.vx = 0;
      this.vy = 0;
      this.maxSpeed = Math.random() * 1.5 + 0.5;
      this.size = Math.random() * 2 + 1;
      this.alpha = Math.random() * 0.5 + 0.2;
      this.color = Math.random() > 0.5 ? '#38bdf8' : '#818cf8';
    }
    update(time, energy) {
      // Simplex-like flow using trigonometric noise
      const angle = Math.cos(this.x * 0.005 + time * 0.5) + Math.sin(this.y * 0.005 + time * 0.3);
      this.vx += Math.cos(angle) * 0.1;
      this.vy += Math.sin(angle) * 0.1;

      // Apply energy boost when audio is playing
      const speedMultiplier = 1 + (energy * 2);
      this.vx *= 0.95;
      this.vy *= 0.95;

      this.x += this.vx * speedMultiplier;
      this.y += this.vy * speedMultiplier;

      if (this.x < 0 || this.x > canvasWidth || this.y < 0 || this.y > canvasHeight) {
        this.reset();
      }
    }
    draw() {
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
      ctx.fillStyle = this.color;
      ctx.globalAlpha = this.alpha;
      ctx.fill();
      ctx.globalAlpha = 1.0;
    }
  }

  function initCanvas() {
    if (!canvas) return;
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    particles = [];
    const count = Math.floor((canvasWidth * canvasHeight) / 12000);
    for (let i = 0; i < Math.max(40, Math.min(count, 150)); i++) {
      particles.push(new Particle());
    }
  }

  function resizeCanvas() {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    canvasWidth = rect.width;
    canvasHeight = rect.height;
    canvas.width = canvasWidth * window.devicePixelRatio;
    canvas.height = canvasHeight * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
  }

  function renderVisualizer(time) {
    if (!ctx) return;
    ctx.fillStyle = 'rgba(11, 15, 25, 0.2)';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    let activeCount = 0;
    if (isPlaying) {
      if (generators.drone.active) activeCount++;
      if (generators.rain.active) activeCount++;
      if (generators.wind.active) activeCount++;
      if (generators.chime.active) activeCount++;
    }
    const energy = activeCount * 0.25;

    particles.forEach(p => {
      p.update(time * 0.001, energy);
      p.draw();
    });

    animationFrameId = requestAnimationFrame(renderVisualizer);
  }

  // --- Event Listeners & UI Binding ---
  function setupUI() {
    const masterPlayBtn = document.getElementById('masterPlayBtn');
    const playBtnText = document.getElementById('playBtnText');
    const masterVolume = document.getElementById('masterVolume');

    masterPlayBtn.addEventListener('click', () => {
      initAudio();
      if (audioCtx.state === 'suspended') {
        audioCtx.resume();
      }
      isPlaying = !isPlaying;
      if (isPlaying) {
        masterPlayBtn.classList.add('active');
        playBtnText.textContent = 'Pause Journey';
      } else {
        masterPlayBtn.classList.remove('active');
        playBtnText.textContent = 'Start Journey';
        stopDrone();
      }
      updateGeneratorAudioStates();
    });

    masterVolume.addEventListener('input', (e) => {
      if (masterGain) {
        masterGain.gain.value = parseFloat(e.target.value);
      }
    });

    // Setup Generator Toggles and Sliders
    setupGeneratorControl('drone', (active) => {
      if (active && isPlaying) startDrone();
      else stopDrone();
    }, (vol) => {
      generators.drone.vol = vol;
      if (generators.drone.gain) generators.drone.gain.gain.value = vol;
    }, (val) => {
      generators.drone.param1 = val;
      if (generators.drone.filter) generators.drone.filter.frequency.value = val;
    });

    setupGeneratorControl('rain', (active) => {
      if (generators.rain.gain) {
        generators.rain.gain.gain.value = active && isPlaying ? generators.rain.vol : 0;
      }
    }, (vol) => {
      generators.rain.vol = vol;
      if (generators.rain.gain && generators.rain.active) generators.rain.gain.gain.value = vol;
    }, (val) => {
      generators.rain.param1 = val;
      if (generators.rain.filter) generators.rain.filter.frequency.value = val;
    });

    setupGeneratorControl('wind', (active) => {
      if (generators.wind.gain) {
        generators.wind.gain.gain.value = active && isPlaying ? generators.wind.vol : 0;
      }
    }, (vol) => {
      generators.wind.vol = vol;
      if (generators.wind.gain && generators.wind.active) generators.wind.gain.gain.value = vol;
    }, (val) => {
      generators.wind.param1 = val;
      if (generators.wind.lfo) generators.wind.lfo.frequency.value = val;
    });

    setupGeneratorControl('chime', (active) => {
      generators.chime.active = active;
      updateChimeInterval();
    }, (vol) => {
      generators.chime.vol = vol;
    }, (val) => {
      generators.chime.param1 = val;
      updateChimeInterval();
    });

    // Presets
    document.querySelectorAll('.btn-preset').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.btn-preset').forEach(b => b.classList.remove('active'));
        const preset = e.target.getAttribute('data-preset');
        if (preset !== 'clear') {
          e.target.classList.add('active');
        }
        applyPreset(preset);
      });
    });

    // Timer Widget
    setupTimer();
  }

  function setupGeneratorControl(name, onToggle, onVol, onParam) {
    const checkbox = document.getElementById(`gen-${name}-active`);
    const volSlider = document.getElementById(`gen-${name}-vol`);
    const paramSlider = document.getElementById(`gen-${name}-filter`) || 
                          document.getElementById(`gen-${name}-tone`) || 
                          document.getElementById(`gen-${name}-speed`) || 
                          document.getElementById(`gen-${name}-rate`);

    checkbox.addEventListener('change', (e) => {
      generators[name].active = e.target.checked;
      onToggle(e.target.checked);
    });

    volSlider.addEventListener('input', (e) => {
      onVol(parseFloat(e.target.value));
    });

    if (paramSlider) {
      paramSlider.addEventListener('input', (e) => {
        onParam(parseFloat(e.target.value));
      });
    }
  }

  function updateGeneratorAudioStates() {
    // Drone
    if (generators.drone.active && isPlaying) startDrone();
    else stopDrone();

    // Rain
    if (generators.rain.gain) {
      generators.rain.gain.gain.value = generators.rain.active && isPlaying ? generators.rain.vol : 0;
    }
    // Wind
    if (generators.wind.gain) {
      generators.wind.gain.gain.value = generators.wind.active && isPlaying ? generators.wind.vol : 0;
    }
    // Chimes
    updateChimeInterval();
  }

  function applyPreset(presetName) {
    const stateMap = {
      focus: { drone: true, rain: false, wind: true, chime: false, droneVol: 0.6, windVol: 0.2 },
      sleep: { drone: true, rain: true, wind: false, chime: true, droneVol: 0.4, rainVol: 0.5, chimeVol: 0.3, chimeRate: 2 },
      rain: { drone: false, rain: true, wind: true, chime: false, rainVol: 0.6, windVol: 0.2 },
      cafe: { drone: false, rain: true, wind: false, chime: true, rainVol: 0.3, chimeVol: 0.4, chimeRate: 5 },
      clear: { drone: false, rain: false, wind: false, chime: false }
    };

    const config = stateMap[presetName] || stateMap.clear;
    ['drone', 'rain', 'wind', 'chime'].forEach(gen => {
      const active = !!config[gen];
      generators[gen].active = active;
      const chk = document.getElementById(`gen-${gen}-active`);
      if (chk) chk.checked = active;

      if (config[`${gen}Vol`] !== undefined) {
        generators[gen].vol = config[`${gen}Vol`];
        const volEl = document.getElementById(`gen-${gen}-vol`);
        if (volEl) volEl.value = config[`${gen}Vol`];
      }
      if (config[`${gen}Rate`] !== undefined) {
        generators[gen].param1 = config[`${gen}Rate`];
        const rateEl = document.getElementById(`gen-${gen}-rate`);
        if (rateEl) rateEl.value = config[`${gen}Rate`];
      }
    });

    updateGeneratorAudioStates();
  }

  function setupTimer() {
    const display = document.getElementById('timerDisplay');
    const toggleBtn = document.getElementById('timerToggle');
    const resetBtn = document.getElementById('timerReset');

    function updateDisplay() {
      const mins = Math.floor(timerSecondsLeft / 60);
      const secs = timerSecondsLeft % 60;
      display.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }

    toggleBtn.addEventListener('click', () => {
      timerRunning = !timerRunning;
      if (timerRunning) {
        toggleBtn.textContent = 'Pause';
        timerInterval = setInterval(() => {
          if (timerSecondsLeft > 0) {
            timerSecondsLeft--;
            updateDisplay();
          } else {
            timerRunning = false;
            clearInterval(timerInterval);
            toggleBtn.textContent = 'Start Timer';
          }
        }, 1000);
      } else {
        toggleBtn.textContent = 'Resume';
        clearInterval(timerInterval);
      }
    });

    resetBtn.addEventListener('click', () => {
      timerRunning = false;
      clearInterval(timerInterval);
      timerSecondsLeft = 25 * 60;
      updateDisplay();
      toggleBtn.textContent = 'Start Timer';
    });

    updateDisplay();
  }

  // Initialize on load
  window.addEventListener('DOMContentLoaded', () => {
    initCanvas();
    setupUI();
    animationFrameId = requestAnimationFrame(renderVisualizer);
  });

})();
