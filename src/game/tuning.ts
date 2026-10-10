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

// ---------------------------------------------------------------- the season's setting

/**
 * Easy, Standard or Hard (Stewart, 2026-10-10: "harder should mean more complex, not just more
 * wolves"). The first evening is the same on every setting; from the second on, the setting
 * changes the evening:
 * - Easy: more daylight, the wolves later and a touch slower, packs hunt gently or not at all,
 *   and no old greys (young wolves only from the fourth evening, and they come back once).
 * - Standard: the evening as written in season.ts, with its kinds of wolf.
 * - Hard: less daylight, the wolves sooner, packs from the third evening and always at full
 *   cunning, more old greys, every wolf you chase off comes back once (young ones twice), and
 *   each evening's own `hard` layer: something from an earlier evening on top of its new thing.
 */
export type Setting = 'easy' | 'standard' | 'hard';
export const SETTINGS: { id: Setting; label: string; text: string }[] = [
  { id: 'easy', label: 'Easy', text: 'More daylight, fewer tricks: the wolves come later and hunt alone.' },
  { id: 'standard', label: 'Standard', text: 'The season as it is meant to be played.' },
  { id: 'hard', label: 'Hard', text: 'Less daylight, the old greys, packs that hunt together, and wolves that come back.' },
];

type EveningRules = Omit<Rules, 'id' | 'perks'>;

/**
 * An evening's rules on a setting. `num` is the evening's number (0 for today's evening, which
 * scales like the later evenings); `hard` is the evening's own extra layer on Hard.
 */
export function settingRules<R extends EveningRules>(r: R, setting: Setting, num: number, hard?: Partial<EveningRules>): R {
  if (num === 1) return r;
  // On Standard a young wolf you chase off comes back once, and from the third evening the light
  // goes a little sooner (the average-skill bot won 16 of 20 evenings as written; the aim is half
  // to two thirds). The trial and the night watch keep their own clocks.
  if (setting === 'standard') {
    const tighter = (num >= 3 || num === 0) && r.objective === 'gather';
    return { ...r, dayLength: tighter ? Math.round(r.dayLength * 0.95) : r.dayLength, returns: r.returns ?? { young: 1, other: 0 }, bold: r.bold ?? 0.6 };
  }
  const watch = r.objective === 'watch';
  const trial = r.objective === 'trial';
  const k = r.kinds ?? {};
  if (setting === 'easy') {
    if (trial) return { ...r, dayLength: Math.round(r.dayLength * 1.2) };
    return {
      ...r,
      dayLength: watch ? r.dayLength : Math.round(r.dayLength * 1.15),
      wolfStart: r.wolfStart === null ? null : r.wolfStart + (watch ? 0.02 : 0.05),
      wolfSpeedScale: r.wolfSpeedScale * 0.94,
      maxWolves: watch ? Math.max(2, r.maxWolves - 2) : r.maxWolves,
      wolfRespawn: [r.wolfRespawn[0] * 1.25, r.wolfRespawn[1] * 1.25],
      pack: r.pack === 'full' ? 'gentle' : undefined,
      kinds: num >= 4 && k.young ? { young: k.young * 0.6 } : undefined,
      returns: { young: 1, other: 0 },
    };
  }
  const h: R = { ...r, ...hard };
  if (trial) return { ...h, strict: true };
  const hk = h.kinds ?? {};
  return {
    ...h,
    dayLength: watch ? h.dayLength : Math.round(h.dayLength * 0.93),
    wolfStart: h.wolfStart === null ? null : Math.max(0.06, h.wolfStart - 0.03),
    wolfSpeedScale: h.wolfSpeedScale * 1.04,
    wolfRespawn: [h.wolfRespawn[0] * 0.85, h.wolfRespawn[1] * 0.85],
    // Any pack hunts at full cunning, and from the third evening two wolves always pair up.
    pack: h.pack || ((num >= 3 || num === 0) && h.maxWolves >= 2) ? 'full' : undefined,
    kinds: { grey: Math.min(0.55, Math.max(0.3, (hk.grey ?? 0) + 0.12)), young: Math.min(0.35, (hk.young ?? 0) + 0.05) },
    returns: { young: 2, other: 1 },
    bold: 1,
  };
}
