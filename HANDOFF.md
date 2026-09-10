# NEON FIST — handoff

A single-file browser beat-'em-up in the style of Irem's *Kung-Fu Master* (1984), art-directed
from an AI-generated pixel-art video clip. No build step, no dependencies, no assets — every
sprite and every background tile is drawn procedurally into a 384×216 canvas that is upscaled
by an integer factor with `image-rendering: pixelated` (a 1080p screen shows it at a clean 5×).

**Files:** `neon-fist.html` (the game), `qa-harness.js` (headless visual QA on Playwright),
this document.

> **History.** The first build (320×224, ~2,100 lines) was described by an earlier version of
> this document but the HTML itself was never committed to the repo. This build is a rebuild
> from that document's spec — same architecture, coordinate systems, skeleton and rules — with
> the "known rough edges" list worked through and the presentation raised a level: parallax,
> neon glow, wet-street reflections, shaded sprites, four enemy types, combos, a special, a
> procedural soundtrack, an attract-mode demo, two stage themes, gamepad and touch input.

---

## 1. Run it

```bash
open neon-fist.html          # macOS
xdg-open neon-fist.html      # Linux
```

No server needed. WebAudio initialises on first keypress, tap or gamepad button (browser
autoplay policy), so there is deliberately no sound on the title screen until the player
touches something.

**Controls:** ← → move · ↑ jump · ↓ duck · **J** punch · **K** kick · **L** special (when the
SP meter is full) · Enter start · M mute · P pause · T toggle CRT scanlines.
WASD / Z X C also work. Gamepad: stick or d-pad, X/LB punch, A/RB kick, B/Y special, Start.
An on-screen thumb pad appears on touch devices (`@media (hover:none) and (pointer:coarse)`).

Moves: crouch + J = low jab, crouch + K = sweep, jump + K = flying kick, punch → kick chains
(press K during a punch's recovery). Mash J/K to break a bruiser's grab. Punch or kick a
thrown knife out of the air for 50 points.

Title screen idles into a demo after 12 s; any input returns to the title.

---

## 2. Architecture

One IIFE, `var` throughout, ES5-compatible syntax. Sections are marked by `// ====` banner
comments in this order (search for the banner name rather than a line number):

| Section | What lives there |
|---|---|
| CANVAS | `W=384`, `H=216`, `GY=192`, `HUD_H`, the 2D context, `mkCanvas`, integer `fit()`, `mulberry`, `shade`/`rgba` colour helpers, `QA` flag |
| 5×7 BITMAP FONT | `GLYPH` table, `text()`, `textSh()`, `textOut()`, `textC()`, `textW()` |
| PALETTES | `PAL` (world), `HERO` (the lead), `KIT` (all five fighters), `THEMES` is under BACKGROUND |
| POSES | `POSE` table + `WALKSEQ`; `walk2/3` and `idle2` are generated at load |
| FIGURE RENDERER | `drawFighter`, `decorate` (per-kit detail), `decorateArm`, `drawShadow` |
| BACKGROUND | `THEMES`, `buildScene`, `brickWall`, `makeSign`, `drawCar`, `drawBackground`, `drawWeather` |
| GAME STATE | `G`, `cam`, `newPlayer`, `makeEnemy`, `startStage`, `resetGame`, high score |
| EFFECTS | `spawnSparks`, `spawnDust`, `spawnCoins`, `spawnWord`, `updateFx`, `drawFx` |
| AUDIO | `audioInit`, `tone`, `noise`, `voice` (the kiai), `SFX`, `musicSet`, `musicTick` |
| INPUT | `KEYMAP`, `press`/`take` (150 ms input buffer), gamepad polling, touch pad wiring |
| COMBAT HELPERS | `ATK`, `ENEMY_ATK`, `inReach`, `evades`, tokens, `hurtEnemy`, `hurtPlayer` |
| UPDATE | `updatePlayer`, `updateEnemy`, `pickAttack`, `spawnWave`, `updateKnives`, `updateCamera`, `updateWorld` |
| ATTRACT-MODE AI | `demoThink` — drives the same input buffer as the keyboard |
| HUD + OVERLAYS | `drawHUD`, `drawTell`, `drawLogo`, `drawTitle`, `drawIntro`, `drawClear`, `drawOver`, `drawPause` |
| RENDER | `buildPost` (vignette, scanlines), `drawKnife`, `render` — draw order and post effects |
| MAIN LOOP | `enterTitle`, `tick` (state machine), `frame`, the `window.__NF` QA hook |

### Coordinate systems

There are two, and mixing them up is the easiest way to break the art.

**World space** — `x` is the horizontal position along the stage (0 … `scene.stageW`, which is
`7 × W`), `y` is the character's *feet*. `GY = 192` is the pavement line. Airborne means `y < GY`.
`cam.x` is subtracted at draw time; every world→screen conversion goes through `Math.round`.

**Sprite space** — origin `(0, 0)` is the feet centre of the sprite, **up is negative**,
`+x` is the direction the fighter is facing. All pose data is in sprite space. The `R()` closure
inside `drawFighter` and the `P()` closure handed to decorators do the mirroring: pass
`face = -1` and they flip `x` to `-(x + w)` before drawing. Never mirror by hand.

### Vertical layout of the scene (y)

```
  0-28   sky + far skyline (parallax 0.25)      88-95   awnings (must clear a standing head)
 28-48   rooflines / mid blocks (parallax 0.6)  96-168  shop windows, doors
 50-72   upper-floor windows                    168-192 base wall behind legs (kept plain)
 72-88   fascia + neon sign                     192-200 pavement   200-204 kerb   204-216 road
```

A standing sprite's head top is at `GY − 96 = 96`, so anything that must not cut through heads
lives above y = 95.

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
Arms are `[upper, forearm, fist]`; legs are `[thigh, shin]` with the foot separate, **or**
`[thigh, shin, foot]` with `footF: null` for a horizontal kick where the foot is part of the
leg. `B` = back (far) limb, drawn behind the torso; `F` = front (near) limb, drawn in front.
Horizontal limbs simply swap `w` and `h`. The neck is auto-filled between head and torso.

Poses: `idle`, `idle2` (breathing, generated), `walk0`–`walk3` (2/3 generated by swapping
near/far limbs), `punchup`, `punch`, `lowpunch`, `kickup`, `kick`, `crouch`, `sweep`, `jump`,
`jumpkick`, `uppercut`, `hurt`, `hurtlow`, `grab`, `grabbed`, `throwup`, `throw`, `win`,
`ko`, `ko2` (airborne tumble, alternated), `sprawl` (grounded).

### The figure renderer

`drawFighter(e)` collects every rect into a list, then:

1. draws every outline (`PAL.outline`, 1 px expansion) in one pass,
2. draws every fill with a 1 px darker bottom row and far-side column and a 1 px lighter top
   row (`shade()`), which is what gives the limbs volume,
3. runs the kit decorator (`decorate`): rounded head corners for everyone, then hair, face,
   clothing detail per kit in sprite space via `P()`,
4. re-outlines and re-fills the near arm so it separates from the chest, then `decorateArm`
   (sleeve stripes, knuckles, the knifer's blade).

`e.flash > 0` paints every fill white and skips decoration. `KIT[x].fat` widens the torso
symmetrically (bruiser 6, boss 2). Decorators check `flat` (head wider than tall) and skip
hair/face detail on the tumble and sprawl poses.

---

## 3. Rules learned the hard way

These are not style preferences. Each one is a bug that shipped and had to be undone.

**Never apply a non-uniform transform to pose data.** An earlier version authored poses at
half scale and remapped them with a piecewise function (legs ×1.3, torso ×0.85). The same limb
came out a different thickness depending on which body zone it sat in, and independent
rounding per rect opened 1 px seams at the joints. If proportions need changing, edit the pose
table by hand. Pure translations are fine — `idle2` is `idle` with the upper body moved 1 px.

**Sprite scale must be an integer.** Everything is 1×. Widen heavies with `kit.fat`.

**Outline in one pass, then fill.** Drawing `outline → fill` per body part paints the outline of
each part over the part drawn before it, producing a tiled-mosaic look. The one deliberate
exception is the near arm, which is re-outlined *after* everything else.

**Horizontal limbs have a shoulder end.** `decorateArm` checks `w >= h` on the upper arm and
puts the sleeve stripes at the shoulder end for a horizontal arm.

**Keep the band behind the legs plain.** Busy window interiors are held above y ≈ 168; the
base wall under the shop windows is flat tiles. Sprites judged against busy brick read as dirt.

**Awnings above heads.** Anything on the facade between y 96 and 192 sits behind the fighters;
awnings are at 88–95.

**`text()` draws through the global `ctx`.** To render text into an offscreen canvas, swap
`ctx` temporarily (`var save = ctx; ctx = other.x; …; ctx = save;`). `makeSign` and the
graffiti do this. Don't `const` the context.

**`localStorage` is wrapped in try/catch.** The Claude artifact sandbox has no storage; a real
browser does. The high score persists where it can and silently doesn't where it can't.

**Enemies pick an attack once, not per frame.** `pickAttack` is called when an enemy enters
`approach` and when its think timer runs out (`e.nextAtk`). Rolling it every frame meant a
bruiser's grab (shorter reach) never survived long enough to be used.

---

## 4. Rendering pipeline

`buildScene(stage)` pre-renders a whole stage once:

- `far` — sky bands (dithered), stars/moon or clouds, distant tower blocks with lit windows,
  a bridge on the canal theme. Drawn at `cam.x × 0.25`.
- `mid` — taller dark blocks that show above the rooflines. Drawn at `cam.x × 0.6`.
- `strip` — the facades, shopfronts, props, pavement, kerb, road, cars, lamp posts with baked
  light cones and pavement pools. Drawn at `cam.x`.
- `emit` — a transparent canvas holding only the emissive surfaces (lit windows, shop
  interiors, bulbs, lamps, signs). It is flipped, squashed to 28 %, blurred 1 px and painted onto
  the pavement/road with row breaks and a fade, which is what makes the street read as wet.
- `signs[]` — each neon sign has a crisp canvas and a blurred glow canvas (`makeSign`, using
  `ctx.filter = 'blur()'` with a multi-draw fallback). They are drawn live so they can pulse;
  about one in five is "broken" and stutters.

Per frame, `drawBackground` draws far → mid → strip → TV/arcade screen flicker → signs (glow
with `lighter` compositing, then crisp) → steam. Entities draw with drop shadows, downed
bodies first, player last. `drawWeather` adds rain on the Camden theme. Post: red/white
flashes, vignette, optional scanlines (`T`).

Two `THEMES` alternate by stage: **SOHO** (red brick, moon and stars, faux-kana hanging sign,
KAREN DIO club neon) and **CAMDEN** (black-painted brick, graffiti tags, market stalls, rain,
BRIDGE neon, canal skyline). A new theme is a palette + signage + prop-flag entry, not a
rewrite.

---

## 5. Combat model

Single plane, no depth movement — faithful to the 1984 original.

```js
ATK = {
  punch:    { reach: 52, from: 14, dmg: 1, dur: 0.24, active: [0.05, 0.16], high: true,  kb: 80  },
  kick:     { reach: 62, from: 18, dmg: 2, dur: 0.36, active: [0.10, 0.26], high: true,  kb: 160 },
  sweep:    { reach: 54, from: 14, dmg: 2, dur: 0.36, active: [0.09, 0.26], high: false, kb: 140 },
  lowpunch: { reach: 46, from: 12, dmg: 1, dur: 0.22, active: [0.04, 0.14], high: false, kb: 70  },
  jumpkick: { reach: 56, from: 14, dmg: 3, dur: 0.5,  active: [0.02, 0.5],  high: true,  kb: 200 },
  uppercut: { reach: 60, from: -10, dmg: 4, dur: 0.6, active: [0.02, 0.4],  all: true, invulnerable }
}
```

`inReach` is 1D along `x` with a ±60 band on `y`. Attacks land once per swing per target via
`hitSet`, keyed by entity id. Kicks, jump kicks and the uppercut leave afterimages (`ghosts`).

**The core mechanic is the tell.** Enemies telegraph before striking: cyan chevrons pointing
down = high attack, duck it; magenta chevrons pointing up = low attack, jump it. Each tell has
its own two-note blip. High attacks (and grabs) miss a crouching player, low attacks miss an
airborne one. This is what stops the game being a mash, so preserve it in any balance change.
`attackTokenFree()` caps simultaneous attackers at one (two from level 2, three from level 5).

**Enemies** (`ENEMY_DEF`, `ENEMY_ATK`):

| Type | HP | Speed | Behaviour |
|---|---|---|---|
| punk | 3 | 72 | fast; high punch, low sweep from level 1 |
| bruiser | 6 | 46 | slow; heavy high boot, or a **grab** that holds for 2.4 s draining 1 HP per 0.7 s then throws — mash J/K five times to break it and stagger him |
| knifer | 2 | 64 | keeps 100–170 px away and throws knives at head height (duck) or shin height (jump); jabs if cornered |
| boss | 13 + 4·level | 60 | both heights plus a long kick; winds up 25 % faster under 40 % HP; the only enemy that doesn't give up a windup when you back off |

On death enemies are launched (`vy = −230`), alternate `ko`/`ko2` while tumbling, land with a
dust burst and shake, sprawl for 1.4 s, blink out.

**Player:** 16 HP, 3 lives. Hits build `combo` (resets on damage, 1.3 s window); score
multiplier is `1 + 0.1 × combo` on kills. Every hit adds 14 % to the SP meter; at full, **L**
performs NEON FIST — an invulnerable rising uppercut hitting everything within 60 px for 4.
`hurtPlayer` gives 0.6 s of invulnerability after the hurt animation; respawn gives 2.2 s.

**Feel:** 45–90 ms hitstop scaled by damage (`G.freeze`), screen shake, white flash on the
struck fighter, red screen flash and `@#!?` on player damage, comic impact words that stack
instead of overlapping, coin burst and score popup on kills.

**Stage flow:** walk right, waves spawn from the screen edges (70 % ahead), boss appears at
`scene.bossGate` (stage end minus 0.55 screens), camera locks, 90 s timer, time and life bonus
on clear, difficulty scales off `lvl()` = `stage − 1` (enemy speed +8 %/level, windups −7 %/level
floored at 60 %, enemy cap 3 → 4 at level 3). Losing a life clears the street and refills the
timer; the boss steps back but keeps his damage.

**The kiai.** Every kick, sweep, jump kick and special throws a **"hee-ya"**. There are no
samples in this project, so `voice()` synthesises it: a sawtooth glottal source pushed through
two swept bandpass formants. /i/ as in "hee" sits at F1 300 / F2 2300, /a/ as in "ya" at
F1 760 / F2 1180, and gliding the pair at the syllable break is what makes it read as a voice
rather than a beep. The envelope dips between syllables and peaks higher on the "ya". Pitch and
formants are jittered per call, and `SFX.kiai` rate-limits to one shout per 0.42 s so a mashed
kick does not stack a dozen of them. The special shouts lower and longer.

Because the bandpass filters at Q 9-12 throw away most of the source energy, the formant gains
sit well above 1. Verify a change with `__NF.renderVoice()`, which renders it through an
`OfflineAudioContext` and hands back the buffer: peak RMS should land near 0.11 with max
|sample| under 0.4, and the zero-crossing rate must **fall** across the syllable break, which is
the cheap proof that the formants really glide.

**Music:** `musicTick` is a 16-step sequencer scheduled 120 ms ahead on `AC.currentTime`.
Drums are fixed; the bass follows one of three progressions by mode (`a` street, `b` rain,
`boss`, `title`); the lead is a seeded random walk on a minor scale, so every stage has its own
line and the boss theme is faster with a tritone bass. Everything is oscillators plus one
noise buffer.

---

## 6. Visual QA harness (important)

This project was built without ever seeing a browser interactively. Every art decision was
checked by rendering headlessly and dumping PNGs. **Do the same before claiming any visual
change works** — pixel art at this scale routinely looks wrong in ways that are invisible in
the source.

```bash
npm i -g playwright && npx playwright install chromium     # once
NODE_PATH=$(npm root -g) node qa-harness.js all            # or: play | poses | ko | stage N
```

Output lands in `shots/` as `name.png` (1×) and `name@3x.png` (nearest-neighbour 3×). Look at
the 3× files.

| Mode | What it gives you |
|---|---|
| `play` | Scripted session: title, intro banner, walking, combat, duck, sweep, jump kick, boss intro, boss fight |
| `poses` | Every pose for every kit on a flat backdrop (canvas enlarged to 640×480 for the sheet). `node qa-harness.js poses kick kickup` for a subset |
| `ko` | Tumble and sprawl poses for all fighters |
| `stage N` | Three screens along stage N (theme check) |

The game exposes `window.__NF` (frame stepping, key injection, `drawFighter`, `POSE`, `KIT`,
`cam`, `G`, `player()`, `enemies()`, `spawn()`, `ai()`); loading with `?qa` disables
`requestAnimationFrame` so the harness drives time deterministically with `__NF.frame(ms)`.
`__NF.ai(dt)` runs the attract-mode controller, which is how the AI soak test that found the
grab bug was run: several thousand frames of AI play, screenshots on first tell / grab / knife /
boss / clear / game over, with the per-frame ms and page errors logged.

Things this catches that reading code does not: awnings slicing through characters at head
height, signage clipped by a neighbouring building, impact words stacking, limbs detaching at
joints, a sheet row height that swallows the sprite below it.

---

## 7. Art direction reference

Source was a 15 s 1080×1920 clip plus two *Kung-Fu Master* screenshots and a photo of the
person the lead is based on.

**Karen** — art-directed from three photo references, which supersede the earlier clip-only
description. Dark hair with a **fringe kept short over the eyes** so the brows stay visible, and
**length falling well past the shoulder to mid-chest**, tapering, with a sheen down the back
mass. The fall is anchored to the torso rect rather than a fixed offset from the head, so it
shortens correctly when she crouches or leans into a kick. It is drawn late, after the collar,
chain, zip and logo, because hair hangs in front of the garment; the far arm's sleeve stripes
are drawn later still, since hair and sleeve are both near-black and letting the fall cover them
made the far sleeve look half erased. **Strong dark brows** and **winged liner** are the two features
that carry the likeness at this size; brown irises in visible white with a catchlight, nose stud,
jaw hoop, glossy lip with a highlight pixel. One **chunky curb chain** at the collarbone.

Kit, exactly as referenced: a **black three-stripe zip crop top** — stand collar, full-length
front zip with a pull, a small chest logo mark, and three white stripes running down each sleeve
from the shoulder seam. Then a **bare tattooed midriff** with an inset waist, **denim cut-offs**
with a studded belt and a frayed hem, bare thighs, and **knee-high black Converse** where the
whole shin is boot, with eyelet pairs up the shaft and white toe caps and soles.

Two things about that kit are load-bearing, not decoration:

- **The stripes and the denim are what make her readable.** A black top on a dark street is a
  camouflage problem. An earlier build solved it by turning the top white, which read instantly
  but was wrong. The correct fix is contrast *within* the silhouette: six white sleeve stripes, a
  blue denim band at the hips, a light skin mass across midriff and thighs, and white boot
  detail, plus a 1 px rim light down the front edge of the torso. Judge any change to her
  palette against `shots/play-05-combat@3x.png`, never against a flat backdrop.
- **The boot covers the entire shin.** On a raised leg that is a long black bar, so it needs
  internal detail or the high kick reads as a plank. The eyelet pairs and the knee-end cuff
  highlight exist for that reason. The cuff end is found from the foot rect, so it lands at the
  knee whichever way the leg points.

Sleeve tattoos are hinted as **one connected band on the forearm, never scattered dots** — at
this size loose specks on skin read as dirt, which is the same trap the art-direction rule at
the end of this document describes.

**The kick** is the character pose. It is a **high kick with the foot above the crown**, the leg
staggered forward across three segments so it reads as a diagonal rather than a vertical bar,
the torso and head leaning away from it, and both fists still up in guard. `kickup` is the
matching chamber (knee driven to the chest, shin folded). The kicking leg is authored longer
than the anatomical skeleton on purpose — segment *thickness* stays at the standard 9 px, which
is the rule that matters.

**Thugs** — skull-face-painted punk with spiked hair in an open leather jacket over a red tee;
bald bruiser in a stained vest with a gold rope and medallion and knuckle tattoos; hooded knifer
with a pocket hoodie and white trainers; suited boss in wraparound shades with a red tie and
pocket square.

**Street** — brick facades with staggered mortar and cornices, lit shopfronts with transoms and
menu boards, neon (ARCADE, KAREN DIO, faux-kana, BRIDGE), striped awnings above head height,
fire escapes, a yellow Lamborghini and a blue Ferrari at the kerb, diamond-motif kerb band.

Palette lives in `PAL`, `HERO` and `KIT`. Sampled from the clip — don't invent new colours,
reuse these.

---

## 8. Known rough edges / next moves

Roughly in order of how much they would change how the game feels:

- **Enemy hit reactions are one frame each.** `hurt`/`hurtlow` are static; a two-frame recoil
  (impact frame, then settle) would sell the hits more than any more particles.
- **No throw for the player.** Karen can break a grab but not grab back. A `throw` on
  punch-while-adjacent-and-holding-toward would give the bruiser a counterplay beyond ducking.
- **Boss has one body.** Every stage's boss is the same suit with more HP. A per-stage kit
  (a second boss with a weapon, say) is a `KIT` entry plus a decorator plus one or two poses.
- **Knifers only ever throw straight.** A knife with a slight arc (or a bottle) would make the
  duck/jump reads more interesting than a flat line.
- **The far layer doesn't animate.** A slow cloud drift, a train crossing the bridge on Camden,
  or a helicopter light would cost little and add life above the rooflines.
- **Music is fine, not memorable.** The lead is a random walk; a hand-written 8-bar hook per
  theme in `music.lead` would be better than any amount of procedural cleverness.
- **Third theme.** Chinatown-at-dawn (paper lanterns, a lightening sky) is a palette and
  signage swap in `THEMES` plus a lantern prop in the lot loop.
- **Enemy cap is 3–4.** At 96 px sprites on a 384 px screen, five is a scrum.
- **No two-player / alternating.** `newPlayer` and the HUD would need a second slot.

## 9. If you change the art

Work at 3× or greater zoom on a flat backdrop (`poses` sheet) before putting anything back in
the scene. Half the mistakes in this project came from judging a sprite at 1× against a busy
brick background, where a detail that reads as "tattoo" in isolation reads as "dirt" in context
— and the reverse.
