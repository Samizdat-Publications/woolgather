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
};
