# Handoff: Run 2 (Woolgather 2.0)

Read this first if you are a fresh session picking up the second 24-hour run. Then read
`docs/RUN2-PLAN.md` (the approved plan), `docs/RUN2-LOG.md` (what happened, in order) and
`docs/RUN2-REPORT.md` (the report for Stewart, nearly final). Project rules: `CLAUDE.md`.

## Done (2026-10-10, about 00:30 local)

Run 2 is finished and shipped: v2.0.0 is live at https://woolgather.pages.dev, tagged, merged to
`main`, GitHub release published. The next session's job is Stewart's playtest feedback (tune
`src/game/tuning.ts`) or the open ideas at the end of `docs/RUN2-REPORT.md`. The notes below are
the state before shipping, kept for reference.

## Where things stood (2026-10-09, about 22:30 local)

- Branch `season`, last commit `1a7748e` (round r07 fixes), pushed. `main` is still at `edb0dd3`
  (fast-forwarded at the start of the run); it is fast-forwarded again only at the very end.
- Version is already `2.0.0` in `package.json`. The site has been built and checked locally
  (`npm run site`, `node tests/site-check.mjs`: no problems), with a new season section.
- All planned work is done (pack wolves, Wolf Moon, verb charms, The Gathering, landmarks, ground
  per place, feel pass, rebalance, three Gemini critic rounds r05-r07). The Gemini spend cap (3
  rounds) is used up: do not run another Gemini round.
- Stewart's standing calls for this run: deploy at the end of the run; the recorded ElevenLabs
  audio ships (paid plan) with a credit line; difficulty: the expert bot should have a fight, the
  average bot win only some of the time; he will playtest afterwards and tune via
  `src/game/tuning.ts`.

## What is running / what is left

1. **Final verification** (was running in the background into `test-results/final.log` on the
   build `test-results/final-dist`): self-test (41 checks), expert season, expert Wolf Moon,
   average bot seed 23, four daily dates, perf-season. If it is not finished or the log is gone,
   rebuild and rerun:
   ```
   npx vite build --outDir test-results/final-dist --emptyOutDir
   node tests/playtest.mjs --serve test-results/final-dist --out test-results/pt-final
   node tests/season-run.mjs --nobuild --dist test-results/final-dist --parallel 3 --out final-expert
   node tests/season-run.mjs --nobuild --dist test-results/final-dist --moon --parallel 3 --out final-moon
   node tests/season-run.mjs --nobuild --dist test-results/final-dist --evenings daily-2026-04-15,daily-2026-07-20,daily-2026-10-10,daily-2026-12-05 --parallel 2 --out final-daily
   ```
   Pass: 0 console errors, all self-test checks, the expert wins the season evenings. A one-off
   bridge stall in the classic win check has happened once (rerun before believing it).
   Perf numbers are noisy on this laptop after hours of load; compare against the old build
   (`test-results/p1-dist`) measured in the same hour rather than against old numbers.
2. **Fill the report**: add a "Verification" section to `docs/RUN2-REPORT.md` with those numbers,
   and the deploy result.
3. **CLAUDE.md Status line** (line ~137): say 2.0.0 is released and live, season merged to main.
4. **Ship** (in this order):
   - commit and push `season`;
   - `git tag v2.0.0`, `git checkout main`, `git merge --ff-only season`, `git push origin main`,
     `git push origin v2.0.0`, back to `season`;
   - `npm run site -- --deploy` (Cloudflare Pages project `woolgather`; wrangler is logged in);
   - `node tests/site-check.mjs --url https://woolgather.pages.dev` must pass;
   - GitHub release: `gh release create v2.0.0 --title "Woolgather 2.0: The Season" --notes-file <notes>`;
   - rollback if the live check fails: rebuild tag `v1.0.0` in a worktree and redeploy it.
5. Tell Stewart in one short message: what shipped, the critic and balance numbers, the tuning
   knob, the open issues (see the report's last section).

## Gotchas learned this run

- Python on Windows writes CRLF unless `open(..., newline='')`; `.gitattributes` normalises, but
  keep edits LF. A heredoc `cat > file` without a body hangs; write files with the editor tool.
- Never run two `season-run`s on the same `--dist`. Captures are on a virtual clock, so they can
  overlap other work; season-run and perf cannot (GPU contention).
- `bot2.mjs` steering: drive points inside a blocked nav cell are moved to the nearest open cell;
  the flank key is used only on open ground (not at crossings, gates or the fold).
- Materials are cached across levels: classify by name before by state (the stone-glow bug).
