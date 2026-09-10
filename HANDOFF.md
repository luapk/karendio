# NEON FIST — handoff

A single-file browser beat-'em-up in the style of Irem's *Kung-Fu Master* (1984), art-directed
from an AI-generated pixel-art video clip. No build step, no dependencies, no assets — every
sprite and every background tile is drawn procedurally with `fillRect` calls into a 320×224
canvas that is CSS-upscaled with `image-rendering: pixelated`.

**Files:** `neon-fist.html` (the game), `qa-harness.js` (headless visual QA), this document.

**Deliverable:** `neon-fist.html` — 2,117 lines, ~2,000 of which are the single inline `<script>`.
Open it in a browser. That's the whole thing.

---

## 1. Run it

```bash
open neon-fist.html          # macOS
xdg-open neon-fist.html      # Linux
```

No server needed. WebAudio initialises on first keypress or tap (browser autoplay policy),
so there is deliberately no sound on the title screen until the player touches something.

**Controls:** ← → move · ↑ jump · ↓ duck · J punch · K kick · M mute · Enter start.
On-screen thumb pad appears on touch devices (`@media (hover: none)`).

---

## 2. Architecture

One IIFE, no modules, `var` throughout, ES5-compatible. Sections are marked by banner comments
in this order:

| Line | Section | What lives there |
|---|---|---|
| 6 | CANVAS | `W`, `H`, `HUD_H`, `GY` and the 2D context |
| 17 | 5×7 BITMAP FONT | `GLYPH` table, `text()`, `textSh()`, `textOut()`, `textW()` |
| 127 | PALETTES | `PAL` (world), `HERO` (the lead), `KIT` (all four fighters) |
| 182 | POSES | `POSE` table + `WALKSEQ` |
| 295 | FIGURE RENDERER | `rectM`, `drawHero` and helpers, `drawFighter`, `drawKO` |
| 838 | BACKGROUND | `buildScene`, `drawBackground`, `drawSign`, `drawProp`, `mulberry` |
| 1183 | GAME STATE | globals, `newPlayer`, `makeEnemy`, `startStage`, `resetGame` |
| 1250 | EFFECTS | `spawnFx`, `spawnSparks`, `spawnCoins` |
| 1283 | AUDIO | `audioInit`, `tone`, `noise`, `SFX`, `musicTick` |
| 1367 | INPUT | keyboard map, pointer handlers for the thumb pad |
| 1421 | COMBAT HELPERS | `ATK` table, `inReach`, `hurtEnemy`, `hurtPlayer` |
| 1481 | UPDATE | `updatePlayer`, `updateEnemy`, `spawnWave`, `updateWorld` |
| 1775 | HUD + OVERLAYS | `drawHUD`, `drawTitle`, `drawClear`, `drawOver` |
| 1888 | RENDER | `render` — draw order and post effects |
| 1953 | MAIN LOOP | `frame` — state machine, fixed-ish timestep |

### Coordinate systems

There are two, and mixing them up is the easiest way to break the art.

**World space** — `x` is the horizontal position along the stage (0 … `stageW`), `y` is the
character's *feet*. `GY = 200` is the pavement line. Airborne means `y < GY`.

**Sprite space** — origin `(0, 0)` is the feet centre of the sprite, **up is negative**,
`+x` is the direction the fighter is facing. All pose data is in sprite space. `rectM()` does
the mirroring: pass `face = -1` and it flips `x` to `-(x + w)` before drawing. Never mirror by
hand; always go through `rectM` or the local `R()` closures.

### The skeleton

96 pixels tall, authored directly at final scale:

```
head    18 × 22   y −96 … −74
torso   20 × 28   y −70 … −42
hips    18 × 10   y −42 … −32
thigh    9 × 15   y −32 … −17
shin     9 × 11   y −17 …  −6
foot    14 ×  6   y  −6 …   0
arm      7 wide, 15 upper + 13 forearm + 8×8 fist
```

A `POSE` entry is `{ head, torso, hips, armB, armF, legB, legF, footB, footF }`. `head`, `torso`,
`hips` and the feet are single `[x, y, w, h]` rects; the arms and legs are arrays of segments.
Arms are `[upper, forearm, fist]`; legs are `[thigh, shin]` with the foot separate. `B` = back
(far) limb, drawn behind the torso; `F` = front (near) limb, drawn in front.

Poses currently defined: `idle`, `walk0`–`walk3`, `punchup`, `punch`, `kickup`, `kick`,
`crouch`, `sweep`, `jump`, `jumpkick`, `hurt`. `walk2`/`walk3` are generated at load by
swapping front and back limbs of `walk0`/`walk1`, which is what makes the four-beat cycle
alternate legs properly.

---

## 3. Rules learned the hard way

These are not style preferences. Each one is a bug that shipped and had to be undone.

**Never apply a non-uniform transform to pose data.** An earlier version authored poses at
half scale and remapped them with a piecewise function (legs ×1.3, torso ×0.85) to fix
proportions. Because the map scaled a rect's height as well as its position, the *same limb*
came out a different thickness depending on which body zone it sat in — the punch arm thinned,
the sweep leg fattened, and rects crossing a zone boundary stretched. Independent rounding
per rect then opened 1px seams at the joints. If proportions need changing, edit the pose
table by hand.

**Sprite scale must be an integer.** The boss was drawn at `sc: 1.12` and resampled every
frame. Everything is `sc: 1` now. Widen heavies with `kit.fat` instead, which widens the torso
rect symmetrically without touching anything else.

**Outline in one pass, then fill.** Drawing `outline → fill` per body part paints the outline of
each part over the part drawn before it, producing a tiled-mosaic look. Collect the rects,
draw every outline first (`#0c0a12`, 1px expansion), then draw every fill. `drawKO` shows the
pattern. The one deliberate exception is `drawHero`, which re-outlines the front arm *after*
the torso to keep a separation line between arm and chest.

**Horizontal limbs have a shoulder end.** `heroSleeve(r, R, H, right)` takes a `right` flag
because a rearward-pointing arm has its shoulder at `+x`. Without it, sleeve cuffs land on
elbows. `right` is passed as the `back` flag from `heroArm`.

**No `localStorage`.** Not supported in the Claude artifact sandbox. High score is in-memory
and resets on reload — deliberate, don't "fix" it.

---

## 4. Combat model

Single plane, no depth movement — faithful to the 1984 original.

```js
ATK = {
  punch:    { reach: 52, from: 16, dmg: 1, dur: 0.24, active: [0.05, 0.16], high: true,  kb: 80  },
  kick:     { reach: 62, from: 20, dmg: 2, dur: 0.36, active: [0.10, 0.26], high: true,  kb: 160 },
  sweep:    { reach: 54, from: 16, dmg: 2, dur: 0.36, active: [0.09, 0.26], high: false, kb: 140 },
  jumpkick: { reach: 54, from: 16, dmg: 3, dur: 0.5,  active: [0.02, 0.5],  high: true,  kb: 200 }
}
```

`inReach` is 1D along `x` with a ±60 band on `y`. Attacks land once per swing per target via
`hitSet`, keyed by entity id.

**The core mechanic is the tell.** Enemies telegraph before striking: cyan chevron = high
attack, duck it; magenta = low attack, jump it. High attacks miss a crouching player, low
attacks miss an airborne one. This is what stops the game being a mash, so preserve it in any
balance change. `attackTokenFree()` caps simultaneous attackers at one (two from level 3).

**Enemies:** punk (3hp, fast), bruiser (6hp, slow, heavy), boss (13 + 4×level hp, both attack
heights). On death they are launched on an arc — `vy = −230`, gravity 900 — tumble in the
airborne KO pose, land with a dust burst and screen shake, then settle sprawled.

**Feel:** 45ms hitstop on contact (`freeze`), screen shake, white flash on the struck fighter,
red screen flash and `@#!?` on player damage, coin burst on kills.

**Stage flow:** walk right, waves spawn from the screen edges, boss appears at `bossGate`,
camera locks, 90s timer, time bonus on clear, difficulty scales off `lvl()` (= `stage − 2`,
so the displayed "STAGE 3-2" is level 1).

---

## 5. Visual QA harness (important)

This project was built without ever seeing a browser. Every art decision was checked by
running the game headlessly under `node-canvas` and dumping PNGs. **Do the same before
claiming any visual change works** — pixel art at this scale routinely looks wrong in ways
that are invisible in the source.

```bash
npm install canvas          # only dependency, only needed for QA
node qa-harness.js all      # or: play | poses | ko
```

Output lands in `shots/`. Upscale with nearest-neighbour before judging anything — at 1× you
cannot see what you are actually shipping:

```bash
ffmpeg -i shots/play-04-combat.png -vf "scale=iw*4:ih*4:flags=neighbor" big.png
```

| Mode | What it gives you |
|---|---|
| `play` | Scripted session: title, stage start (the Ferrari is always the first prop), walking, combat, duck, sweep, jump kick, boss fight |
| `poses` | Every pose on a flat backdrop, paged. `node qa-harness.js poses kick kickup` to check just two |
| `ko` | Knockdown poses — airborne tumble and grounded sprawl, all four fighters |

`qa-harness.js` stubs `document`, `window`, `performance` and `requestAnimationFrame`, runs the
script in a `vm` context, and drives input by calling the captured keydown handlers directly.
`AudioContext` is deliberately absent from the stub so `audioInit()` bails out. For the sprite
sheets it injects `window.__hook = { drawFighter, POSE, cam, KIT, HERO, ctx, W, H, GY }` before
the IIFE closes, which lets it pose fighters arbitrarily. Canvas dimensions are read out of the
HTML, so the harness survives resolution changes.

Things this catches that reading code does not: white blobs where three 1px stripes should be,
awnings slicing through characters at head height, signage clipped by a taller neighbouring
building, impact words stacking on top of each other, limbs detaching at joints.

---

## 6. Art direction reference

Source was a 15s 1080×1920 clip plus two *Kung-Fu Master* screenshots and a photo of the
person the lead is based on.

**Karen** — dark shaggy bob with a soft uneven fringe and pieces past the jaw; brown irises in
visible white with liner and a catchlight; nose stud, jaw hoop, stacked silver chains; black
three-stripe cropped tee; bare tattooed midriff with an inset waist; denim cut-offs with a
studded belt and frayed hem; knee-high black Converse with four eyelet pairs and white rubber
toe caps.

**Thugs** — skull-masked punk in an open leather jacket over a red tee; bald bruiser in a
stained vest with a gold rope and medallion; suited boss in wraparound shades with a red tie.

**Street** — brick facades with staggered mortar and cornices, lit shopfronts with transoms and
menu boards, neon (ARCADE, KAREN DIO, faux-kana, BRIDGE), striped awnings above head height,
fire escapes, a yellow Lamborghini and a blue Ferrari at the kerb, diamond-motif kerb band.

Palette lives in `PAL`, `HERO` and `KIT`. Sampled from the clip — don't invent new colours,
reuse these.

---

## 7. Known rough edges / next moves

- **Idle is a single static frame.** A two-frame breathing cycle would help; the walk cycle
  already carries the fluidity load alone.
- **No hit reaction variety.** One `hurt` pose for every attack type.
- **Bruiser has no grab.** Was scoped and cut; the AI states (`walk`/`idle`/`wind`/`atk`/
  `hurt`/`ko`) have room for it.
- **No attract-mode demo loop.** The title screen pans the alley but nobody fights.
- **Music is one 16-step loop** in `BASS`/`LEAD`, no variation between stages.
- **Stages are procedurally identical** past the seed — same generator, different `mulberry`
  seed per stage. A second tileset (Camden, per the original brief) would be a palette and
  signage swap in `FACADE`/`FRONTS`/`SIGNS`, not a rewrite.
- **Enemy cap is 3.** At 96px sprites on a 320px-wide screen, four is a scrum.

## 8. If you change the art

Work at 4× or greater zoom on a flat backdrop before putting anything back in the scene. Half
the mistakes in this project came from judging a sprite at 1× against a busy brick background,
where a detail that reads as "tattoo" in isolation reads as "dirt" in context — and the reverse.
