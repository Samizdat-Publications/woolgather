# Overnight report: Woolgather 2, "The Season"

Night of 2026-10-08/09. Everything is on branch **`season`** (pushed to GitHub). `main` and the live
site (woolgather.pages.dev) are untouched on 1.0.0: nothing was merged or deployed.

To play it: `git checkout season`, `npm install`, `npm run dev`, open http://localhost:5317.
Enter on the title opens the season. To try any evening without unlocking it, add `?test=1` to the
URL, open the browser console and run `__WG.progress('all')`.

## The short version

1.0 was one valley, one sunset and three difficulties. All four critics said the same thing about
it: beautiful, but a single map with no progression and little variety. So the night went into
making it a game you play through rather than one you finish once:

- **A season of nine evenings** on one hill farm, midsummer to the first snow, in **five places**
  (each with its own ground: a green machair by the loch, a tawny moor in the corrie, a mown show
  field). Each evening adds one new thing and has its own story card, star goals, a ribbon (an
  optional challenge) and a best time. Charms (perks) are bought with stars. Progress is saved.
- **Today's evening**: a new evening every day, made from the date (a place, the real season of
  the calendar, the weather, two or three flocks, sometimes a ram or a black sheep). It sits in the
  season map's spare slot once evening 1 is won.
- **New things to herd around**: lambs that follow their mothers (and a lost lamb that follows Pip
  once found), Old Angus the ram (he will not be pushed: stare him down or bark; he butts a dog that
  crowds him; the ewes follow him; wolves fear his horns), a black sheep that bolts, a sheepdog trial
  at the village show (gates in order, judged on points), mist where you find the flock by its
  bleating, a storm whose thunder scatters the flock and whose flood closes the ford, first snow, and
  a **night watch** run from night to dawn where ewes wander off into the dark and, at midnight,
  something crashes through the bracken and scatters the flock three ways.
- **New controls**: lie down (Q / gamepad B) stops the flock dead, as a real handler would at a
  gate; **flank** (hold Z or X, d-pad left or right) sends Pip round the nearest flock, "away" or
  "come bye", just outside the distance that would push it; and the mouse wheel zooms, all the way
  in to a **low view across the valley** with Pip in the foreground.
- **A visual leap**: a living grass field (wind gusts roll across it, the animals part it), seasons
  (summer green, heather purple, autumn gold, snow), weather (overcast, rain, mist banks, snowfall,
  autumn leaves), a starling murmuration over the sunset, chimney smoke, rabbits that bolt from Pip,
  sheep trods worn across the hills, and a sunset cutaway: when the wolves come out the camera drops
  to a low shot into the western sky for three seconds (any key skips it).
- **Real sounds and music**: 32 recorded effects generated with ElevenLabs (bleats for ewes, lambs
  and the ram, barks, howls, thunder, rain, wind, stream, loch, dawn chorus) and a recorded score
  (an evening theme in D major, a dusk theme in D minor, a title piece and a win phrase), with the
  old synthesised tension layer playing over it when the wolves close in.
- **A critic system** that reviews gameplay video and stills as a random gamer who knows nothing
  about the code or the design decisions (Gemini 3.8 Flash on the video and the stills, plus two
  blind Claude critics), with a scoreboard. Five rounds were run: the 1.0 baseline and four of
  the season.

## How the critics scored it

Means of eight 1-10 scores (look, readability, feel, fun, variety, progression, keep playing,
wishlist). Full tables and every review: `docs/critic/SCOREBOARD.md` and `docs/critic/r*/`.

| Round | What they saw | Gemini video | Gemini stills | Claude video | Claude stills | Mean |
| --- | --- | --- | --- | --- | --- | --- |
| r00 | 1.0 as released | 5.50 | 4.75 | 5.25 | 5.38 | 5.22 |
| r01 | first season build | 7.25 | 7.38 | 6.63 | 6.75 | 7.00 |
| r02 | after round 1's fixes | 7.38 | 7.00 | 6.63 | 7.13 | 7.03 |
| r03 | after round 2's fixes | **8.13** | 7.00 | 7.00 | 6.88 | **7.25** |
| r04 | flanking, today's evening, orb fix, low view fixed | 8.13 | 7.00 | 6.63 | 7.00 | 7.19 |

Biggest moves since 1.0: variety 3-4 to 7-9, progression 2-3 to 7-8, "would keep playing" 3-5 to
7-8. Look and readability held at 7-8 throughout. Game feel is the weakest score (6-7).

The scores have levelled off at about 7.2 over rounds 3 and 4: what still holds them down is
structural (see below), not polish. Round 4's critics saw the low view working ("the low zoomed-in
view of the meadow" was one critic's favourite shot; another asked to play in it) and no orbs.
They did not see flanking in use (the bot does not flank), and walk-on, the trial crowd and hurdles,
and the corrie's heather moor went in after round 4.

## What the critics still say, and what happened to it

Fixed after round 3 (round 4 confirmed the low view and the orbs):

- **The low view was a mess** (all three who saw it): the camera dropped into the forest edge and
  pines filled the screen. Trees near the camera now vanish while it is tilted.
- **"Glowing yellow orbs on the ground"** (every round): two causes. The wolves' eye-shine sprite
  was drawn by day and bloomed into a yellow ball (now it only fades in as the light goes), and
  any single over-bright pixel could bloom the same way (the bloom now clamps each sample). Two
  bot runs of 63 and 134 frames found none, against one or two per run before.
- **Moonlit boulders looked like sheep** at night: stone now darkens with the night.
- **The trial's sheep stalled at the pen mouth**: the small pen now pulls driven sheep in harder,
  and driven sheep bunch closer in any pen mouth.
- **The mist read as a dirty filter**: it now has a crisp clear area round Pip, rolling banks with
  gaps and a cooler colour.

Changed after round 4, not yet seen by a critic:

- **Walk-on**: a flock driven steadily trots on up to 45% faster (the "dead time driving" complaint).
- **The trial looks like a show**: a crowd two or three deep behind the bunting, red and white
  hurdle wings on every gate (they were "two thin sticks"), subtler mown stripes (two critics read
  the strong ones as smudges or shadows).
- **The corrie is a heather moor**: purple heather over most of the hill and darker moor grass (it
  read as "one big mustard-yellow wash").

Still open (worth the planning session):

- **The places still look alike from the high herding camera** (both Claude critics, every round):
  colour helped less than hoped. Landmarks the camera can see (crags and scree, a loch shore with
  reeds, walls and gullies) are the next step, and so is a closer default view.
- **Not enough pressure** (Claude video, round 4): every evening the critics saw was a tidy win,
  because the capture is played by an expert bot. Wolves that hunt as a pack and a harder replay
  tier would answer it; a human playtest will say how hard the evenings really are.
- **Sheep turn pink at sunset** (round 4): the 1.0 grade lets the fleece take the sunset's colour on
  purpose; two critics found it odd. A small change in the grade if wanted.
- **A dark slab across the burn** in the night watch dawn shots (round 4): fixed after round 4. The
  loch's shore rule lifted the burn's channel bed above its own water where it runs into the loch
  (and left an empty mud channel at the corrie lochan's outflow); burns now keep their channel
  below the loch's level there.
- **Stiff animal motion** (Gemini, both rounds): more squash, lean and fleece bounce in the
  procedural animation.
- **Wolves come early** (Claude stills): the opposite of round 1's complaint, partly because the
  capture jumps each evening to just before the wolves. Evening 1 now has 39 s of calm (it had 30).
- **HUD helper text** feels cluttered to Gemini during the opening tips.
- **Charms are stat bumps** (every round): see the ideas below.

## The places and evenings

| # | Evening | Place | Season | New thing |
|---|---------|-------|--------|-----------|
| 1 | Long Light | Hollow Valley | midsummer | herding; one early wolf |
| 2 | The Far Bank | Hollow Valley | midsummer | crossings (bridge and ford); flanking |
| 3 | Lambing Time | Loch Ailsa | early summer | lambs, a lost lamb |
| 4 | Old Angus | Crannach Corrie | high summer | the ram |
| 5 | The Glenbrae Trial | Glenbrae Show Field | late summer | a sheepdog trial, judged on points |
| 6 | Night Watch | Loch Ailsa | late summer | until dawn: strays, a midnight scatter |
| 7 | Mist on the Moor | The High Pass | autumn | mist, a black sheep |
| 8 | The Storm | Hollow Valley | autumn | thunder, a flood |
| 9 | First Snow | The High Pass | winter | everything at once |
| - | Today's evening | any of four | the real one | a new mix every day |

## Under the hood

- Levels are now data (`level/*.json`), and the ground, water, tracks and trods are generated at
  load time in TypeScript (a port of the Blender terrain script), per level and per season. A new
  place is a JSON file; no Blender round trip. Blender still makes the props and animals.
- The sim takes per-evening rules instead of three difficulty presets; the 1.0 game is still there
  as "Classic evening".
- New test hooks for look-dev (`__WG.near`, `pick`, `uniform`, `zoom`), which is how the orb was
  finally found.
- Decisions are logged in `CLAUDE.md` (DECISIONS log, newest at the bottom); the plan I started
  from is `docs/NEXT-LEVEL-PLAN.md`.

## Verification

On the branch, the morning of 2026-10-09 (the self-test was re-run after every later change,
the last time on the final commit):

- **Self-test** (`npm run playtest`): 0 console errors, 32 of 32 assertions pass (title, menus,
  classic evening, the season map, every evening starting, the results card).
- **The whole season played by the bot** (`node tests/season-run.mjs`): all nine evenings won,
  all with three stars, no console errors:

  | Evening | Result | Home | Time |
  | --- | --- | --- | --- |
  | Long Light | 3 stars | 8 of 8 | 62 of 300 s |
  | The Far Bank | 3 stars | 11 of 11 | 91 of 330 s |
  | Lambing Time | 3 stars | 17 of 17 | 140 of 380 s |
  | Old Angus | 3 stars | 12 of 12 | 115 of 400 s |
  | The Glenbrae Trial | 3 stars | 5 of 5 penned | 77 of 300 s |
  | Night Watch | 3 stars | 12 of 12 to dawn | 240 s |
  | Mist on the Moor | 3 stars | 13 of 13 | 191 of 480 s |
  | The Storm | 3 stars | 14 of 14 | 129 of 390 s |
  | First Snow | 3 stars | 16 of 16 | 241 of 520 s |

  The bot is an expert (it plans with A* and herds by the textbook), so a person will take two to
  four times as long; the day lengths leave room for that, but a human playtest is the real test.
- **After walk-on and the trial and corrie changes**: the whole season again, all nine won with
  three stars; the trial and Angus once more on the final commit, both three stars.
- **Today's evening** on six sampled dates (spring, summer, autumn, winter): all won by the bot.
- **Frame rate** (`node tests/perf-season.mjs`, 1080p, High, this RTX 5070 Ti laptop): 124 to 141
  fps in every evening, 312 to 377 draw calls, no console errors.
- **Production build** (`npm run build`): clean.
- **Orb hunt**: two bot runs (63 and 134 screenshots) after the bloom clamp found no glowing orb;
  runs of the same length before it found one or two.

## Spend

- ElevenLabs: 765 credits for the 32 sound effects (38 calls), and 1,359 credits for the recorded
  score (four tracks, 198 s of music, one call each). Check the ElevenLabs music terms for the
  account's plan before the score ships on the public site.
- Gemini: one video and one stills review per critic round, five rounds (gemini-3.8-flash).
- Nothing else paid was used (OpenAI, Meshy and Sketchfab keys were not needed tonight).

## Ideas for the planning session

In rough order of what the critics asked for most:

1. **Charms that change how you play**, not percentages (every round called them passive): a
   second dog for one evening, a lantern that keeps wolves further off at night, a whistle that
   turns a flock from further away, a flank that runs wider and faster.
2. **Landmarks per place** the herding camera can see: crags and scree in the corrie, the loch
   shore in shot, spectators, a judge's tent and a handler at the trial post. Meshy or Sketchfab
   could supply people and props quickly; the animals should stay Blender-built so they match.
3. **Make the drive itself a decision**: walls with gaps, gullies, a bog to steer round; a "walk
   on" that quickens a flock driven well.
4. **Progress you can see**: collars and coat patterns bought with stars; a farm that grows across
   the season (the fold rebuilt, a new barn, lambs in the paddock at the end).
5. **A pack**: wolves that work together (one shows itself, the other circles), the critics' wish
   for "real decisions".
6. **Animation pass** on the sheep and Pip (lean into turns, fleece bounce, squash on landings).
7. **Before release**: a human playtest of the whole season (the bot is an expert: real players will
   be slower, and the night watch, First Snow and today's evening may need easing), then merge
   `season` into `main` and deploy.
