import { DIFFICULTIES, DOG, type Difficulty } from '../game/config';
import type { Level } from '../game/level';
import type { Outcome, Sim } from '../game/sim';
import { Minimap } from './minimap';

// DOM overlay: HUD, toasts and the menu screens. Milestone 1 keeps it functional; milestone 4
// redesigns the look.

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;

function fmtTime(s: number) {
  s = Math.max(0, Math.ceil(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Rough valley region for a point, for the losses line on the end card. */
function placeName(x: number, z: number) {
  // Same names as the minimap labels.
  if (x < -44) return 'on the far bank';
  if (z < -35) return 'in the grove';
  if (z > 35) return 'near the rocks';
  if (x > 40) return 'near the farm';
  return 'in the meadow';
}

export type UiAction = 'play' | 'resume' | 'restart' | 'title' | 'howto' | 'close-howto';

export class Ui {
  readonly root: HTMLElement;
  readonly minimap: Minimap;
  difficulty: Difficulty = 'standard';
  onAction: (a: UiAction) => void = () => {};
  private toastQueue: { text: string; kind: string }[] = [];
  private toastT = 0;

  constructor(level: Level) {
    this.root = document.getElementById('ui')!;
    this.root.innerHTML = `
      <div class="hud" hidden>
        <div class="hud-counts">
          <div class="count-home"><span class="n-home">0</span><span class="of">/ <span class="n-total">0</span> home</span></div>
          <div class="count-need">need <span class="n-need">0</span></div>
          <div class="count-spare"></div>
        </div>
        <div class="hud-time">
          <div class="sunbar"><div class="sunbar-fill"></div><div class="sunbar-mark"></div></div>
          <div class="time-label">Nightfall in <span class="t-left">0:00</span></div>
          <div class="wolf-label"></div>
        </div>
        <div class="hud-map"></div>
        <div class="hud-dog">
          <div class="meter"><span class="meter-label">Stamina <small>(Shift)</small></span><div class="stamina"><div class="stamina-fill"></div></div></div>
          <div class="bark-pip"><div class="bark-fill"></div><span>Bark <small>(Space)</small></span></div>
        </div>
        <div class="hud-hint"></div>
        <div class="hud-prompt" hidden></div>
        <div class="toast" hidden></div>
      </div>

      <div class="screen title-screen" hidden>
        <h1>Woolgather</h1>
        <p class="tag">Herd the flock home before nightfall.</p>
        <div class="diff-row"></div>
        <button class="btn primary" data-act="play">Play</button>
        <button class="btn" data-act="howto">How to play</button>
      </div>

      <div class="screen pause-screen" hidden><div class="card">
        <h2>Paused</h2>
        <button class="btn primary" data-act="resume">Resume</button>
        <button class="btn" data-act="restart">Restart day</button>
        <button class="btn" data-act="howto">How to play</button>
        <button class="btn" data-act="title">Quit to title</button>
      </div></div>

      <div class="screen end-screen" hidden><div class="card">
        <h2 class="end-title"></h2>
        <p class="end-sub"></p>
        <div class="end-stats"></div>
        <button class="btn primary" data-act="restart">Play again</button>
        <button class="btn" data-act="title">Title screen</button>
      </div></div>

      <div class="screen howto-screen" hidden><div class="card">
        <h2>How to play</h2>
        <ul class="howto">
          <li><b>WASD / Arrows</b> move Pip. Sheep run <i>away</i> from you, so get behind them.</li>
          <li>The pale ring around Pip is how close you can get before sheep bolt. It shrinks while you creep and grows when you sprint.</li>
          <li><b>Shift</b> sprint (uses stamina). <b>C</b> creep: sheep stay calm until you are close.</li>
          <li><b>Space</b> bark: startles nearby sheep and scares wolves off.</li>
          <li>Drive the flock through the gate of the stone fold by the farmhouse.</li>
          <li>Sheep will not wade the stream: use the bridge or the shallow ford.</li>
          <li>After sunset wolves try to drag stragglers into the woods. Chase them off!</li>
          <li>Once you have enough sheep home, <b>Enter</b> latches the gate and ends the day.</li>
        </ul>
        <button class="btn primary" data-act="close-howto">Got it</button>
      </div></div>
    `;
    this.minimap = new Minimap(level);
    $('.hud-map', this.root).appendChild(this.minimap.canvas);

    const row = $('.diff-row', this.root);
    for (const d of Object.values(DIFFICULTIES)) {
      const b = document.createElement('button');
      b.className = 'btn diff';
      b.dataset.diff = d.id;
      b.innerHTML = `<b>${d.label}</b><small>${d.blurb}</small>`;
      b.addEventListener('click', () => this.setDifficulty(d.id));
      row.appendChild(b);
    }
    this.setDifficulty(this.difficulty);

    this.root.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (el) this.onAction(el.dataset.act as UiAction);
    });
  }

  setDifficulty(d: Difficulty) {
    this.difficulty = d;
    this.root.querySelectorAll<HTMLElement>('.diff').forEach((b) => b.classList.toggle('on', b.dataset.diff === d));
  }

  cycleDifficulty(dir: number) {
    const ids = Object.keys(DIFFICULTIES) as Difficulty[];
    const i = ids.indexOf(this.difficulty);
    this.setDifficulty(ids[(i + dir + ids.length) % ids.length]);
  }

  show(screen: 'title' | 'pause' | 'end' | 'howto' | null) {
    for (const s of ['title', 'pause', 'end', 'howto']) {
      ($(`.${s}-screen`, this.root) as HTMLElement).hidden = s !== screen;
    }
  }

  showHud(on: boolean) {
    $('.hud', this.root).hidden = !on;
  }

  toast(text: string, kind = 'info') {
    this.toastQueue.push({ text, kind });
  }

  hint(text: string) {
    $('.hud-hint', this.root).textContent = text;
  }

  /** A prominent call to action above the hint line (e.g. latching the gate). Null hides it. */
  prompt(html: string | null) {
    const el = $('.hud-prompt', this.root);
    el.hidden = !html;
    if (html && el.innerHTML !== html) el.innerHTML = html;
  }

  update(sim: Sim, dt: number, time: number) {
    $('.n-home', this.root).textContent = String(sim.folded);
    $('.n-total', this.root).textContent = String(sim.total);
    $('.n-need', this.root).textContent = String(sim.target);
    // How many more sheep can be lost before the target becomes impossible, or a hurry-up when
    // daylight is the tighter limit.
    const spare = sim.total - sim.target - sim.lost;
    const need = Math.max(0, sim.target - sim.folded);
    const spareEl = $('.count-spare', this.root);
    const lostTxt = sim.lost > 0 ? ` · lost ${sim.lost}` : '';
    const hurry = !sim.targetMet && sim.timeLeft < 90;
    spareEl.textContent = sim.targetMet
      ? `target met${lostTxt}`
      : hurry
        ? `hurry: ${need} more before dark!`
        : spare > 0
          ? `can lose ${spare} more${lostTxt}`
          : `no sheep to spare!${lostTxt}`;
    spareEl.classList.toggle('danger', (!sim.targetMet && spare <= 0) || hurry);
    // Sun bar: a notch where the wolves come out, violet once the sun is down.
    const ws = sim.preset.wolfStart;
    const wolvesOut = sim.t >= ws;
    const mark = $('.sunbar-mark', this.root);
    mark.style.left = `${(1 - ws) * 100}%`;
    mark.hidden = wolvesOut;
    $('.sunbar-fill', this.root).classList.toggle('dusk', wolvesOut);
    const wl = $('.wolf-label', this.root);
    wl.textContent = wolvesOut ? 'the wolves are out' : `wolves come out in ${fmtTime((ws - sim.t) * sim.preset.dayLength)}`;
    wl.classList.toggle('out', wolvesOut);
    $('.count-need', this.root).classList.toggle('met', sim.targetMet);
    $('.t-left', this.root).textContent = fmtTime(sim.timeLeft);
    // The last minute escalates: ember text, then a pulse in the final 20 seconds.
    const timeEl = $('.hud-time', this.root);
    timeEl.classList.toggle('late', sim.timeLeft < 60);
    timeEl.classList.toggle('critical', sim.timeLeft < 20);
    ($('.sunbar-fill', this.root) as HTMLElement).style.width = `${(1 - sim.t) * 100}%`;
    const d = sim.dog;
    const st = $('.stamina-fill', this.root);
    st.style.width = `${(d.stamina / DOG.staminaMax) * 100}%`;
    st.classList.toggle('tired', d.sprintLock);
    $('.bark-pip', this.root).classList.toggle('ready', d.barkCd <= 0);
    $('.bark-fill', this.root).style.width = `${(1 - d.barkCd / DOG.barkCooldown) * 100}%`;
    this.minimap.draw(sim, time);

    const toast = $('.toast', this.root);
    this.toastT -= dt;
    if (this.toastT <= 0) {
      const next = this.toastQueue.shift();
      if (next) {
        toast.textContent = next.text;
        toast.className = `toast ${next.kind}`;
        toast.hidden = false;
        this.toastT = 3.2;
      } else {
        toast.hidden = true;
      }
    }
  }

  clearToasts() {
    this.toastQueue.length = 0;
    this.toastT = 0;
    $('.toast', this.root).hidden = true;
  }

  showEnd(o: Outcome, sim: Sim) {
    const title = $('.end-title', this.root);
    const sub = $('.end-sub', this.root);
    const stats = $('.end-stats', this.root);
    const win = o.kind === 'win';
    this.root.querySelector('.end-screen')!.classList.toggle('win', win);
    this.root.querySelector('.end-screen')!.classList.toggle('lose', !win);
    if (o.kind === 'win') {
      title.textContent = o.stars === 3 ? 'Every sheep is home!' : sim.free > 0 ? 'Home before dark' : 'The flock is home';
      const took = sim.lost === 1 ? 'one' : String(sim.lost);
      sub.textContent =
        o.reason === 'nightfall'
          ? 'Night fell, but enough of the flock made it to the fold.'
          : o.reason === 'latched'
            ? 'You latched the gate with the flock safe inside.'
            : sim.lost === 0
              ? 'Not a single sheep left out on the hill.'
              : `Every sheep still with you is safe in the fold, but the wolves took ${took}.`;
    } else {
      title.textContent = o.reason === 'wolves' ? 'The wolves took too many' : 'Night has fallen';
      sub.textContent =
        o.reason === 'wolves'
          ? 'Too few sheep are left to make it through the winter.'
          : sim.folded === 0
            ? `None of the ${sim.target} sheep you needed made it home.`
            : `Only ${sim.folded} of the ${sim.target} sheep you needed made it home.`;
    }
    const stars = o.kind === 'win' ? '★'.repeat(o.stars) + '☆'.repeat(3 - o.stars) : '';
    // Times match the in-game "Nightfall in" countdown, so they are given as daylight left.
    const dayLen = sim.preset.dayLength;
    const losses = sim.lostLog.map((l) => `${placeName(l.x, l.z)} (${fmtTime(dayLen - l.t)} left)`).join(' · ');
    const two = Math.ceil((sim.target + sim.total) / 2);
    const legend = `★ ${sim.target}+ home · ★★ ${two}+ · ★★★ all ${sim.total}`;
    stats.innerHTML = `
      ${stars ? `<div class="stars">${stars}</div><div class="star-legend">${legend}</div>` : ''}
      <div>Home: <b>${sim.folded}</b> / ${sim.total}</div>
      <div>Lost to wolves: <b>${sim.lost}</b></div>
      ${losses ? `<div class="losses">Taken ${losses}</div>` : ''}
      <div>Rescued from jaws: <b>${sim.rescues}</b></div>
      <div>${sim.timeLeft > 0.5 ? `Daylight left: <b>${fmtTime(sim.timeLeft)}</b>` : 'Night had fallen'}</div>`;
    this.show('end');
  }
}
