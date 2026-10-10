# Run 2 report: Woolgather 2.0

The second 24-hour run, 2026-10-09 from 14:20. Plan: `docs/RUN2-PLAN.md`. Hour-by-hour notes:
`docs/RUN2-LOG.md`. Decisions: the CLAUDE.md DECISIONS log (entries marked "Run 2").

## The short version

You played it once and found it "kid game easy". It is not any more, and it has more to do:

- **It is hard now.** Every evening is short, the wolves come early, and from Old Angus on they
  hunt in **pairs**: one shows itself on your side of the flock and feints, while its mate circles
  round to the far side and waits for you to take the bait. Measured with two bots (below): the
  expert bot, which plays the way you do, has a fight; the average-skill bot wins a bit more than
  half the time.
- **Wolf Moon**: three stars on an evening opens a harder version of it (shorter, one more wolf,
  the full pack, one more sheep needed). The expert bot wins about 7 in 10.
- **Charms that do something**: The Outrun (Z and X together), **Old Fly** (F: Pip's mother lies
  down where he stands and holds that spot) and The Bell-wether. Pip's coats are won with ribbons
  and Wolf Moon stars.
- **A tenth evening, The Gathering**: every flock on the High Pass comes down for winter, and Old
  Fly comes along whether or not you have her charm.
- **Places you can tell apart**: landmarks where you herd (crags and screes, standing stones, a
  stell, a shieling, a jetty and boat, cairns, peat hags, the judges' box), each place its own
  ground (a buttercup pasture, a machair thick with flowers and shell sand, a heather moor, a stony
  pass), rounded loch shores, a closer camera, and a paper-and-ink map.
- **Feel**: sheep and wolves lean into turns and stand on the slope, sheep squash when they startle
  and watch Pip as he passes, the crowd applauds at the trial, gamepads rumble.
- **Live**: version 2.0.0 is deployed to https://woolgather.pages.dev with a new season section on
  the landing page (see the end of this report for the deploy check).

**The one knob**: `src/game/tuning.ts`. After you play, tell me "easier" or "harder" and it is one
number for the whole season (`day` scales every evening's length; `wolves`, `wolfSpeed` and
`wolfStart` do what they say).


## How hard it is now (measured)

Two bots play every evening through real key presses (`tests/season-run.mjs`). The **expert**
(`--skill expert`) herds by the textbook with perfect knowledge: it stands in for how you play.
The **average** bot (`--skill average`) stands in for a first-time player: it only reacts to
wolves it can see or that the game announced, 0.4 s late, runs at the nearest wolf (so a bait wolf
fools it), aims loosely, walks more and stops to look around.

On the 1.0-balanced season both bots won every evening, nearly all with three stars: that was
"kid game easy" in numbers. After the rebalance (pass 6, then small changes since):

| | Expert | Average (two seeds) |
| --- | --- | --- |
| Season evenings won | 10 of 10, most with 3 stars | 12 of 20 (60%), many on 1 star |
| Wolf Moon evenings won | about 7 of 10 | (not a target) |

The average bot's results swing a lot between seeds (5 of 10 on one, 9 of 10 on another), so treat
"about half" as the honest summary. The final numbers on the shipped build are under
**Verification** below.

## Verification (the shipped build)

| Check | Result |
| --- | --- |
| Build | clean (`tsc` and `vite build`) |
| Self-test (`npm run playtest`, frozen build) | 41 of 41 checks, 0 console errors |
| Expert bot, season | 10 of 10 won, all with three stars (Long Light 45 of 110 s, The Far Bank 119 of 140, Lambing Time 138 of 160, The Gathering 258 of 480, First Snow 271 of 440) |
| Expert bot, Wolf Moon | 6 of 10 won (Long Light, The Far Bank, Old Angus and The Storm lost at nightfall) |
| Average bot, season (seed 23) | 7 of 10 won (two with one or two stars) |
| Today's evening, four sample dates | expert 4 of 4, average 4 of 4, tight on some (tightened twice in the last hour) |
| Frame rate (`perf-season`, 1080p High) | 116-149 fps on every evening, 341-402 draw calls, no errors |
| Public site (`site-check`, local) | passes; the season section has no horizontal scroll on desktop or phone |

## What the critics said

Four critics score footage of the game from 1 to 10 without ever seeing the code (Gemini on the
video and on stills, two blind Claude subagents on contact sheets and stills). From this run on the
footage is played by the **average** bot, so it shows losses and pressure instead of tidy expert
wins; a control round (r04b) on the old build with the new footage separates the two effects.

| Round | Gemini video | Gemini stills | Claude video | Claude stills | Mean |
| --- | --- | --- | --- | --- | --- |
| r04 (end of run 1) | 8.13 | 7.00 | 6.63 | 7.00 | 7.19 |
| r04b (control: old build, new footage) | - | - | 7.25 | 7.13 | - |
| r05 | 7.63 | 7.25 | 7.00 | 7.13 | 7.25 |
| r06 | 7.38 | 7.88 | 7.13 | 7.00 | 7.35 |
| r07 | 7.75 | 7.63 | 7.13 | 7.00 | 7.38 |

The scores moved a little, not a lot: footage from a bot shows how the game looks, not how hard it
feels, and the critics' taste swings round by round (as in every earlier milestone). What they
consistently liked: the flock behaving like a flock, a new twist each evening, the progression, the
wolf rescues. What they still raise (and what happened to it):

- **Fixed this run**: boulders glowing white at night (a real bug: cached stone materials were
  taken for lamps on every level after the first); heather and dusk ground turning neon violet;
  the mist as a beige wash; the storm as a dark soup; snow-capped bushes reading as a flock; the
  trial pen stall (sheep now follow each other in) and grinding against hurdles; the low view in
  the grass; the cutaway interrupting a retry; the Wolf Moon card running off the screen; Old Fly
  reading as a fox; the trial warning about nightfall.
- **Better, still raised**: places looking alike from the herding camera (a blind "which place is
  this?" test went from 3 of 5 pairs right and 4/10 distinctness to 3 of 5 and 6/10: the loch,
  the corrie, the show field and the snow now read at a glance; Hollow Valley and the High Pass
  still look like each other without water in frame); sheep jamming at bridge ends (bridges are
  20% wider now, after the last round, so not yet re-judged); streams reading as grey roads.
- **Taste calls left alone**: the snatch banner and close-up (two critics call them intrusive,
  two praise them), the camera height (moved 12% closer once; asked for both ways), Old Angus's
  grey fleece.

## What changed, by area

- **Pressure**: wolves hunt as a pack from Old Angus on (bait and flanker, fair tells: an answered
  howl, a "Two wolves!" toast with an arrow, a growl, a pulsing minimap ring, a one-time tip);
  every evening rebalanced; lone wolves rarely go for sheep more than 100 m from Pip.
- **Depth**: Wolf Moon tier; verb charms (The Outrun, Old Fly, The Bell-wether) and a third slot;
  Pip's coats; a tenth evening, The Gathering.
- **Place**: landmarks as level data (`landmarks` in `level/*.json`, models from the new
  `blender_scripts/landmarks.py`); per-place ground (`cover` and `ground`); rounded loch shores
  with a broken waterline; a paper-and-ink minimap that follows the season.
- **Feel**: lean, slope tilt, squash, sheep watching Pip, fleece white at sunset, chips that dim
  once learned, applause at the trial, gamepad rumble, a closer camera.
- **Tests**: average-skill bot, `--moon`, `--dist`, the self-test on a frozen build (41 checks),
  blind place-test shots, evening stills, a heavy-mesh report.

## Spend

- Gemini: three critic rounds (r05, r06, r07), video and stills each; one video upload retried
  after a network error.
- ElevenLabs: none this run (the bell and the applause are synthesised; Fly's bark is Pip's recorded bark, pitched down).
- Claude subagents: the landmark models (Blender, headless), eight blind critic reviews, three
  blind place tests, a plan review.

## Open issues and next ideas

- **Your playtest is the real balance check.** Tell me easier or harder and it is one number in
  `src/game/tuning.ts`.
- Hollow Valley and the High Pass could still use more of a signature in the middle of the field.
- The dusk and night grade still reads murky to two critics.
- The Shed (split two raddled ewes off and pen them apart) is the obvious eleventh evening.
