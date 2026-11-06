import { split } from "@/lib/scramble";

/**
 * Волна по буквам комнаты — как в комнатах igloo.inc (Илья, 2026-11-06;
 * их код разобран в тот же день, `App3D`, классы карты и буквы).
 *
 * Мышь рисует мазок в грубой карте экрана (клетка — 5 px). Карта каждый шаг
 * расползается на клетку во все стороны (~300 px/с) и гаснет. Буква берёт
 * из карты одно значение в своём центре: сама величина её подсвечивает,
 * а её рост — проходящий фронт — на 3–5 шагов подменяет букву соседними
 * знаками её строки «атласа». Поэтому свет держится пятном вокруг следа
 * и гаснет весь разом (~0,6 с), а кольцо перебора уходит дальше, ~400 px.
 * Скорость мыши в волну не передаётся: она решает только ширину мазка —
 * медленная рука (до ~50 px/с) не рисует вовсе, с ~100 px/с — в полную силу.
 *
 * Буквы — `[data-c]` (проза комнаты, `WaveText`) и буквы надписей `Flip`
 * внутри `[data-wave]`. Свет — `--w`, знак-подмена — `data-g`, его рисует CSS
 * поверх буквы, не трогая текст: ширина строк не прыгает, React и
 * перещёлкивание `scramble` не мешают друг другу.
 */

/** Клетка карты, px. */
const TEXEL = 5;
/** Шаг карты, с: как у igloo, не чаще 60 раз в секунду. */
const STEP = 1 / 60;
/** Затухание карты за шаг. */
const DECAY = 0.985;
/** Ослабление фронта на клетку: у igloo его даёт шум сноса, без него кольцо
    перебора уходило бы через весь экран. Подобрано под их замер: ~400 px. */
const SPREAD = 0.976;
/** Мышь стояла дольше — первое её движение не рисуется, с. */
const IDLE = 0.15;
/** Скачок больше этой доли окна за шаг — не мазок. */
const JUMP = 0.3;
/** Радиус мазка на полной скорости — доля высоты окна. */
const RADIUS = 0.05;
/** Свет буквы: от этой величины карты загорается, к той — в полную силу. */
const LIT_FROM = 0.6;
const LIT_TO = 0.8;
/** Рост карты за шаг, с которого буква перебирает знаки, и сколько шагов. */
const RIM = 0.045;
const SCRAMBLE_STEPS = 4;

/* Строки «атласа» igloo — знак мотается по своей строке. Кириллицы у них нет,
   её строки сложены так же, по восемь. */
const ROWS = [
  "!\"#$%&'(",
  ")*+,-./0",
  "12345678",
  "9:;<=>?@",
  "ABCDEFGH",
  "IJKLMNOP",
  "QRSTUVWX",
  "YZ[]^_`a",
  "bcdefghi",
  "jklmnopq",
  "rstuvwxy",
  "z~©®´·‘’",
  "“”€",
  "АБВГДЕЁЖ",
  "ЗИЙКЛМНО",
  "ПРСТУФХЦ",
  "ЧШЩЪЫЬЭЮ",
  "Яабвгдеё",
  "жзийклмн",
  "опрстуфх",
  "цчшщъыьэ",
  "юя",
];
const PLACE = new Map<string, [number, number]>();
ROWS.forEach((row, r) => Array.from(row).forEach((c, i) => PLACE.set(c, [r, i])));

/** Знак на `k` мест дальше по его строке; знак вне атласа остаётся собой. */
const shifted = (ch: string, k: number) => {
  const at = PLACE.get(ch);
  if (!at) return ch;
  const row = ROWS[at[0]];
  return row[(at[1] + k) % row.length];
};

type Letter = { el: HTMLElement; x: number; y: number; last: number; w: number; scr: number; g: string; seed: number };

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

export function attachWave() {
  const off = { setRoot: () => {}, detach: () => {} };
  if (typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return off;

  let root: HTMLElement | null = null;
  let scroller: HTMLElement | null = null;
  let scroll0 = 0;
  let letters: Letter[] = [];
  let measured = false;

  let vw = 0;
  let vh = 0;
  let gw = 0;
  let gh = 0;
  let cur = new Float32Array(0);
  let nxt = new Float32Array(0);
  let active = false;

  let mx = -1;
  let my = -1;
  let lx = -1;
  let ly = -1;
  let moveT = 0;
  /** Скорость мыши: копилка и её сглаженное значение, как у igloo. */
  let tv = 0;
  let sv = 0;

  let raf = 0;
  let last = 0;
  let acc = 0;

  const size = () => {
    vw = window.innerWidth;
    vh = window.innerHeight;
    gw = Math.ceil(vw / TEXEL) + 1;
    gh = Math.ceil(vh / TEXEL) + 1;
    cur = new Float32Array(gw * gh);
    nxt = new Float32Array(gw * gh);
    measured = false;
  };

  /** Где буквы: раз на комнату и раз на каждое пробуждение волны — не в обработчике мыши. */
  const measure = () => {
    letters = [];
    measured = true;
    if (!root) return;
    scroller = root.closest<HTMLElement>("[data-room-scroll]");
    scroll0 = scroller?.scrollTop ?? 0;
    const boxes = root.matches("[data-wave]") ? [root] : Array.from(root.querySelectorAll<HTMLElement>("[data-wave]"));
    let seed = 0;
    for (const box of boxes) {
      box.querySelectorAll<HTMLElement>("[data-flip]").forEach((el) => {
        if (!el.dataset.split) split(el);
      });
      box.querySelectorAll<HTMLElement>("[data-c], [data-split] > span").forEach((el) => {
        const r = el.getBoundingClientRect();
        if (!r.width) return;
        letters.push({ el, x: r.left + r.width / 2, y: r.top + r.height / 2, last: 0, w: 0, scr: 0, g: "", seed: seed++ * 5 });
      });
    }
  };

  const clearLetters = () => {
    for (const l of letters) {
      if (l.w) l.el.style.removeProperty("--w");
      if (l.g) l.el.removeAttribute("data-g");
    }
    letters = [];
  };

  const step = () => {
    const now = performance.now() / 1000;
    const present = mx >= 0;
    let e = present && lx >= 0 ? Math.hypot((mx - lx) / vw, (my - ly) / vh) : 0;
    if (!present || now - moveT > IDLE || e > JUMP) {
      tv = 0;
      e = 0;
      lx = mx;
      ly = my;
    }
    tv = clamp01((tv + e * 6) * 0.88);
    sv += (1 - Math.pow(1 - tv, 4) - sv) * 0.1;
    const R = RADIUS * smooth(0.1, 1, sv) * vh;

    // Карта расползается на клетку и чуть слабеет на фронте.
    for (let y = 0; y < gh; y++) {
      const row = y * gw;
      for (let x = 0; x < gw; x++) {
        const i = row + x;
        let n = x > 0 ? cur[i - 1] : 0;
        if (x < gw - 1 && cur[i + 1] > n) n = cur[i + 1];
        if (y > 0 && cur[i - gw] > n) n = cur[i - gw];
        if (y < gh - 1 && cur[i + gw] > n) n = cur[i + gw];
        n *= SPREAD;
        nxt[i] = cur[i] > n ? cur[i] : n;
      }
    }
    // Мазок — отрезок от прошлого места мыши к нынешнему.
    if (present && R > 0.5) {
      const ax = lx;
      const ay = ly;
      const sx = mx - ax;
      const sy = my - ay;
      const l2 = sx * sx + sy * sy;
      const x0 = Math.max(0, Math.floor((Math.min(ax, mx) - R) / TEXEL));
      const x1 = Math.min(gw - 1, Math.ceil((Math.max(ax, mx) + R) / TEXEL));
      const y0 = Math.max(0, Math.floor((Math.min(ay, my) - R) / TEXEL));
      const y1 = Math.min(gh - 1, Math.ceil((Math.max(ay, my) + R) / TEXEL));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const px = (x + 0.5) * TEXEL - ax;
          const py = (y + 0.5) * TEXEL - ay;
          const t = l2 > 0 ? clamp01((px * sx + py * sy) / l2) : 0;
          const d = Math.hypot(px - sx * t, py - sy * t);
          const s = 1 - d / R;
          if (s > 0) nxt[y * gw + x] += s * s * s;
        }
      }
    }
    let max = 0;
    for (let i = 0; i < nxt.length; i++) {
      const v = Math.min(1, nxt[i] * DECAY);
      nxt[i] = v < 1e-4 ? 0 : v;
      if (v > max) max = v;
    }
    [cur, nxt] = [nxt, cur];
    lx = mx;
    ly = my;
    active = max > 0.003;

    // Буквы читают карту в своём центре.
    const dy = scroller ? scroll0 - scroller.scrollTop : 0;
    for (const l of letters) {
      const cx = Math.floor(l.x / TEXEL);
      const cy = Math.floor((l.y + dy) / TEXEL);
      const v = cx >= 0 && cy >= 0 && cx < gw && cy < gh ? cur[cy * gw + cx] : 0;
      const rim = v - l.last;
      l.last = v;
      const w = Math.round(clamp01((v - LIT_FROM) / (LIT_TO - LIT_FROM)) * 50) / 50;
      if (w !== l.w) {
        if (w) l.el.style.setProperty("--w", String(w));
        else l.el.style.removeProperty("--w");
        l.w = w;
      }
      if (rim > RIM) l.scr = SCRAMBLE_STEPS;
      let g = "";
      if (l.scr > 0) {
        l.scr--;
        if (l.scr > 0) g = shifted(l.el.textContent ?? "", 1 + ((l.seed + l.scr * 3) % 7));
      }
      if (g !== l.g) {
        if (g) l.el.setAttribute("data-g", g);
        else l.el.removeAttribute("data-g");
        l.g = g;
      }
    }
  };

  const frame = (t: number) => {
    raf = 0;
    if (!root) return;
    if (!measured) measure();
    acc += Math.min(0.1, (t - last) / 1000);
    last = t;
    let n = 0;
    while (acc >= STEP && n < 4) {
      step();
      acc -= STEP;
      n++;
    }
    if (n === 4) acc = 0;
    if (active || performance.now() / 1000 - moveT < IDLE * 2) raf = requestAnimationFrame(frame);
    else {
      // Волна улеглась — буквы на месте; при следующем движении перемеряем.
      for (const l of letters) l.last = 0;
      measured = false;
    }
  };

  const wake = () => {
    if (raf || !root) return;
    last = performance.now();
    acc = 0;
    raf = requestAnimationFrame(frame);
  };

  const onMove = (e: PointerEvent) => {
    mx = e.clientX;
    my = e.clientY;
    moveT = performance.now() / 1000;
    wake();
  };
  const onOut = (e: PointerEvent) => {
    if (!e.relatedTarget) mx = my = -1;
  };
  const onResize = () => {
    size();
    if (root) wake();
  };

  size();
  window.addEventListener("pointermove", onMove, { passive: true });
  window.addEventListener("pointerout", onOut, { passive: true });
  window.addEventListener("resize", onResize);

  return {
    /** Комната открылась (или сменился язык) — волна читает её буквы; null — комнаты нет. */
    setRoot(el: HTMLElement | null) {
      clearLetters();
      cur.fill(0);
      active = false;
      root = el;
      measured = false;
    },
    detach() {
      clearLetters();
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerout", onOut);
      window.removeEventListener("resize", onResize);
    },
  };
}
