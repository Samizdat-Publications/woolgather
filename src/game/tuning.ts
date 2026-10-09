import type { Rules } from './rules';

/**
 * One place to make the whole season (and today's evening) easier or harder after a playtest.
 * The evenings in season.ts are tuned so the expert bot has a fight and the average-skill bot
 * wins only some of the time (Stewart, 2026-10-09: "fun, but not a walkthrough").
 * - day: scales every evening's length (more than 1 is easier).
 * - wolves: extra wolves at the peak of every evening that has wolves.
 * - wolfSpeed: scales how fast the wolves move.
 * - wolfStart: shifts when the wolves come out (negative is earlier, as a share of the day).
 */
export const TUNING = { day: 1, wolves: 0, wolfSpeed: 1, wolfStart: 0 };

export function tuned(r: Rules): Rules {
  const T = TUNING;
  if (r.objective === 'watch') return { ...r, maxWolves: r.maxWolves + T.wolves, wolfSpeedScale: r.wolfSpeedScale * T.wolfSpeed };
  return {
    ...r,
    dayLength: Math.round(r.dayLength * T.day),
    maxWolves: r.wolfStart === null ? r.maxWolves : r.maxWolves + T.wolves,
    wolfSpeedScale: r.wolfSpeedScale * T.wolfSpeed,
    wolfStart: r.wolfStart === null ? null : Math.max(0.02, r.wolfStart + T.wolfStart),
  };
}
