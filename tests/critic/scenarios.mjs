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
    /** Play with the bot for `seconds` of game time (or to the end), taking stills on cue. */
    const play = async (seconds, cues = []) => {
      const bot = new Bot(page);
      const until = ctx.time() + seconds;
      let st = await state();
      while (st.mode !== 'ended' && ctx.time() < until && !ctx.overTime()) {
        const due = [];
        for (const [name, cond] of cues) {
          if (!taken.has(name) && st.mode === 'playing' && cond(st)) {
            taken.add(name);
            due.push(name);
          }
        }
        if (st.mode === 'playing') await bot.step(st, 1 / fps);
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
      ['mist', 80, 'evening-6-mist', (s) => s.elapsed > 40],
      ['storm', 100, 'evening-7-storm', (s) => s.elapsed > 45],
      ['first-snow', 90, 'evening-8-snow', (s) => s.elapsed > 40],
    ];
    for (const [id, seconds, name, cue] of montage) {
      if (ctx.overTime()) break;
      await page.evaluate((e) => window.__WG.evening(e, false), id);
      await frames(3);
      await still(`${name}-card`);
      await page.keyboard.press('Enter');
      await frame();
      mark('evening', { id });
      // A highlight: twenty seconds of the opening, then on to just before the wolves come out.
      st = await play(20, []);
      if (id !== 'show') await page.evaluate(() => {
        const s = window.__WG.state();
        const ws = { lambing: 0.22, angus: 0.2, mist: 0.24, storm: 0.22, 'first-snow': 0.18 }[s.evening] ?? 0.2;
        if (s.t < ws - 0.03) window.__WG.jumpTo(ws - 0.03);
      });
      st = await play(seconds, [[name, cue]]);
    }
    // The night watch near its end: the sun coming up and the wolves going home.
    if (!ctx.overTime()) {
      await page.evaluate(() => window.__WG.evening('night-watch', true));
      await frames(1);
      mark('evening', { id: 'night-watch' });
      await play(25, [['evening-5-night', (s) => s.elapsed > 15]]);
      await page.evaluate(() => window.__WG.jumpTo(0.84));
      st = await play(60, [['evening-5-dawn', (s) => s.t > 0.95]]);
      await frames(3);
      await still('evening-5-result');
    }
    log(`season scenario done at ${ctx.time().toFixed(0)} s`);
  },
};
