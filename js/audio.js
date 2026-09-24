'use strict';
/* 梦潮：回声航线 — WebAudio: four-layer procedural music (环境/节奏/紧张/演奏) and synthesized SFX */

const Sound = (() => {
  let ctx = null, master, comp, musicBus, sfxBus, musicFilter, lfo, lfoGain, delay, delayFb, delayWet, revIn, noiseBuf;
  const layer = {}, level = { ambient: 0, rhythm: 0, tension: 0, perf: 0 };
  const cfg = { music: 0.7, sfx: 0.8, muted: false };
  let mode = 'silent', bpm = 92, step = 0, bar = 0, nextTime = 0, timer = null;
  let prog = 'dream', boost = { tension: 0, perf: 0 }, mods = {}, reverse = false;
  const throttle = {};
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

  const PROGS = {
    dream: [
      { root: 43, notes: [55, 59, 62, 66] }, // Gmaj7
      { root: 45, notes: [57, 61, 64, 66] }, // A6
      { root: 42, notes: [54, 57, 61, 64] }, // F#m7
      { root: 47, notes: [59, 62, 66, 69] }, // Bm7
    ],
    clock: [
      { root: 47, notes: [59, 62, 66, 71] }, // Bm
      { root: 43, notes: [55, 59, 62, 67] }, // G
      { root: 40, notes: [52, 55, 59, 64] }, // Em
      { root: 42, notes: [54, 58, 61, 66] }, // F# (harmonic minor lift)
    ],
  };
  // music-box motif, D major pentatonic, 16 steps per bar (null = rest)
  const MOTIF = [
    [74, null, 78, null, 81, null, 78, 76, null, null, 74, null, 71, null, null, null],
    [73, null, 76, null, 78, null, 81, null, 83, null, 81, 78, null, null, null, null],
    [78, null, 76, null, 73, null, 76, 78, null, null, 81, null, 78, null, 76, null],
    [74, null, 71, null, 74, null, 78, null, 76, null, null, null, 74, null, null, null],
  ];

  const MODES = {
    silent: { ambient: 0, rhythm: 0, tension: 0, perf: 0, bpm: 92, prog: 'dream' },
    title: { ambient: 0.55, rhythm: 0, tension: 0, perf: 0.32, bpm: 84, prog: 'dream' },
    hub: { ambient: 0.5, rhythm: 0, tension: 0, perf: 0.22, bpm: 84, prog: 'dream' },
    map: { ambient: 0.5, rhythm: 0.12, tension: 0, perf: 0.14, bpm: 88, prog: 'dream' },
    combat: { ambient: 0.32, rhythm: 0.55, tension: 0, perf: 0, bpm: 100, prog: 'dream' },
    elite: { ambient: 0.3, rhythm: 0.6, tension: 0.32, perf: 0, bpm: 106, prog: 'clock' },
    boss1: { ambient: 0.3, rhythm: 0.62, tension: 0.42, perf: 0, bpm: 108, prog: 'clock' },
    boss2: { ambient: 0.26, rhythm: 0.7, tension: 0.55, perf: 0, bpm: 118, prog: 'clock' },
    boss3: { ambient: 0.4, rhythm: 0.55, tension: 0.45, perf: 0.12, bpm: 100, prog: 'clock', reverse: true },
    result: { ambient: 0.5, rhythm: 0, tension: 0, perf: 0.38, bpm: 80, prog: 'dream' },
  };

  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { ctx = new AC(); } catch (e) { ctx = null; return; }
    master = ctx.createGain();
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
    master.connect(comp); comp.connect(ctx.destination);
    musicBus = ctx.createGain(); sfxBus = ctx.createGain();
    musicFilter = ctx.createBiquadFilter(); musicFilter.type = 'lowpass'; musicFilter.frequency.value = 12000; musicFilter.Q.value = 0.5;
    musicFilter.connect(musicBus); musicBus.connect(master); sfxBus.connect(master);
    // slow LFO on the music filter (the 潮汐 card deepens it)
    lfo = ctx.createOscillator(); lfo.frequency.value = 0.18; lfoGain = ctx.createGain(); lfoGain.gain.value = 0;
    lfo.connect(lfoGain); lfoGain.connect(musicFilter.frequency); lfo.start();
    // reverb
    const conv = ctx.createConvolver(); conv.buffer = impulse(2.6, 2.4);
    revIn = ctx.createGain(); revIn.gain.value = 0.35; revIn.connect(conv); conv.connect(master);
    // echo delay on music
    delay = ctx.createDelay(1.2); delay.delayTime.value = 0.375;
    delayFb = ctx.createGain(); delayFb.gain.value = 0.3;
    delayWet = ctx.createGain(); delayWet.gain.value = 0.14;
    delay.connect(delayFb); delayFb.connect(delay); delay.connect(delayWet); delayWet.connect(musicFilter);
    for (const k of ['ambient', 'rhythm', 'tension', 'perf']) {
      layer[k] = ctx.createGain(); layer[k].gain.value = 0; layer[k].connect(musicFilter);
    }
    layer.perf.connect(delay); layer.tension.connect(delay);
    layer.ambient.connect(revIn); layer.perf.connect(revIn); sfxBus.connect(revIn);
    // noise
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    applyVolumes();
    nextTime = ctx.currentTime + 0.1;
    timer = setInterval(schedule, 25);
    document.addEventListener('visibilitychange', () => { if (!ctx) return; if (document.hidden) ctx.suspend(); else ctx.resume(); });
    setMode(mode, true);
  }

  function impulse(sec, decay) {
    const len = Math.floor(ctx.sampleRate * sec), buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = buf.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay); }
    return buf;
  }

  function applyVolumes() {
    if (!ctx) return;
    const t = ctx.currentTime;
    master.gain.setTargetAtTime(cfg.muted ? 0 : 0.9, t, 0.05);
    musicBus.gain.setTargetAtTime(cfg.music * 0.8, t, 0.1);
    sfxBus.gain.setTargetAtTime(cfg.sfx, t, 0.05);
  }
  function configure(s) { cfg.music = s.music; cfg.sfx = s.sfx; cfg.muted = s.muted; applyVolumes(); }

  function targetLevel(k) {
    const base = level[k] + (boost[k] || 0);
    let v = base;
    if (k === 'rhythm' && mods.quiet) v *= 0.6;
    if (k === 'tension' && mods.overheat && base > 0) v += 0.12;
    return clamp(v, 0, 1);
  }
  function refreshLayers() {
    if (!ctx) return;
    const t = ctx.currentTime;
    for (const k in layer) layer[k].gain.setTargetAtTime(targetLevel(k), t, 0.6);
  }

  function setMode(m, force) {
    if (!MODES[m]) return;
    if (m === mode && !force) return;
    mode = m;
    const M = MODES[m];
    Object.assign(level, { ambient: M.ambient, rhythm: M.rhythm, tension: M.tension, perf: M.perf });
    bpm = M.bpm; prog = M.prog; reverse = !!M.reverse;
    refreshLayers();
  }
  function setBoost(k, v) { boost[k] = v; refreshLayers(); }
  function setBpm(v) { bpm = v; }
  // 梦境卡 change at least one music layer each
  function setCardMods(cardIds) {
    mods = {};
    for (const id of cardIds) mods[id] = true;
    if (!ctx) return;
    const t = ctx.currentTime;
    delayWet.gain.setTargetAtTime(mods.echo ? 0.34 : 0.14, t, 0.3);
    delayFb.gain.setTargetAtTime(mods.echo ? 0.46 : 0.3, t, 0.3);
    delay.delayTime.setTargetAtTime(mods.mirror ? 0.5 : 0.375, t, 0.3);
    lfoGain.gain.setTargetAtTime(mods.tide || mods.fallstar ? 2600 : 0, t, 0.3);
    musicFilter.frequency.setTargetAtTime(mods.unfocus ? 1500 : mods.tide || mods.fallstar ? 5200 : 12000, t, 0.3);
    revIn.gain.setTargetAtTime(mods.gentle || mods.paperboat ? 0.5 : 0.35, t, 0.3);
    refreshLayers();
  }

  /* ---------- scheduler ---------- */
  function schedule() {
    if (!ctx || ctx.state !== 'running') return;
    const ahead = ctx.currentTime + 0.14;
    if (nextTime < ctx.currentTime - 0.3) nextTime = ctx.currentTime + 0.02;
    while (nextTime < ahead) {
      playStep(step, nextTime);
      nextTime += 60 / bpm / 4;
      step++;
      if (step % 16 === 0) bar++;
    }
  }
  const on = (k) => targetLevel(k) > 0.02 || (layer[k] && layer[k].gain.value > 0.02);

  function playStep(st, t) {
    const s = st % 16, P = PROGS[prog], chord = P[bar % 4], barDur = (60 / bpm) * 4;
    if (on('ambient') && s === 0) pad(t, chord, barDur * 1.04);
    if (on('rhythm')) {
      if (s === 0 || s === 8 || (bar % 2 === 1 && s === 11)) kick(t);
      if (s % 4 === 2) hat(t, s === 14 ? 0.1 : 0.06);
      if (s === 4 || s === 12) snap(t);
      const bassPat = { 0: 0, 6: 7, 8: 0, 11: 12, 14: 7 };
      if (bassPat[s] !== undefined) bass(t, chord.root + bassPat[s]);
    }
    if (on('tension')) {
      const n = chord.notes[(st >> 0) % chord.notes.length] + 12 + (s >= 8 ? 12 : 0);
      if (s % 2 === 0 || mode === 'boss2') arp(t, n);
      if (s % 4 === 0) tick(t, (s / 4) % 2 === 0);
    }
    if (on('perf')) {
      const m = MOTIF[bar % 4][s];
      if (m) bell(t, m + (prog === 'clock' ? -2 : 0), 0.22);
      if (boost.perf > 0.2 && s % 4 === 2) bell(t, chord.notes[(s / 4 | 0) % 4] + 24, 0.08);
    }
  }

  /* ---------- instruments ---------- */
  function env(g, t, a, peak, dur, rel) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.setTargetAtTime(0.0001, t + Math.max(a, dur - rel), rel / 3);
  }
  function pad(t, chord, dur) {
    const g = ctx.createGain(), f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 1100; f.Q.value = 0.6;
    f.connect(g); g.connect(layer.ambient);
    if (reverse) { // time flows backwards in 终章: swell in, cut off
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16, t + dur * 0.92); g.gain.linearRampToValueAtTime(0.0001, t + dur);
    } else env(g, t, 0.9, 0.12, dur, 1.4);
    for (const n of chord.notes) for (const det of [-7, 7]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(n); o.detune.value = det;
      o.connect(f); o.start(t); o.stop(t + dur + 0.6);
    }
    const sub = ctx.createOscillator(), sg = ctx.createGain(); sub.type = 'sine'; sub.frequency.value = mtof(chord.root);
    env(sg, t, 0.6, 0.16, dur, 1.2); sub.connect(sg); sg.connect(layer.ambient); sub.start(t); sub.stop(t + dur + 0.6);
  }
  function kick(t) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    g.gain.setValueAtTime(0.75, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
    o.connect(g); g.connect(layer.rhythm); o.start(t); o.stop(t + 0.35);
  }
  function hat(t, vol) {
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuf; f.type = 'highpass'; f.frequency.value = 7200;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    s.connect(f); f.connect(g); g.connect(layer.rhythm); s.start(t, Math.random() * 0.5, 0.06);
  }
  function snap(t) {
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuf; f.type = 'bandpass'; f.frequency.value = 1900; f.Q.value = 1.2;
    g.gain.setValueAtTime(0.28, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
    s.connect(f); f.connect(g); g.connect(layer.rhythm); s.start(t, Math.random() * 0.5, 0.15);
  }
  function bass(t, m) {
    const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = 'triangle'; o.frequency.value = mtof(m);
    f.type = 'lowpass'; f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(220, t + 0.3);
    g.gain.setValueAtTime(0.34, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
    o.connect(f); f.connect(g); g.connect(layer.rhythm); o.start(t); o.stop(t + 0.4);
  }
  function arp(t, m) {
    const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = 'square'; o.frequency.value = mtof(m);
    f.type = 'lowpass'; f.frequency.value = 1700;
    g.gain.setValueAtTime(0.07, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
    o.connect(f); f.connect(g); g.connect(layer.tension); o.start(t); o.stop(t + 0.15);
  }
  function tick(t, hi) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = hi ? 2600 : 1900;
    g.gain.setValueAtTime(0.16, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
    o.connect(g); g.connect(layer.tension); o.start(t); o.stop(t + 0.04);
  }
  function bell(t, m, vol, dest) {
    const out = dest || layer.perf, f0 = mtof(m);
    for (const [ratio, amp, dec] of [[1, 1, 1.4], [2.01, 0.35, 0.7], [3.98, 0.12, 0.35]]) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f0 * ratio;
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol * amp, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0005, t + dec);
      o.connect(g); g.connect(out); o.start(t); o.stop(t + dec + 0.05);
    }
  }

  /* ---------- SFX ---------- */
  function tone(o) {
    const t = (o.t || ctx.currentTime) + (o.delay || 0);
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f, t);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f2), t + (o.slide || o.dur));
    const a = o.a || 0.004, vol = o.vol || 0.2;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + a); g.gain.exponentialRampToValueAtTime(0.0005, t + o.dur);
    let node = g;
    if (o.lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; g.connect(f); node = f; }
    if (o.pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = clamp(o.pan, -1, 1); node.connect(p); node = p; }
    osc.connect(g); node.connect(o.dest || sfxBus); osc.start(t); osc.stop(t + o.dur + 0.05);
  }
  function noise(o) {
    const t = (o.t || ctx.currentTime) + (o.delay || 0);
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuf; f.type = o.ft || 'bandpass'; f.frequency.setValueAtTime(o.f || 1000, t); f.Q.value = o.q || 1;
    if (o.f2) f.frequency.exponentialRampToValueAtTime(o.f2, t + o.dur);
    const a = o.a || 0.004;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(o.vol || 0.2, t + a); g.gain.exponentialRampToValueAtTime(0.0005, t + o.dur);
    let node = g;
    if (o.pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = clamp(o.pan, -1, 1); g.connect(p); node = p; }
    s.connect(f); f.connect(g); node.connect(o.dest || sfxBus); s.start(t, Math.random() * 0.4, o.dur + 0.05);
  }

  const SFX = {
    shoot: (o) => tone({ f: 1500 + rand(200), f2: 900, dur: 0.05, vol: 0.035, type: 'triangle', pan: o.pan }),
    shootHeavy: (o) => { noise({ f: 900, f2: 3200, q: 0.8, dur: 0.16, vol: 0.13, pan: o.pan }); tone({ f: 420, f2: 700, dur: 0.12, vol: 0.05, type: 'triangle' }); },
    arrow: (o) => { noise({ f: 2400, f2: 900, q: 2, dur: 0.18, vol: 0.08, pan: o.pan }); tone({ f: 880, f2: 1320, dur: 0.1, vol: 0.04 }); },
    bellnote: (o) => bell(ctx.currentTime, 84 + randi(0, 2) * 3, 0.1, sfxBus),
    boomNote: () => { bell(ctx.currentTime, 79, 0.14, sfxBus); noise({ f: 500, f2: 120, q: 0.7, dur: 0.25, vol: 0.12 }); },
    hit: (o) => tone({ f: 660 + rand(120), f2: 400, dur: 0.05, vol: 0.05, type: 'square', lp: 2400, pan: o.pan }),
    armor: (o) => tone({ f: 1800, f2: 1400, dur: 0.04, vol: 0.035, type: 'triangle', pan: o.pan }),
    kill: (o) => { tone({ f: 520, f2: 180, dur: 0.12, vol: 0.12, type: 'triangle', pan: o.pan }); bell(ctx.currentTime + 0.02, 88 + randi(0, 3) * 2, 0.08, sfxBus); },
    graze: (o) => tone({ f: 2600 + rand(600), f2: 3600, dur: 0.07, vol: 0.05, type: 'sine', pan: o.pan }),
    cut: (o) => {
      noise({ f: 1400, f2: 5200, q: 0.7, dur: 0.14, vol: 0.2, pan: o.pan });
      tone({ f: 2400, f2: 5200, dur: 0.12, vol: 0.09, type: 'triangle', delay: 0.02 });
      tone({ f: 3100, dur: 0.25, vol: 0.05, delay: 0.05 });
    },
    swing: (o) => noise({ f: 800, f2: 2600, q: 0.6, dur: 0.12, vol: 0.1, pan: o.pan }),
    parry: () => { bell(ctx.currentTime, 88, 0.3, sfxBus); tone({ f: 1760, f2: 2640, dur: 0.18, vol: 0.08 }); },
    parryPerfect: () => {
      const t = ctx.currentTime;
      bell(t, 88, 0.34, sfxBus); bell(t + 0.05, 93, 0.26, sfxBus); bell(t + 0.1, 97, 0.2, sfxBus);
      noise({ f: 5000, f2: 9000, q: 0.5, dur: 0.4, vol: 0.08, ft: 'highpass' });
    },
    parryBlock: () => { bell(ctx.currentTime, 81, 0.2, sfxBus); },
    dash: () => { noise({ f: 600, f2: 2400, q: 0.5, dur: 0.2, vol: 0.14 }); tone({ f: 300, f2: 900, dur: 0.15, vol: 0.05 }); },
    perfectDodge: () => { tone({ f: 1200, f2: 2400, dur: 0.25, vol: 0.1 }); bell(ctx.currentTime + 0.06, 90, 0.16, sfxBus); },
    hurt: () => { tone({ f: 240, f2: 90, dur: 0.28, vol: 0.28, type: 'triangle' }); tone({ f: 370, f2: 150, dur: 0.22, vol: 0.12, type: 'square', lp: 1200 }); noise({ f: 600, q: 0.5, dur: 0.12, vol: 0.12 }); },
    shieldPop: () => { noise({ f: 2600, f2: 600, q: 1, dur: 0.3, vol: 0.18 }); tone({ f: 900, f2: 300, dur: 0.25, vol: 0.08, type: 'triangle' }); },
    heart: () => { const t = ctx.currentTime; bell(t, 76, 0.2, sfxBus); bell(t + 0.08, 83, 0.18, sfxBus); },
    dust: (o) => tone({ f: 1900 + rand(700), f2: 2600, dur: 0.06, vol: 0.035, pan: o.pan }),
    bubble: (o) => { tone({ f: 500, f2: 1400, dur: 0.1, vol: 0.09, pan: o.pan }); tone({ f: 900, f2: 1900, dur: 0.08, vol: 0.05, delay: 0.05 }); },
    warn: (o) => tone({ f: 700, f2: 1400, dur: 0.35, vol: 0.05, type: 'sine', slide: 0.3, pan: o.pan }),
    laser: (o) => { tone({ f: 1800, f2: 500, dur: 0.22, vol: 0.07, type: 'sawtooth', lp: 3000, pan: o.pan }); },
    spawnPink: (o) => tone({ f: 340 + rand(60), f2: 260, dur: 0.07, vol: 0.05, type: 'sine', pan: o.pan }),
    spawnBlue: (o) => tone({ f: 1320 + rand(200), dur: 0.09, vol: 0.045, type: 'triangle', pan: o.pan }),
    spawnGold: (o) => { tone({ f: 1760, f2: 2200, dur: 0.14, vol: 0.06, pan: o.pan }); },
    goldNear: () => tone({ f: 2640, f2: 3000, dur: 0.12, vol: 0.07 }),
    resFull: () => { const t = ctx.currentTime; [74, 78, 81, 86].forEach((m, i) => bell(t + i * 0.05, m, 0.16, sfxBus)); },
    perf_echo: () => { const t = ctx.currentTime; tone({ f: 1200, f2: 300, dur: 0.9, vol: 0.14, type: 'sine', slide: 0.8 }); for (let i = 0; i < 4; i++) tick(t + i * 0.18, i % 2 === 0); bell(t, 71, 0.25, sfxBus); },
    perf_melody: () => { const t = ctx.currentTime; [74, 78, 81, 85, 88].forEach((m, i) => bell(t + i * 0.06, m, 0.2, sfxBus)); },
    perf_gravity: () => { tone({ f: 200, f2: 1200, dur: 0.6, vol: 0.14, type: 'triangle', slide: 0.5 }); tone({ f: 1200, f2: 200, dur: 0.6, vol: 0.08, type: 'sine', slide: 0.5, delay: 0.1 }); },
    perf_still: () => { noise({ f: 8000, f2: 1500, q: 0.4, dur: 0.8, vol: 0.12, ft: 'highpass' }); bell(ctx.currentTime, 93, 0.24, sfxBus); bell(ctx.currentTime + 0.12, 86, 0.2, sfxBus); },
    perfEnd: () => { const t = ctx.currentTime; bell(t, 81, 0.14, sfxBus); bell(t + 0.1, 74, 0.12, sfxBus); tone({ f: 900, f2: 300, dur: 0.3, vol: 0.05 }); },
    burst: () => { noise({ f: 300, f2: 2400, q: 0.5, dur: 0.45, vol: 0.2 }); tone({ f: 110, f2: 55, dur: 0.5, vol: 0.2, type: 'triangle' }); },
    phase: () => {
      const t = ctx.currentTime;
      tone({ f: 98, f2: 60, dur: 2.2, vol: 0.3, type: 'triangle' }); tone({ f: 196, dur: 1.8, vol: 0.12 });
      noise({ f: 400, f2: 3000, q: 0.4, dur: 1.2, vol: 0.12, a: 0.9 });
      for (let i = 0; i < 8; i++) tone({ f: 2200 + (i % 2) * 400, dur: 0.05, vol: 0.08, t: t + i * 0.07 });
    },
    alarm: () => { const t = ctx.currentTime; for (let i = 0; i < 10; i++) tone({ f: i % 2 ? 1760 : 2093, dur: 0.05, vol: 0.06, t: t + i * 0.045 }); },
    boom: () => { noise({ f: 200, f2: 60, q: 0.4, dur: 1.4, vol: 0.4, ft: 'lowpass' }); tone({ f: 80, f2: 30, dur: 1.2, vol: 0.35, type: 'sine' }); },
    rewind: () => { tone({ f: 200, f2: 1600, dur: 0.7, vol: 0.12, type: 'sawtooth', lp: 2200, a: 0.5 }); noise({ f: 300, f2: 4000, q: 0.6, dur: 0.7, vol: 0.12, a: 0.55 }); },
    tide: () => { noise({ f: 300, f2: 1400, q: 0.5, dur: 0.9, vol: 0.16, a: 0.3 }); tone({ f: 330, f2: 220, dur: 0.8, vol: 0.06 }); },
    ui: () => tone({ f: 1320, f2: 1760, dur: 0.06, vol: 0.06, type: 'triangle' }),
    uiBack: () => tone({ f: 1100, f2: 700, dur: 0.07, vol: 0.05, type: 'triangle' }),
    card: () => { noise({ f: 2400, f2: 5000, q: 0.8, dur: 0.12, vol: 0.06 }); },
    select: () => { const t = ctx.currentTime; bell(t, 79, 0.18, sfxBus); bell(t + 0.07, 86, 0.16, sfxBus); },
    denied: () => tone({ f: 300, f2: 220, dur: 0.14, vol: 0.08, type: 'square', lp: 900 }),
    win: () => { const t = ctx.currentTime; [74, 78, 81, 86, 90, 93].forEach((m, i) => bell(t + i * 0.12, m, 0.22, sfxBus)); },
    lose: () => { const t = ctx.currentTime; [81, 78, 74, 69].forEach((m, i) => bell(t + i * 0.22, m, 0.18, sfxBus)); },
    waveClear: () => { const t = ctx.currentTime; bell(t, 81, 0.12, sfxBus); bell(t + 0.08, 86, 0.1, sfxBus); },
    weakOpen: () => { tone({ f: 2400, f2: 3200, dur: 0.12, vol: 0.09 }); tone({ f: 3200, dur: 0.12, vol: 0.06, delay: 0.12 }); },
    weakHit: (o) => tone({ f: 3000 + rand(300), dur: 0.05, vol: 0.05, pan: o.pan }),
    crystal: () => { const t = ctx.currentTime; [79, 83, 86, 91].forEach((m, i) => bell(t + i * 0.045, m, 0.18, sfxBus)); noise({ f: 6000, f2: 9000, q: 0.6, dur: 0.3, vol: 0.06, ft: 'highpass' }); },
    levelup: () => { const t = ctx.currentTime; [74, 78, 81, 86, 90].forEach((m, i) => bell(t + i * 0.06, m, 0.2, sfxBus)); tone({ f: 400, f2: 1600, dur: 0.4, vol: 0.08, type: 'triangle' }); },
    synergy: () => { const t = ctx.currentTime; [62, 66, 69, 74].forEach((m) => { tone({ f: mtof(m), dur: 1.2, vol: 0.09, type: 'sawtooth', lp: 2400, a: 0.02 }); }); [86, 90, 93, 98].forEach((m, i) => bell(t + 0.1 + i * 0.07, m, 0.22, sfxBus)); noise({ f: 300, f2: 5000, q: 0.5, dur: 0.6, vol: 0.14 }); },
    stream: () => { const t = ctx.currentTime; [62, 69, 74, 78, 81, 86].forEach((m, i) => bell(t + i * 0.08, m, 0.24, sfxBus)); tone({ f: 110, f2: 55, dur: 1, vol: 0.25, type: 'triangle' }); },
    streak: (o) => { const t = ctx.currentTime, k = o.k || 0; [81, 86, 90].forEach((m, i) => bell(t + i * 0.05, m + k * 2, 0.16, sfxBus)); noise({ f: 1200, f2: 4000, q: 0.5, dur: 0.25, vol: 0.1 }); },
    nova: () => { noise({ f: 200, f2: 3000, q: 0.5, dur: 0.4, vol: 0.2 }); tone({ f: 160, f2: 60, dur: 0.4, vol: 0.2, type: 'triangle' }); },
    burstCut: () => { noise({ f: 400, f2: 6000, q: 0.4, dur: 0.45, vol: 0.2, a: 0.2 }); tone({ f: 220, f2: 880, dur: 0.45, vol: 0.1, type: 'sawtooth', lp: 2000, a: 0.2 }); },
    b_moon: () => { const t = ctx.currentTime; tone({ f: 330, f2: 990, dur: 0.8, vol: 0.18, type: 'triangle' }); [74, 81, 86, 93].forEach((m, i) => bell(t + i * 0.1, m, 0.2, sfxBus)); },
    b_cloud: () => { noise({ f: 200, f2: 1200, q: 0.4, dur: 1.4, vol: 0.3, a: 0.2 }); tone({ f: 90, f2: 60, dur: 1.2, vol: 0.2, type: 'sine' }); },
    b_candy: () => { const t = ctx.currentTime; for (let i = 0; i < 10; i++) bell(t + i * 0.07, 84 + ((i * 5) % 12), 0.12, sfxBus); },
    b_paper: () => { const t = ctx.currentTime; for (let i = 0; i < 5; i++) noise({ f: 1500, f2: 4000, q: 1, dur: 0.15, vol: 0.12, t: t + i * 0.08 }); bell(t + 0.4, 88, 0.2, sfxBus); },
    b_whale: () => { tone({ f: 800, f2: 120, dur: 1, vol: 0.2, type: 'sine', slide: 0.9 }); tone({ f: 120, f2: 60, dur: 1.6, vol: 0.28, type: 'triangle', delay: 1 }); noise({ f: 200, f2: 2400, q: 0.4, dur: 1.2, vol: 0.25, delay: 1 }); },
    b_clock: () => { const t = ctx.currentTime; for (let i = 0; i < 6; i++) tick(t + i * 0.12, i % 2 === 0); tone({ f: 1400, f2: 200, dur: 0.8, vol: 0.14, type: 'sine' }); },
    timeResume: () => { tone({ f: 200, f2: 1400, dur: 0.5, vol: 0.14, type: 'sine' }); noise({ f: 300, f2: 3000, q: 0.5, dur: 0.6, vol: 0.2 }); },
    portal: () => { tone({ f: 300, f2: 1200, dur: 0.6, vol: 0.12, type: 'sine' }); noise({ f: 500, f2: 3000, q: 0.6, dur: 0.6, vol: 0.14, a: 0.1 }); bell(ctx.currentTime + 0.2, 86, 0.18, sfxBus); },
    explode: (o) => { noise({ f: 900, f2: 120, q: 0.5, dur: 0.3, vol: 0.14 * (o.v || 1), ft: 'lowpass', pan: o.pan }); tone({ f: 140, f2: 50, dur: 0.25, vol: 0.12 * (o.v || 1), type: 'sine', pan: o.pan }); },
    zap: (o) => { noise({ f: 3000, f2: 1200, q: 3, dur: 0.12, vol: 0.08, pan: o.pan }); tone({ f: 1800 + rand(600), f2: 600, dur: 0.1, vol: 0.05, type: 'sawtooth', lp: 4000 }); },
    freeze: (o) => { noise({ f: 7000, f2: 3000, q: 1, dur: 0.18, vol: 0.06, ft: 'highpass', pan: o.pan }); tone({ f: 2400, dur: 0.12, vol: 0.04 }); },
    shatter: (o) => { noise({ f: 5000, f2: 1500, q: 0.8, dur: 0.25, vol: 0.1, pan: o.pan }); tone({ f: 3200, f2: 2000, dur: 0.15, vol: 0.05, type: 'triangle' }); },
    beam: () => { tone({ f: 600, f2: 1200, dur: 0.8, vol: 0.07, type: 'sawtooth', lp: 3000 }); tone({ f: 900, f2: 1800, dur: 0.8, vol: 0.05, type: 'triangle' }); },
    candy: () => { const t = ctx.currentTime; bell(t, 86, 0.14, sfxBus); bell(t + 0.05, 90, 0.12, sfxBus); },
    gold: () => { const t = ctx.currentTime; [74, 78, 81, 86, 90, 93, 98].forEach((m, i) => bell(t + i * 0.05, m, 0.2, sfxBus)); },
    chest: () => { const t = ctx.currentTime; noise({ f: 800, f2: 300, q: 1, dur: 0.2, vol: 0.14 }); [81, 86, 90].forEach((m, i) => bell(t + 0.1 + i * 0.06, m, 0.2, sfxBus)); },
    gachaRoll: () => { const t = ctx.currentTime; for (let i = 0; i < 12; i++) tone({ f: 500 + i * 80, dur: 0.06, vol: 0.05, type: 'triangle', t: t + i * 0.06 }); },
    reveal: (o) => {
      const t = ctx.currentTime, r = o.r || 'N';
      const seq = { N: [74, 78, 81], R: [74, 78, 81, 86], SR: [74, 78, 81, 86, 90], SSR: [62, 69, 74, 78, 81, 86, 90, 93] }[r];
      seq.forEach((m, i) => bell(t + i * 0.07, m, 0.22, sfxBus));
      if (r === 'SSR' || r === 'SR') { noise({ f: 300, f2: 6000, q: 0.4, dur: 1, vol: 0.18 }); tone({ f: 110, f2: 55, dur: 1.2, vol: 0.25, type: 'triangle' }); }
    },
    starLight: () => { const t = ctx.currentTime; bell(t, 86, 0.2, sfxBus); bell(t + 0.08, 93, 0.18, sfxBus); tone({ f: 600, f2: 1800, dur: 0.3, vol: 0.06 }); },
  };

  function sfx(name, o = {}) {
    if (!ctx || ctx.state !== 'running' || cfg.muted) return;
    const now = performance.now(), gap = o.gap !== undefined ? o.gap : 28;
    if (throttle[name] && now - throttle[name] < gap) return;
    throttle[name] = now;
    const fn = SFX[name];
    if (fn) { try { fn(o); } catch (e) { /* ignore a dropped voice */ } }
  }

  return { init, configure, setMode, setBoost, setBpm, setCardMods, sfx, get ready() { return !!ctx; }, get mode() { return mode; } };
})();
