"use client";

import { useEffect, useRef, useState } from "react";
import { Clicks } from "@/lib/ambience";

/** Сколько точек в кольце и его радиус. */
const DOTS = 64;
const R = 62;
/** За сколько кольцо проходит круг, мс (Илья, 2026-11-10: было ~2,5 с, «чтобы не ждать»). */
const DUR = 1500;
/** Пока сцена не готова, кольцо не заходит дальше этой доли. */
const HOLD = 0.86;
/** Разгон к середине и торможение к концу — кубическая кривая, как доводка маршрута. */
const inOut = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
/** Доля времени, на которой кривая доходит до HOLD. */
const U_HOLD = 1 - Math.cbrt(2 * (1 - HOLD)) / 2;

/**
 * Заставка на первые секунды (Илья, 2026-10-20, по образцу Active Theory).
 *
 * Без неё в первом кадре мелькало имя обычным шрифтом посередине — запасной
 * заголовок, пока сцена не поднялась, — «заглянули под капот». Заставка
 * отрисована сервером, поэтому закрывает экран с самого первого кадра.
 * Язык сайта: кольцо точек загорается по кругу, как шкала прибора, рядом
 * счётчик. Круг — за DUR: медленно трогается, разгоняется к середине и мягко
 * встаёт; каждая загоревшаяся точка щёлкает, как буквы под рукой. Сцена не
 * готова — кольцо ждёт на HOLD; уходя, наплывает на зрителя и гаснет, и в тот
 * же миг точки собирают имя. Если скрипты не запустились, CSS убирает её сам
 * через 9 секунд.
 */
export function Loader({ title, ready, onDone }: { title: string; ready: boolean; onDone: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const count = useRef<HTMLSpanElement>(null);
  const dots = useRef<(SVGCircleElement | null)[]>([]);
  const readyRef = useRef(ready);
  const doneRef = useRef(onDone);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    readyRef.current = ready;
    doneRef.current = onDone;
  });

  useEffect(() => {
    let last = performance.now();
    /** Доля пройденного времени круга: стоит, пока сцена не готова. */
    let u = 0;
    let lit = 0;
    let shown = -1;
    let raf = 0;
    let timer = 0;
    const clicks = new Clicks();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      u = Math.min(readyRef.current ? 1 : U_HOLD, u + (dt * 1000) / DUR);
      const p = inOut(u);
      const on = Math.round(p * DOTS);
      for (; lit < on; lit++) {
        dots.current[lit]?.setAttribute("data-on", "");
        clicks.tick(0.8);
      }
      const pct = Math.min(100, Math.round(p * 100));
      if (pct !== shown && count.current) {
        shown = pct;
        count.current.textContent = String(pct).padStart(3, "0");
      }
      if (readyRef.current && u >= 1) {
        clicks.close();
        box.current?.setAttribute("data-done", "");
        doneRef.current();
        timer = window.setTimeout(() => setGone(true), 950);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
      clicks.close();
    };
  }, []);

  if (gone) return null;
  return (
    <div ref={box} aria-hidden className="loader fixed inset-0 z-50 flex flex-col items-center justify-center bg-[var(--color-void)]">
      <svg className="loader-ring" width="160" height="160" viewBox="0 0 160 160">
        {Array.from({ length: DOTS }, (_, i) => {
          const a = (i / DOTS) * Math.PI * 2 - Math.PI / 2;
          return (
            <circle
              key={i}
              ref={(el) => {
                dots.current[i] = el;
              }}
              className="loader-dot"
              cx={(80 + Math.cos(a) * R).toFixed(2)}
              cy={(80 + Math.sin(a) * R).toFixed(2)}
              r="1.6"
            />
          );
        })}
      </svg>
      <span translate="no" className="notranslate instrument mt-6 text-[var(--color-sand)]">
        {title}
      </span>
      <span ref={count} className="instrument mt-1 tabular-nums text-[var(--sand-faint)]">
        000
      </span>
    </div>
  );
}
