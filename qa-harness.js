/*
 * NEON FIST — headless visual QA (Playwright + Chromium)
 * ------------------------------------------------------------------
 * Loads neon-fist.html?qa in headless Chromium, drives frames and input
 * through the window.__NF hook, and writes PNGs of the 384x216 canvas at
 * 1x and 3x (nearest-neighbour) so you can judge the pixels, not the code.
 *
 *   npm i -g playwright && npx playwright install chromium   (once)
 *   node qa-harness.js play     scripted session -> shots/play-*.png
 *   node qa-harness.js poses    every pose on a flat backdrop, all kits
 *   node qa-harness.js ko       knockdown poses, airborne and grounded
 *   node qa-harness.js stage 2  first screens of a given stage
 *   node qa-harness.js all
 *
 * If playwright is installed globally, run with
 *   NODE_PATH=$(npm root -g) node qa-harness.js all
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const GAME = path.join(__dirname, 'neon-fist.html');
const OUT = path.join(__dirname, 'shots');

async function boot() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1152, height: 648 } });
  page.on('pageerror', (e) => console.error('PAGE ERROR:', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.error('CONSOLE:', m.text()); });
  await page.goto('file://' + GAME + '?qa');
  await page.waitForFunction(() => window.__NF);
  fs.mkdirSync(OUT, { recursive: true });

  const g = {
    page, browser,
    async key(code, down) { await page.evaluate(([c, d]) => window.__NF.key(c, d), [code, down]); },
    async tap(code, frames = 2) { await g.key(code, true); await g.step(frames); await g.key(code, false); },
    async step(frames, ms = 16.7) { await page.evaluate(([n, m]) => { for (let i = 0; i < n; i++) window.__NF.frame(m); }, [frames, ms]); },
    async shot(name) {
      const data = await page.evaluate(() => {
        const c = document.getElementById('c');
        const big = document.createElement('canvas');
        big.width = c.width * 3; big.height = c.height * 3;
        const x = big.getContext('2d'); x.imageSmoothingEnabled = false;
        x.drawImage(c, 0, 0, big.width, big.height);
        return [c.toDataURL('image/png'), big.toDataURL('image/png')];
      });
      fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(data[0].split(',')[1], 'base64'));
      fs.writeFileSync(path.join(OUT, name + '@3x.png'), Buffer.from(data[1].split(',')[1], 'base64'));
      console.log('  ' + name + '.png');
    },
    async eval(fn, arg) { return page.evaluate(fn, arg); },
    async close() { await browser.close(); }
  };
  return g;
}

// --------------------------------------------------------------------------
async function play() {
  console.log('play:');
  const g = await boot();
  await g.step(30);
  await g.shot('play-01-title');

  await g.tap('Enter');
  await g.step(20);
  await g.shot('play-02-stage-start');
  await g.step(80);
  await g.shot('play-03-intro-done');

  await g.key('ArrowRight', true);
  await g.step(90);
  await g.shot('play-04-walking');
  await g.key('ArrowRight', false);

  for (let r = 0; r < 10; r++) {
    await g.tap('KeyJ', 3); await g.step(8);
    await g.tap('KeyK', 3); await g.step(14);
    await g.key('ArrowRight', true); await g.step(20); await g.key('ArrowRight', false);
  }
  await g.shot('play-05-combat');

  await g.key('ArrowDown', true); await g.step(6);
  await g.shot('play-06-duck');
  await g.tap('KeyK', 3); await g.step(5);
  await g.shot('play-07-sweep');
  await g.key('ArrowDown', false); await g.step(12);

  await g.tap('ArrowUp'); await g.step(8);
  await g.tap('KeyK', 3); await g.step(2);
  await g.shot('play-08-jumpkick');
  await g.step(40);

  // force the boss: teleport near the gate
  await g.eval(() => { const p = window.__NF.player(); const s = window.__NF.scene(); p.x = s.bossGate - 40; window.__NF.cam.x = p.x - 150; });
  await g.key('ArrowRight', true);
  await g.step(60);
  await g.key('ArrowRight', false);
  await g.step(30);
  await g.shot('play-09-boss-intro');
  for (let r = 0; r < 40; r++) {
    await g.step(10);
    await g.tap('KeyK', 3); await g.step(6);
    await g.key('ArrowRight', true); await g.step(6); await g.key('ArrowRight', false);
  }
  await g.shot('play-10-boss-fight');
  await g.step(200);
  await g.shot('play-11-later');
  await g.close();
}

// --------------------------------------------------------------------------
async function poses(list) {
  console.log('poses:');
  const g = await boot();
  const names = list && list.length ? list : ['idle', 'idle2', 'walk0', 'walk1', 'walk2', 'walk3', 'punchup', 'punch', 'lowpunch',
    'kickup', 'kick', 'crouch', 'sweep', 'jump', 'jumpkick', 'uppercut', 'hurt', 'hurtlow', 'grab', 'grabbed', 'throwup', 'throw', 'win'];
  const kits = ['hero', 'punk', 'bruiser', 'knifer', 'boss'];
  // sheets get a bigger canvas: 96px sprites need 120px rows
  await g.eval(() => { const c = document.getElementById('c'); c.width = 640; c.height = 480; });
  for (const kit of kits) {
    let page = 0;
    for (let i = 0; i < names.length; i += 20) {
      const chunk = names.slice(i, i + 20);
      await g.eval(([chunk, kit]) => {
        const h = window.__NF, ctx = h.ctx();
        ctx.fillStyle = '#2a2438'; ctx.fillRect(0, 0, 640, 480);
        h.cam.x = 0;
        chunk.forEach((name, j) => {
          const col = j % 5, row = Math.floor(j / 5);
          const x = 64 + col * 128, y = 108 + row * 120;
          ctx.fillStyle = '#1e1a2a'; ctx.fillRect(x - 60, y, 120, 1);
          h.drawFighter({ kit: h.KIT[kit], x, y, face: 1, pose: name, state: name, flash: 0 });
          h.textC(name, x, y + 4, '#c8c0d8', 1);
        });
      }, [chunk, kit]);
      await g.shot('poses-' + kit + '-' + page);
      page++;
    }
  }
  console.log('  (' + names.join(', ') + ')');
  await g.close();
}

// --------------------------------------------------------------------------
async function ko() {
  console.log('ko:');
  const g = await boot();
  await g.eval(() => {
    const h = window.__NF, ctx = h.ctx();
    ctx.fillStyle = '#2a2438'; ctx.fillRect(0, 0, h.W, h.H);
    h.cam.x = 0;
    const cast = [['punk', 'ko'], ['bruiser', 'ko2'], ['boss', 'ko'], ['hero', 'ko2'], ['punk', 'sprawl'], ['bruiser', 'sprawl'], ['hero', 'sprawl'], ['knifer', 'sprawl']];
    cast.forEach(([type, pose], i) => {
      const x = 70 + (i % 4) * 90, y = i < 4 ? h.GY - 70 : h.GY;
      h.drawFighter({ kit: h.KIT[type], x, y, face: 1, pose, state: pose, flash: 0 });
      h.textC(type + ' ' + pose, x, y + 4, '#c8c0d8', 1);
    });
  });
  await g.shot('ko-sheet');
  await g.close();
}

// --------------------------------------------------------------------------
async function stage(n) {
  console.log('stage ' + n + ':');
  const g = await boot();
  await g.eval((n) => window.__NF.startStage(n), n);
  await g.step(140);
  await g.shot('stage-' + n + '-a');
  await g.key('ArrowRight', true); await g.step(200); await g.key('ArrowRight', false);
  await g.shot('stage-' + n + '-b');
  await g.eval(() => { const p = window.__NF.player(); p.x += 900; window.__NF.cam.x = p.x - 150; });
  await g.step(30);
  await g.shot('stage-' + n + '-c');
  await g.close();
}

// --------------------------------------------------------------------------
(async () => {
  const mode = process.argv[2] || 'all';
  if (mode === 'play') await play();
  else if (mode === 'poses') await poses(process.argv.slice(3));
  else if (mode === 'ko') await ko();
  else if (mode === 'stage') await stage(+(process.argv[3] || 1));
  else { await play(); await poses(); await ko(); await stage(1); await stage(2); }
  console.log('\nwrote to ' + OUT);
})().catch((e) => { console.error(e); process.exit(1); });
