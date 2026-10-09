import type { AudioSettings } from '../audio/engine';
import { DIFFICULTIES, DOG, type Difficulty } from '../game/config';
import type { Level } from '../game/level';
import type { Rules } from '../game/rules';
import { CHARMS, SECOND_CHARM_STARS, SEASON, totalRibbons, totalStars, unlocked, type Evening, type Progress } from '../game/season';
import type { Outcome, Sim } from '../game/sim';
import { dawnTime, moodTime, SUN_MOON_SWAP } from '../render/daycycle';
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
  return escapeHtml(text).replace(/\((Shift|Space|Enter|Esc|WASD|C|M|Q)\)|\b(Shift|Space|Enter|Esc|WASD)\b|\b(C|M|Q)(?= to )/g, (_m, a, b, c) => `<kbd>${a ?? b ?? c}</kbd>`);
}

/** A small sheep for the flock counter. */
const SHEEP_GLYPH =
  '<svg class="glyph" viewBox="0 0 28 22"><path d="M8 15.5v4.5M16 15.5v4.5" stroke="#231c2b" stroke-width="2.6" stroke-linecap="round"/><path d="M3.5 11.5a3.8 3.8 0 0 1 1.8-6.4A4.4 4.4 0 0 1 12 2.8a4.4 4.4 0 0 1 6.6 2.6A3.8 3.8 0 0 1 19 12.8a3.4 3.4 0 0 1-3.3 3H6.6a3.4 3.4 0 0 1-3.1-4.3Z" fill="#fbf3e4" stroke="#231c2b" stroke-width="1.4"/><path d="M18.5 7.2c1.8-1.4 5.4-1 6.6 1.2 1 1.9-0.2 4.9-2.6 5.4-2.2 0.5-4.4-0.9-4.6-3" fill="#231c2b"/><path d="M19.2 6.8l-2.4-1.6" stroke="#231c2b" stroke-width="2.2" stroke-linecap="round"/></svg>';

/** A rosette for ribbons (filled when won). */
const RIBBON = (on: boolean) =>
  `<svg class="ribbon-glyph ${on ? 'on' : ''}" viewBox="0 0 24 28"><path d="M7 14 L3 27 L8 24 L11 28 L12 16 Z M17 14 L21 27 L16 24 L13 28 L12 16 Z" fill="${on ? '#c0402e' : 'none'}" stroke="${on ? '#7a2018' : 'rgba(251,243,228,0.45)'}" stroke-width="1.4"/><circle cx="12" cy="10" r="8.5" fill="${on ? '#e8584a' : 'none'}" stroke="${on ? '#7a2018' : 'rgba(251,243,228,0.45)'}" stroke-width="1.6"/><circle cx="12" cy="10" r="4.5" fill="${on ? '#f2b45a' : 'none'}" stroke="${on ? '#7a2018' : 'rgba(251,243,228,0.3)'}" stroke-width="1.2"/></svg>`;

const LOCK = '<svg class="lock" viewBox="0 0 20 22"><rect x="3" y="9" width="14" height="11" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M6 9V6.5a4 4 0 0 1 8 0V9" fill="none" stroke="currentColor" stroke-width="2"/></svg>';

const stars = (n: number, of = 3) => Array.from({ length: of }, (_, i) => `<span class="${i < n ? 'on' : ''}">★</span>`).join('');

function legendIcon(kind: keyof typeof MARKER_ICONS) {
  return `<span class="lg-icon ind-${kind}"><span class="ind-icon">${MARKER_ICONS[kind]}</span></span>`;
}

export type Screen = 'title' | 'season' | 'intro' | 'pause' | 'end' | 'howto';

export interface EndContext {
  evening: Evening | null;
  ribbon: boolean;
  firstWin: boolean;
  next: Evening | null;
  unlocked: string[];
  seasonDone: boolean;
  progress: Progress;
  /** Beat this evening's best time (or trial score). */
  newBest?: boolean;
}

export class Ui {
  readonly root: HTMLElement;
  readonly minimap: Minimap;
  difficulty: Difficulty = 'standard';
  onAction: (a: string, arg?: string) => void = () => {};
  private toastQueue: { text: string; kind: string }[] = [];
  private toastT = 0;
  current: Screen | null = null;

  constructor(private level: Level) {
    this.root = document.getElementById('ui')!;
    this.root.innerHTML = `
      <div class="hud" hidden>
        <div class="hud-counts">
          <div class="count-home">${SHEEP_GLYPH}<span class="n-home">0</span><span class="of"><span class="of-word">home</span> · need <span class="n-need">0</span></span></div>
          <div class="pips"></div>
          <div class="goals"></div>
          <div class="count-spare"></div>
        </div>
        <div class="hud-time">
          <div class="sunbar"><div class="sunbar-fill"></div><div class="sunbar-mark"></div><div class="sunbar-sun"></div></div>
          <div class="time-label"><span class="t-word">Nightfall in</span> <span class="t-left">0:00</span></div>
          <div class="wolf-label"></div>
        </div>
        <div class="hud-map"></div>
        <div class="hud-dog">
          <div class="meter"><span class="meter-label">Stamina <kbd>Shift</kbd></span><div class="stamina"><div class="stamina-fill"></div></div></div>
          <div class="creep-pip"><span>Creep <kbd>C</kbd></span></div>
          <div class="creep-pip lie-pip"><span>Lie down <kbd>Q</kbd></span></div>
          <div class="bark-pip"><div class="bark-fill"></div><span>Bark <kbd>Space</kbd></span></div>
        </div>
        <div class="hud-hint"></div>
        <div class="hud-prompt" hidden></div>
        <div class="toast" hidden></div>
      </div>

      <div class="screen title-screen" hidden>
        <div class="title-lockup">
          <div class="kicker">A sheepdog's year</div>
          <h1>Woolgather</h1>
          <p class="tag">Herd the flock home before nightfall.</p>
        </div>
        <div class="card title-card">
          <button class="btn primary big" data-act="season">The Season <kbd>Enter</kbd></button>
          <div class="season-line"></div>
          <div class="classic">
            <div class="diff-label">Or a classic evening in Hollow Valley</div>
            <div class="diff-row"></div>
          </div>
          <div class="btn-row">
            <button class="btn" data-act="classic">Classic evening</button>
            <button class="btn" data-act="howto">How to play</button>
          </div>
          <div class="keys-line"><kbd>WASD</kbd> move · <kbd>Shift</kbd> sprint · <kbd>C</kbd> creep · <kbd>Q</kbd> lie down · <kbd>Space</kbd> bark · <kbd>Esc</kbd> pause</div>
        </div>
      </div>

      <div class="screen season-screen" hidden>
        <div class="card season-card">
          <div class="season-head">
            <div>
              <div class="kicker">A year on the hill farm</div>
              <h2>The Season</h2>
            </div>
            <div class="season-tally"></div>
          </div>
          <div class="season-grid"></div>
          <div class="charm-shelf"></div>
          <div class="btn-row">
            <button class="btn" data-act="title">Back <kbd>Esc</kbd></button>
          </div>
        </div>
      </div>

      <div class="screen intro-screen" hidden>
        <div class="card intro-card">
          <div class="kicker intro-kicker"></div>
          <h2 class="intro-title"></h2>
          <p class="intro-story"></p>
          <div class="intro-new"></div>
          <div class="intro-goals"></div>
          <div class="intro-charms"></div>
          <div class="btn-row">
            <button class="btn primary" data-act="begin">Begin <kbd>Enter</kbd></button>
            <button class="btn" data-act="season">The season <kbd>Esc</kbd></button>
          </div>
        </div>
      </div>

      <div class="screen pause-screen" hidden><div class="card pause-card">
        <h2>Paused</h2>
        <div class="pause-body">
          <div class="menu">
            <button class="btn primary" data-act="resume">Resume <kbd>Esc</kbd></button>
            <button class="btn" data-act="restart">Restart the evening</button>
            <button class="btn" data-act="howto">How to play</button>
            <button class="btn" data-act="title">Quit to title</button>
          </div>
          <div class="sound">
            <div class="sound-title">Sound</div>
            <label class="slider"><span>Volume</span><input type="range" min="0" max="1" step="0.05" data-vol="volume" /><output></output></label>
            <label class="slider"><span>Music</span><input type="range" min="0" max="1" step="0.05" data-vol="music" /><output></output></label>
            <label class="slider"><span>Effects</span><input type="range" min="0" max="1" step="0.05" data-vol="sfx" /><output></output></label>
            <label class="toggle"><input type="checkbox" data-vol="muted" /><span>Mute everything <kbd>M</kbd></span></label>
            <div class="sound-title gfx-title">Graphics</div>
            <div class="seg" role="radiogroup">
              <button class="seg-btn" data-q="auto">Auto</button><button class="seg-btn" data-q="high">High</button><button class="seg-btn" data-q="medium">Medium</button><button class="seg-btn" data-q="low">Low</button>
            </div>
            <div class="gfx-note"></div>
          </div>
        </div>
      </div></div>

      <div class="screen end-screen" hidden><div class="card end-card">
        <div class="kicker end-kicker"></div>
        <h2 class="end-title"></h2>
        <p class="end-sub"></p>
        <div class="end-stats"></div>
        <div class="btn-row end-buttons"></div>
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
              <dt><kbd>Q</kbd></dt><dd>hold to lie down: Pip drops flat and the flock stops</dd>
              <dt><kbd>Space</kbd></dt><dd>bark: startles sheep, scares wolves off, moves a stubborn ram</dd>
              <dt><kbd>Enter</kbd></dt><dd>latch the gate once enough sheep are home</dd>
              <dt><kbd>Esc</kbd></dt><dd>pause</dd>
              <dt><kbd>M</kbd></dt><dd>sound on or off</dd>
            </dl>
            <div class="pad-line"><b>Gamepad:</b> left stick moves, RT sprints, LT creeps, B lies down, A barks, Y latches, Start pauses.</div>
          </div>
          <div>
            <h3>Herding</h3>
            <ul class="howto">
              <li>Sheep move <b>away</b> from Pip: get behind a flock and it trots on ahead of you.</li>
              <li>The dashed ring is Pip's reach: sheep inside it move away. Creeping shrinks it, sprinting grows it.</li>
              <li>Sheep will not wade a stream: cross at a <b>bridge</b> or a shallow <b>ford</b>.</li>
              <li>Drive them through the gate of the <b>stone fold</b>.</li>
              <li>When the sun bar reaches the red notch, <b>wolves</b> come out for stragglers. Run at one or bark near it: it drops the sheep.</li>
              <li>The counter has a dot per sheep, a gold tick at the target and the star goals below. Target met? Latch the gate, or keep herding for stars.</li>
              <li><b>Lambs</b> follow their mothers. <b>Rams</b> stand their ground: stare them down (stand still or creep near) or bark.</li>
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
      // A second click on the chosen evening starts it.
      b.addEventListener('click', () => (this.difficulty === d.id ? this.onAction('classic') : this.setDifficulty(d.id)));
      row.appendChild(b);
    }
    this.setDifficulty(this.difficulty);

    this.root.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (el && !el.classList.contains('locked')) this.onAction(el.dataset.act!, el.dataset.arg);
    });
  }

  setLevel(level: Level) {
    this.level = level;
    this.minimap.setLevel(level);
  }

  /** The HUD's words for the evening's goal: nightfall or dawn, home or safe. */
  setRules(r: Rules) {
    const watch = r.objective === 'watch';
    const trial = r.objective === 'trial';
    $('.t-word', this.root).textContent = watch ? 'Dawn in' : trial ? 'Time left' : 'Nightfall in';
    $('.of-word', this.root).textContent = watch ? 'safe' : trial ? 'points' : 'home';
    $('.count-home .of', this.root).innerHTML = trial ? '<span class="of-word">points</span> <span class="n-need" hidden></span>' : `<span class="of-word">${watch ? 'safe' : 'home'}</span> · need <span class="n-need">0</span>`;
    this.root.querySelector('.hud-counts')!.classList.toggle('watch', watch);
    $('.pips', this.root).dataset.key = '';
  }

  private sound: { settings: AudioSettings; apply: () => void } | null = null;

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

  private gfx: { get: () => { mode: string; tier: string }; set: (m: 'auto' | 'high' | 'medium' | 'low') => void } | null = null;

  bindQuality(get: () => { mode: string; tier: string }, set: (m: 'auto' | 'high' | 'medium' | 'low') => void) {
    this.gfx = { get, set };
    this.root.querySelectorAll<HTMLButtonElement>('.seg-btn').forEach((b) =>
      b.addEventListener('click', () => {
        set(b.dataset.q as 'auto' | 'high' | 'medium' | 'low');
        this.syncQuality();
      }),
    );
    this.syncQuality();
  }

  syncQuality() {
    if (!this.gfx) return;
    const { mode, tier } = this.gfx.get();
    this.root.querySelectorAll<HTMLButtonElement>('.seg-btn').forEach((b) => b.classList.toggle('on', b.dataset.q === mode));
    $('.gfx-note', this.root).textContent = mode === 'auto' ? `Running at ${tier}: it steps down by itself if the game runs slowly.` : '';
  }

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

  moveFocus(dir: number) {
    const screen = this.root.querySelector<HTMLElement>('.screen:not([hidden])');
    if (!screen) return;
    const items = [...screen.querySelectorAll<HTMLElement>('button:not(.diff):not(.locked), input')];
    if (items.length === 0) return;
    const i = items.indexOf(document.activeElement as HTMLElement);
    items[(i < 0 ? 0 : i + dir + items.length) % items.length].focus({ preventScroll: true });
  }

  cycleDifficulty(dir: number) {
    const ids = Object.keys(DIFFICULTIES) as Difficulty[];
    const i = ids.indexOf(this.difficulty);
    this.setDifficulty(ids[(i + dir + ids.length) % ids.length]);
  }

  show(screen: Screen | null) {
    this.current = screen;
    for (const s of ['title', 'season', 'intro', 'pause', 'end', 'howto']) ($(`.${s}-screen`, this.root) as HTMLElement).hidden = s !== screen;
    if (screen === 'pause') {
      this.syncSound();
      this.syncQuality();
    }
    if (screen) {
      const el = ($(`.${screen}-screen .focus-me`, this.root) ?? $(`.${screen}-screen .btn.primary`, this.root)) as HTMLElement | null;
      el?.focus({ preventScroll: true });
    } else (document.activeElement as HTMLElement | null)?.blur?.();
  }

  // ---------------------------------------------------------------- season screens

  /** The season map: eight evenings with their stars and ribbons, and the charms. */
  renderSeason(p: Progress) {
    const s = totalStars(p);
    $('.season-tally', this.root).innerHTML = `<div class="tally"><span class="tally-n">${s}</span><span class="tally-of">/ ${SEASON.length * 3} ★</span></div><div class="tally"><span class="tally-n">${totalRibbons(p)}</span><span class="tally-of">/ ${SEASON.length} ribbons</span></div>`;
    const firstOpen = SEASON.findIndex((e, i) => unlocked(p, i) && !(p.evenings[e.id]?.stars));
    const focusId = p.last ?? SEASON[Math.max(0, firstOpen)].id;
    $('.season-grid', this.root).innerHTML = SEASON.map((e, i) => {
      const open = unlocked(p, i);
      const rec = p.evenings[e.id];
      const cls = ['ev', open ? '' : 'locked', rec?.stars ? 'won' : '', i === firstOpen ? 'next' : '', `season-${e.rules.season}`, e.id === focusId && open ? 'focus-me' : ''].join(' ');
      return `<button class="${cls}" data-act="evening" data-arg="${e.id}"${open ? '' : ' tabindex="-1"'}>
        <span class="ev-num">${e.num}</span>
        <span class="ev-when">${e.when}</span>
        <b class="ev-title">${e.title}</b>
        <span class="ev-place">${e.place}</span>
        <span class="ev-foot">${open ? `<span class="ev-stars">${stars(rec?.stars ?? 0)}</span>${RIBBON(!!rec?.ribbon)}` : `${LOCK}<span class="ev-lock">Win evening ${e.num - 1} to open</span>`}</span>
      </button>`;
    }).join('');
    $('.charm-shelf', this.root).innerHTML = `<div class="charm-title">Pip's charms <small>earned with stars · wear ${s >= SECOND_CHARM_STARS ? 'two' : 'one'} on any evening</small></div><div class="charm-row">${CHARMS.map((c) => `<span class="charm ${s >= c.stars ? 'got' : ''}"><b>${c.title}</b><small>${s >= c.stars ? c.text : `${c.stars} ★ to earn`}</small></span>`).join('')}</div>`;
    const done = SEASON.filter((e) => (p.evenings[e.id]?.stars ?? 0) > 0).length;
    const complete = done === SEASON.length;
    $('.season-card .kicker', this.root).textContent = complete ? 'The season is complete' : 'A year on the hill farm';
    $('.season-line', this.root).textContent = complete ? `Season complete · ${s} of ${SEASON.length * 3} ★ · ${totalRibbons(p)} ribbons` : done ? `${done} of ${SEASON.length} evenings won · ${s} ★` : `${['Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve'][SEASON.length - 6] ?? SEASON.length} evenings from midsummer to the first snow`;
  }

  /** One evening's card: its story, the new thing, the goals, the ribbon and the charms. */
  renderIntro(e: Evening, p: Progress) {
    const r = e.rules;
    const total = r.flock.reduce((a, g) => a + g.ewes + (g.lambs ?? 0) + (g.ram ? 1 : 0) + (g.black ?? 0), 0) + (r.lostLamb ? 1 : 0);
    $('.intro-kicker', this.root).textContent = `Evening ${e.num} · ${e.when} · ${e.place}`;
    $('.intro-title', this.root).textContent = e.title;
    $('.intro-story', this.root).textContent = e.story;
    $('.intro-new', this.root).innerHTML = e.newThing ? `<div class="new-label">New tonight: ${escapeHtml(e.newThing.title)}</div><p>${keycaps(e.newThing.text)}</p>` : '';
    const rec = p.evenings[e.id];
    const two = Math.ceil((r.target + total) / 2);
    const goals =
      r.objective === 'trial'
        ? '<span>★ 50 points</span><span>★★ 70</span><span>★★★ 85</span>'
        : r.objective === 'watch'
        ? `<span>★ lose no more than ${total - r.target}</span><span>★★ lose ${Math.floor((total - r.target) / 2)} or fewer</span><span>★★★ lose none</span>`
        : `<span>★ ${r.target} of ${total} home</span><span>★★ ${two}</span><span>★★★ all ${total}</span>`;
    $('.intro-goals', this.root).innerHTML = `<div class="goal-row">${goals}</div><div class="ribbon-row">${RIBBON(!!rec?.ribbon)}<span>${escapeHtml(e.ribbon.title)}</span></div>${rec?.stars ? `<div class="best">Your best: ${stars(rec.stars)}${rec.time ? ` · home in ${fmtTime(rec.time)}` : ''}${rec.score !== undefined ? ` · ${rec.score} points` : ''}</div>` : ''}`;
    const s = totalStars(p);
    const slots = s >= SECOND_CHARM_STARS ? 2 : 1;
    const got = CHARMS.filter((c) => s >= c.stars);
    $('.intro-charms', this.root).innerHTML = got.length
      ? `<div class="charm-title">Wear ${slots === 2 ? 'two charms' : 'a charm'}</div><div class="charm-row">${got.map((c) => `<button class="charm pick ${p.charms.includes(c.id) ? 'on' : ''}" data-act="charm" data-arg="${c.id}"><b>${c.title}</b><small>${c.text}</small></button>`).join('')}</div>`
      : '';
  }

  showHud(on: boolean) {
    $('.hud', this.root).hidden = !on;
  }

  // ---------------------------------------------------------------- messages

  toast(text: string, kind = 'info') {
    const pri = (k: string) => (k === 'danger' ? 3 : k === 'info' ? 1 : 2);
    if (this.toastT <= 0 || pri(kind) >= pri(this.toastKind)) {
      this.toastText = text;
      this.toastT = Math.max(3.2, Math.min(6, text.length / 16));
      this.toastKind = kind;
    } else {
      this.toastQueue.length = 0;
      this.toastQueue.push({ text, kind });
    }
    this.renderToast();
  }
  private toastKind = 'info';
  private frameNo = 0;
  private toastDrop = 0;
  private toastText = '';
  private alertText: string | null = null;
  private alertSub = '';
  private alertCalm = false;

  alert(text: string | null, sub = '', calm = false) {
    if (text === this.alertText && sub === this.alertSub && calm === this.alertCalm) return;
    this.alertSub = sub;
    this.alertCalm = calm;
    if (text && !this.alertText) {
      this.toastT = 0;
      this.toastQueue.length = 0;
    }
    this.alertText = text;
    this.renderToast();
  }

  private rects = new Map<HTMLElement, { r: DOMRect; t: number; drop: number }>();
  private rectOf(el: HTMLElement) {
    const now = performance.now();
    const c = this.rects.get(el);
    if (c && now - c.t < 200) return c;
    const n = { r: el.getBoundingClientRect(), t: now, drop: this.toastDrop };
    this.rects.set(el, n);
    return n;
  }

  countsRect() {
    if ($('.hud', this.root).hidden) return null;
    return this.rectOf($('.hud-counts', this.root)).r;
  }

  bottomRects() {
    if ($('.hud', this.root).hidden) return [];
    const out = [this.rectOf($('.hud-dog', this.root)).r];
    const hint = $('.hud-hint', this.root);
    if (hint.textContent) out.push(this.rectOf(hint).r);
    return out;
  }

  mapRect() {
    if ($('.hud', this.root).hidden) return null;
    return this.rectOf($('.hud-map', this.root)).r;
  }

  fadeMap(on: boolean) {
    $('.hud-map', this.root).classList.toggle('faded', on);
  }

  dropToast(text: string) {
    if (this.toastText === text) this.toastT = 0;
    this.toastQueue = this.toastQueue.filter((q) => q.text !== text);
    this.renderToast();
  }

  dropInfoToast() {
    if (this.toastKind === 'info') this.toastT = 0;
    this.toastQueue = this.toastQueue.filter((q) => q.kind !== 'info');
    this.renderToast();
  }

  private renderToast() {
    const el = $('.toast', this.root);
    const text = this.alertText ?? (this.toastT > 0 ? this.toastText : '');
    const cls = this.alertText ? `toast danger sticky${this.alertCalm ? ' calm' : ''}` : `toast ${this.toastKind}`;
    el.hidden = !text;
    const sub = this.alertText ? this.alertSub : '';
    const key = `${text}|${sub}`;
    if (el.dataset.key !== key) {
      el.dataset.key = key;
      el.innerHTML = keycaps(text) + (sub ? `<span class="toast-sub">${keycaps(sub)}</span>` : '');
    }
    if (el.className !== cls) el.className = cls;
    const alerting = !!text && (!!this.alertText || this.toastKind === 'warn' || this.toastKind === 'danger');
    $('.hud', this.root).classList.toggle('alerting', alerting);
  }

  hint(text: string) {
    const el = $('.hud-hint', this.root);
    if (el.dataset.text === text) return;
    el.dataset.text = text;
    el.innerHTML = keycaps(text);
  }

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
  get bannerUp() {
    return !$('.toast', this.root).hidden || (!$('.hud-prompt', this.root).hidden && !this.promptIsChip);
  }

  setPaused(on: boolean) {
    $('.hud', this.root).classList.toggle('paused', on);
  }

  get promptIsChip() {
    return $('.hud-prompt', this.root).classList.contains('chip');
  }

  clearOf(points: { x: number; y: number }[], dt: number) {
    const el = $('.toast', this.root);
    let want = 0;
    if (!el.hidden) {
      const c = this.rectOf(el);
      const r = c.r;
      const top = r.top - c.drop;
      const bottom = r.bottom - c.drop;
      for (const p of points) {
        if (p.x > r.left - 60 && p.x < r.right + 60 && p.y > top - 70 && p.y < bottom + 60) want = Math.max(want, p.y + 70 - top);
      }
    }
    want = Math.min(want, 64);
    this.toastDrop += (want - this.toastDrop) * (1 - Math.exp(-(want > this.toastDrop ? 14 : 4) * dt));
    if (this.toastDrop < 0.5) this.toastDrop = 0;
    el.style.setProperty('--toast-drop', `${Math.round(this.toastDrop)}px`);
  }

  fadePanels(points: { x: number; y: number }[]) {
    for (const sel of ['.hud-counts', '.hud-time', '.toast', '.hud-prompt']) {
      const el = $(sel, this.root);
      if (el.hidden) continue;
      if (el.classList.contains('sticky')) {
        el.classList.remove('see-through');
        continue;
      }
      const r = this.rectOf(el).r;
      const under = points.some((p) => p.x > r.left - 14 && p.x < r.right + 14 && p.y > r.top - 14 && p.y < r.bottom + 14);
      el.classList.toggle('see-through', under);
    }
  }

  update(sim: Sim, dt: number, time: number) {
    if (sim.trial) this.updateTrial(sim);
    const watch = sim.watch;
    if (!sim.trial) {
      $('.n-home', this.root).textContent = String(watch ? sim.total - sim.lost : sim.folded);
      $('.n-need', this.root).textContent = watch ? `${sim.target} to dawn` : String(sim.target);
    }
    $('.count-home .of', this.root).classList.toggle('met', sim.targetMet);
    const pips = $('.pips', this.root);
    const pipKey = `${sim.folded}|${sim.lost}|${sim.total}|${sim.target}|${watch}`;
    if (!sim.trial && pips.dataset.key !== pipKey) {
      pips.dataset.key = pipKey;
      const two = sim.twoStar;
      let html = '';
      if (watch) {
        // One dot per sheep: still safe, or lost; the tick marks how many may be lost.
        for (let i = 1; i <= sim.total; i++) html += `<i class="pip ${i > sim.total - sim.lost ? 'lost' : 'home'}"></i>`;
        pips.innerHTML = html;
        const spareAll = sim.total - sim.target;
        $('.goals', this.root).innerHTML = `<span class="${sim.lost <= spareAll ? '' : 'gone'}">★ lose ${spareAll}</span><span class="${sim.lost <= Math.floor(spareAll / 2) ? '' : 'gone'}">★★ ${Math.floor(spareAll / 2)}</span><span class="${sim.lost === 0 ? '' : 'gone'}">★★★ none</span>`;
      } else {
        for (let i = 1; i <= sim.total; i++) {
          html += `<i class="pip ${i <= sim.folded ? 'home' : i > sim.total - sim.lost ? 'lost' : ''}"></i>`;
          if (i === sim.target && i < sim.total) html += '<i class="tick"></i>';
        }
        pips.innerHTML = html;
        const goal = (n: number, st: string) => `<span class="${sim.folded >= n ? 'got' : sim.total - sim.lost < n ? 'gone' : ''}">${st} ${n}</span>`;
        $('.goals', this.root).innerHTML = `${goal(sim.target, '★')}${goal(two, '★★')}${goal(sim.total, '★★★')}`;
      }
    }
    const spare = sim.spare;
    const need = Math.max(0, sim.target - sim.folded);
    const spareEl = $('.count-spare', this.root);
    if (sim.trial) {
      spareEl.textContent = '';
    } else {
    const hurry = !watch && !sim.targetMet && sim.timeLeft < 90;
    const spareTxt = spare > 0 ? `can lose ${spare} more` : "can't lose any more!";
    spareEl.textContent = sim.targetMet ? 'target met' : hurry ? `hurry: ${need} more to go before dark` : spareTxt;
    spareEl.classList.toggle('danger', (!sim.targetMet && spare <= 0) || hurry);
    spareEl.classList.toggle('met', sim.targetMet);
    }
    const r = sim.rules;
    const ws = r.wolfStart ?? 2;
    const wolvesOut = sim.t >= ws;
    const mark = $('.sunbar-mark', this.root);
    mark.style.left = `${(1 - Math.min(1, ws)) * 100}%`;
    mark.hidden = wolvesOut || r.wolfStart === null || watch;
    const fill = $('.sunbar-fill', this.root);
    fill.classList.toggle('dusk', wolvesOut && !watch);
    fill.classList.toggle('dawn', watch);
    const wl = $('.wolf-label', this.root);
    wl.textContent = watch ? (sim.t > 0.9 ? 'the wolves are leaving' : 'the wolves are out') : r.wolfStart === null ? '' : wolvesOut ? 'the wolves are out' : `wolves come out in ${fmtTime((ws - sim.t) * r.dayLength)}`;
    wl.classList.toggle('out', wolvesOut);
    $('.t-left', this.root).textContent = fmtTime(sim.timeLeft);
    const timeEl = $('.hud-time', this.root);
    timeEl.classList.toggle('late', !watch && sim.timeLeft < 60);
    timeEl.classList.toggle('critical', !watch && sim.timeLeft < 20);
    // Dusk: the bar empties as the light goes. Dawn: it fills as the sun comes up.
    fill.style.width = `${(watch ? sim.t : 1 - sim.t) * 100}%`;
    const sun = $('.sunbar-sun', this.root);
    sun.style.left = `${(watch ? sim.t : 1 - sim.t) * 100}%`;
    const mt = watch ? dawnTime(sim.t) : moodTime(sim.t, ws, r.dayLength);
    sun.classList.toggle('moon', mt >= SUN_MOON_SWAP);
    const d = sim.dog;
    const st = $('.stamina-fill', this.root);
    st.style.width = `${(d.stamina / DOG.staminaMax) * 100}%`;
    st.classList.toggle('tired', d.sprintLock);
    $('.creep-pip', this.root).classList.toggle('on', d.creeping);
    $('.lie-pip', this.root).classList.toggle('on', d.lying);
    const bark = $('.bark-pip', this.root);
    bark.classList.toggle('ready', d.barkCd <= 0);
    const reach = sim.barkRadius + 4;
    bark.classList.toggle('urgent', sim.wolves.some((w) => w.state !== 'gone' && w.state !== 'flee' && (w.x - d.x) ** 2 + (w.z - d.z) ** 2 < reach * reach));
    $('.bark-fill', this.root).style.width = `${(1 - d.barkCd / (DOG.barkCooldown * sim.perks.barkCooldown)) * 100}%`;
    if ((this.frameNo++ & 1) === 0) this.minimap.draw(sim, time);

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

  /** Trial HUD: the judges' points and the course (each gate taken or missed, then the pen). */
  private updateTrial(sim: Sim) {
    $('.n-home', this.root).textContent = String(sim.trialScore());
    $('.of-word', this.root).textContent = 'points';
    const key = `${sim.gateIdx}|${sim.gateResults.join(',')}|${sim.folded}`;
    const pips = $('.pips', this.root);
    if (pips.dataset.key === key) return;
    pips.dataset.key = key;
    const gates = this.level.gates;
    pips.innerHTML = gates
      .map((g, i) => {
        const r = sim.gateResults[i];
        const cls = r === 'passed' ? 'got' : r === 'missed' ? 'gone' : i === sim.gateIdx ? 'now' : '';
        return `<span class="course ${cls}">${r === 'passed' ? '✓ ' : r === 'missed' ? '✗ ' : ''}${escapeHtml(g.name.replace(' gates', ''))}</span>`;
      })
      .concat(`<span class="course ${sim.gateIdx >= gates.length ? 'now' : ''}">Pen ${sim.folded}/${sim.total}</span>`)
      .join('');
    $('.goals', this.root).innerHTML = '<span>★ 50</span><span>★★ 70</span><span>★★★ 85 points</span>';
  }

  /** The whole season in a row: each evening's stars, this one marked, locked ones dim. */
  private seasonStrip(p: Progress, current: Evening) {
    return `<div class="season-strip">${SEASON.map((e, i) => {
      const st = p.evenings[e.id]?.stars ?? 0;
      const open = unlocked(p, i);
      return `<span class="ss ${e.id === current.id ? 'cur' : ''} ${open ? '' : 'locked'} ${st ? 'won' : ''}" title="${escapeHtml(e.title)}"><b>${e.num}</b><i>${'★'.repeat(st)}${'☆'.repeat(3 - st)}</i></span>`;
    }).join('')}</div>`;
  }

  clearToasts() {
    this.toastQueue.length = 0;
    this.toastT = 0;
    this.alertText = null;
    this.renderToast();
  }

  showEnd(o: Outcome, sim: Sim, ctx: EndContext) {
    const title = $('.end-title', this.root);
    const sub = $('.end-sub', this.root);
    const statsEl = $('.end-stats', this.root);
    const win = o.kind === 'win';
    const screen = this.root.querySelector('.end-screen')!;
    screen.classList.toggle('win', win);
    screen.classList.toggle('lose', !win);
    const ev = ctx.evening;
    const kicker = sim.trial ? 'The judges' : win ? (sim.watch ? 'Dawn' : "Day's end") : o.reason === 'wolves' ? 'Too many lost' : 'Nightfall';
    $('.end-kicker', this.root).textContent = ev ? `${kicker} · Evening ${ev.num}: ${ev.title}` : `${kicker} · ${DIFFICULTIES[this.difficulty].label}`;
    let tip = '';
    if (sim.trial) {
      const sc = sim.trialScore();
      const missed = sim.gateResults.filter((g) => g !== 'passed').length;
      title.textContent = sc >= 90 ? 'A clean round!' : win ? `${sc} points` : 'The judges were not impressed';
      sub.textContent = `${sc} points out of 100: ${missed === 0 ? 'every gate taken' : `${missed} gate${missed > 1 ? 's' : ''} missed`}, ${sim.folded} of ${sim.total} penned.`;
      if (!win) tip = 'Take each gate in order: get the ewes lined up well before it, then walk them through.';
    } else if (o.kind === 'win') {
      if (ctx.seasonDone) title.textContent = 'The season is done!';
      else if (sim.watch) title.textContent = sim.lost === 0 ? 'Not one lost!' : 'The flock made it to dawn';
      else title.textContent = o.stars === 3 ? 'Every sheep is home!' : sim.free > 0 ? 'Home before dark' : 'The flock is home';
      const took = sim.lost === 1 ? 'one' : String(sim.lost);
      sub.textContent = sim.watch
        ? sim.lost === 0
          ? 'The sun is up and every sheep is still with you.'
          : `The sun is up. The wolves took ${took}, but the flock held together.`
        : o.reason === 'nightfall'
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
        sub.textContent = sim.watch ? `The wolves took ${sim.lost}; you could only spare ${sim.total - sim.target}.` : `Only ${left} sheep are left and you needed ${sim.target} home.`;
        tip = 'Run at a wolf or bark (Space) near it: it drops the sheep and runs.';
      } else if (sim.folded === 0) {
        sub.textContent = `None of the ${sim.target} sheep you needed made it home.`;
        tip = 'Get behind a flock and let it trot on ahead of you towards the gate.';
      } else {
        sub.textContent = `Only ${sim.folded} of the ${sim.target} sheep you needed made it home.`;
        tip = sim.butts > 2 ? 'Angus will not be rushed: stand still near him, or bark, and he gives way.' : 'Sprint (Shift) between flocks to save daylight.';
      }
    }
    const place = (x: number, z: number) => {
      const p = this.level.placeName(x, z).replace(/^(in|on|at|by|over|across) the /, '');
      return p.charAt(0).toUpperCase() + p.slice(1);
    };
    const byPlace = new Map<string, number>();
    for (const l of sim.lostLog) byPlace.set(place(l.x, l.z), (byPlace.get(place(l.x, l.z)) ?? 0) + 1);
    const losses = [...byPlace].map(([p, n]) => (n > 1 ? `${p} ×${n}` : p)).join(', ');
    const two = sim.twoStar;
    const starHtml = win ? stars(o.stars) : '';
    const legend = sim.trial ? '★ 50+ points · ★★ 70+ · ★★★ 85+' : sim.watch ? `★ ${sim.total - sim.target} or fewer lost · ★★ ${Math.floor((sim.total - sim.target) / 2)} · ★★★ none` : `★ ${sim.target}+ home · ★★ ${two}+ · ★★★ all ${sim.total}`;
    const row = (label: string, value: string) => `<div class="row"><span>${label}</span><b>${value}</b></div>`;
    const ribbon = ev ? `<div class="end-ribbon ${ctx.ribbon ? 'on' : ''}">${RIBBON(ctx.ribbon)}<span>${ctx.ribbon ? 'Ribbon won: ' : 'Ribbon: '}${escapeHtml(ev.ribbon.title)}</span></div>` : '';
    const unlock = ctx.unlocked.length ? `<div class="end-unlock">New charm${ctx.unlocked.length > 1 ? 's' : ''}: <b>${ctx.unlocked.map(escapeHtml).join(', ')}</b></div>` : '';
    const bestLine = ctx.newBest ? '<div class="end-unlock">A new best for this evening!</div>' : '';
    const nextLine = ctx.next && ctx.firstWin ? `<div class="end-unlock">Evening ${ctx.next.num} is open: <b>${escapeHtml(ctx.next.title)}</b></div>` : '';
    statsEl.innerHTML = `
      ${starHtml ? `<div class="stars">${starHtml}</div><div class="star-legend">${legend}</div>` : ''}
      ${ribbon}
      <div class="ledger">
        ${sim.watch ? row('Sheep still with you', `${sim.total - sim.lost} / ${sim.total}`) : row('Home in the fold', `${sim.folded} / ${sim.total}`)}
        ${row('Lost to wolves', String(sim.lost))}
        ${row('Rescued from jaws', String(sim.rescues))}
        ${sim.watch ? '' : row('Daylight left', sim.timeLeft > 0.5 ? fmtTime(sim.timeLeft) : 'none')}
      </div>
      ${losses ? `<div class="losses"><b>Taken by wolves:</b> ${sim.lost} (${escapeHtml(losses)})</div>` : ''}
      ${ev ? this.seasonStrip(ctx.progress, ev) : ''}
      ${bestLine}${nextLine}${unlock}
      ${tip ? `<div class="tip"><b>Tip</b> ${keycaps(tip)}</div>` : ''}`;
    const btns: string[] = [];
    if (ev && win && ctx.next) btns.push(`<button class="btn primary" data-act="next">Next: ${escapeHtml(ctx.next.title)} <kbd>Enter</kbd></button>`);
    btns.push(`<button class="btn ${btns.length ? '' : 'primary'}" data-act="restart">${win ? 'Play again' : 'Try again'}${btns.length ? '' : ' <kbd>Enter</kbd>'}</button>`);
    btns.push(ev ? '<button class="btn" data-act="season">The season</button>' : '<button class="btn" data-act="title">Title screen</button>');
    $('.end-buttons', this.root).innerHTML = btns.join('');
    this.show('end');
  }
}
