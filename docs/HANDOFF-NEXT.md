# Handoff: next session (after Woolgather 2.1)

Start here, then `docs/RUN3-REPORT.md` (what 2.1 is and how it was measured) and the end of the
CLAUDE.md DECISIONS log. 2.1.0 is on `main`, tagged `v2.1.0` and live. The previous handoff (the
brief for 2.1) is `docs/HANDOFF-RUN3.md`; everything in it was done.

## What 2.1 added

- **Easy / Standard / Hard** for the season (`Setting`, `settingRules` in `src/game/tuning.ts`; each
  evening's `hard` layer in `season.ts`). Evening 1 is the same on all three.
- **Wolves by kind** (`WOLF_KINDS` in `config.ts`): the old grey (two barks, or run into him), young
  wolves (bolt at one bark, come back), wolves that return after a chase, `Rules.bold` for how hard a
  snatch is to answer. Every behaviour has its tells (howl pitch, toasts, ring, banner, evening card).
- **The goose**: opens once every evening is won, chosen in the coat row; honks instead of barking.

## Overnight 2.1.1 (2026-10-10)

See the "Overnight" section of `docs/RUN3-REPORT.md`. Balance untouched by request: Stewart sets
the difficulty after playing. Done: landing page loads fast, the flank no longer stalls on walls,
bot give-up and outrun fixes, crisp show-field stripes, lantern glow, Fly's name tag, critic round
r08, the dusk variant B (opt-in `?dusk=b`), the film tour (`--shoot tour`).

## Waiting on Stewart

- Dusk: keep the shipped look or switch to variant B (`?dusk=b`; side by side in
  `docs/progress/2.1-dusk-*.jpg`). If B, move its overrides into the key tables in `grade.ts` and
  `daycycle.ts` and drop the flag.
- Evening 1's star goals ("7, 8, all 8": two and three stars are the same goal).

- His playtest of the three settings, especially whether Hard's wolves now feel like a threat and
  whether Easy is what the first evenings felt like to him.
- Whether the goose should do something of its own (a louder honk that carries further but scares
  the flock more, a goose ribbon), or stay a pure joke with Pip's exact mechanics.

## Worth doing next (decide for yourself)

1. (Done overnight in 2.1.1: it was the flank and the bot, not a stuck ewe.) **The bot's stalls** (`tests/bot2.mjs`): circling a small group near the end of Long Light, and
   fixating for minutes on a ewe wedged at the west corner of a High Pass bridge. Check first
   whether the wedged ewe is a real game problem (a sheep that cannot be moved off a bridge rail
   corner); if so, fix it in the sim (the bridge funnel in `sim.ts`).
2. The average bot's trial pen jam (0 of 5 penned in some runs): makes the trial look harder than it is.
3. Hard could ask for a real choice: a second wolf testing another flock while Pip is busy with
   the first (both answerable in principle, not at once). Keep the one-snatch-at-a-time rule.
4. (Done overnight in 2.1.1.) **The landing page loaded 6.4 MB at once** (113 files, mostly the 96 scroll-scrub frames in
   `site/media/evening/`). On a slow connection (about 100 KB/s here on 2026-10-10) the phone page
   took 60-85 s to finish loading, and `tests/site-check.mjs --url` timed out on its phone pass
   (desktop passed). Load the scrub frames lazily (the first few, then the rest after load or as
   the scroll approaches them) so the page is usable at once.
5. Landing page footage: the clips are 2.0's; a short clip of the old grey staggering and of the
   goose would show 2.1 (`npm run film`, `npm run media`; Gemini critics only if visuals change a lot).

## How to verify (unchanged)

- `npm run build`; `node tests/playtest.mjs --serve dist` (54 checks).
- `node tests/season-run.mjs --dist <dir> --skill expert|average --setting easy|standard|hard
  [--seed n] [--moon]`. Average-skill runs must be solo (concurrent runs slow that bot).
- `node tests/perf-season.mjs --dist <build>`; compare against an old build measured in the same
  hour (build a tag in a worktree under `test-results/` with a junction to `node_modules`).
- Before deploying: `npm run site`, `node tests/site-check.mjs`, then `--url` on the live site.

## Practical notes

- Commit and push after every step (standing preference). Never use em dashes anywhere.
- Python on Windows: open files with `newline=''` to keep LF; write new files with the editor tool.
- The goose model: `blender --background --factory-startup --python blender_scripts/characters.py
  -- --only goose --preview --topdown` (Blender 5.1 under `C:\Program Files\Blender Foundation`).
