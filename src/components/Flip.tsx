"use client";

import { useEffect, useRef, useState } from "react";
import { FLIP_SHOW, isSign, rollAt, scramble, split, tick } from "@/lib/scramble";

/**
 * Мелкая надпись, которая перещёлкивается: при появлении страницы, при смене
 * текста (язык, номер точки) и по `flipIn` — когда её слой проявился или на
 * неё навели. Текст в DOM ведёт `scramble`, а не React: React рисует только
 * первый кадр и дальше в надпись не лезет, иначе они затирали бы друг друга.
 */
export function Flip({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [first] = useState(text);
  useEffect(() => {
    if (ref.current) scramble(ref.current, text);
  }, [text]);
  return (
    <span ref={ref} data-flip>
      {first}
    </span>
  );
}

/** Перещёлкнуть все надписи внутри элемента: слой проявился или на него
    навели (`sound` — тогда со щелчками). */
export const flipIn = (root: Element | null, dur = FLIP_SHOW, sound = false) => {
  root?.querySelectorAll<HTMLElement>("[data-flip]").forEach((el) => scramble(el, undefined, dur, sound));
};

/**
 * Надписи под рукой (Илья, 2026-10-21). Курсор ведёт по кнопке или ссылке —
 * буква под ним вспыхивает белым со своим ореолом и тлеет с хвостом: ведёшь —
 * буквы загораются по одной и гаснут позади. Каждая пройденная буква — зубчик
 * колеса: щелчок, как у колеса выбора времени в iPhone. С `?hand=roll` буква
 * под курсором ещё и проворачивается барабаном (`rollAt`).
 *
 * Пробовали в тот же день: цифры вместо букв, как у Active Theory, — «как
 * на аналоговом сайте, не наше»; пятно света поверх надписи — «PNG-шка».
 *
 * Надпись разбивается на буквы при первом наведении (`split`), яркость каждой —
 * `--l`, цвет и ореол по ней рисует CSS (`[data-split] > span`). Один слушатель
 * на всё окно. Где лежат надписи, меряется раз — при заходе на кнопку, а не
 * на каждом движении: чтение геометрии в pointermove — рывки.
 */
export function attachFlipHand() {
  const roll = new URLSearchParams(location.search).get("hand") === "roll";
  type Span = { el: HTMLElement; left: number; right: number; text: string[] };
  let host: Element | null = null;
  let spans: Span[] = [];
  /** Свет на надписи: яркость каждой буквы и над какой буквой рука (−1 — ушла). */
  const lights = new Map<HTMLElement, { lit: Float32Array; at: number; prev: number }>();
  let raf = 0;
  let last = 0;
  const frame = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    // Буква загорается за ~0,05 с и тлеет ~0,9 с.
    const up = 1 - Math.pow(1e-9, dt);
    const down = 1 - Math.pow(0.03, dt);
    for (const [el, l] of lights) {
      const kids = el.children;
      let any = l.at >= 0;
      for (let i = 0; i < l.lit.length; i++) {
        const want = i === l.at ? 1 : 0;
        const v = l.lit[i] + (want - l.lit[i]) * (want > l.lit[i] ? up : down);
        l.lit[i] = v < 0.004 && !want ? 0 : v;
        if (l.lit[i]) any = true;
        const kid = kids[i] as HTMLElement | undefined;
        if (!kid) continue;
        if (l.lit[i]) kid.style.setProperty("--l", l.lit[i].toFixed(3));
        else kid.style.removeProperty("--l");
      }
      if (!any) lights.delete(el);
    }
    raf = lights.size ? requestAnimationFrame(frame) : 0;
  };
  const leave = () => lights.forEach((l) => (l.at = -1));
  // Кнопки и ссылки — и мелкие надписи, которые играют под рукой сами (`data-hand`).
  const hostOf = (e: PointerEvent) => (e.target as Element | null)?.closest?.("a, button, [data-hand]") ?? null;
  const onMove = (e: PointerEvent) => {
    const h = hostOf(e);
    if (h !== host) {
      leave();
      host = h;
      spans = h
        ? Array.from(h.querySelectorAll<HTMLElement>("[data-flip]"), (el) => {
            const r = el.getBoundingClientRect();
            return { el, left: r.left, right: r.right, text: Array.from(el.textContent ?? "") };
          })
        : [];
    }
    // Надпись под курсором, а если их у кнопки несколько и курсор между ними — ближайшая.
    let best: Span | null = null;
    let gap = Infinity;
    for (const s of spans) {
      const d = Math.max(s.left - e.clientX, e.clientX - s.right, 0);
      if (d < gap) [best, gap] = [s, d];
    }
    if (!best) return;
    const n = best.text.length;
    const i = Math.min(n - 1, Math.max(0, Math.floor(((e.clientX - best.left) / Math.max(1, best.right - best.left)) * n)));
    if (!best.el.dataset.split) split(best.el);
    let l = lights.get(best.el);
    if (!l || l.lit.length !== n) lights.set(best.el, (l = { lit: new Float32Array(n), at: -1, prev: -1 }));
    if (l.at < 0) leave();
    // Пробел и «·» не горят: свет держится на последней букве.
    if (isSign(best.text[i]) && i !== l.at) {
      // Первая буква при заходе не щёлкает — там щёлкает перепечатка строки.
      if (l.prev >= 0) {
        tick(0.8);
        if (roll) rollAt(best.el, i);
      }
      l.at = l.prev = i;
    }
    if (!raf) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
  };
  const onDown = (e: PointerEvent) => {
    const h = hostOf(e);
    if (h?.matches("a, button") && h.querySelector("[data-flip]")) tick(1.6);
  };
  window.addEventListener("pointermove", onMove, { passive: true });
  window.addEventListener("pointerdown", onDown, { passive: true });
  return () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerdown", onDown);
    cancelAnimationFrame(raf);
  };
}
