import { DIFFICULTIES, DOG, type Difficulty } from '../game/config';
import type { Level } from '../game/level';
import type { Outcome, Sim } from '../game/sim';
import { moodTime, SUN_MOON_SWAP } from '../render/daycycle';
import { MARKER_ICONS } from './indicators';
import { Minimap } from './minimap';

// DOM overlay: HUD, toasts and the menu screens. Milestone 1 keeps it functional; milestone 4
// redesigns the look.

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;

function fmtTime(s: number) {
  s = Math.max(0, Math.ceil(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Edge-marker glyph in its badge, for the legend on the how-to card. */
function legendIcon(kind: keyof typeof MARKER_ICONS) {
  return `<span class="lg-icon ind-${kind}"><span class="ind-icon">${MARKER_ICONS[kind]}</span></span>`;
}

export type UiAction = 'play' | 'resume' | 'restart' | 'title' | 'howto' | 'close-howto';

export class Ui {
  readonly root: HTMLElement;
  readonly minimap: Minimap;
  difficulty: Difficulty = 'standard';
  onAction: (a: UiAction) => void = () => {};
  private toastQueue: { text: string; kind: string }[] = [];
  private toastT = 0;

  constructor(private level: Level) {
    this.root = document.getElementById('ui')!;
    this.root.innerHTML = `
      <div class="hud" hidden>
        <div class="hud-counts">
          <div class="count-home"><span class="n-home">0</span><span class="of">/ <span class="n-total">0</span> home</span></div>
          <div class="count-need">need <span class="n-need">0</span> to win<span class="count-stars"></span></div>
          <div class="count-spare"></div>
        </div>
        <div class="hud-time">
          <div class="sunbar"><div class="sunbar-fill"></div><div class="sunbar-mark"></div><div class="sunbar-sun"></div></div>
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
          <li>The dashed ring around Pip is how close you can get before sheep bolt. It shrinks while you creep and grows when you sprint.</li>
          <li><b>Shift</b> sprint (uses stamina). <b>C</b> creep: sheep stay calm until you are close.</li>
          <li><b>Space</b> bark: startles nearby sheep and scares wolves off.</li>
          <li>Drive the flock through the gate of the stone fold by the farmhouse.</li>
          <li>Sheep will not wade the stream: use the bridge or the shallow ford.</li>
          <li>When the sun sets (the red notch on the sun bar) wolves slip out of the pines to drag stragglers into the woods. Run at them or bark to make them drop their prey.</li>
          <li>Once you have enough sheep home, <b>Enter</b> latches the gate and ends the day. More sheep home earns more stars.</li>
        </ul>
        <div class="legend">
          <div class="legend-title">Markers at the screen edge point to things out of view:</div>
          <div class="legend-row">
            <span class="lg">${legendIcon('fold')}the fold</span>
            <span class="lg">${legendIcon('sheep')}nearest loose sheep</span>
            <span class="lg">${legendIcon('wolf')}hunting wolf</span>
            <span class="lg">${legendIcon('grab')}sheep in a wolf's jaws</span>
          </div>
        </div>
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

  /**
   * One message slot. A message at least as urgent as the one showing replaces it at once; a less
   * urgent one waits (only the latest waiting message is kept), so stale banners never pile up.
   */
  toast(text: string, kind = 'info') {
    const pri = (k: string) => (k === 'danger' ? 3 : k === 'info' ? 1 : 2);
    if (this.toastT <= 0 || pri(kind) >= pri(this.toastKind)) {
      this.toastText = text;
      this.toastT = 3.2;
      this.toastKind = kind;
    } else {
      this.toastQueue.length = 0;
      this.toastQueue.push({ text, kind });
    }
    this.renderToast();
  }
  private toastKind = 'info';
  private toastText = '';
  private alertText: string | null = null;
  private alertSub = '';

  /**
   * A danger message that holds the slot until cleared (a sheep in a wolf's jaws). Toasts that
   * arrive meanwhile wait underneath and show once it clears.
   */
  alert(text: string | null, sub = '') {
    if (text === this.alertText && sub === this.alertSub) return;
    this.alertSub = sub;
    if (text && !this.alertText) {
      // Whatever was showing is old news by the time the snatch is settled.
      this.toastT = 0;
      this.toastQueue.length = 0;
    }
    this.alertText = text;
    this.renderToast();
  }

  /** Screen rectangle of the minimap panel. */
  mapRect() {
    const el = $('.hud-map', this.root);
    return el.offsetParent ? el.getBoundingClientRect() : null;
  }

  /** Let things under the minimap show through it. */
  fadeMap(on: boolean) {
    $('.hud-map', this.root).classList.toggle('faded', on);
  }

  /** Drop a showing or waiting info toast (e.g. the day's objective once the target is met). */
  dropInfoToast() {
    if (this.toastKind === 'info') this.toastT = 0;
    this.toastQueue = this.toastQueue.filter((q) => q.kind !== 'info');
    this.renderToast();
  }

  private renderToast() {
    const el = $('.toast', this.root);
    const text = this.alertText ?? (this.toastT > 0 ? this.toastText : '');
    const cls = this.alertText ? 'toast danger sticky' : `toast ${this.toastKind}`;
    el.hidden = !text;
    // A snatch alert carries what to do on a second line in the same banner.
    const sub = this.alertText ? this.alertSub : '';
    const key = `${text}|${sub}`;
    if (el.dataset.key !== key) {
      el.dataset.key = key;
      el.textContent = text;
      if (sub) {
        const line = document.createElement('span');
        line.className = 'toast-sub';
        line.textContent = sub;
        el.appendChild(line);
      }
    }
    if (el.className !== cls) el.className = cls;
  }

  hint(text: string) {
    $('.hud-hint', this.root).textContent = text;
  }

  /**
   * A prominent call to action under the timer (e.g. latching the gate); after a few seconds it
   * shrinks to a small chip with the `short` text. Null hides it.
   */
  prompt(html: string | null, short = '') {
    const el = $('.hud-prompt', this.root);
    if (!html) this.promptSince = -1;
    else if (this.promptSince < 0) this.promptSince = performance.now();
    const chip = !!html && !!short && performance.now() - this.promptSince > 5000;
    const want = chip ? short : html;
    el.hidden = !html;
    el.classList.toggle('chip', chip);
    $('.hud', this.root).classList.toggle('has-prompt', !!html && !chip);
    if (want && el.innerHTML !== want) el.innerHTML = want;
  }
  private promptSince = -1;
  /** The latch prompt has shrunk to its chip. */
  get promptIsChip() {
    return $('.hud-prompt', this.root).classList.contains('chip');
  }

  /** HUD panels go see-through while Pip, a sheep or a wolf is behind them (screen points). */
  fadePanels(points: { x: number; y: number }[]) {
    for (const sel of ['.hud-counts', '.hud-time', '.toast', '.hud-prompt']) {
      const el = $(sel, this.root);
      if (el.hidden) continue;
      const r = el.getBoundingClientRect();
      const under = points.some((p) => p.x > r.left - 14 && p.x < r.right + 14 && p.y > r.top - 14 && p.y < r.bottom + 14);
      el.classList.toggle('see-through', under);
    }
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
    const spareTxt = spare > 0 ? `${spare} sheep to spare` : 'no sheep to spare!';
    spareEl.textContent = sim.targetMet
      ? `target met${lostTxt}`
      : hurry
        ? `hurry: ${need} more · ${spareTxt}`
        : `${spareTxt}${lostTxt}`;
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
    // The extra-star targets, lit once reached and struck out once the wolves make them impossible.
    const two = Math.ceil((sim.target + sim.total) / 2);
    const tier = (n: number, s: string) =>
      `<span class="${sim.folded >= n ? 'got' : sim.total - sim.lost < n ? 'gone' : ''}">${s} ${n}</span>`;
    const starsHtml = ` · ${tier(two, '★★')} · ${tier(sim.total, '★★★')}`;
    const starsEl = $('.count-stars', this.root);
    if (starsEl.innerHTML !== starsHtml) starsEl.innerHTML = starsHtml;
    $('.t-left', this.root).textContent = fmtTime(sim.timeLeft);
    // The last minute escalates: ember text, then a pulse in the final 20 seconds.
    const timeEl = $('.hud-time', this.root);
    timeEl.classList.toggle('late', sim.timeLeft < 60);
    timeEl.classList.toggle('critical', sim.timeLeft < 20);
    ($('.sunbar-fill', this.root) as HTMLElement).style.width = `${(1 - sim.t) * 100}%`;
    // The sky the camera cannot show: a sun riding the end of the bar, a moon once it has set.
    const sun = $('.sunbar-sun', this.root);
    sun.style.left = `${(1 - sim.t) * 100}%`;
    sun.classList.toggle('moon', moodTime(sim.t, ws, sim.preset.dayLength) >= SUN_MOON_SWAP);
    const d = sim.dog;
    const st = $('.stamina-fill', this.root);
    st.style.width = `${(d.stamina / DOG.staminaMax) * 100}%`;
    st.classList.toggle('tired', d.sprintLock);
    $('.bark-pip', this.root).classList.toggle('ready', d.barkCd <= 0);
    $('.bark-fill', this.root).style.width = `${(1 - d.barkCd / DOG.barkCooldown) * 100}%`;
    this.minimap.draw(sim, time);

    // Toasts under an alert do not run down, so nothing is missed while a snatch is on.
    if (!this.alertText && this.toastT > 0) {
      this.toastT -= dt;
      if (this.toastT <= 0) {
        const next = this.toastQueue.shift();
        if (next) {
          this.toastText = next.text;
          this.toastKind = next.kind;
          this.toastT = 3.2;
        }
      }
    }
    this.renderToast();
  }

  clearToasts() {
    this.toastQueue.length = 0;
    this.toastT = 0;
    this.alertText = null;
    this.renderToast();
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
            ? sim.free > 0
              ? `You latched the gate with ${sim.folded} safe inside; ${sim.free} ${sim.free === 1 ? 'was' : 'were'} left out on the hill.`
              : 'You latched the gate with the flock safe inside.'
            : sim.lost === 0
              ? 'Not a single sheep left out on the hill.'
              : `Every sheep still with you is safe in the fold, but the wolves took ${took}.`;
    } else {
      title.textContent = o.reason === 'wolves' ? 'The wolves took too many' : 'Night has fallen';
      const left = sim.total - sim.lost;
      sub.textContent =
        o.reason === 'wolves'
          ? `Only ${left} sheep are left and you needed ${sim.target} home. Tip: run straight at a wolf or bark (Space) and it drops its prey.`
          : sim.folded === 0
            ? `None of the ${sim.target} sheep you needed made it home. Tip: get behind a flock and let it trot ahead of you towards the gate.`
            : `Only ${sim.folded} of the ${sim.target} sheep you needed made it home. Tip: sprint (Shift) between flocks to save daylight.`;
    }
    const stars = o.kind === 'win' ? '★'.repeat(o.stars) + '☆'.repeat(3 - o.stars) : '';
    // Times match the in-game "Nightfall in" countdown, so they are given as daylight left.
    const dayLen = sim.preset.dayLength;
    const losses = sim.lostLog.map((l) => `${this.level.placeName(l.x, l.z)} (${fmtTime(dayLen - l.t)} left)`).join(' · ');
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
