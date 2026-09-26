import type { AudioSettings } from '../audio/engine';
import { DIFFICULTIES, DOG, type Difficulty } from '../game/config';
import type { Level } from '../game/level';
import type { Outcome, Sim } from '../game/sim';
import { moodTime, SUN_MOON_SWAP } from '../render/daycycle';
import { MARKER_ICONS } from './indicators';
import { Minimap } from './minimap';

// DOM overlay: HUD, messages and the menu screens, all built from the same stitched felt panels
// (see style.css). Key names in tips and banners are drawn as key caps.

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;

function fmtTime(s: number) {
  s = Math.max(0, Math.ceil(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const escapeHtml = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Plain text with key names drawn as key caps: "(Space)", "Shift", "Hold C to creep". */
export function keycaps(text: string) {
  return escapeHtml(text).replace(/\((Shift|Space|Enter|Esc|WASD|C|M)\)|\b(Shift|Space|Enter|Esc|WASD)\b|\b(C|M)(?= to )/g, (_m, a, b, c) => `<kbd>${a ?? b ?? c}</kbd>`);
}

/** A small sheep for the flock counter. */
const SHEEP_GLYPH =
  '<svg class="glyph" viewBox="0 0 26 22"><path d="M4 13a4 4 0 0 1 1.5-7.2A4.6 4.6 0 0 1 13 3.2a4.6 4.6 0 0 1 7.4 2.6A4 4 0 0 1 21 13a3.6 3.6 0 0 1-3.6 3.4H7.4A3.6 3.6 0 0 1 4 13Z" fill="#fbf3e4" stroke="#231c2b" stroke-width="1.4"/><rect x="18.4" y="7.2" width="6" height="6.6" rx="2.6" fill="#231c2b"/><path d="M8 16.2v4M16 16.2v4" stroke="#231c2b" stroke-width="2" stroke-linecap="round"/></svg>';

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
          <div class="count-home">${SHEEP_GLYPH}<span class="n-home">0</span><span class="of">/ <span class="n-total">0</span> home</span></div>
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
          <div class="meter"><span class="meter-label">Stamina <kbd>Shift</kbd></span><div class="stamina"><div class="stamina-fill"></div></div></div>
          <div class="bark-pip"><div class="bark-fill"></div><span>Bark <kbd>Space</kbd></span></div>
        </div>
        <div class="hud-hint"></div>
        <div class="hud-prompt" hidden></div>
        <div class="toast" hidden></div>
      </div>

      <div class="screen title-screen" hidden>
        <div class="title-lockup">
          <div class="kicker">A sheepdog's evening</div>
          <h1>Woolgather</h1>
          <p class="tag">Herd the flock home before nightfall.</p>
        </div>
        <div class="card title-card">
          <div class="diff-label">Choose your evening</div>
          <div class="diff-row"></div>
          <div class="btn-row">
            <button class="btn primary" data-act="play">Play <kbd>Enter</kbd></button>
            <button class="btn" data-act="howto">How to play</button>
          </div>
          <div class="keys-line"><kbd>WASD</kbd> move · <kbd>Shift</kbd> sprint · <kbd>C</kbd> creep · <kbd>Space</kbd> bark · <kbd>Esc</kbd> pause · <kbd>M</kbd> sound · <kbd>&larr;</kbd><kbd>&rarr;</kbd> change the evening</div>
        </div>
      </div>

      <div class="screen pause-screen" hidden><div class="card pause-card">
        <h2>Paused</h2>
        <div class="pause-body">
          <div class="menu">
            <button class="btn primary" data-act="resume">Resume <kbd>Esc</kbd></button>
            <button class="btn" data-act="restart">Restart the day</button>
            <button class="btn" data-act="howto">How to play</button>
            <button class="btn" data-act="title">Quit to title</button>
          </div>
          <div class="sound">
            <div class="sound-title">Sound</div>
            <label class="slider"><span>Volume</span><input type="range" min="0" max="1" step="0.05" data-vol="volume" /><output></output></label>
            <label class="slider"><span>Music</span><input type="range" min="0" max="1" step="0.05" data-vol="music" /><output></output></label>
            <label class="slider"><span>Effects</span><input type="range" min="0" max="1" step="0.05" data-vol="sfx" /><output></output></label>
            <label class="toggle"><input type="checkbox" data-vol="muted" /><span>Mute everything <kbd>M</kbd></span></label>
          </div>
        </div>
      </div></div>

      <div class="screen end-screen" hidden><div class="card end-card">
        <div class="kicker end-kicker"></div>
        <h2 class="end-title"></h2>
        <p class="end-sub"></p>
        <div class="end-stats"></div>
        <div class="btn-row">
          <button class="btn primary" data-act="restart">Play again <kbd>Enter</kbd></button>
          <button class="btn" data-act="title">Title screen</button>
        </div>
      </div></div>

      <div class="screen howto-screen" hidden><div class="card howto-card">
        <h2>How to play</h2>
        <div class="howto-cols">
          <div>
            <h3>Controls</h3>
            <dl class="controls">
              <dt><kbd>WASD</kbd> <kbd>&uarr;&darr;&larr;&rarr;</kbd></dt><dd>move Pip</dd>
              <dt><kbd>Shift</kbd></dt><dd>sprint (uses stamina)</dd>
              <dt><kbd>C</kbd></dt><dd>hold to creep: sheep stay calm until you are close</dd>
              <dt><kbd>Space</kbd></dt><dd>bark: startles sheep, scares wolves off</dd>
              <dt><kbd>Enter</kbd></dt><dd>latch the gate once enough sheep are home</dd>
              <dt><kbd>Esc</kbd></dt><dd>pause</dd>
              <dt><kbd>M</kbd></dt><dd>sound on or off</dd>
            </dl>
            <div class="pad-line"><b>Gamepad:</b> left stick moves, RT sprints, LT creeps, A barks, Y latches, Start pauses.</div>
          </div>
          <div>
            <h3>Herding</h3>
            <ul class="howto">
              <li>Sheep move <b>away</b> from Pip: get behind a flock and it trots on ahead of you.</li>
              <li>The dashed ring is Pip's reach: sheep inside it move away. Creeping shrinks it, sprinting grows it.</li>
              <li>Sheep will not wade the stream: cross at the <b>bridge</b> or the shallow <b>ford</b>.</li>
              <li>Drive them through the gate of the <b>stone fold</b> by the farmhouse.</li>
              <li>When the sun sets (the red notch on the sun bar), <b>wolves</b> come for stragglers. Run at one or bark and it drops its prey.</li>
              <li>Enough sheep home? Latch the gate to end the day. More sheep, more stars.</li>
            </ul>
          </div>
        </div>
        <div class="legend">
          <div class="legend-title">Markers at the screen edge point to things out of view</div>
          <div class="legend-row">
            <span class="lg">${legendIcon('fold')}the fold</span>
            <span class="lg">${legendIcon('sheep')}nearest loose sheep</span>
            <span class="lg">${legendIcon('wolf')}hunting wolf</span>
            <span class="lg">${legendIcon('grab')}sheep in a wolf's jaws</span>
          </div>
        </div>
        <button class="btn primary" data-act="close-howto">Got it <kbd>Enter</kbd></button>
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

  private sound: { settings: AudioSettings; apply: () => void } | null = null;

  /** Wire the pause card's sound controls to the audio settings. */
  bindSound(settings: AudioSettings, apply: () => void) {
    this.sound = { settings, apply };
    this.root.querySelectorAll<HTMLInputElement>('.sound input').forEach((el) => {
      el.addEventListener('input', () => {
        const key = el.dataset.vol as keyof AudioSettings;
        if (key === 'muted') settings.muted = el.checked;
        else settings[key] = Number(el.value);
        apply();
        this.syncSound();
      });
    });
    this.syncSound();
  }

  /** Show the current sound settings (after M toggles mute, or a slider moves). */
  syncSound() {
    if (!this.sound) return;
    const st = this.sound.settings;
    this.root.querySelectorAll<HTMLInputElement>('.sound input').forEach((el) => {
      const key = el.dataset.vol as keyof AudioSettings;
      if (key === 'muted') {
        el.checked = st.muted;
        return;
      }
      const v = st[key] as number;
      if (document.activeElement !== el) el.value = String(v);
      el.style.setProperty('--fill', `${Math.round(v * 100)}%`);
      const out = el.parentElement?.querySelector('output');
      if (out) out.textContent = `${Math.round(v * 100)}`;
    });
  }

  setDifficulty(d: Difficulty) {
    this.difficulty = d;
    this.root.querySelectorAll<HTMLElement>('.diff').forEach((b) => b.classList.toggle('on', b.dataset.diff === d));
  }

  /** Move the keyboard or gamepad focus to the next or previous control on the open screen. */
  moveFocus(dir: number) {
    const screen = this.root.querySelector<HTMLElement>('.screen:not([hidden])');
    if (!screen) return;
    const items = [...screen.querySelectorAll<HTMLElement>('button:not(.diff), input')];
    if (items.length === 0) return;
    const i = items.indexOf(document.activeElement as HTMLElement);
    items[(i < 0 ? 0 : i + dir + items.length) % items.length].focus({ preventScroll: true });
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
    if (screen === 'pause') this.syncSound();
    // Keyboard players start on the screen's main button.
    if (screen) ($(`.${screen}-screen .btn.primary`, this.root) as HTMLElement | null)?.focus({ preventScroll: true });
    else (document.activeElement as HTMLElement | null)?.blur?.();
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
  /** How far the message banner has stepped down out of a wolf's way (px). */
  private toastDrop = 0;
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

  /** Screen rectangle of the minimap panel (null while the HUD is hidden). */
  mapRect() {
    const el = $('.hud-map', this.root);
    return el.offsetParent ? el.getBoundingClientRect() : null;
  }

  /** Let things under the minimap show through it. */
  fadeMap(on: boolean) {
    $('.hud-map', this.root).classList.toggle('faded', on);
  }

  /** Take a message down (showing or waiting) if it is still the given text. */
  dropToast(text: string) {
    if (this.toastText === text) this.toastT = 0;
    this.toastQueue = this.toastQueue.filter((q) => q.text !== text);
    this.renderToast();
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
      el.innerHTML = keycaps(text) + (sub ? `<span class="toast-sub">${keycaps(sub)}</span>` : '');
    }
    if (el.className !== cls) el.className = cls;
  }

  hint(text: string) {
    const el = $('.hud-hint', this.root);
    if (el.dataset.text === text) return;
    el.dataset.text = text;
    el.innerHTML = keycaps(text);
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
  /** A message or the full latch prompt is showing under the timer. */
  get bannerUp() {
    return !$('.toast', this.root).hidden || (!$('.hud-prompt', this.root).hidden && !this.promptIsChip);
  }

  /** Mark the HUD as paused (play's hints and messages hide under the pause card). */
  setPaused(on: boolean) {
    $('.hud', this.root).classList.toggle('paused', on);
  }

  /** The latch prompt has shrunk to its chip. */
  get promptIsChip() {
    return $('.hud-prompt', this.root).classList.contains('chip');
  }

  /**
   * The message banner steps down out of the way of a wolf under it: the danger on screen is never
   * covered by the words about it. `points` are the wolves' (and their prey's) screen positions.
   */
  clearOf(points: { x: number; y: number }[], dt: number) {
    const el = $('.toast', this.root);
    let want = 0;
    if (!el.hidden) {
      const r = el.getBoundingClientRect();
      const top = r.top - this.toastDrop;
      const bottom = r.bottom - this.toastDrop;
      for (const p of points) {
        if (p.x > r.left - 60 && p.x < r.right + 60 && p.y > top - 70 && p.y < bottom + 60) want = Math.max(want, p.y + 70 - top);
      }
    }
    want = Math.min(want, window.innerHeight * 0.3);
    this.toastDrop += (want - this.toastDrop) * (1 - Math.exp(-(want > this.toastDrop ? 14 : 4) * dt));
    if (this.toastDrop < 0.5) this.toastDrop = 0;
    el.style.setProperty('--toast-drop', `${Math.round(this.toastDrop)}px`);
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
    const bark = $('.bark-pip', this.root);
    bark.classList.toggle('ready', d.barkCd <= 0);
    const reach = DOG.barkRadius + 4;
    bark.classList.toggle('urgent', sim.wolves.some((w) => w.state !== 'gone' && w.state !== 'flee' && (w.x - d.x) ** 2 + (w.z - d.z) ** 2 < reach * reach));
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
    const screen = this.root.querySelector('.end-screen')!;
    screen.classList.toggle('win', win);
    screen.classList.toggle('lose', !win);
    const kicker = win ? "Day's end" : o.reason === 'wolves' ? 'Too many lost' : 'Nightfall';
    $('.end-kicker', this.root).textContent = `${kicker} · ${DIFFICULTIES[this.difficulty].label}`;
    let tip = '';
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
      if (o.reason === 'wolves') {
        sub.textContent = `Only ${left} sheep are left and you needed ${sim.target} home.`;
        tip = 'Run straight at a wolf or bark (Space): it drops its prey and runs.';
      } else if (sim.folded === 0) {
        sub.textContent = `None of the ${sim.target} sheep you needed made it home.`;
        tip = 'Get behind a flock and let it trot on ahead of you towards the gate.';
      } else {
        sub.textContent = `Only ${sim.folded} of the ${sim.target} sheep you needed made it home.`;
        tip = 'Sprint (Shift) between flocks to save daylight.';
      }
    }
    // Times match the in-game "Nightfall in" countdown, so they are given as daylight left.
    const dayLen = sim.preset.dayLength;
    // "on the far bank" -> "Far bank": a labelled list reads better than a run-on sentence.
    const place = (x: number, z: number) => {
      const p = this.level.placeName(x, z).replace(/^(in|on|at|by) the /, '');
      return p.charAt(0).toUpperCase() + p.slice(1);
    };
    const losses = sim.lostLog.map((l) => `${place(l.x, l.z)} ${fmtTime(dayLen - l.t)}`).join(' · ');
    const two = Math.ceil((sim.target + sim.total) / 2);
    const stars = win ? [0, 1, 2].map((i) => `<span class="${i < o.stars ? 'on' : ''}">★</span>`).join('') : '';
    const legend = `★ ${sim.target}+ home · ★★ ${two}+ · ★★★ all ${sim.total}`;
    const row = (label: string, value: string) => `<div class="row"><span>${label}</span><b>${value}</b></div>`;
    stats.innerHTML = `
      ${stars ? `<div class="stars">${stars}</div><div class="star-legend">${legend}</div>` : ''}
      <div class="ledger">
        ${row('Home in the fold', `${sim.folded} / ${sim.total}`)}
        ${row('Lost to wolves', String(sim.lost))}
        ${row('Rescued from jaws', String(sim.rescues))}
        ${row('Daylight left', sim.timeLeft > 0.5 ? fmtTime(sim.timeLeft) : 'none')}
      </div>
      ${losses ? `<div class="losses"><b>Taken by wolves:</b> ${escapeHtml(losses)} <span class="dim">(daylight left)</span></div>` : ''}
      ${tip ? `<div class="tip"><b>Tip</b> ${keycaps(tip)}</div>` : ''}`;
    this.show('end');
  }
}
