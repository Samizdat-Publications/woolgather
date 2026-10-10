# Woolgather 2.1: Easy, Standard, Hard, wolves by kind, and the goose

Run 3 (2026-10-10), from Stewart's playtest of 2.0: "much harder" than 1.0, the first evenings
good starters, **the wolves not a meaningful threat**, and a wish for **difficulty levels** where
harder means **more complex, not just more wolves**, plus a **goose** as a later unlock.

## What changed

- **A setting for the season: Easy, Standard or Hard.** Chosen on the season map or any evening's
  card and remembered with the saved season (2.0 saves load as Standard). Evening 1 is the same on
  all three; from evening 2 the setting changes the evening (`settingRules` in `src/game/tuning.ts`):
  - **Easy:** about 15% more daylight, the wolves out later and a touch slower, no packs beyond a
    gentle one, no old greys (young wolves only from evening 4).
  - **Standard:** the evening as written in `season.ts` with its kinds of wolf; from evening 3 the
    light goes 5% sooner (the average bot won 16 of 20 before that).
  - **Hard:** 7% less daylight, wolves sooner and bolder, packs from evening 3 at full cunning,
    more old greys, every wolf you chase off comes back once (young ones twice), and each evening's
    own **Hard layer**: something from an earlier evening on top of its new thing (a black sheep on
    the far bank, a black sheep with the lambs, lambs with Old Angus, the ram up in the mist, lambs
    in the storm with an earlier flood, lambs and a black sheep in the Gathering, more of the flock
    in First Snow). The trial is judged strictly.
  - Records keep the hardest setting each evening was won on (a small "Hard" tag on the map).
- **Wolves by kind** (`WOLF_KINDS` in `config.ts`):
  - **The old grey:** bigger, slower and bold (lets Pip within half the usual distance). He hears
    a bark only from about 13 m, and **one bark only staggers him**: he rears back and stands still
    for 1.4 s, still holding any sheep he has. A second bark while he is shaken, or Pip running
    into him, drives him off.
  - **The young wolf:** small, quick and nervy; keeps further from Pip and bolts at one bark, but
    **comes back** from another den 6-10 s later.
  - **Wolves that come back:** on Hard any wolf you chase off returns once from a den well away
    from where it left, announced with an arrow.
  - **Bolder wolves** (`Rules.bold`: Easy 0, Standard 0.6, Hard 1): a snatch is a real race (the
    drag is faster and no longer slows right down when Pip is far off), a wolf may strike a sheep
    closer to Pip, and waits less before its first charge.
  - Every new behaviour is told: the old grey's deeper howl and the young wolf's thin one, a named
    toast the first time, a snarl and "Bark again" on a stagger, the snatch banner's "Bark twice, or
    run into him", the grey's wider, slower ring, and each kind taught on the evening card the
    first evening it comes out on your setting.
- **The goose.** Win every evening of the season and the last swatch of Pip's coat row is a goose:
  a white farm goose (new `goose.glb` from `characters.py`) that waddles, hisses low when creeping,
  flaps at a run and throws its neck up with its wings spread when it honks (a recorded honk). The
  sheep and wolves treat it exactly as they treat Pip, and the messages say "the goose" and "honk".
- **Fixes found on the way:** the season map was cut off at 1280x720 (already in 2.0; it now
  scrolls inside the window and uses its full width, so evening titles are no longer clipped); the
  evening card fits a 720p screen; the tip beside the meters overlapped the bark chip since the
  lie-down and flank chips were added (it now follows the meters' real edge).

## How hard it is now (measured)

`node tests/season-run.mjs --setting <s> --skill <k> --seed <n>`, solo runs at three pages:

| | Expert, Hard | Average, Standard | Average, Easy |
| --- | --- | --- | --- |
| Target (handoff) | wins most, not all with three stars | wins about half to two thirds | wins nearly everything |
| Result | 10 of 11 (seed 23, today's evening included) and 7 of 10 (seed 11, two of the losses bot stalls) | 6 of 10 (seed 23, after the Standard tightening); 8 of 10 on both seeds before it | 9 of 10, nearly all with three stars (seed 23) |
| Stars | a spread: 1-3, about half to two thirds of the wins with three | mostly 1-2 | mostly 3 |

Wolves now cost sheep as well as time: in 2.0 the average bot lost two sheep in a whole Standard
season; with the old greys, returns and bolder drags it loses a few, and the old grey's two barks
show up in every run (`g/y/back/stag` in the table: old greys, young wolves, returns, staggers).

Notes on the numbers:

- The bots' results swing from run to run (the same rules lost and won the same evening in two
  runs), so read them as a band, not a point.
- Two seasons at once slow the average bot enough to lose evenings it wins alone (the trial, with
  no wolves and unchanged rules, went from 5 of 5 to 0 of 5). Average numbers here are solo runs.
- Some losses are the bot stalling, not the balance: the expert lost Long Light (identical on
  every setting, normally won in 45 s) when it drove four sheep in circles for 80 s, and brought
  none home in one Gathering when it fixated on a ewe wedged at the west corner of a bridge for
  five minutes. The average bot sometimes jams at the trial's pen (0 of 5 penned).

## Verification

| Check | Result |
| --- | --- |
| Build | clean (`tsc`, `vite build`) |
| Self-test (`node tests/playtest.mjs --serve dist`) | 54 of 54 checks (13 new: the setting, the Hard layer, Easy's later wolves, evening 1 unchanged, the old grey's two barks, the young wolf, the goose), 0 console errors |
| Frame rate (`perf-season`, 1080p High, same hour) | 2.1: 109-141 fps; 2.0.0 built alongside: 116-140 fps; identical draw calls and triangles |

## For the next session

- The bot's two stalls (circling a small group on Long Light; a ewe wedged at a bridge corner on
  the High Pass) are worth a look: the wedged ewe may be a real game problem a player could meet.
- The average bot's trial pen jam is old; it makes the trial look harder than it is for people.
- Ideas not done: on Hard, wolves that test a second flock while Pip is busy (a real choice of
  which to save); a goose-only ribbon or a goose honk that carries further but scares the flock
  more (a different verb, not a nerf).
