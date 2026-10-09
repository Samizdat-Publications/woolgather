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
