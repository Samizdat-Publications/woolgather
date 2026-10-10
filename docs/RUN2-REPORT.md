# Run 2 report: Woolgather 2.0

The second 24-hour run, 2026-10-09 from 14:20. Plan: `docs/RUN2-PLAN.md`. Hour-by-hour notes:
`docs/RUN2-LOG.md`. Decisions: the CLAUDE.md DECISIONS log (entries marked "Run 2").

## The short version

You played it once and found it "kid game easy". It is not any more, and it has more to do:

- **It is hard now.** Every evening is short, the wolves come early, and from Old Angus on they
  hunt in **pairs**: one shows itself on your side of the flock and feints, while its mate circles
  round to the far side and waits for you to take the bait. Measured with two bots (below): the
  expert bot, which plays the way you do, has a fight; the average-skill bot wins a bit more than
  half the time.
- **Wolf Moon**: three stars on an evening opens a harder version of it (shorter, one more wolf,
  the full pack, one more sheep needed). The expert bot wins about 7 in 10.
- **Charms that do something**: The Outrun (Z and X together), **Old Fly** (F: Pip's mother lies
  down where he stands and holds that spot) and The Bell-wether. Pip's coats are won with ribbons
  and Wolf Moon stars.
- **A tenth evening, The Gathering**: every flock on the High Pass comes down for winter, and Old
  Fly comes along whether or not you have her charm.
- **Places you can tell apart**: landmarks where you herd (crags and screes, standing stones, a
  stell, a shieling, a jetty and boat, cairns, peat hags, the judges' box), each place its own
  ground (a buttercup pasture, a machair thick with flowers and shell sand, a heather moor, a stony
  pass), rounded loch shores, a closer camera, and a paper-and-ink map.
- **Feel**: sheep and wolves lean into turns and stand on the slope, sheep squash when they startle
  and watch Pip as he passes, the crowd applauds at the trial, gamepads rumble.
- **Live**: version 2.0.0 is deployed to https://woolgather.pages.dev with a new season section on
  the landing page (see the end of this report for the deploy check).

**The one knob**: `src/game/tuning.ts`. After you play, tell me "easier" or "harder" and it is one
number for the whole season (`day` scales every evening's length; `wolves`, `wolfSpeed` and
`wolfStart` do what they say).

(Sections below are filled in at the end of the run.)
