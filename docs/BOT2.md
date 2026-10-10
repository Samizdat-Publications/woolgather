# HerdBot2: the season bot

`tests/bot2.mjs` plays any evening of the season (any level, either objective) through real key
events, the way a player would. `tests/season-run.mjs` builds the game, plays a list of evenings
with it and reports how each went. The 1.0 bot (`tests/bot.mjs`) is unchanged and still drives the
classic playtest, the film and the critic captures; it only knows Hollow Valley.

## Running it

```
node tests/season-run.mjs                                   # all eight evenings, one at a time, time x2
node tests/season-run.mjs --evenings angus,storm --scale 3  # some evenings, faster
node tests/season-run.mjs --parallel 4 --seed 23            # four pages at once, another sim seed
node tests/season-run.mjs --wait 0.5 --out season-run-wait  # handicap: Pip idles for half the evening
node tests/season-run.mjs --nobuild                         # reuse the last build
```

| Option | Default | Meaning |
| --- | --- | --- |
| `--evenings a,b` | all ten | season evening ids (`long-light`, `far-bank`, `lambing`, `angus`, `show`, `night-watch`, `mist`, `storm`, `gather`, `first-snow`), or `daily-YYYY-MM-DD` |
| `--setting s` | standard | the season's setting: `easy`, `standard` or `hard` (2.1) |
| `--skill s` | expert | `expert` or `average` (see below) |
| `--moon` |  | play each evening's Wolf Moon |
| `--dist dir` | test-results/bot-dist | where to build and serve from (give concurrent runs their own) |
| `--scale k` | 2 | game time scale (`__WG.setTimeScale`); the bot steps every ~50 ms of real time |
| `--parallel n` | 1 | evenings played at once, one browser page each |
| `--seed n` | 11 | the sim seed (`?seed=`); the flock's placement has its own fixed seed per evening |
| `--wait f` | 0 | handicap: Pip sits still until this fraction of the evening has gone |
| `--cap m` | 12 | stop an evening after m game minutes |
| `--port p` | random | port for the static server |
| `--quality q` | low | graphics tier (`?quality=`) |
| `--out name` | season-run | output names under `test-results/` |
| `--nobuild` |  | reuse `test-results/bot-dist` |
| `--headed` |  | show the browser |

The build goes to `test-results/bot-dist` (vite's JS API with its own `outDir`), never to `dist/`,
and is served by a small static server on its own port, so it never touches the dev server on 5317
or the preview on 4317. A build that fails because the source is mid-edit is retried every 60 s, up
to five times.

Output:

- `test-results/season-run.json`: one record per evening: outcome and reason, stars, home/total,
  target, lost, grabs, rescues, barks, game time used and the evening's length, whether the ribbon
  was earned, the final state of the ram, the black sheep and the lambs, any sheep left out, console
  and page errors, seconds spent in each kind of decision (`why`) and seconds spent unsticking.
- `test-results/season-run/<id>.json`: the same record plus the game's events (with the day clock),
  a trace every game second (Pip, counts, the bot's decision, every free sheep and wolf) and the
  nav grid used; `<id>-end.png` is the last frame.
- A table on stdout.

## How it plans

Everything is planned on the game's own walkability grid, `__WG.navGrid()`: 2 m cells, 0 open
ground, 1 water the sheep refuse, 2 solid (walls, rocks, trees, buildings, outside the valley),
3 a crossing (a bridge deck or an open ford), plus the fold's gate, mouth, inside point and inward
direction. The level file (`__WG.level`) adds the bridges' and fords' axes and the pen's size. The
grid is fetched again when the level changes and whenever `state.fords` changes, so a flooded ford
stops being a crossing at once.

**The flock's way home.** A Dijkstra distance field runs from the fold mouth over the cells sheep
will walk on (0 and 3). Cells next to anything the sheep refuse cost extra, so routes keep off walls
and banks. Walking down the field from a group's centre gives its route home and the crossings it
needs, in order.

**Driving a group.** Groups are clusters of free sheep (11 m links). Each group gets a drive goal:

- a point about 16 m down its route, cut short where the route bends (so the drive never cuts a
  corner into a bank or a wall);
- if the route goes over water, the next crossing is taken in two stages, as the 1.0 bot did: first
  drive the group to a point on the crossing's axis 5 m short of it (A* for the flock, with the
  same lookahead), then drive straight over to a point 8 m past the far end. The stage has
  hysteresis so the plan does not flip while the group bunches up;
- once the group is in front of the fold (inside the guide fences' reach and in view of the
  mouth) the goal is the point inside the gate.

Pip then works the group Strombom-style: if a sheep has strayed more than `3 + 1.4 sqrt(n)` m from
the centre he goes round behind it (4.5 m past it, on the far side from the group) and brings it
back; otherwise he stands `r + 6.5` m behind the group, opposite the drive goal, and the sheep move
off ahead of him. When he is on the wrong side of the group he makes a wide outrun: he circles at
`r + 15` m (outside a walking dog's 12.5 m flight zone), choosing the way round with less in the
way and keeping to it. He sprints only when well clear of the group (sprinting widens the flight
zone to 15 m).

**Choosing a group.** The bot stays with the group it is working while it exists; otherwise it picks
the one with the lowest `distance from Pip + 0.35 x its way home - 2 x its size`.

**Pip's own moves.** A straight line is used when it is clear on the grid (no solid cell, less than
7 m of water, not through the fold). Otherwise A* over cells 0, 1 and 3 (Pip wades; water costs
extra, cells next to solid ones cost extra, the fold and its funnel cost a lot unless he means to
go in), and he steers at the furthest path node within 10 m that is in plain view. If he has not
moved for 0.8 s while trying to, he slides sideways for 0.9 s (the 1.0 unstick). While `stunT > 0`
(butted by the ram) he presses nothing.

## The animals

- **Lambs** with a free mother belong to their mother's group and are never collected as strays
  unless they are more than 12 m from her (a lamb that close follows her anyway, and chasing it only
  splits the pair). Lambs whose mother is home or lost count as ordinary sheep.
- **The lost lamb** (`state 'hidden'`) is fetched once the other sheep are home or the target is
  met, or at once when it is within 25 m of Pip. Found (it comes within 9 m), it follows Pip: he
  walks (never sprints) to the fold mouth, waits whenever it falls more than 10 m behind, goes back
  for it if it is more than 30 m away (it only follows within 40 m), and when it is near the gate
  and no other sheep is about he walks into the fold so it follows him through. If it stands by the
  gate for 20 s without going in, the bot records where (`lambGivenUp` in the report, with its
  pen-local position) and gets on with the rest of the evening.
- **Sheep outside the valley edge** (a wolf dragged one past the forest edge and Pip made it drop
  it there) cannot be reached: the edge stops Pip and the sheep alike. The bot lists them
  (`stranded` in the report) and leaves them out of its plans.
- **Angus.** While a ram in or near the worked group is stubborn (`stubborn > 0.15` and
  `yieldT <= 0`) the group will not move, so the bot stares him down instead of driving: it goes to
  a spot 8 m from him on the side away from the drive goal, going round (never within 6 m of his
  horns) and creeping (C) once within 13 m (no butt while creeping, and the stare works faster),
  then stands still holding C. It barks whenever he is within 11 m and the bark is ready (each bark
  takes 0.55 off). Once he gives way it drives as usual; the ewes follow him. If he starts to dig in
  again within 12 m, a bark settles it.
- **Black sheep** need nothing special: they flee from further out and bolt, and are collected as
  strays like any other.

## Wolves

The old grey (2.1) only hears a bark from about 12.9 m and takes two: the expert closes to 11.5 m
before barking and keeps barking while he is staggered; the average bot barks from its usual 14 m
and wastes some, as a first-time player would. The table on stdout counts the wolves that came
out (`g/y/back/stag`: old greys, young wolves, wolves that came back, staggers).

Average-skill numbers are only comparable from solo runs: two seasons at once slow the average
bot enough to lose evenings it wins alone (the expert is not affected).

- A snatch is answered whenever the game says it can be saved (`dragFeasible !== false`): Pip
  sprints at the wolf and barks within 14 m.
- A wolf stalking or charging within 16 m of a sheep and 45 m of Pip is met the same way.
- A snatch the game calls too far to save is left alone, like a player reading the banner.

## Objectives

- **Gather.** As above. The gate is latched (Enter) once the target is met and either 90% of the
  evening has gone or the nearest group still out cannot be brought home in the time left (its way
  home at about 2.2 m/s plus Pip's run to it).
- **Watch** (no fold, wolves all evening). Pip keeps the flock in one bunch: any sheep further than
  `4 + 1.5 sqrt(n)` m from the main bunch is collected back to it (with a short outrun if needed);
  otherwise he stands `r + 9` m off the bunch on the side the nearest wolf is on. Every wolf
  stalking or charging within 40 m of a sheep is met at a sprint, the one nearest a sheep first,
  with a bark inside 16 m.

## What it does not do

- It reads every sheep's position from the game state, mist or not: in **Mist on the Moor** it
  plays with perfect knowledge. A human must listen for bleats and work from the map's memory.
- It does not use charms (the runner marks every evening won, which unlocks none).
- On **Long Light** it avoids barking (the ribbon is "win without barking") unless a wolf has a
  sheep or is within 9 m.
