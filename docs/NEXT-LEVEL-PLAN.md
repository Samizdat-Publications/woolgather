# Woolgather 2: "A Season in the Glen"

Overnight plan (2026-10-09), written before any code changed. Branch `season`; `main` and the live
site stay on 1.0.0 until Stewart reviews.

## What 1.0 is, and what it lacks

1.0 is one valley, one sunset, three difficulty presets. It looks and reads well (30+ critic rounds
went into the light, the wolves and the HUD), but once you have won Standard there is nothing new to
see: no reason to come back, no sense of progression, the same 12 sheep in the same 4 spots. The
herding itself is the best thing in it, and the flock never asks anything new of you.

## Direction

Keep the core (steer a real flock by where you stand, race the sunset, fend off wolves) and build a
**season** around it: eight evenings from midsummer to the first snow, each one adding one new thing
to herd around, in a valley that changes with the season and the weather.

### 1. Progression: the Season

- A season map screen (felt patches on a stitched calendar): eight evenings, stars and a ribbon per
  evening, the next one unlocked by winning the last. Saved in localStorage.
- An intro card per evening: name, season, a two-line story, the one new thing (with how to handle
  it), the star goals. A results card with "Next evening".
- Each evening has a ribbon (an optional challenge: find the lost lamb, bring Angus home, no sheep
  lost, the black sheep home...). Stars plus ribbons give replay value.
- The 1.0 game stays as "Classic evening" (Gentle / Standard / Hard).

| # | Evening | Season | New thing |
|---|---------|--------|-----------|
| 1 | Long Light | midsummer | Two flocks near the farm, no stream to cross, a single late wolf. Learn the ring, creeping, the fold. |
| 2 | The Far Bank | midsummer | The flock is over the stream: the bridge and the ford. |
| 3 | Lambing Time | early summer | Ewes with lambs. Lambs follow their mothers; a lost lamb bleats and its mother turns back. Wolves go for lambs. |
| 4 | Old Angus | high summer | The ram. He will not be pushed by a walking dog: stare him down (stand still or creep close) or bark. Crowd him and he butts Pip. Where he goes the flock follows, and he sees off wolves. |
| 5 | Heather Moon | late summer | A bigger flock with a skittish black sheep, two wolves, the heather in bloom. |
| 6 | Mist on the Moor | autumn | Fog: you see little beyond Pip, the map only knows what Pip has seen, follow the bleats. |
| 7 | The Storm | autumn | Rain and thunder: thunderclaps scatter the flock, and the ford floods halfway through. |
| 8 | First Snow | winter | Snow on the hills, the hungriest pack, the whole cast at once. |

### 2. Gameplay features

- Sheep kinds in the sim: ewe, lamb (follows its mother, small, fast, panicky), ram (stubbornness,
  butting, leading the flock, scaring wolves), black sheep (skittish, bolts).
- Weather in the sim: thunder scatter, ford flooding, fog (visibility for the map and markers).
- Per-evening rules objects replace the difficulty presets inside the sim (the presets become rules).
- The test bot learns the new cast (bark the ram, avoid the flooded ford) so every evening is
  verified winnable by the same expert proxy as 1.0.

### 3. Visual leap

- A living grass field: tens of thousands of instanced grass tufts with wind waves rolling over the
  valley, parted by Pip, the sheep and the wolves as they move through.
- Seasons: midsummer green, heather purple, autumn gold (orange birches and oaks, rust bracken,
  falling leaves), winter snow (snow on every upward face, snow caps on the pines, snowfall).
- Weather: drifting fog banks, rain streaks with lightning flashes, snowfall.
- Life in the valley: a starling murmuration over the sunset (a flock above the flock), rabbits
  that bolt from Pip, chimney smoke, birds lifting off.
- New characters: lambs, Old Angus with curled horns, the black sheep.

### 4. The critic system

A "random gamer" critic that knows nothing about how the game is built or why: it gets a two-line
store blurb and the footage, and reports on looks, feel, clarity, wanting to keep playing and sense
of progression, with 1-10 scores so rounds can be compared.

- `tests/critic/capture.mjs` films scripted sessions of the production build on a virtual clock
  (the bot plays), saves an mp4, key stills and contact-sheet filmstrips.
- `tests/critic/gemini.mjs` sends the mp4 to Gemini (video understanding) when `GEMINI_API_KEY` is
  set (env or `.env.local`), else says it skipped. No key tonight: the Gemini critic is wired but
  dormant until Stewart provides one.
- Tonight's video critic is a Claude subagent reading the filmstrips in order (a frame every 2-3 s);
  a second Claude subagent reads the stills. Both see only the blurb and images.
- Reports land in `docs/critic/rNN/`, scores in `docs/critic/SCOREBOARD.md`.
- A baseline round on 1.0.0 first, so the overnight work is measured against where it started.

### Order of work (don't let one thing block the rest)

1. Critic harness + baseline round on 1.0.0.
2. Rules refactor and the Season framework (map screen, intro and results cards, saves).
3. Sheep kinds (lamb, ram, black sheep) with models, animation and sound.
4. Grass field, seasons and weather visuals; murmuration and valley life.
5. Weather gameplay (fog, storm, flood, snow).
6. Bot updates, playtest, critic rounds, fixes; commit and push the branch at each step.
7. Morning report: `docs/OVERNIGHT-REPORT.md`.

Out of scope tonight: new valleys (new terrain meshes), external asset services (Sketchfab, Meshy,
Mixamo, ElevenLabs), deploying the site. Those wait for Stewart's keys and review.
