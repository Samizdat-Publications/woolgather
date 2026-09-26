// Woolgather landing page: the scroll-scrubbed evening with the game's sun bar, a small herding toy,
// the evening's stage of clips, the whole-evening recorder and the greybox-to-finished slider.
// The page reads fine without this script; it only adds the motion.
(function () {
  'use strict';
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const conn = navigator.connection;
  const saveData = !!(conn && (conn.saveData || /(^|-)2g|3g/.test(conn.effectiveType || '')));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  const root = document.documentElement;
  const chapters = fetch('media/chapters.json').then((r) => r.json()).catch(() => null);

  // Enter plays, as on the game's own title screen (only when nothing else has the focus).
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.repeat && (e.target === document.body || e.target === root)) location.href = 'play/';
  });

  // ---------------------------------------------------------------- top bar turns solid past the opening
  const bar = document.querySelector('.bar');
  const dusk = document.querySelector('.dusk');
  const onBar = () => bar.classList.toggle('solid', window.scrollY > dusk.offsetHeight - window.innerHeight - 40);
  window.addEventListener('scroll', onBar, { passive: true });
  onBar();

  // ---------------------------------------------------------------- the sun goes down
  // Standard's evening: six minutes, the wolves at a third of it. The frames turn from gold to rose at
  // about 36% of the way through, so the clock runs two minutes up to there and four after.
  const DAY = 360;
  const WOLVES = 0.33 * DAY;
  const NOTCH = 0.36;
  const canvas = document.getElementById('dusk-canvas');
  const still = document.getElementById('dusk-still');
  const ctx = canvas.getContext('2d');
  const ledes = [...document.querySelectorAll('.lede')];
  const cta = document.getElementById('dusk-cta');
  const fine = document.getElementById('dusk-fine');
  const cue = document.getElementById('scroll-cue');
  const clockMain = document.getElementById('clock-main');
  const clockSub = document.getElementById('clock-sub');
  const sunDay = document.getElementById('sunbar-day');
  const sunDusk = document.getElementById('sunbar-dusk');
  const sun = document.getElementById('sunbar-sun');
  let frames = [];
  let shown = -1;
  let want = 0;
  let ticking = false;
  let lastClock = '';

  function progress() {
    const r = dusk.getBoundingClientRect();
    return clamp(-r.top / Math.max(1, r.height - window.innerHeight), 0, 1);
  }
  function sizeCanvas() {
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);
    shown = -1;
  }
  /** the nearest frame that has loaded (frames stream in coarse to fine) */
  function nearest(i) {
    for (let d = 0; d < frames.length; d++) {
      if (frames[i - d]?.ok) return i - d;
      if (frames[i + d]?.ok) return i + d;
    }
    return -1;
  }
  function draw() {
    const i = nearest(want);
    if (i < 0 || i === shown) return;
    shown = i;
    const img = frames[i].img;
    const cw = canvas.width;
    const ch = canvas.height;
    const s = Math.max(cw / img.naturalWidth, ch / img.naturalHeight);
    const w = img.naturalWidth * s;
    const h = img.naturalHeight * s;
    // cover, anchored a little above centre so the sky keeps room for the name
    ctx.drawImage(img, (cw - w) * 0.5, (ch - h) * 0.4, w, h);
  }
  function setClock(fp) {
    const t = fp < NOTCH ? (fp / NOTCH) * WOLVES : WOLVES + ((fp - NOTCH) / (1 - NOTCH)) * (DAY - WOLVES);
    const key = fp >= 0.999 ? 'night' : String(Math.ceil(DAY - t));
    if (key !== lastClock) {
      lastClock = key;
      if (key === 'night') clockMain.textContent = 'Night has fallen';
      else {
        const b = document.createElement('b');
        b.textContent = mmss(Math.ceil(DAY - t));
        clockMain.replaceChildren('Nightfall in ', b);
      }
      const out = t >= WOLVES;
      clockSub.textContent = key === 'night' ? 'the wolves have the valley' : out ? 'the wolves are out' : `wolves come out in ${mmss(Math.ceil(WOLVES - t))}`;
      clockSub.classList.toggle('out', out);
    }
    sunDay.style.width = `${Math.min(fp, NOTCH) * 100}%`;
    sunDusk.style.width = `${Math.max(0, fp - NOTCH) * 100}%`;
    sun.style.left = `${fp * 100}%`;
    sun.classList.toggle('moon', fp > 0.74);
  }
  function scrub() {
    ticking = false;
    const p = progress();
    // hold the golden hour for a moment, let the sun go down over most of the scroll, hold the night
    const fp = clamp((p - 0.03) / 0.8, 0, 1);
    want = Math.round(fp * (frames.length - 1));
    draw();
    // the words turn from ink on the golden sky to wool on the night sky as the light goes
    root.style.setProperty('--n', clamp((fp - 0.76) / 0.1, 0, 1).toFixed(3));
    setClock(fp);
    for (const l of ledes) l.classList.toggle('on', p >= Number(l.dataset.from) && p < Number(l.dataset.to));
    const end = p > 0.8;
    cta.classList.toggle('on', end);
    fine.classList.toggle('on', end);
    cue.classList.toggle('gone', p > 0.02);
  }
  const requestScrub = () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(scrub);
    }
  };

  function startDusk(n) {
    const src = (i) => `media/evening/e${String(i).padStart(2, '0')}.jpg`;
    if (reduced) {
      // no scrub: one golden-hour frame, the words in ink, everything in place
      still.src = src(Math.round(n * 0.12));
      root.style.setProperty('--n', '0');
      return;
    }
    frames = Array.from({ length: n }, () => ({ img: null, ok: false }));
    // coarse to fine, so scrolling early still shows the right light
    const order = [];
    for (const stride of [16, 8, 4, 2, 1]) for (let i = 0; i < n; i += stride) if (!order.includes(i)) order.push(i);
    if (!order.includes(n - 1)) order.splice(1, 0, n - 1);
    let next = 0;
    const load = () => {
      if (next >= order.length) return;
      const i = order[next++];
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        frames[i] = { img, ok: true };
        if (i === 0) {
          sizeCanvas();
          dusk.classList.add('live');
        }
        draw();
        load();
      };
      img.onerror = load;
      img.src = src(i);
    };
    for (let k = 0; k < 4; k++) load();
    window.addEventListener('scroll', requestScrub, { passive: true });
    window.addEventListener('resize', () => {
      sizeCanvas();
      requestScrub();
    });
    scrub();
  }
  fetch('media/evening.json')
    .then((r) => r.json())
    .then((d) => startDusk(d.frames))
    .catch(() => startDusk(96));

  // ---------------------------------------------------------------- a small herding toy
  // Ten sheep in a meadow, a stone fold with a gate on the right, and a dog that follows the pointer.
  // The sheep run the game's rule in miniature: they flee the dog as a flock (bunching when nervous,
  // trotting on for a moment after a scare) and graze when left alone.
  (function toy() {
    const cv = document.getElementById('toy-canvas');
    if (!cv) return;
    const g = cv.getContext('2d');
    const countEl = document.getElementById('toy-count');
    const doneEl = document.getElementById('toy-done');
    const resetEl = document.getElementById('toy-reset');
    const W = 800;
    const H = 480;
    const N = 10;
    const R = 112; // the dog's reach: sheep inside it move away
    const SR = 9; // sheep radius
    const fold = { x0: 612, x1: 772, y0: 140, y1: 340, gy0: 206, gy1: 274 };
    const walls = [
      [fold.x0, fold.y0, fold.x1, fold.y0],
      [fold.x0, fold.y1, fold.x1, fold.y1],
      [fold.x1, fold.y0, fold.x1, fold.y1],
      [fold.x0, fold.y0, fold.x0, fold.gy0],
      [fold.x0, fold.gy1, fold.x0, fold.y1],
    ];
    const fences = [
      [fold.x0, fold.gy0, fold.x0 - 84, fold.gy0 - 66],
      [fold.x0, fold.gy1, fold.x0 - 84, fold.gy1 + 66],
    ];
    const gate = [fold.x0, fold.gy0, fold.x0, fold.gy1];
    const dog = { x: 70, y: 420, tx: 70, ty: 420, vx: 0, vy: 0, face: -0.6 };
    const keys = new Set();
    let sheep = [];
    let hearts = [];
    let home = 0;
    let done = false;
    let running = false;
    let last = 0;
    let bg = null;
    let scale = 1;
    let dpr = 1;
    let pointerIn = false;

    function scatter() {
      const groups = [
        [175, 130],
        [235, 350],
        [330, 225],
      ];
      sheep = Array.from({ length: N }, (_, i) => {
        const c = groups[i % groups.length];
        return {
          x: c[0] + (Math.random() - 0.5) * 80,
          y: c[1] + (Math.random() - 0.5) * 70,
          vx: 0,
          vy: 0,
          face: Math.random() * Math.PI * 2,
          scared: 0,
          graze: Math.random() * 2,
          wa: Math.random() * Math.PI * 2,
          ws: 0,
          home: false,
          bob: Math.random() * 10,
          size: 0.92 + Math.random() * 0.16,
        };
      });
      hearts = [];
      home = 0;
      done = false;
      doneEl.hidden = true;
      resetEl.classList.remove('glow');
      resetEl.textContent = 'Scatter them';
      setCount();
    }
    function setCount() {
      const b = document.createElement('b');
      b.textContent = String(home);
      countEl.replaceChildren(b, ` home of ${N}`);
    }

    /** push a circle out of a wall segment */
    function collide(o, r, seg) {
      const [ax, ay, bx, by] = seg;
      const dx = bx - ax;
      const dy = by - ay;
      const t = clamp(((o.x - ax) * dx + (o.y - ay) * dy) / (dx * dx + dy * dy), 0, 1);
      const px = ax + dx * t;
      const py = ay + dy * t;
      const ex = o.x - px;
      const ey = o.y - py;
      const d = Math.hypot(ex, ey);
      const min = r + 6;
      if (d < min && d > 0.001) {
        o.x = px + (ex / d) * min;
        o.y = py + (ey / d) * min;
      }
    }
    const turn = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;

    function step(dt) {
      // the dog: runs to the pointer (or the arrow keys move its target)
      let kx = 0;
      let ky = 0;
      if (keys.has('ArrowLeft') || keys.has('a')) kx -= 1;
      if (keys.has('ArrowRight') || keys.has('d')) kx += 1;
      if (keys.has('ArrowUp') || keys.has('w')) ky -= 1;
      if (keys.has('ArrowDown') || keys.has('s')) ky += 1;
      if (kx || ky) {
        const k = 250 / Math.hypot(kx, ky);
        dog.tx = clamp(dog.x + kx * k * 0.25, 12, W - 12);
        dog.ty = clamp(dog.y + ky * k * 0.25, 12, H - 12);
      }
      const dx = dog.tx - dog.x;
      const dy = dog.ty - dog.y;
      const dd = Math.hypot(dx, dy);
      const sp = Math.min(dd * 7, 300);
      const wx = dd > 0.5 ? (dx / dd) * sp : 0;
      const wy = dd > 0.5 ? (dy / dd) * sp : 0;
      const kd = Math.min(1, dt * 10);
      dog.vx += (wx - dog.vx) * kd;
      dog.vy += (wy - dog.vy) * kd;
      dog.x = clamp(dog.x + dog.vx * dt, 12, W - 12);
      dog.y = clamp(dog.y + dog.vy * dt, 12, H - 12);
      for (const w of walls) collide(dog, 10, w);
      for (const f of fences) collide(dog, 10, f);
      if (Math.hypot(dog.vx, dog.vy) > 12) dog.face = turn(dog.face, Math.atan2(dog.vy, dog.vx), Math.min(1, dt * 12));

      // the flock
      for (const s of sheep) {
        const ex = s.x - dog.x;
        const ey = s.y - dog.y;
        const d = Math.hypot(ex, ey) || 1;
        const fear = d < R ? (1 - d / R) * (s.home ? 0.35 : 1) : 0;
        if (fear > 0.05) s.scared = 1.5;
        s.scared = Math.max(0, s.scared - dt);
        const alert = Math.max(fear, (s.scared / 1.5) * 0.6);
        let vx = 0;
        let vy = 0;
        if (fear > 0) {
          vx += (ex / d) * (40 + 150 * fear);
          vy += (ey / d) * (40 + 150 * fear);
        }
        let cx = 0;
        let cy = 0;
        let ax = 0;
        let ay = 0;
        let n = 0;
        let px = 0;
        let py = 0;
        for (const o of sheep) {
          if (o === s || o.home !== s.home) continue;
          const ox = o.x - s.x;
          const oy = o.y - s.y;
          const od = Math.hypot(ox, oy);
          if (od < 130) {
            cx += ox;
            cy += oy;
            ax += o.vx;
            ay += o.vy;
            n++;
          }
          if (od < 25 && od > 0.01) {
            px -= (ox / od) * (25 - od);
            py -= (oy / od) * (25 - od);
          }
        }
        if (n) {
          // bunch up and move together when nervous
          vx += (cx / n) * 0.9 * alert + (ax / n) * 0.3 * alert;
          vy += (cy / n) * 0.9 * alert + (ay / n) * 0.3 * alert;
        }
        vx += px * 4;
        vy += py * 4;
        if (alert < 0.05) {
          // graze: a few slow steps, then a pause
          s.graze -= dt;
          if (s.graze <= 0) {
            s.graze = 1.2 + Math.random() * 2.8;
            s.wa = Math.random() * Math.PI * 2;
            s.ws = Math.random() < 0.45 ? 0 : 5 + Math.random() * 9;
          }
          vx += Math.cos(s.wa) * s.ws;
          vy += Math.sin(s.wa) * s.ws;
        } else if (fear === 0) {
          // trot on for a moment after a scare
          vx += s.vx * 0.55;
          vy += s.vy * 0.55;
        }
        const k = Math.min(1, dt * 5);
        s.vx += (vx - s.vx) * k;
        s.vy += (vy - s.vy) * k;
        const v = Math.hypot(s.vx, s.vy);
        if (v > 175) {
          s.vx *= 175 / v;
          s.vy *= 175 / v;
        }
        s.x = clamp(s.x + s.vx * dt, SR, W - SR);
        s.y = clamp(s.y + s.vy * dt, SR, H - SR);
        for (const w of walls) collide(s, SR, w);
        for (const f of fences) collide(s, SR, f);
        if (s.home || done) collide(s, SR, gate);
        if (v > 6) s.face = turn(s.face, Math.atan2(s.vy, s.vx), Math.min(1, dt * 6));
        s.bob += dt * (v > 30 ? 16 : 0);
        if (!s.home && s.x > fold.x0 + SR && s.x < fold.x1 && s.y > fold.y0 && s.y < fold.y1) {
          s.home = true;
          home++;
          hearts.push({ x: s.x, y: s.y - 16, t: 0 });
          hearts.push({ x: s.x + 9, y: s.y - 10, t: -0.18 });
          setCount();
          if (home === N) {
            done = true;
            doneEl.hidden = false;
            resetEl.classList.add('glow');
            resetEl.textContent = 'Again';
          }
        }
      }
      for (const h of hearts) h.t += dt;
      hearts = hearts.filter((h) => h.t < 1.3);
    }

    // the meadow, the path and the fold are drawn once per size
    function paintGround() {
      bg = document.createElement('canvas');
      bg.width = cv.width;
      bg.height = cv.height;
      const b = bg.getContext('2d');
      b.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
      let rnd = 7;
      const rand = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);
      const gr = b.createLinearGradient(0, 0, W, H);
      gr.addColorStop(0, '#c2bd58');
      gr.addColorStop(1, '#9ba44a');
      b.fillStyle = gr;
      b.fillRect(0, 0, W, H);
      const sunGlow = b.createRadialGradient(40, 20, 10, 40, 20, 520);
      sunGlow.addColorStop(0, 'rgba(255, 214, 140, 0.4)');
      sunGlow.addColorStop(1, 'rgba(255, 214, 140, 0)');
      b.fillStyle = sunGlow;
      b.fillRect(0, 0, W, H);
      // the worn track to the gate
      b.lineCap = 'round';
      b.lineJoin = 'round';
      const track = () => {
        b.beginPath();
        b.moveTo(-10, 300);
        b.bezierCurveTo(160, 330, 330, 190, 460, 232);
        b.bezierCurveTo(530, 254, 570, 240, fold.x0 + 30, (fold.gy0 + fold.gy1) / 2);
      };
      track();
      b.strokeStyle = 'rgba(120, 88, 48, 0.35)';
      b.lineWidth = 30;
      b.stroke();
      track();
      b.strokeStyle = '#caa56a';
      b.lineWidth = 24;
      b.stroke();
      // grass tufts and a few flowers
      for (let i = 0; i < 420; i++) {
        const x = rand() * W;
        const y = rand() * H;
        b.strokeStyle = `rgba(92, 104, 40, ${0.35 + rand() * 0.3})`;
        b.lineWidth = 1.4;
        b.beginPath();
        for (let k = -1; k <= 1; k++) {
          b.moveTo(x + k * 2, y);
          b.lineTo(x + k * 3.5, y - 5 - rand() * 3);
        }
        b.stroke();
      }
      const petals = ['#fff7e8', '#ffe07a', '#d9c3f0'];
      for (let i = 0; i < 60; i++) {
        b.fillStyle = petals[i % 3];
        b.beginPath();
        b.arc(rand() * W, rand() * H, 1.8, 0, Math.PI * 2);
        b.fill();
      }
      // the fold: straw and mud inside, dry-stone walls, guide fences, a lantern on each gatepost
      b.fillStyle = '#a58d5a';
      b.fillRect(fold.x0, fold.y0, fold.x1 - fold.x0, fold.y1 - fold.y0);
      for (let i = 0; i < 90; i++) {
        const x = fold.x0 + 8 + rand() * (fold.x1 - fold.x0 - 16);
        const y = fold.y0 + 8 + rand() * (fold.y1 - fold.y0 - 16);
        b.strokeStyle = `rgba(236, 206, 128, ${0.35 + rand() * 0.4})`;
        b.lineWidth = 1.3;
        b.beginPath();
        b.moveTo(x, y);
        b.lineTo(x + 6 * (rand() - 0.5), y + 6 * (rand() - 0.5));
        b.stroke();
      }
      for (const f of fences) {
        b.strokeStyle = '#5e4630';
        b.lineWidth = 3;
        b.beginPath();
        b.moveTo(f[0], f[1]);
        b.lineTo(f[2], f[3]);
        b.stroke();
        for (let t = 0; t <= 1.001; t += 0.2) {
          b.fillStyle = '#4a3624';
          b.fillRect(f[0] + (f[2] - f[0]) * t - 2.5, f[1] + (f[3] - f[1]) * t - 2.5, 5, 5);
        }
      }
      // wall shadows to the east (the sun is low in the west)
      for (const w of walls) {
        b.strokeStyle = 'rgba(52, 40, 30, 0.28)';
        b.lineWidth = 15;
        b.beginPath();
        b.moveTo(w[0] + 6, w[1] + 4);
        b.lineTo(w[2] + 6, w[3] + 4);
        b.stroke();
      }
      for (const w of walls) {
        b.strokeStyle = '#4f4638';
        b.lineWidth = 14;
        b.beginPath();
        b.moveTo(w[0], w[1]);
        b.lineTo(w[2], w[3]);
        b.stroke();
        b.strokeStyle = '#b3a891';
        b.lineWidth = 10;
        b.stroke();
        const len = Math.hypot(w[2] - w[0], w[3] - w[1]);
        for (let t = 0; t < len; t += 9) {
          const x = w[0] + ((w[2] - w[0]) * t) / len;
          const y = w[1] + ((w[3] - w[1]) * t) / len;
          b.fillStyle = `rgba(${rand() < 0.5 ? '124, 114, 96' : '208, 198, 176'}, 0.7)`;
          b.fillRect(x - 2.5, y - 2.5, 5, 4);
        }
      }
      for (const y of [fold.gy0, fold.gy1]) {
        b.fillStyle = '#3d3329';
        b.fillRect(fold.x0 - 6, y - 6, 12, 12);
        b.fillStyle = '#ffcf7a';
        b.beginPath();
        b.arc(fold.x0, y, 3, 0, Math.PI * 2);
        b.fill();
      }
      // the fold's gold home badge, as on the game's edge marker
      const hx = fold.x1 - 30;
      const hy = fold.y0 + 30;
      b.fillStyle = 'rgba(20, 16, 26, 0.45)';
      b.beginPath();
      b.arc(hx, hy, 17, 0, Math.PI * 2);
      b.fill();
      b.fillStyle = '#f2b45a';
      b.beginPath();
      b.arc(hx, hy, 14, 0, Math.PI * 2);
      b.fill();
      b.strokeStyle = '#231c2b';
      b.lineWidth = 2.6;
      b.beginPath();
      b.moveTo(hx - 7, hy + 1);
      b.lineTo(hx, hy - 6);
      b.lineTo(hx + 7, hy + 1);
      b.moveTo(hx - 5, hy);
      b.lineTo(hx - 5, hy + 7);
      b.lineTo(hx + 5, hy + 7);
      b.lineTo(hx + 5, hy);
      b.stroke();
    }

    function drawSheep(s) {
      const bob = Math.sin(s.bob) * 0.06;
      g.save();
      g.translate(s.x, s.y);
      g.rotate(s.face);
      g.scale(s.size * 1.15 * (1 + bob), s.size * 1.15 * (1 - bob));
      g.fillStyle = '#f8f1e2';
      g.strokeStyle = '#231c2b';
      g.lineWidth = 1.6;
      g.beginPath();
      g.ellipse(-1, 0, 11.5, 8.5, 0, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.fillStyle = 'rgba(255, 255, 255, 0.9)';
      g.beginPath();
      g.arc(-4, -2.5, 3.2, 0, Math.PI * 2);
      g.arc(1.5, 2, 2.8, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#2a2230';
      g.beginPath();
      g.ellipse(10.5, 0, 5, 4, 0, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.ellipse(9, -4.6, 2.6, 1.3, -0.6, 0, Math.PI * 2);
      g.ellipse(9, 4.6, 2.6, 1.3, 0.6, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
    function drawDog() {
      g.save();
      g.translate(dog.x, dog.y);
      g.rotate(dog.face);
      g.scale(1.1, 1.1);
      g.strokeStyle = '#120e16';
      g.lineWidth = 1.5;
      // tail with a white tip
      g.strokeStyle = '#1f1b25';
      g.lineWidth = 4;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(-10, 0);
      g.quadraticCurveTo(-17, 2, -21, 5);
      g.stroke();
      g.strokeStyle = '#fbf3e4';
      g.beginPath();
      g.moveTo(-19.5, 4.3);
      g.lineTo(-21.5, 5.4);
      g.stroke();
      g.fillStyle = '#1f1b25';
      g.strokeStyle = '#120e16';
      g.lineWidth = 1.5;
      g.beginPath();
      g.ellipse(-1, 0, 12, 6.6, 0, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      // white ruff, then the head with a blaze and ears
      g.fillStyle = '#fbf3e4';
      g.beginPath();
      g.ellipse(7, 0, 3.8, 6.4, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#1f1b25';
      g.beginPath();
      g.arc(12, 0, 4.8, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.moveTo(10, -3.5);
      g.lineTo(8, -7.5);
      g.lineTo(12.5, -4.5);
      g.moveTo(10, 3.5);
      g.lineTo(8, 7.5);
      g.lineTo(12.5, 4.5);
      g.fill();
      g.fillStyle = '#fbf3e4';
      g.fillRect(12, -0.9, 5, 1.8);
      g.restore();
    }
    function drawHeart(h) {
      if (h.t < 0) return;
      const a = 1 - h.t / 1.3;
      const y = h.y - h.t * 26;
      const s = 0.8 + Math.min(1, h.t * 5) * 0.4;
      g.save();
      g.translate(h.x, y);
      g.scale(s, s);
      g.globalAlpha = a;
      g.fillStyle = '#f2b45a';
      g.strokeStyle = '#231c2b';
      g.lineWidth = 1.6;
      g.beginPath();
      g.moveTo(0, 5);
      g.bezierCurveTo(-8, -1, -5, -8, 0, -3.5);
      g.bezierCurveTo(5, -8, 8, -1, 0, 5);
      g.fill();
      g.stroke();
      g.restore();
    }
    function render() {
      g.setTransform(1, 0, 0, 1, 0, 0);
      if (bg) g.drawImage(bg, 0, 0);
      g.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
      if (done) {
        // the gate swings shut
        g.strokeStyle = '#6b4f33';
        g.lineWidth = 5;
        g.beginPath();
        g.moveTo(fold.x0, fold.gy0 + 5);
        g.lineTo(fold.x0, fold.gy1 - 5);
        g.stroke();
      }
      // Pip's reach, a dashed ring like the game's
      g.save();
      g.setLineDash([9, 8]);
      g.lineWidth = 2;
      g.strokeStyle = 'rgba(40, 30, 20, 0.25)';
      g.beginPath();
      g.arc(dog.x, dog.y + 1, R, 0, Math.PI * 2);
      g.stroke();
      g.strokeStyle = 'rgba(255, 250, 235, 0.62)';
      g.beginPath();
      g.arc(dog.x, dog.y, R, 0, Math.PI * 2);
      g.stroke();
      g.restore();
      // long shadows to the east
      g.fillStyle = 'rgba(58, 46, 22, 0.3)';
      for (const s of sheep) {
        g.beginPath();
        g.ellipse(s.x + 7, s.y + 3, 12, 7, 0, 0, Math.PI * 2);
        g.fill();
      }
      g.beginPath();
      g.ellipse(dog.x + 7, dog.y + 3, 13, 6, 0, 0, Math.PI * 2);
      g.fill();
      const order = sheep.slice().sort((a, b) => a.y - b.y);
      for (const s of order) drawSheep(s);
      drawDog();
      for (const h of hearts) drawHeart(h);
      // where the pointer is asking the dog to go
      if (pointerIn && Math.hypot(dog.tx - dog.x, dog.ty - dog.y) > 18) {
        g.strokeStyle = 'rgba(255, 244, 214, 0.7)';
        g.lineWidth = 1.6;
        g.beginPath();
        g.arc(dog.tx, dog.ty, 5, 0, Math.PI * 2);
        g.stroke();
      }
    }
    function resize() {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = cv.clientWidth || 600;
      scale = w / W;
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(H * scale * dpr);
      paintGround();
      render();
    }
    function frame(t) {
      if (!running) return;
      const dt = Math.min(0.05, (t - last) / 1000 || 0.016);
      last = t;
      step(dt);
      render();
      requestAnimationFrame(frame);
    }
    function toWorld(e) {
      const r = cv.getBoundingClientRect();
      return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H];
    }
    cv.addEventListener('pointermove', (e) => {
      [dog.tx, dog.ty] = toWorld(e);
      pointerIn = true;
    });
    cv.addEventListener('pointerdown', (e) => {
      [dog.tx, dog.ty] = toWorld(e);
      pointerIn = true;
      if (e.pointerType !== 'mouse') cv.setPointerCapture(e.pointerId);
    });
    cv.addEventListener('pointerleave', () => (pointerIn = false));
    cv.addEventListener('keydown', (e) => {
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'w', 'a', 's', 'd'].includes(k)) {
        keys.add(k);
        e.preventDefault();
      }
    });
    cv.addEventListener('keyup', (e) => {
      keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key);
      if (!keys.size) {
        dog.tx = dog.x;
        dog.ty = dog.y;
      }
    });
    cv.addEventListener('blur', () => keys.clear());
    resetEl.addEventListener('click', scatter);
    // read-only state for the site check's herding test
    cv.herdState = () => ({ dog: { x: dog.x, y: dog.y }, sheep: sheep.map((s) => ({ x: s.x, y: s.y, home: s.home })) });
    window.addEventListener('resize', resize);
    scatter();
    resize();
    if ('IntersectionObserver' in window) {
      new IntersectionObserver((es) => {
        const vis = es[0].isIntersecting;
        if (vis && !running) {
          running = true;
          last = performance.now();
          requestAnimationFrame(frame);
        } else if (!vis) running = false;
      }).observe(cv);
    } else {
      running = true;
      requestAnimationFrame(frame);
    }
  })();

  // ---------------------------------------------------------------- clips
  function makeVideo(name, label) {
    const v = document.createElement('video');
    v.muted = true;
    v.loop = true;
    v.playsInline = true;
    v.preload = 'none';
    v.poster = `media/${name}.jpg`;
    v.setAttribute('aria-label', label);
    const s = document.createElement('source');
    s.src = `media/${name}.mp4`;
    s.type = 'video/mp4';
    v.appendChild(s);
    return v;
  }
  const play = (v) => {
    if (saveData || reduced) {
      v.controls = true;
      return;
    }
    if (v.preload === 'none') v.preload = 'auto';
    // controls only when the browser refuses to autoplay (a pause() from scrolling past also rejects)
    v.play().catch((e) => {
      if (e?.name === 'NotAllowedError') v.controls = true;
    });
  };

  // How an evening goes: one stage on wide screens, a clip under each step on narrow ones. The stage is
  // built once chapters.json says which clips this recording has.
  const shotsEl = document.getElementById('stage-shots');
  const cap = document.getElementById('stage-cap');
  const ticksEl = document.getElementById('stage-ticks');
  const wide = window.matchMedia('(min-width: 961px)');
  let shots = [];
  let steps = [];
  let active = -1;
  function activate(i) {
    if (i === active || !wide.matches) return;
    const prev = shots[active];
    const cur = shots[i];
    steps.forEach((s, k) => s.classList.toggle('is-active', k === i));
    shots.forEach((s, k) => s.b.setAttribute('aria-current', String(k === i)));
    if (prev) {
      prev.shot.classList.remove('is-active');
      prev.shot.classList.add('was-active');
      setTimeout(() => {
        prev.shot.classList.remove('was-active');
        if (active !== shots.indexOf(prev)) prev.v.pause();
      }, 760);
    }
    cur.shot.classList.add('is-active');
    play(cur.v);
    cap.textContent = cur.li.dataset.time ? `${cur.title}${/[!?.]$/.test(cur.title) ? '' : ','} ${cur.li.dataset.time}` : cur.title;
    active = i;
    // warm up the next clip
    const nx = shots[i + 1];
    if (nx && nx.v.preload === 'none' && !saveData) nx.v.preload = 'metadata';
  }
  const LIGHT_NAMES = { gold: 'Golden hour', rose: 'Sunset', dusk: 'Dusk', night: 'Night' };
  function buildStage(data) {
    const have = data?.available ? new Set(data.available) : null;
    for (const li of document.querySelectorAll('.step')) if (have && !have.has(li.dataset.clip)) li.remove();
    steps = [...document.querySelectorAll('.step')];
    shots = steps.map((li) => {
      const title = li.querySelector('h3').textContent;
      const light = data?.lights?.[li.dataset.clip];
      if (light && LIGHT_NAMES[light]) {
        li.dataset.light = light;
        li.querySelector('.light').textContent = LIGHT_NAMES[light];
      }
      const at = data?.clips?.[li.dataset.clip];
      if (at != null) {
        li.dataset.time = `${mmss(at)} into the evening`;
        li.querySelector('.step-time').textContent = li.dataset.time;
      }
      const shot = document.createElement('div');
      shot.className = 'shot';
      const v = makeVideo(li.dataset.clip, title);
      shot.appendChild(v);
      shotsEl.appendChild(shot);
      // the narrow-screen copy
      const fig = document.createElement('figure');
      fig.className = 'clip-inline felt';
      const vi = makeVideo(li.dataset.clip, title);
      vi.dataset.inview = '';
      fig.appendChild(vi);
      li.appendChild(fig);
      watchInView(vi);
      // a jump button per step
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('aria-label', `Show: ${title}`);
      b.addEventListener('click', () => li.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' }));
      ticksEl.appendChild(b);
      return { li, shot, v, b, title };
    });
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver(
        (es) => {
          for (const e of es) if (e.isIntersecting) activate(steps.indexOf(e.target));
        },
        { rootMargin: '-45% 0px -45% 0px' },
      );
      steps.forEach((s) => io.observe(s));
    }
    wide.addEventListener('change', () => {
      active = -1;
    });
  }

  // clips that play while they are on screen (narrow-screen steps, the nightfall clip)
  const inviewIO =
    'IntersectionObserver' in window
      ? new IntersectionObserver(
          (es) => {
            for (const e of es) {
              const v = e.target;
              if (!v.offsetParent) continue;
              if (e.isIntersecting) play(v);
              else v.pause();
            }
          },
          { threshold: 0.5 },
        )
      : null;
  function watchInView(v) {
    if (inviewIO) inviewIO.observe(v);
  }
  document.querySelectorAll('video[data-inview]').forEach(watchInView);

  // ---------------------------------------------------------------- the whole evening
  const run = document.getElementById('run');
  const bands = document.getElementById('tl-bands');
  const tl = document.getElementById('tl-ticks');
  const fill = document.getElementById('tl-fill');
  const now = document.getElementById('now');
  const tally = document.getElementById('tally');
  const kindColour = { start: 'var(--wool)', herd: 'var(--gold)', home: 'var(--leaf)', danger: 'var(--alarm)', save: 'var(--leaf)', end: 'var(--gold-hi)' };
  chapters.then((data) => {
    buildStage(data);
    if (!data) return;
    const dur = data.duration;
    const start = data.start ?? 0;
    // light bands: gold until the sun goes down, rose after it, then the results card
    const lead = document.createElement('span');
    lead.style.width = `${(start / dur) * 100}%`;
    bands.appendChild(lead);
    for (const b of data.bands ?? []) {
      const el = document.createElement('span');
      el.dataset.light = b.light;
      el.style.width = `${((b.to - b.from) / dur) * 100}%`;
      bands.appendChild(el);
    }
    // moments
    const ticks = data.events.map((ev) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tick';
      b.style.left = `${(ev.t / dur) * 100}%`;
      // labels near the ends open inwards, so they never widen the page
      if (ev.t / dur < 0.12) b.classList.add('edge-l');
      if (ev.t / dur > 0.82) b.classList.add('edge-r');
      b.style.setProperty('--c', kindColour[ev.kind] || 'var(--wool)');
      const at = mmss(Math.max(0, ev.t - start));
      const tip = document.createElement('span');
      tip.textContent = `${at} ${ev.label}`;
      b.appendChild(tip);
      b.setAttribute('aria-label', `Jump to ${at}: ${ev.label}`);
      b.addEventListener('click', () => {
        if (run.preload === 'none') run.preload = 'auto';
        run.currentTime = Math.max(0, ev.t - 1.5);
        run.play().catch(() => undefined);
      });
      tl.appendChild(b);
      return { ev, b, at };
    });
    let last = null;
    const update = () => {
      const t = run.currentTime || 0;
      fill.style.width = `${clamp(t / dur, 0, 1) * 100}%`;
      let cur = null;
      for (const k of ticks) if (k.ev.t <= t + 0.05) cur = k;
      if (cur !== last) {
        last?.b.classList.remove('is-now');
        cur?.b.classList.add('is-now');
        last = cur;
        now.replaceChildren();
        if (cur) {
          const b = document.createElement('b');
          b.textContent = cur.ev.label;
          now.append(b, `${/[!?.]$/.test(cur.ev.label) ? '' : ','} ${cur.at} into the evening.`);
        }
      }
    };
    run.addEventListener('timeupdate', update);
    run.addEventListener('seeked', update);
    update();
    const st = data.stats;
    if (st) {
      const left = Math.max(0, (st.dayLength ?? DAY) - st.daySeconds);
      const parts = [st.lost ? `lost ${st.lost} to the wolves` : 'lost none to the wolves'];
      if (st.barks) parts.push(`barked ${st.barks === 1 ? 'once' : st.barks === 2 ? 'twice' : `${st.barks} times`}`);
      if (st.rescues) parts.push(`pulled ${st.rescues === 1 ? 'one sheep' : `${st.rescues} sheep`} back out of a wolf's jaws`);
      const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
      tally.textContent = `In this evening the bot brought ${st.folded} of ${st.total} sheep home in ${mmss(st.daySeconds)}, with ${mmss(left)} of light to spare. It ${list}.`;
    }
  });

  // ---------------------------------------------------------------- greybox to finished
  const cmp = document.getElementById('compare');
  const range = document.getElementById('cmp-range');
  const before = document.getElementById('cmp-before');
  const after = document.getElementById('cmp-after');
  const tabs = [...document.querySelectorAll('.compare-tabs [role=tab]')];
  const setX = () => cmp.style.setProperty('--x', `${range.value}%`);
  range.addEventListener('input', setX);
  tabs.forEach((t) =>
    t.addEventListener('click', () => {
      tabs.forEach((x) => x.setAttribute('aria-selected', String(x === t)));
      before.src = `media/evo-${t.dataset.beat}-grey.jpg`;
      after.src = `media/evo-${t.dataset.beat}-final.jpg`;
    }),
  );
  setX();
})();
