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

const reduced = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Перепечатать надпись: довести до `text` или, без него, заново до той же
 * (появление слоя, наведение). Новый вызов прерывает текущий.
 */
export function scramble(el: HTMLElement, text?: string, dur = FLIP_SHOW) {
  const to = text ?? finals.get(el) ?? el.textContent ?? "";
  const prev = running.get(el);
  if (prev) cancelAnimationFrame(prev);
  finals.set(el, to);
  if (reduced()) {
    el.textContent = to;
    running.delete(el);
    return;
  }
  const chars = Array.from(to);
  const n = chars.length;
  const start = performance.now();

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
    el.textContent = out;
    if (t < dur) running.set(el, requestAnimationFrame(step));
    else {
      el.textContent = to;
      running.delete(el);
    }
  };
  running.set(el, requestAnimationFrame(step));
}
