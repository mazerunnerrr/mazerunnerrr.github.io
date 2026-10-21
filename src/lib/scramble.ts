/**
 * Перещёлкивание мелких надписей — как у igloo.inc (Илья, 2026-10-19): строка
 * печатается волной слева направо, и каждая буква, прежде чем встать,
 * доматывается к себе, как барабан счётчика, — показывает пять следующих
 * за ней знаков алфавита в обратном порядке: S → X W V U T → S. Из таких
 * мелочей и складывается ощущение прибора, а не страницы.
 *
 * Числа сняты с их кода (разобран 2026-10-19): доля строки x = i / (N − 1),
 * барабан tr2 = clamp(2·s − x), видимость tr1 = clamp((1.1·s₁ − x)·10),
 * сдвиг floor((1 − tr2)·5.753); s идёт за `dur`, s₁ — за 0.53·dur, sine.out.
 * Вся строка встаёт за ~0.73·dur.
 *
 * Пишет прямо в textContent, минуя React: надпись меняется каждый кадр.
 * Ширина не прыгает — приборы набраны моноширинным, а ещё не напечатанные
 * буквы стоят неразрывными пробелами.
 */

/** Длительность прогона, мс: появление — неторопливо, наведение — вдвое быстрее. */
export const FLIP_SHOW = 750;
export const FLIP_HOVER = 375;

const BLANK = " ";

/** Кольца знаков, по которым мотается барабан. Знак вне колец (·, —, ↵)
    не мотается, а только печатается. */
const RINGS = [
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  "abcdefghijklmnopqrstuvwxyz",
  "АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ",
  "абвгдежзийклмнопрстуфхцчшщъыьэюя",
  "0123456789",
  "!\"#$%&'()*+,-./:;<=>?@",
];

/** Знак на `k` шагов дальше по его кольцу. */
const ahead = (ch: string, k: number) => {
  if (!k) return ch;
  const c = ch === "Ё" ? "Е" : ch === "ё" ? "е" : ch;
  for (const ring of RINGS) {
    const i = ring.indexOf(c);
    if (i >= 0) return ring[(i + k) % ring.length];
  }
  return ch;
};

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const sineOut = (x: number) => Math.sin((clamp01(x) * Math.PI) / 2);

const running = new WeakMap<HTMLElement, number>();
const finals = new WeakMap<HTMLElement, string>();

/**
 * Записать строку в надпись. Надпись, разбитая на буквы (`split` — свет под
 * рукой), пишется по буквам: разметка и яркость каждой буквы остаются.
 */
const write = (el: HTMLElement, str: string) => {
  if (!el.dataset.split) {
    el.textContent = str;
    return;
  }
  const chars = Array.from(str);
  const kids = el.children;
  if (kids.length !== chars.length) return split(el, chars);
  chars.forEach((c, i) => {
    if (kids[i].textContent !== c) kids[i].textContent = c;
  });
};

/** Разбить надпись на буквы — по `<span>` на знак. Текст и ширина те же. */
export const split = (el: HTMLElement, chars = Array.from(el.textContent ?? "")) => {
  el.dataset.split = "1";
  el.replaceChildren(
    ...chars.map((c) => {
      const s = document.createElement("span");
      s.textContent = c;
      return s;
    })
  );
};

/** Щелчок прибора — звук мира (`Ambience.tick`); звук выключен — тишина. */
let ticker: ((k: number) => void) | null = null;
export const setTicker = (f: typeof ticker) => {
  ticker = f;
};
/** Щёлкнуть: `k` — сила, 1 — обычный щелчок. */
export const tick = (k = 1) => ticker?.(k);

const reduced = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Перепечатать надпись: довести до `text` или, без него, заново до той же
 * (появление слоя, наведение). Новый вызов прерывает текущий. `sound` —
 * под рукой: каждая смена знаков щёлкает, строка звучит дробью.
 */
export function scramble(el: HTMLElement, text?: string, dur = FLIP_SHOW, sound = false) {
  const to = text ?? finals.get(el) ?? el.textContent ?? "";
  const prev = running.get(el);
  if (prev) cancelAnimationFrame(prev);
  finals.set(el, to);
  if (reduced()) {
    write(el, to);
    running.delete(el);
    return;
  }
  const chars = Array.from(to);
  const n = chars.length;
  const start = performance.now();
  let was = el.textContent;

  const step = (now: number) => {
    const t = now - start;
    const s = sineOut(t / dur);
    const s1 = sineOut(t / (dur * 0.53));
    let out = "";
    for (let i = 0; i < n; i++) {
      const ch = chars[i];
      const x = n > 1 ? i / (n - 1) : 0;
      if (ch === " " || (1.1 * s1 - x) * 10 < 0.5) {
        out += ch === " " ? " " : BLANK;
        continue;
      }
      const tr2 = clamp01(2 * s - x);
      out += ahead(ch, Math.floor((1 - tr2) * 5.753));
    }
    write(el, out);
    if (sound && out !== was) tick(0.55);
    was = out;
    if (t < dur) running.set(el, requestAnimationFrame(step));
    else {
      write(el, to);
      running.delete(el);
    }
  };
  running.set(el, requestAnimationFrame(step));
}

/** Буква или цифра — у них есть «зубчик»: пробел и «·» не щёлкают и не мотаются. */
export const isSign = (ch: string) => /[\p{L}\p{N}]/u.test(ch);

/* Барабан одной буквы под рукой (вариант ?hand=roll, Илья выбирает, 2026-10-21):
   буква под курсором проворачивается на три знака своего кольца и встаёт
   на место — то же движение, что у строки при наведении, но по одной букве.
   Цифры вместо букв, как у Active Theory, пробовали в тот же день: «как
   на аналоговом сайте, не наше». */
const ROLL_STEP = 45; // мс на знак
const rolls = new WeakMap<HTMLElement, { at: Map<number, number>; raf: number }>();

export function rollAt(el: HTMLElement, i: number) {
  if (running.has(el) || reduced()) return;
  let r = rolls.get(el);
  if (!r) rolls.set(el, (r = { at: new Map(), raf: 0 }));
  const roll = r;
  roll.at.set(i, performance.now());
  if (roll.raf) return;
  const step = (now: number) => {
    // Строка перепечатывается целиком — её барабан главнее.
    if (running.has(el)) {
      roll.at.clear();
      roll.raf = 0;
      return;
    }
    const chars = Array.from(finals.get(el) ?? el.textContent ?? "");
    for (const [j, t0] of roll.at) {
      const k = 3 - Math.floor((now - t0) / ROLL_STEP);
      if (k <= 0) roll.at.delete(j);
      else chars[j] = ahead(chars[j], k);
    }
    write(el, chars.join(""));
    roll.raf = roll.at.size ? requestAnimationFrame(step) : 0;
  };
  roll.raf = requestAnimationFrame(step);
}
