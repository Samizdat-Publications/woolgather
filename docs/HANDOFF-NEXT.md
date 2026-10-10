# Handoff: next session (after Woolgather 2.0)

Start here. Then skim `docs/RUN2-REPORT.md` (what 2.0 is and how it was measured) and the end of
the CLAUDE.md DECISIONS log. 2.0.0 is live (https://woolgather.pages.dev), tagged `v2.0.0`, merged
to `main`; work on a new branch (`difficulty` or similar) and keep `main` and the live site on
2.0.0 until the new work is verified.

## Stewart's playtest feedback (2026-10-10)

He played the first two or three season evenings, on Standard (the season has no difficulty
setting yet; he meant the overall feel):

- "Much harder" than 1.0, and the first evenings are good starters: about what he expects from
  levels 1 and 2. He has not played the later evenings yet.
- **The wolves are not a meaningful threat yet.**
- He does **not** want the game itself genuinely hard. He wants **difficulty levels**:
  - **Easy**: what the first two evenings feel like now.
  - **Standard**: average difficulty.
  - **Hard**: genuinely hard.
  - Evening 1 is a good introduction on any setting; **scaling starts from evening 2**.
- **Harder should mean more complex, not just more wolves.** One idea of his: stronger wolves you
  have to bark at twice.
- **A later unlock: a goose** that replaces the dog, with a honk instead of a bark. He thinks it
  would be hilarious.
- His words are direction, not a spec: keep making design decisions.

## Suggested plan (decide for yourself)

1. **Season difficulty setting** (Easy / Standard / Hard), chosen on the season map or the evening
   card and remembered. Implement it as overlays on `tuned()` in `src/game/tuning.ts`, which already
   scales every evening: day length, target, wolf count, wolf speed and wolf start, plus the new
   wolf kinds below. Evening 1 stays gentle on every setting. Balance targets:
   - Hard: the expert bot (`--skill expert`) wins most evenings, not all with three stars.
   - Standard: the average bot (`--skill average`) wins about half to two thirds.
   - Easy: the average bot wins nearly everything.
   Current numbers are close to the Hard target for the expert and a little easy for the average.
   Wolf Moon stays as the extra tier on top. Record which setting earned each record (or keep one
   record per setting) without breaking saves (`woolgather.season.v1`; see `finishEvening` in
   `game.ts`, which must spread the previous record).
2. **Make wolves a real threat by kind, not count** (`src/game/sim.ts`, `WOLF` in `config.ts`):
   - **The old grey**: a bigger, slower, braver wolf. One bark only staggers it; it takes two
     barks, or Pip running into it, to drive it off. It can be pictured with a scarred, darker coat
     and a wider ring. It should arrive from evening 3 or 4 on Standard, earlier on Hard.
   - Perhaps a **young wolf**: quick and skittish, bolts at one bark but comes back sooner.
   - Wolves that **return after being chased off** (a cooldown, then back from another den) on
     Standard and Hard, so a chase is not the end of the threat.
   - Pack tactics already exist (bait and flanker, `Wolf.role`, `Rules.pack`); on Hard they could
     come earlier and the flanker could commit sooner.
   - Keep the fairness tells (the answered howl, the toast with an arrow, the growl, the minimap
     ring) for every new behaviour, and teach each new wolf on an evening card the first time.
   - Bot2 must learn any new rule (for example, bark twice at an old grey) or the balance numbers
     mean nothing.
3. **Escalate complexity across the evenings**: each evening layers an earlier mechanic onto its
   new one (lambs plus a pack, the ram plus mist, and so on), and Hard turns on combinations that
   Easy leaves off. Prefer new decisions for the player over bigger numbers.
4. **The goose** (a later unlock, for example on finishing the season or at a ribbon count): a goose
   in Pip's place. It needs a Blender model (a new character family or added to `characters.py`,
   with rigid parts like the collie's: body, neck/head, legs, wings), a waddle gait in
   `src/world/anim.ts`, and a honk (ElevenLabs Sound Effects through `tools/gen-sfx.mjs`, a few
   credits). The honk works like the bark; consider a flap or a hiss instead of creep. Sheep and
   wolves should react as they do to Pip, maybe with a comic toast the first time.
   Offer it through the coat picker on the season map (it is already a cosmetic chooser).

## How to verify (as in run 2)

- `npm run build`; `node tests/playtest.mjs --serve <build>` (41 checks today: add ones for the
  difficulty setting, the new wolves and the goose).
- `node tests/season-run.mjs --dist <build> --skill expert|average [--moon]`, two seeds for the
  average bot; give concurrent runs their own `--dist`.
- `node tests/perf-season.mjs --dist <build>` (116-149 fps at 1080p High on 2.0; it is noisy when
  the laptop is warm, so compare against an old build measured in the same hour).
- No Gemini critic rounds are needed for this work unless the visuals change a lot; if you run any,
  keep to one or two (each costs a video upload of about 60 MB).
- Before deploying: the site check (`node tests/site-check.mjs`, then `--url` on the live site), a
  version bump (2.1.0), the README and the landing page's season section if the features show.

## Practical notes

- Commit and push after every step (standing preference). Never use em dashes anywhere.
- Python on Windows: open files with `newline=''` to keep LF; write new files with the editor tool.
- Run-2 resume notes are in `docs/RUN2-LOG.md`; the older handoff `docs/HANDOFF-RUN2.md` describes
  the 2.0 ship and is done.
