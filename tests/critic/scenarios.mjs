// Scenarios for tests/critic/capture.mjs. Each one is an async function of a capture context and
// drives the page from the title screen (the virtual clock has just started) to whatever it wants
// the critics to see. Add a scenario by adding a key here; capture.mjs needs no change.
//
// The context (ctx):
//   page            Playwright page (keyboard, evaluate; window.__WG test hooks are present)
//   frame()         advance one virtual frame and capture it into the video
//   frames(s)       advance and capture s game seconds
//   still(name)     save the frame on screen as stills/<name>.jpg
//   mark(label, i)  add a mark to marks.json at the current frame
//   state()         window.__WG.state(): mode, outcome, t (0..1 of the day), elapsed (s), folded,
//                   lost, total, target, dog, sheep[], wolves[] (state: prowl, stalk, charge, drag ...)
//   bot             a HerdBot (tests/bot.mjs): await bot.step(state, dtSeconds); await bot.release()
//   fps, opts, log, time() (game seconds so far), overTime() (past --minutes), dist(a, b)
//
// Game time is the virtual clock: one frame() is 1/fps game seconds, whatever the real speed.

export const scenarios = {
  /** The title, then the herding bot plays a whole evening to the result card. */
  async classic(ctx) {
    const { page, frame, frames, still, mark, state, bot, fps, log, dist } = ctx;

    await frames(3);
    await still('title');
    await page.keyboard.press('Enter');
    await frame();
    mark('start');

    const taken = new Set();
    let st = await state();
    while (st.mode !== 'ended' && !ctx.overTime()) {
      // Stills are decided on the state before a frame and taken on the frame after it.
      const due = [];
      const want = (name, cond) => {
        if (!taken.has(name) && cond) {
          taken.add(name);
          due.push(name);
        }
      };
      if (st.mode === 'playing') {
        want('herding-early', st.elapsed >= 20);
        want('wolf-near', st.wolves?.some((w) => w.state === 'stalk' && dist(w, st.dog) < 35));
        want('snatch', st.wolves?.some((w) => w.state === 'drag'));
        want('sunset', st.t >= 0.5);
        want('dusk', st.t >= 0.85);
        await bot.step(st, 1 / fps);
      }
      await frame();
      for (const name of due) await still(name);
      st = await state();
    }
    await bot.release();
    if (st.mode !== 'ended') log(`time cap reached in mode ${st.mode}`);
    mark('outcome', st.outcome);
    // The gate swings shut and the results card comes in.
    await frames(2);
    await still('end-card');
    await frames(3);
  },

  /**
   * The season: the title, the season map, evening 1 played in full to its results, then a
   * montage of later evenings (each place, season and weather), a minute or two of each.
   */
  async season(ctx) {
    const { page, frame, frames, still, mark, state, fps, log, dist } = ctx;
    let Bot;
    try {
      ({ HerdBot2: Bot } = await import('../bot2.mjs'));
    } catch {
      ({ HerdBot: Bot } = await import('../bot.mjs'));
      log('bot2.mjs not found: using the 1.0 bot');
    }
    const click = (sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel);
    const taken = new Set();
    /**
     * Play with the bot for `seconds` of game time (or to the end), taking stills on cue. A cue with
     * a third element runs that instead of taking a still (for example the player zooming in).
     */
    const play = async (seconds, cues = []) => {
      const bot = new Bot(page, () => {}, { skill: ctx.opts.skill, seed: ctx.opts.seed * 31 + Math.round(ctx.time()) });
      const until = ctx.time() + seconds;
      let st = await state();
      while (st.mode !== 'ended' && ctx.time() < until && !ctx.overTime()) {
        const due = [];
        for (const [name, cond, act] of cues) {
          if (!taken.has(name) && st.mode === 'playing' && cond(st)) {
            taken.add(name);
            if (act) {
              await act();
              mark(name);
            } else due.push(name);
          }
        }
        if (st.mode === 'playing') await bot.step(st, 1 / fps, ctx.takeEvents());
        await frame();
        for (const name of due) await still(name);
        st = await state();
      }
      await bot.release();
      return st;
    };

    await page.evaluate(() => window.__WG.progress('reset'));
    await frames(3);
    await still('title');
    await page.keyboard.press('Enter');
    await frames(3);
    await still('season-map');
    mark('season-map');
    await click('.ev[data-arg="long-light"]');
    await frames(4);
    await still('evening-1-card');
    await page.keyboard.press('Enter');
    await frame();
    mark('evening', { id: 'long-light' });
    let st = await play(330, [
      ['e1-herding', (s) => s.elapsed >= 20],
      ['e1-first-home', (s) => s.folded >= 1],
      ['e1-wolf', (s) => s.wolves?.some((w) => (w.state === 'stalk' || w.state === 'charge') && dist(w, s.dog) < 35)],
      // The player rolls the wheel all the way in for a low look across the valley, then back out.
      ['zoom-in', (s) => s.elapsed >= 38, () => page.evaluate(() => window.__WG.zoom?.(0.5))],
      ['e1-low-view', (s) => s.elapsed >= 45],
      ['zoom-out', (s) => s.elapsed >= 52, () => page.evaluate(() => window.__WG.zoom?.(1))],
    ]);
    mark('outcome', st.outcome);
    await frames(2.5);
    await still('evening-1-result');
    await frames(2);
    // Back to the map: evening 1 won, evening 2 open.
    await click('.end-screen [data-act="season"]');
    await frames(2.5);
    await still('season-map-after-1');
    // Montage: later evenings, as if the season had gone on (each one unlocked for the camera).
    await page.evaluate(() => window.__WG.progress('all'));
    const montage = [
      ['show', 70, 'evening-5-trial', (s) => s.elapsed > 30],
      ['lambing', 110, 'evening-3-lambing', (s) => s.elapsed > 50],
      ['angus', 100, 'evening-4-angus', (s) => s.sheep?.some((q) => q.kind === 'ram' && dist(q, s.dog) < 18)],
      ['mist', 80, 'evening-7-mist', (s) => s.elapsed > 40],
      ['storm', 100, 'evening-8-storm', (s) => s.elapsed > 45],
      ['gather', 70, 'evening-9-gather', (s) => s.elapsed > 35],
      ['first-snow', 90, 'evening-10-snow', (s) => s.elapsed > 40],
    ];
    // Lambing Time is played with Old Fly along: the player sends her to hold a spot, then calls her back.
    const flyCues = [
      ['fly-down', (s) => s.elapsed > 28 && s.sheep?.some((q) => q.state !== 'folded' && dist(q, s.dog) < 22), () => page.keyboard.press('KeyF')],
      ['evening-3-fly', (s) => s.fly?.mode === 'down' && s.elapsed > 31],
      ['fly-back', (s) => s.fly?.mode === 'down' && s.elapsed > 70, () => page.keyboard.press('KeyF')],
    ];
    for (const [id, seconds, name, cue] of montage) {
      if (ctx.overTime()) break;
      await page.evaluate((c) => window.__WG.charms(c), id === 'lambing' ? ['fly'] : []);
      await page.evaluate((e) => window.__WG.evening(e, false), id);
      await frames(3);
      await still(`${name}-card`);
      await page.keyboard.press('Enter');
      await frame();
      mark('evening', { id });
      // A highlight: twenty seconds of the opening, then on to just before the wolves come out.
      st = await play(id === 'lambing' ? 40 : 20, id === 'lambing' ? flyCues : []);
      if (id !== 'show') await page.evaluate(() => {
        const s = window.__WG.state();
        const ws = s.wolfStart ?? 0.2;
        if (s.t < ws - 0.03) window.__WG.jumpTo(ws - 0.03);
      });
      st = await play(seconds, id === 'lambing' ? [[name, cue], ...flyCues] : [[name, cue]]);
    }
    await page.evaluate(() => window.__WG.charms([]));
    // The Wolf Moon: the storm again, harder, with the wolves hunting as a pack.
    if (!ctx.overTime()) {
      await page.evaluate(() => window.__WG.progress('moon'));
      await page.evaluate(() => window.__WG.evening('storm', false, true));
      await frames(3);
      await still('wolf-moon-card');
      await page.keyboard.press('Enter');
      await frame();
      mark('evening', { id: 'storm', moon: true });
      st = await play(15, []);
      // On to the moment a second wolf may come out (the pack needs two).
      await page.evaluate(() => {
        const s = window.__WG.state();
        const ws = s.wolfStart ?? 0.15;
        const two = ws + 0.18 * (0.85 - ws);
        if (s.t < two - 0.02) window.__WG.jumpTo(two - 0.02);
      });
      st = await play(110, [
        ['wolf-moon-pack', (s) => s.wolves?.some((w) => w.role === 'flanker' && w.state === 'stalk')],
        ['wolf-moon-feint', (s) => s.wolves?.some((w) => w.feint)],
      ]);
    }
    // The night watch near its end: the sun coming up and the wolves going home.
    if (!ctx.overTime()) {
      await page.evaluate(() => window.__WG.evening('night-watch', true));
      await frames(1);
      mark('evening', { id: 'night-watch' });
      await play(25, [['evening-6-night', (s) => s.elapsed > 15]]);
      await page.evaluate(() => window.__WG.jumpTo(0.84));
      st = await play(60, [['evening-6-dawn', (s) => s.t > 0.95]]);
      await frames(3);
      await still('evening-6-result');
    }
    log(`season scenario done at ${ctx.time().toFixed(0)} s`);
  },
};
