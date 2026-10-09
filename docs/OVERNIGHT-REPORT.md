# Overnight report: Woolgather 2, "The Season"

Night of 2026-10-08/09. Everything is on branch **`season`** (pushed to GitHub). `main` and the live
site (woolgather.pages.dev) are untouched on 1.0.0: nothing was merged or deployed.

To play it: `git checkout season`, `npm install`, `npm run dev`, open http://localhost:5317.
Enter on the title opens the season. To try any evening without unlocking it, open the browser
console with `?test=1` in the URL and run `__WG.progress('all')`.

## The short version

1.0 was one valley, one sunset and three difficulties. All four critics said the same thing about
it: beautiful, but a single map with no progression and little variety. So the night went into
making it a game you play through rather than one you finish once:

- **A season of nine evenings** on one hill farm, midsummer to the first snow, in **five places**.
  Each evening adds one new thing and has its own story card, star goals, a ribbon (an optional
  challenge) and a best time. Charms (perks) are bought with stars. Progress is saved.
- **New things to herd around**: lambs that follow their mothers (and a lost lamb that follows Pip
  once found), Old Angus the ram (he will not be pushed: stare him down or bark; he butts a dog that
  crowds him; the ewes follow him; wolves fear his horns), a black sheep that bolts, a night watch
  run backwards from night to dawn, a sheepdog trial at the village show (gates in order, judged on
  points), mist where you find the flock by its bleating, a storm whose thunder scatters the flock
  and whose flood closes the ford, and first snow.
- **New controls**: lie down (Q / gamepad B) stops the flock dead, as a real handler would at a gate.
- **A visual leap**: a living grass field (wind gusts roll across it, the animals part it), seasons
  (summer green, heather purple, autumn gold, snow), weather (overcast, rain, mist, snowfall, autumn
  leaves), a starling murmuration over the sunset, chimney smoke, rabbits that bolt from Pip, sheep
  trods worn across the hills, and a sunset cutaway: when the wolves come out the camera drops to a
  low shot into the western sky for three seconds.
- **Real sounds and music**: 32 recorded effects generated with ElevenLabs (bleats for ewes, lambs
  and the ram, barks, howls, thunder, rain, wind, stream, loch, dawn chorus) and a recorded score
  (an evening theme in D major, a dusk theme in D minor, a title piece and a win phrase), with the
  old synthesised tension layer playing over it when the wolves close in.
- **A critic system** that reviews gameplay video and stills as a random gamer who knows nothing
  about the code or the design decisions (Gemini 3.8 Flash on the video and the stills, plus two
  blind Claude critics), with a scoreboard.

## How the critics scored it

Means of eight 1-10 scores (look, readability, feel, fun, variety, progression, keep playing,
wishlist). Full tables and every review: `docs/critic/SCOREBOARD.md` and `docs/critic/r*/`.

SCORES_TABLE

## What the critics still say

REMAINING_ISSUES

## The places and evenings

| # | Evening | Place | Season | New thing |
|---|---------|-------|--------|-----------|
| 1 | Long Light | Hollow Valley | midsummer | herding; one early wolf |
| 2 | The Far Bank | Hollow Valley | midsummer | crossings (bridge and ford) |
| 3 | Lambing Time | Loch Ailsa | early summer | lambs, a lost lamb |
| 4 | Old Angus | Crannach Corrie | high summer | the ram |
| 5 | The Glenbrae Trial | Glenbrae Show Field | late summer | a sheepdog trial, judged on points |
| 6 | Night Watch | Loch Ailsa | late summer | survive until dawn |
| 7 | Mist on the Moor | The High Pass | autumn | mist, a black sheep |
| 8 | The Storm | Hollow Valley | autumn | thunder, a flood |
| 9 | First Snow | The High Pass | winter | everything at once |

The test bot (`tests/bot2.mjs`, an A* herding bot that works on any level) wins every evening,
mostly with three stars; see "Verification".

## Under the hood

- Levels are now data (`level/*.json`), and the ground, water, tracks and trods are generated at
  load time in TypeScript (a port of the Blender terrain script), per level and per season. A new
  place is a JSON file; no Blender round trip. Blender still makes the props and animals.
- The sim takes per-evening rules instead of three difficulty presets; the 1.0 game is still there
  as "Classic evening".
- Decisions are logged in `CLAUDE.md` (DECISIONS log, newest at the bottom); the plan I started
  from is `docs/NEXT-LEVEL-PLAN.md`.

## Verification

VERIFICATION

## Spend

- ElevenLabs: 765 credits for the 32 sound effects (38 calls), and 1,359 credits for the recorded
  score (four tracks, 198 s of music, one call each). Check the ElevenLabs music terms for the
  account's plan before the score ships on the public site.
- Gemini: one video and one stills review per critic round (gemini-3.8-flash).
- Nothing else paid was used (OpenAI, Meshy and Sketchfab keys were not needed tonight).

## Ideas for the planning session

In rough order of what the critics asked for most:

1. **Flank commands** (all three critics who wished for something in round 2 wished for whistles).
   From the dog's side: hold a key to run a "come bye" (clockwise) or "away" (anticlockwise) arc
   round the flock at the edge of its flight zone. It would make the fiddliest part of herding (getting
   round a flock without pushing it) a skill with a button, and give the trial its proper vocabulary.
2. **A reason to come back**: a daily evening (one seed for everyone, a random place, season and
   weather) with a best score; a free herding meadow after the season; a trial score to beat.
3. **Charms that change how you play**, not percentages (both rounds called them passive): a second
   dog for one evening, a lantern that keeps wolves further off at night, a whistle that turns a
   flock from further away.
4. **Progress you can see**: collars and coat patterns bought with stars; a farm that grows across
   the season (the fold rebuilt, a new barn, lambs in the paddock at the end).
5. **A pack**: wolves that work together (one shows itself, the other circles), the critics' wish
   for "real decisions".
6. **More places and people**: a coastal machair, a high bothy; spectators and a handler at the
   trial post, a shepherd at the farm. Meshy or Sketchfab could supply people and props quickly;
   the animals should stay Blender-built so they match.
7. **Before release**: a human playtest of the whole season (the bot is an expert: real players will
   be slower, and the night watch and First Snow may need easing), then merge `season` into `main`
   and deploy.
