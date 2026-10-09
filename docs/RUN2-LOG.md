# Run 2 log

Resume notes for the second 24-hour run (plan: `docs/RUN2-PLAN.md`). Newest at the bottom.

## Phase 1: measure honestly (started 2026-10-09)

- HerdBot2 has skill levels (`{skill: 'expert' | 'average'}`): the expert now goes round flocks
  with the flank command (Z/X); the average bot reacts to wolves only once seen or announced and
  0.4 s late, goes for the nearest wolf, holds a course for half a second, aims 2-3.5 m off, walks
  more, pauses, and goes round flocks late and close.
- `season-run` gains `--skill` and `--dist` and passes the game's events to the bot each step;
  `capture.mjs` gains `--skill` (default average) and `ctx.takeEvents()`; the self-test plays the
  classic evening with HerdBot2 and can serve a frozen build itself (`--serve <dir>`,
  `tests/serve.mjs`). The snapshot gives each wolf its target and whether it is on screen.
- Fixed in the bot: a found lost lamb that cannot reach Pip (water between) left the bot waiting
  forever; it now goes back for it after 5 s.
- Baselines (build before any gameplay change, seed 11):

  | Evening | Expert | Average |
  | --- | --- | --- |
  | Long Light | 3 stars, 62 s | 3 stars, 70 s |
  | The Far Bank | 3, 92 s | 3, 133 s |
  | Lambing Time | 3, 137 s | 3, 219 s |
  | Old Angus | 3, 99 s | 3, 190 s |
  | Glenbrae Trial | 3, 70 s | 3, 104 s |
  | Night Watch | 3, 0 lost | 2, 1 lost |
  | Mist on the Moor | 3, 183 s | 3, 271 s |
  | The Storm | 3, 119 s | 3, 192 s |
  | First Snow | 3, 220 s | 3, 331 s |

  The average bot is 1.1-1.9x the expert's time (two tuning passes, then timeboxed) and still wins
  every evening, nearly all with three stars: the evenings have a lot of slack and the wolves
  rarely cost a sheep. That is the "no pressure" complaint in numbers.

## Phase 2: pressure and depth

- Stewart (mid-run): he plays like the expert bot and found 1.0 "kid game easy". New balance rule:
  the expert bot should have a fight (win most, not always with three stars), the average bot
  should win only some of the time. `src/game/tuning.ts` is one knob for the whole season.
- Wolf pack (`Rules.pack`, `Wolf.role`): a second wolf that comes out while one stalks Pip's flock
  pairs with it; the bait prowls in view on Pip's side and feints (a flag on the stalk state, not a
  new state, so markers, camera and HUD treat it as stalking); the flanker circles outside the
  sheep's fear radius to the far side and charges once Pip has committed to the bait. Tells: a
  call-and-answer howl, a "Two wolves!" toast with an arrow, a growl from the flanker's side when
  it is in place, a pulsing ring on the minimap, a one-time tip. Pack on from Old Angus.
- Lone wolves prefer prey within 100 m of Pip (the control critic saw a 250 m snatch nobody could
  answer).
- Wolf Moon: per evening at three stars; `moonRules` overlay; own record under `moon`; moon stars
  count toward charms; tier switch on the intro card, a moon badge on the map.
- Charms with verbs: The Outrun (7 stars, hold Z and X) and Old Fly (16 stars, F: Pip's mother lies
  down where he stands and holds it; F again calls her back; not at the trial). A third charm slot
  at 30 stars.
- Trial stars: 90 / 75 / 55 points (were 85 / 70 / 50).
- Control round r04b (today's build, average-bot footage, Claude critics only): stills 7.13 (r04
  7.00), video 7.25 (r04 6.63). The footage change alone lifts the Claude means a little.
- Balance pass 2 (seed 11 and 23): expert 7 of 9 (lost storm and first snow, far off), average 8
  of 17. Pass 3 eases storm and first snow and tightens the evenings the average bot won easily.

## Phase 4-5 and stretch (ahead of schedule: run started 14:20, this at about 18:00)

- Blind place test (10 unlabelled herding shots, 2 per place): before 3 of 5 pairs right,
  distinct 4/10; after the first landmark pass 2 of 5, distinct 5/10. Within noise: the places
  were told apart only by water, snow, the trial gate or the jetty; green meadows without a
  landmark in frame still blurred (Hollow Valley and Loch Ailsa had the same lime lawn). Response:
  per-place ground (`ground` and new `cover` multipliers in the level file: Hollow Valley a rich
  pasture with buttercups and little heather, Loch Ailsa a pale flower-thick machair with shell-sand
  patches, the High Pass stony all over) and more landmarks beside each grazing spot.
- Stretch work done: Pip's coats (won with ribbons and Wolf Moon stars), a paper-and-ink minimap
  (hachured hillsides, inked water and wood marks, italic place names), the Bell-wether charm
  (22 stars), gamepad rumble, and a tenth evening, The Gathering (High Pass, late autumn, 22 sheep
  in five flocks, Old Fly comes along charm or not, teaching her).
- Fixed: one F press could toggle Fly twice when a frame held several sim steps (debounced); the
  expert bot's flank key ran round and round a flock across the stream at a bridge (flank only on
  open ground now).

## Round r05 (built 17:00, average-bot footage, before the ground pass)

| Critic | r04 | r04b control | r05 |
| --- | --- | --- | --- |
| Gemini video | 8.13 | - | 7.63 |
| Gemini stills | 7.00 | - | 7.25 |
| Claude video | 6.63 | 7.25 | 7.00 |
| Claude stills | 7.00 | 7.13 | 7.13 |

Flat. Repeated majors: dusk ground a purple/orange smear with neon heather; mist a beige wash with
ghostly sheep; the trial flat; boulders reading as sheep at night; places alike (the ground pass
came after this capture); the Wolf Moon card running off a 720p screen. Fixed since: heather fades
to dusk-brown after sunset, stone darkens much more at night, the mist is a cooler blue-grey and
thinner at most, the crowd claps every gate and penned ewe, the storm's rain is finer and fainter,
the intro card's charm descriptions moved to a tooltip, the moon badge no longer covers the ribbon.
Wolf Moon gate: the expert won all ten, so the tier was made harder (now 7 of 10 for the expert,
target never the whole flock). Packs now pair with any lone wolf stalking within 70 m of Pip (only
three formed in the whole r05 capture).
