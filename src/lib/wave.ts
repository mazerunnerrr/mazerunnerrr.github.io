import { split } from "@/lib/scramble";
import { createField } from "@/lib/waveField";

/**
 * Волна по буквам комнаты — как в комнатах igloo.inc (Илья, 2026-11-06;
 * их код разобран в тот же день, `App3D`, классы карты и буквы).
 *
 * Мышь рисует мазок в грубой карте экрана (клетка — 5 px). Волна от мазка
 * расходится кругом (~300 px/с) и гаснет (`waveField.ts`). Буква берёт
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
   её строки сложены так же, по восемь; украинские буквы — своей строкой. */
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
  "ҐЄІЇґєії",
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

/** `still` — крупный текст: только светлеет, знаки не перебирает (Илья, 2026-11-10:
    подмена в больших буквах, особенно русских, «выглядит липово»). */
type Letter = { el: HTMLElement; x: number; y: number; last: number; w: number; scr: number; g: string; seed: number; still: boolean };

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
  const field = createField(TEXEL);

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
    field.resize(vw, vh);
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
        letters.push({
          el,
          x: r.left + r.width / 2,
          y: r.top + r.height / 2,
          last: 0,
          w: 0,
          scr: 0,
          g: "",
          seed: seed++ * 5,
          still: el.dataset.c === "still",
        });
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

    // Мазок — отрезок от прошлого места мыши к нынешнему.
    field.step(lx, ly, mx, my, present ? R : 0);
    lx = mx;
    ly = my;

    // Буквы читают карту в своём центре.
    const dy = scroller ? scroll0 - scroller.scrollTop : 0;
    for (const l of letters) {
      const v = field.at(l.x, l.y + dy);
      const rim = v - l.last;
      l.last = v;
      const w = Math.round(clamp01((v - LIT_FROM) / (LIT_TO - LIT_FROM)) * 50) / 50;
      if (w !== l.w) {
        if (w) l.el.style.setProperty("--w", String(w));
        else l.el.style.removeProperty("--w");
        l.w = w;
      }
      if (rim > RIM && !l.still) l.scr = SCRAMBLE_STEPS;
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
    if (field.active || performance.now() / 1000 - moveT < IDLE * 2) raf = requestAnimationFrame(frame);
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
      field.reset();
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
