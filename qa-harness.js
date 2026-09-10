/*
 * NEON FIST — headless visual QA
 * ------------------------------------------------------------------
 * Runs the game under node-canvas with a stubbed DOM so sprites and
 * scenes can be inspected as PNGs without a browser.
 *
 *   npm install canvas
 *   node qa-harness.js play     scripted session -> shots/play-*.png
 *   node qa-harness.js poses    every pose on a flat backdrop
 *   node qa-harness.js ko       knockdown poses, airborne and grounded
 *   node qa-harness.js all
 *
 * Then look at the pixels, not the code:
 *   ffmpeg -i shots/play-04-combat.png -vf "scale=iw*4:ih*4:flags=neighbor" big.png
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createCanvas } = require('canvas');

const GAME = path.join(__dirname, 'neon-fist.html');
const OUT = path.join(__dirname, 'shots');

// --------------------------------------------------------------------------
// Load the game into a stubbed DOM
// --------------------------------------------------------------------------
function boot({ hook = false } = {}) {
  const html = fs.readFileSync(GAME, 'utf8');
  let src = html.match(/<script>([\s\S]*?)<\/script>/)[1];

  // Expose internals for the sprite sheets by injecting before the IIFE closes.
  if (hook) {
    src = src.replace(/\}\)\(\);\s*$/,
      'window.__hook = { drawFighter: drawFighter, POSE: POSE, cam: cam, ' +
      'KIT: KIT, HERO: HERO, ctx: ctx, W: W, H: H, GY: GY };\n})();');
  }

  const dims = html.match(/<canvas[^>]*width="(\d+)"[^>]*height="(\d+)"/);
  const canvas = createCanvas(+dims[1], +dims[2]);
  canvas.addEventListener = () => {};

  const listeners = {};
  const stubEl = () => ({
    addEventListener() {}, getAttribute() { return null; },
    classList: { add() {}, remove() {} }, style: {}, textContent: ''
  });

  const state = { raf: null, t: 0 };
  const win = {
    addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
    requestAnimationFrame: (fn) => { state.raf = fn; return 1; },
    performance: { now: () => state.t },
    Math, Date, JSON, console
    // AudioContext deliberately absent: audioInit() bails out early.
  };
  win.window = win;

  const doc = {
    getElementById: (id) => (id === 'c' ? canvas : stubEl()),
    querySelectorAll: () => [],
    addEventListener() {}
  };

  const ctx = {
    window: win, document: doc,
    performance: win.performance,
    requestAnimationFrame: win.requestAnimationFrame,
    setTimeout: () => {},
    console, Math, Date, JSON, Array, Object, String, Number, Boolean, Error
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);

  return {
    canvas,
    hook: win.__hook,
    key(code, down) {
      (listeners[down ? 'keydown' : 'keyup'] || [])
        .forEach((fn) => fn({ code, preventDefault() {} }));
    },
    step(frames, ms = 16.7) {
      for (let i = 0; i < frames; i++) {
        state.t += ms;
        const fn = state.raf;
        state.raf = null;
        if (fn) fn(state.t);
      }
    },
    shot(name) {
      fs.mkdirSync(OUT, { recursive: true });
      fs.writeFileSync(path.join(OUT, name + '.png'), canvas.toBuffer('image/png'));
      console.log('  ' + name + '.png');
    }
  };
}

// --------------------------------------------------------------------------
// Scripted play session
// --------------------------------------------------------------------------
function play() {
  console.log('play:');
  const g = boot();

  g.step(20);
  g.shot('play-01-title');

  g.key('Enter', true); g.step(2); g.key('Enter', false);
  g.step(30);
  g.shot('play-02-stage-start');   // first prop of every stage is the Ferrari

  g.key('ArrowRight', true);
  g.step(150);
  g.shot('play-03-walking');
  g.key('ArrowRight', false);

  for (let r = 0; r < 12; r++) {
    g.key('KeyJ', true); g.step(3); g.key('KeyJ', false); g.step(8);
    g.key('KeyK', true); g.step(3); g.key('KeyK', false); g.step(14);
    g.key('ArrowRight', true); g.step(20); g.key('ArrowRight', false);
  }
  g.shot('play-04-combat');

  g.key('ArrowDown', true); g.step(6);
  g.shot('play-05-duck');
  g.key('KeyK', true); g.step(6); g.key('KeyK', false);
  g.shot('play-06-sweep');
  g.key('ArrowDown', false); g.step(10);

  g.key('ArrowUp', true); g.step(2); g.key('ArrowUp', false); g.step(10);
  g.key('KeyK', true); g.step(3); g.key('KeyK', false);
  g.shot('play-07-jumpkick');
  g.step(40);

  g.key('ArrowRight', true);
  for (let r = 0; r < 60; r++) {
    g.step(20);
    g.key('KeyK', true); g.step(3); g.key('KeyK', false); g.step(6);
  }
  g.key('ArrowRight', false);
  g.shot('play-08-boss');

  g.step(300);
  g.shot('play-09-later');
}

// --------------------------------------------------------------------------
// Pose sheet — judge sprites away from the busy background
// --------------------------------------------------------------------------
function poses(list) {
  console.log('poses:');
  const g = boot({ hook: true });
  const h = g.hook;
  const ctx = h.ctx;

  const names = list && list.length ? list : [
    'idle', 'walk0', 'walk1', 'walk2', 'walk3',
    'punchup', 'punch', 'kickup', 'kick',
    'crouch', 'sweep', 'jump', 'jumpkick', 'hurt'
  ];

  const perRow = 3;
  const colW = 106, rowH = 100;
  ctx.fillStyle = '#2a2438';
  ctx.fillRect(0, 0, g.canvas.width, g.canvas.height);
  h.cam.x = 0;

  let page = 0;
  const perPage = perRow * Math.max(1, Math.floor((g.canvas.height - 4) / rowH));
  for (let i = 0; i < names.length; i++) {
    const idx = i % perPage;
    if (i > 0 && idx === 0) {
      g.shot('poses-' + page);
      page++;
      ctx.fillStyle = '#2a2438';
      ctx.fillRect(0, 0, g.canvas.width, g.canvas.height);
    }
    const col = idx % perRow, row = Math.floor(idx / perRow);
    h.drawFighter({
      type: 'hero', kit: h.KIT.hero, sc: 1,
      x: 40 + col * colW, y: 100 + row * rowH,
      face: 1, pose: names[i], state: names[i], flash: 0
    });
  }
  g.shot('poses-' + page);
  console.log('  (' + names.join(', ') + ')');
}

// --------------------------------------------------------------------------
// Knockdown sheet — airborne tumble and grounded sprawl, all four fighters
// --------------------------------------------------------------------------
function ko() {
  console.log('ko:');
  const g = boot({ hook: true });
  const h = g.hook;
  const ctx = h.ctx;

  ctx.fillStyle = '#2a2438';
  ctx.fillRect(0, 0, g.canvas.width, g.canvas.height);

  const cast = [
    ['punk', false], ['bruiser', false], ['boss', false],
    ['punk', true], ['bruiser', true], ['hero', true]
  ];
  cast.forEach((entry, i) => {
    const [type, grounded] = entry;
    h.drawFighter({
      type, kit: h.KIT[type], sc: 1,
      x: 70 + (i % 3) * 100,
      y: grounded ? h.GY : h.GY - 60,
      face: 1, pose: 'idle', state: 'ko', flash: 0, grounded
    });
  });
  g.shot('ko-sheet');
}

// --------------------------------------------------------------------------
const mode = process.argv[2] || 'all';
if (mode === 'play') play();
else if (mode === 'poses') poses(process.argv.slice(3));
else if (mode === 'ko') ko();
else { play(); poses(); ko(); }
console.log('\nwrote to ' + OUT);
