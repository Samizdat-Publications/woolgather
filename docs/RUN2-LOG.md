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
