'use strict';
/* 梦潮：回声航线 — WebAudio: four-layer procedural music (环境/节奏/紧张/演奏) and synthesized SFX */

const Sound = (() => {
  let ctx = null, master, comp, musicBus, sfxBus, duckBus, bus, musicFilter, lfo, lfoGain, delay, delayFb, delayWet, revIn, noiseBuf;
  const layer = {}, level = { ambient: 0, rhythm: 0, tension: 0, perf: 0 };
  const cfg = { music: 0.7, sfx: 0.8, muted: false };
  let mode = 'silent', bpm = 92, step = 0, bar = 0, nextTime = 0, timer = null;
  let prog = 'dream', boost = { tension: 0, perf: 0 }, mods = {}, reverse = false;
  const throttle = {};
  let focusOn = false, duckUntil = 0; const recent = [];
  const LOW = new Set(['kill', 'shoot', 'dust', 'hit', 'clink', 'explode', 'spawnPink', 'spawnBlue', 'spawnGold', 'zap', 'freeze', 'shatter']); // 可以被压掉的碎声
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
    duckBus = ctx.createGain(); duckBus.connect(sfxBus); bus = sfxBus; // 奖励焦点时战场音效走 duckBus 被压低
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
    musicBus.gain.setTargetAtTime(cfg.music * 0.8 * (focusOn ? 0.4 : 1), t, 0.1);
    if (duckBus) duckBus.gain.setTargetAtTime(focusOn ? 0.22 : 1, t, 0.08);
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
    osc.connect(g); node.connect(o.dest || bus || sfxBus); osc.start(t); osc.stop(t + o.dur + 0.05);
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
    s.connect(f); f.connect(g); node.connect(o.dest || bus || sfxBus); s.start(t, Math.random() * 0.4, o.dur + 0.05);
  }

  const SFX = {
    shoot: (o) => tone({ f: 1500 + rand(200), f2: 900, dur: 0.05, vol: 0.035, type: 'triangle', pan: o.pan }),
    shootHeavy: (o) => { noise({ f: 900, f2: 3200, q: 0.8, dur: 0.16, vol: 0.13, pan: o.pan }); tone({ f: 420, f2: 700, dur: 0.12, vol: 0.05, type: 'triangle' }); },
    arrow: (o) => { noise({ f: 2400, f2: 900, q: 2, dur: 0.18, vol: 0.08, pan: o.pan }); tone({ f: 880, f2: 1320, dur: 0.1, vol: 0.04 }); },
    bellnote: (o) => bell(ctx.currentTime, 84 + randi(0, 2) * 3, 0.1, bus),
    boomNote: () => { bell(ctx.currentTime, 79, 0.14, bus); noise({ f: 500, f2: 120, q: 0.7, dur: 0.25, vol: 0.12 }); },
    hit: (o) => { noise({ f: 1700 + rand(300), f2: 700, q: 1, dur: 0.04, vol: 0.06, pan: o.pan }); tone({ f: 320 + rand(40), f2: 160, dur: 0.05, vol: 0.05, type: 'triangle', pan: o.pan }); }, // 没打死：闷一点的“噗”，和击杀的碎裂声分开
    armor: (o) => tone({ f: 1800, f2: 1400, dur: 0.04, vol: 0.035, type: 'triangle', pan: o.pan }),
    kill: (o) => { const k = o.k || 0; tone({ f: 620 * Math.pow(2, k / 12), f2: 220, dur: 0.07, vol: 0.1, type: 'triangle', pan: o.pan }); noise({ f: 2600 + k * 200, f2: 1200, q: 1.2, dur: 0.05, vol: 0.05, pan: o.pan }); }, // 短促的碎裂声，连杀音高上升（最多 +6 半音）
    clink: (o) => { const k = o.k || 0; tone({ f: 2400 + k * 300 + rand(200), f2: 1800, dur: 0.05, vol: 0.06, type: 'triangle', pan: o.pan }); tone({ f: 5200 + rand(400), dur: 0.03, vol: 0.025, pan: o.pan }); },
    crack: (o) => { noise({ f: 3000, f2: 1200, q: 2, dur: 0.1, vol: 0.12, pan: o.pan }); tone({ f: 900, f2: 500, dur: 0.08, vol: 0.06, type: 'square', lp: 2600, pan: o.pan }); },
    armorBreak: (o) => { tone({ f: 110, f2: 45, dur: 0.35, vol: 0.32, type: 'sine', pan: o.pan }); noise({ f: 1400, f2: 300, q: 0.7, dur: 0.3, vol: 0.2, pan: o.pan }); tone({ f: 1600, f2: 900, dur: 0.12, vol: 0.07, type: 'triangle', delay: 0.02 }); },
    armorKill: (o) => { const k = o.k || 0; tone({ f: 700 + k * 60, f2: 200, dur: 0.14, vol: 0.14, type: 'triangle', pan: o.pan }); bell(ctx.currentTime + 0.02, 83 + k, 0.12, bus); },
    eliteKill: (o) => { tone({ f: 90, f2: 40, dur: 0.5, vol: 0.34, type: 'sine' }); noise({ f: 800, f2: 120, q: 0.5, dur: 0.45, vol: 0.22, ft: 'lowpass', pan: o.pan }); const t = ctx.currentTime; [81, 86, 90].forEach((m, i) => bell(t + 0.05 + i * 0.05, m, 0.16, bus)); },
    goalDone: () => { const t = ctx.currentTime; [74, 81, 86, 93].forEach((m, i) => bell(t + i * 0.06, m, 0.22, bus)); tone({ f: 220, f2: 440, dur: 0.5, vol: 0.1, type: 'triangle' }); },
    ritualTrigger: () => { const t = ctx.currentTime; bell(t, 86, 0.2, bus); tone({ f: 400, f2: 1200, dur: 0.3, vol: 0.08 }); },
    transform: () => { noise({ f: 300, f2: 2400, q: 0.6, dur: 0.7, vol: 0.12, a: 0.2 }); tone({ f: 180, f2: 520, dur: 0.7, vol: 0.1, type: 'triangle' }); },
    rollTick: (o) => tone({ f: 1400 + (o.k || 0) * 600, dur: 0.025, vol: 0.05, type: 'square', lp: 3000 }),
    qualityUp: (o) => { const t = ctx.currentTime, k = o.k || 1; [74, 78, 81, 86, 90].slice(0, 3 + k).forEach((m, i) => bell(t + i * 0.05, m + k * 5, 0.22, bus)); noise({ f: 2000, f2: 8000, q: 0.5, dur: 0.4, vol: 0.1, ft: 'highpass' }); tone({ f: 110 * k, f2: 220 * k, dur: 0.4, vol: 0.12, type: 'triangle' }); },
    flyIn: () => { noise({ f: 1200, f2: 5000, q: 0.8, dur: 0.45, vol: 0.08, a: 0.2 }); tone({ f: 600, f2: 1400, dur: 0.45, vol: 0.06 }); },
    slotLand: () => { bell(ctx.currentTime, 88, 0.22, bus); tone({ f: 160, f2: 80, dur: 0.18, vol: 0.14, type: 'sine' }); },
    engine: () => { tone({ f: 70, f2: 140, dur: 1.2, vol: 0.18, type: 'sawtooth', lp: 400, a: 0.6 }); noise({ f: 200, f2: 600, q: 0.8, dur: 1.2, vol: 0.1, a: 0.6, pan: -0.9 }); },
    riftOpen: (o) => { tone({ f: 1200, f2: 200, dur: 0.9, vol: 0.1, type: 'sine', pan: o.pan }); noise({ f: 4000, f2: 400, q: 1, dur: 0.9, vol: 0.08, pan: o.pan }); },
    riftSpit: (o) => tone({ f: 300, f2: 900, dur: 0.1, vol: 0.06, type: 'triangle', pan: o.pan }),
    bell: () => { const t = ctx.currentTime; bell(t, 88, 0.26, bus); bell(t + 0.12, 93, 0.2, bus); },
    hook: (o) => { tone({ f: 500, f2: 1100, dur: 0.12, vol: 0.08, type: 'triangle', pan: o.pan }); bell(ctx.currentTime + 0.05, 86, 0.14, bus); },
    coreFly: (o) => tone({ f: 400, f2: 1600, dur: 0.35, vol: 0.1, pan: o.pan }),
    wallBreak: () => { noise({ f: 400, f2: 60, q: 0.4, dur: 1.0, vol: 0.35, ft: 'lowpass' }); tone({ f: 70, f2: 30, dur: 0.9, vol: 0.3, type: 'sine' }); const t = ctx.currentTime; [69, 74, 81].forEach((m, i) => bell(t + 0.2 + i * 0.08, m, 0.16, bus)); },
    podHit: (o) => tone({ f: 800, f2: 300, dur: 0.15, vol: 0.12, type: 'square', lp: 1800, pan: o.pan }),
    houseShot: (o) => { bell(ctx.currentTime, 84, 0.12, bus); tone({ f: 900, f2: 1600, dur: 0.1, vol: 0.05, pan: o.pan }); },
    wind: (o) => noise({ f: 300, f2: 2400, q: 0.4, dur: 1.4, vol: 0.2, a: 0.3, pan: o.pan }),
    moonBlink: () => { tone({ f: 2000, f2: 1200, dur: 0.12, vol: 0.05 }); bell(ctx.currentTime + 0.1, 79, 0.12, bus); },
    moonDetach: () => { tone({ f: 300, f2: 80, dur: 2, vol: 0.22, type: 'sine', a: 0.5 }); noise({ f: 200, f2: 2000, q: 0.4, dur: 2, vol: 0.14, a: 1 }); },
    moonBreak: () => { noise({ f: 300, f2: 50, q: 0.4, dur: 1.6, vol: 0.4, ft: 'lowpass' }); const t = ctx.currentTime; [93, 90, 86, 81, 74].forEach((m, i) => bell(t + i * 0.09, m, 0.2, bus)); },
    bite: () => { noise({ f: 800, f2: 200, q: 1, dur: 0.2, vol: 0.18 }); tone({ f: 200, f2: 90, dur: 0.2, vol: 0.14, type: 'square', lp: 900 }); },
    peel: () => { noise({ f: 3000, f2: 800, q: 1.2, dur: 0.6, vol: 0.12 }); tone({ f: 600, f2: 1200, dur: 0.4, vol: 0.06 }); },
    houseWake: () => { tone({ f: 90, f2: 140, dur: 1.0, vol: 0.24, type: 'sawtooth', lp: 600 }); const t = ctx.currentTime; [60, 63, 67].forEach((m, i) => bell(t + i * 0.15, m, 0.16, bus)); },
    ultEnd: () => { const t = ctx.currentTime; [74, 81, 86].forEach((m, i) => bell(t + i * 0.08, m, 0.14, bus)); },
    graze: (o) => tone({ f: 2600 + rand(600), f2: 3600, dur: 0.07, vol: 0.05, type: 'sine', pan: o.pan }),
    cut: (o) => {
      noise({ f: 1400, f2: 5200, q: 0.7, dur: 0.14, vol: 0.2, pan: o.pan });
      tone({ f: 2400, f2: 5200, dur: 0.12, vol: 0.09, type: 'triangle', delay: 0.02 });
      tone({ f: 3100, dur: 0.25, vol: 0.05, delay: 0.05 });
    },
    swing: (o) => noise({ f: 800, f2: 2600, q: 0.6, dur: 0.12, vol: 0.1, pan: o.pan }),
    parry: () => { bell(ctx.currentTime, 88, 0.3, bus); tone({ f: 1760, f2: 2640, dur: 0.18, vol: 0.08 }); },
    parryPerfect: () => {
      const t = ctx.currentTime;
      bell(t, 88, 0.34, bus); bell(t + 0.05, 93, 0.26, bus); bell(t + 0.1, 97, 0.2, bus);
      noise({ f: 5000, f2: 9000, q: 0.5, dur: 0.4, vol: 0.08, ft: 'highpass' });
    },
    parryBlock: () => { bell(ctx.currentTime, 81, 0.2, bus); },
    dash: () => { noise({ f: 600, f2: 2400, q: 0.5, dur: 0.2, vol: 0.14 }); tone({ f: 300, f2: 900, dur: 0.15, vol: 0.05 }); },
    perfectDodge: () => { tone({ f: 1200, f2: 2400, dur: 0.25, vol: 0.1 }); bell(ctx.currentTime + 0.06, 90, 0.16, bus); },
    hurt: () => { tone({ f: 240, f2: 90, dur: 0.28, vol: 0.28, type: 'triangle' }); tone({ f: 370, f2: 150, dur: 0.22, vol: 0.12, type: 'square', lp: 1200 }); noise({ f: 600, q: 0.5, dur: 0.12, vol: 0.12 }); },
    shieldPop: () => { noise({ f: 2600, f2: 600, q: 1, dur: 0.3, vol: 0.18 }); tone({ f: 900, f2: 300, dur: 0.25, vol: 0.08, type: 'triangle' }); },
    heart: () => { const t = ctx.currentTime; bell(t, 76, 0.2, bus); bell(t + 0.08, 83, 0.18, bus); },
    dust: (o) => { const k = o.k || 0; tone({ f: (1700 + rand(200)) * Math.pow(2, k / 12), f2: 2600 * Math.pow(2, k / 12), dur: 0.06, vol: 0.035 + k * 0.003, pan: o.pan }); }, // 连着捡音高一颗颗往上走（最多 +10 半音）
    bubble: (o) => { tone({ f: 500, f2: 1400, dur: 0.1, vol: 0.09, pan: o.pan }); tone({ f: 900, f2: 1900, dur: 0.08, vol: 0.05, delay: 0.05 }); },
    warn: (o) => tone({ f: 700, f2: 1400, dur: 0.35, vol: 0.05, type: 'sine', slide: 0.3, pan: o.pan }),
    laser: (o) => { tone({ f: 1800, f2: 500, dur: 0.22, vol: 0.07, type: 'sawtooth', lp: 3000, pan: o.pan }); },
    spawnPink: (o) => tone({ f: 340 + rand(60), f2: 260, dur: 0.07, vol: 0.05, type: 'sine', pan: o.pan }),
    spawnBlue: (o) => tone({ f: 1320 + rand(200), dur: 0.09, vol: 0.045, type: 'triangle', pan: o.pan }),
    spawnGold: (o) => { tone({ f: 1760, f2: 2200, dur: 0.14, vol: 0.06, pan: o.pan }); },
    goldNear: () => tone({ f: 2640, f2: 3000, dur: 0.12, vol: 0.07 }),
    resFull: () => { const t = ctx.currentTime; [74, 78, 81, 86].forEach((m, i) => bell(t + i * 0.05, m, 0.16, bus)); },
    perf_echo: () => { const t = ctx.currentTime; tone({ f: 1200, f2: 300, dur: 0.9, vol: 0.14, type: 'sine', slide: 0.8 }); for (let i = 0; i < 4; i++) tick(t + i * 0.18, i % 2 === 0); bell(t, 71, 0.25, bus); },
    perf_melody: () => { const t = ctx.currentTime; [74, 78, 81, 85, 88].forEach((m, i) => bell(t + i * 0.06, m, 0.2, bus)); },
    perf_gravity: () => { tone({ f: 200, f2: 1200, dur: 0.6, vol: 0.14, type: 'triangle', slide: 0.5 }); tone({ f: 1200, f2: 200, dur: 0.6, vol: 0.08, type: 'sine', slide: 0.5, delay: 0.1 }); },
    perf_still: () => { noise({ f: 8000, f2: 1500, q: 0.4, dur: 0.8, vol: 0.12, ft: 'highpass' }); bell(ctx.currentTime, 93, 0.24, bus); bell(ctx.currentTime + 0.12, 86, 0.2, bus); },
    perfEnd: () => { const t = ctx.currentTime; bell(t, 81, 0.14, bus); bell(t + 0.1, 74, 0.12, bus); tone({ f: 900, f2: 300, dur: 0.3, vol: 0.05 }); },
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
    select: () => { const t = ctx.currentTime; bell(t, 79, 0.18, bus); bell(t + 0.07, 86, 0.16, bus); },
    denied: () => tone({ f: 300, f2: 220, dur: 0.14, vol: 0.08, type: 'square', lp: 900 }),
    win: () => { const t = ctx.currentTime; [74, 78, 81, 86, 90, 93].forEach((m, i) => bell(t + i * 0.12, m, 0.22, bus)); },
    lose: () => { const t = ctx.currentTime; [81, 78, 74, 69].forEach((m, i) => bell(t + i * 0.22, m, 0.18, bus)); },
    waveClear: () => { const t = ctx.currentTime; bell(t, 81, 0.12, bus); bell(t + 0.08, 86, 0.1, bus); },
    weakOpen: () => { tone({ f: 2400, f2: 3200, dur: 0.12, vol: 0.09 }); tone({ f: 3200, dur: 0.12, vol: 0.06, delay: 0.12 }); },
    weakHit: (o) => tone({ f: 3000 + rand(300), dur: 0.05, vol: 0.05, pan: o.pan }),
    crystal: () => { const t = ctx.currentTime; [79, 83, 86, 91].forEach((m, i) => bell(t + i * 0.045, m, 0.18, bus)); noise({ f: 6000, f2: 9000, q: 0.6, dur: 0.3, vol: 0.06, ft: 'highpass' }); },
    levelup: () => { const t = ctx.currentTime; [74, 78, 81, 86, 90].forEach((m, i) => bell(t + i * 0.06, m, 0.2, bus)); tone({ f: 400, f2: 1600, dur: 0.4, vol: 0.08, type: 'triangle' }); },
    synergy: () => { const t = ctx.currentTime; [62, 66, 69, 74].forEach((m) => { tone({ f: mtof(m), dur: 1.2, vol: 0.09, type: 'sawtooth', lp: 2400, a: 0.02 }); }); [86, 90, 93, 98].forEach((m, i) => bell(t + 0.1 + i * 0.07, m, 0.22, bus)); noise({ f: 300, f2: 5000, q: 0.5, dur: 0.6, vol: 0.14 }); },
    stream: () => { const t = ctx.currentTime; [62, 69, 74, 78, 81, 86].forEach((m, i) => bell(t + i * 0.08, m, 0.24, bus)); tone({ f: 110, f2: 55, dur: 1, vol: 0.25, type: 'triangle' }); },
    streak: (o) => { const t = ctx.currentTime, k = o.k || 0; [81, 86, 90].forEach((m, i) => bell(t + i * 0.05, m + k * 2, 0.16, bus)); noise({ f: 1200, f2: 4000, q: 0.5, dur: 0.25, vol: 0.1 }); },
    nova: () => { noise({ f: 200, f2: 3000, q: 0.5, dur: 0.4, vol: 0.2 }); tone({ f: 160, f2: 60, dur: 0.4, vol: 0.2, type: 'triangle' }); },
    burstCut: () => { noise({ f: 400, f2: 6000, q: 0.4, dur: 0.45, vol: 0.2, a: 0.2 }); tone({ f: 220, f2: 880, dur: 0.45, vol: 0.1, type: 'sawtooth', lp: 2000, a: 0.2 }); },
    b_moon: () => { const t = ctx.currentTime; tone({ f: 330, f2: 990, dur: 0.8, vol: 0.18, type: 'triangle' }); [74, 81, 86, 93].forEach((m, i) => bell(t + i * 0.1, m, 0.2, bus)); },
    b_cloud: () => { noise({ f: 200, f2: 1200, q: 0.4, dur: 1.4, vol: 0.3, a: 0.2 }); tone({ f: 90, f2: 60, dur: 1.2, vol: 0.2, type: 'sine' }); },
    b_candy: () => { const t = ctx.currentTime; for (let i = 0; i < 10; i++) bell(t + i * 0.07, 84 + ((i * 5) % 12), 0.12, bus); },
    b_paper: () => { const t = ctx.currentTime; for (let i = 0; i < 5; i++) noise({ f: 1500, f2: 4000, q: 1, dur: 0.15, vol: 0.12, t: t + i * 0.08 }); bell(t + 0.4, 88, 0.2, bus); },
    b_whale: () => { tone({ f: 800, f2: 120, dur: 1, vol: 0.2, type: 'sine', slide: 0.9 }); tone({ f: 120, f2: 60, dur: 1.6, vol: 0.28, type: 'triangle', delay: 1 }); noise({ f: 200, f2: 2400, q: 0.4, dur: 1.2, vol: 0.25, delay: 1 }); },
    b_clock: () => { const t = ctx.currentTime; for (let i = 0; i < 6; i++) tick(t + i * 0.12, i % 2 === 0); tone({ f: 1400, f2: 200, dur: 0.8, vol: 0.14, type: 'sine' }); },
    timeResume: () => { tone({ f: 200, f2: 1400, dur: 0.5, vol: 0.14, type: 'sine' }); noise({ f: 300, f2: 3000, q: 0.5, dur: 0.6, vol: 0.2 }); },
    portal: () => { tone({ f: 300, f2: 1200, dur: 0.6, vol: 0.12, type: 'sine' }); noise({ f: 500, f2: 3000, q: 0.6, dur: 0.6, vol: 0.14, a: 0.1 }); bell(ctx.currentTime + 0.2, 86, 0.18, bus); },
    explode: (o) => { noise({ f: 900, f2: 120, q: 0.5, dur: 0.3, vol: 0.14 * (o.v || 1), ft: 'lowpass', pan: o.pan }); tone({ f: 140, f2: 50, dur: 0.25, vol: 0.12 * (o.v || 1), type: 'sine', pan: o.pan }); },
    zap: (o) => { noise({ f: 3000, f2: 1200, q: 3, dur: 0.12, vol: 0.08, pan: o.pan }); tone({ f: 1800 + rand(600), f2: 600, dur: 0.1, vol: 0.05, type: 'sawtooth', lp: 4000 }); },
    freeze: (o) => { noise({ f: 7000, f2: 3000, q: 1, dur: 0.18, vol: 0.06, ft: 'highpass', pan: o.pan }); tone({ f: 2400, dur: 0.12, vol: 0.04 }); },
    shatter: (o) => { noise({ f: 5000, f2: 1500, q: 0.8, dur: 0.25, vol: 0.1, pan: o.pan }); tone({ f: 3200, f2: 2000, dur: 0.15, vol: 0.05, type: 'triangle' }); },
    beam: () => { tone({ f: 600, f2: 1200, dur: 0.8, vol: 0.07, type: 'sawtooth', lp: 3000 }); tone({ f: 900, f2: 1800, dur: 0.8, vol: 0.05, type: 'triangle' }); },
    candy: () => { const t = ctx.currentTime; bell(t, 86, 0.14, bus); bell(t + 0.05, 90, 0.12, bus); },
    gold: () => { const t = ctx.currentTime; [74, 78, 81, 86, 90, 93, 98].forEach((m, i) => bell(t + i * 0.05, m, 0.2, bus)); },
    chest: () => { const t = ctx.currentTime; noise({ f: 800, f2: 300, q: 1, dur: 0.2, vol: 0.14 }); [81, 86, 90].forEach((m, i) => bell(t + 0.1 + i * 0.06, m, 0.2, bus)); },
    gachaRoll: () => { const t = ctx.currentTime; for (let i = 0; i < 12; i++) tone({ f: 500 + i * 80, dur: 0.06, vol: 0.05, type: 'triangle', t: t + i * 0.06 }); },
    reveal: (o) => {
      const t = ctx.currentTime, r = o.r || 'N';
      const seq = { N: [74, 78, 81], R: [74, 78, 81, 86], SR: [74, 78, 81, 86, 90], SSR: [62, 69, 74, 78, 81, 86, 90, 93] }[r];
      seq.forEach((m, i) => bell(t + i * 0.07, m, 0.22, bus));
      if (r === 'SSR' || r === 'SR') { noise({ f: 300, f2: 6000, q: 0.4, dur: 1, vol: 0.18 }); tone({ f: 110, f2: 55, dur: 1.2, vol: 0.25, type: 'triangle' }); }
    },
    starLight: () => { const t = ctx.currentTime; bell(t, 86, 0.2, bus); bell(t + 0.08, 93, 0.18, bus); tone({ f: 600, f2: 1800, dur: 0.3, vol: 0.06 }); },
    /* v0.6 地图互动 */
    mapNear: (o) => { const t = ctx.currentTime; bell(t, 81, 0.1, bus); bell(t + 0.09, 88, 0.08, bus); tone({ f: 900, f2: 1300, dur: 0.25, vol: 0.03, pan: o.pan }); },
    mapCharge: (o) => tone({ f: 500 + (o.k || 0) * 900, f2: 560 + (o.k || 0) * 900, dur: 0.07, vol: 0.035, type: 'triangle', pan: o.pan }),
    ringPass: (o) => { const t = ctx.currentTime, k = o.k || 0; bell(t, 79 + k * 4, 0.2, bus); tone({ f: 700 + k * 200, f2: 1500 + k * 300, dur: 0.18, vol: 0.05 }); },
    spin: () => { const t = ctx.currentTime; for (let i = 0; i < 9; i++) tone({ f: 1400 - i * 60, dur: 0.03, vol: 0.05, type: 'square', lp: 2600, delay: i * (0.05 + i * 0.012) }); },
    mapDone: () => { const t = ctx.currentTime; [69, 74, 78, 81, 86, 90].forEach((m, i) => bell(t + i * 0.055, m, 0.2, bus)); noise({ f: 400, f2: 4000, q: 0.5, dur: 0.5, vol: 0.12, a: 0.1 }); },
    bridge: () => { const t = ctx.currentTime; [62, 66, 69, 74, 78, 81, 86].forEach((m, i) => bell(t + i * 0.07, m, 0.2, bus)); tone({ f: 220, f2: 440, dur: 0.9, vol: 0.12, type: 'triangle' }); },
    rescue: () => { const t = ctx.currentTime; noise({ f: 2600, f2: 900, q: 1, dur: 0.2, vol: 0.12 }); [78, 83, 86, 90].forEach((m, i) => bell(t + 0.1 + i * 0.08, m, 0.2, bus)); },
    // 装备掉落（§6.8）：越稀有越亮、越长；金色是专属的一声
    lootBlue: () => { const t = ctx.currentTime; [76, 83].forEach((m, i) => bell(t + i * 0.06, m, 0.16, bus)); },
    lootYellow: () => { const t = ctx.currentTime; [74, 79, 86].forEach((m, i) => bell(t + i * 0.06, m, 0.18, bus)); tone({ f: 880, f2: 1320, dur: 0.25, vol: 0.05, type: 'triangle' }); },
    lootGreen: () => { const t = ctx.currentTime; [67, 74, 79, 83, 86].forEach((m, i) => bell(t + i * 0.07, m, 0.2, bus)); tone({ f: 330, f2: 660, dur: 0.6, vol: 0.1, type: 'triangle' }); },
    lootGold: () => { const t = ctx.currentTime; tone({ f: 60, f2: 40, dur: 0.6, vol: 0.35, type: 'sine' }); noise({ f: 3000, f2: 600, q: 0.7, dur: 0.5, vol: 0.14 }); [62, 69, 74, 78, 81, 86, 90].forEach((m, i) => bell(t + 0.12 + i * 0.07, m, 0.22, bus)); },
    pickLoot: (o) => { const t = ctx.currentTime, k = o.k || 0; bell(t, 72 + k * 3, 0.14, bus); tone({ f: 500 + k * 120, f2: 900 + k * 160, dur: 0.08, vol: 0.05 }); },
    cargoShip: () => { const t = ctx.currentTime; noise({ f: 300, f2: 1800, q: 0.6, dur: 0.6, vol: 0.14, a: 0.05 }); [64, 71, 76, 83].forEach((m, i) => bell(t + 0.3 + i * 0.09, m, 0.18, bus)); },
    giantWake: () => { tone({ f: 70, f2: 110, dur: 1.6, vol: 0.3, type: 'sine', a: 0.4 }); tone({ f: 140, f2: 220, dur: 1.4, vol: 0.12, type: 'triangle', a: 0.5 }); const t = ctx.currentTime; [57, 64, 69].forEach((m, i) => bell(t + 0.5 + i * 0.18, m, 0.2, bus)); },
  };

  let quiet = false; // 联机断线回来“从开局重算追帧”时静音：重算只为了得到状态，不再放一遍声音
  function sfx(name, o = {}) {
    if (!ctx || ctx.state !== 'running' || cfg.muted || quiet) return;
    const now = performance.now(), gap = o.gap !== undefined ? o.gap : 28;
    if (throttle[name] && now - throttle[name] < gap) return;
    // 分层与上限：破甲 / 终结 / 受击优先，短时间内压掉碎声；同屏声部最多 10 个碎声
    if (LOW.has(name) && now < duckUntil) return;
    while (recent.length && now - recent[0] > 60) recent.shift();
    if (LOW.has(name) && recent.length >= 10) return;
    recent.push(now); throttle[name] = now;
    if (o.prio) duckUntil = now + 140;
    const fn = SFX[name];
    bus = focusOn && !o.ui && duckBus ? duckBus : sfxBus;
    if (fn) { try { fn(o); } catch (e) { /* ignore a dropped voice */ } }
    bus = sfxBus;
  }
  function focus(on) { if (focusOn === !!on) return; focusOn = !!on; applyVolumes(); }

  return { init, configure, setMode, setBoost, setBpm, setCardMods, sfx, focus, get ready() { return !!ctx; }, get mode() { return mode; }, get quiet() { return quiet; }, set quiet(v) { quiet = !!v; } };
})();
