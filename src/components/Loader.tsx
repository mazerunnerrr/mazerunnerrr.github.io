"use client";

import { useEffect, useRef, useState } from "react";

/** Сколько точек в кольце, его радиус и сколько заставка держится минимум. */
const DOTS = 64;
const R = 62;
const MIN_MS = 2000;

/**
 * Заставка на первые секунды (Илья, 2026-10-20, по образцу Active Theory).
 *
 * Без неё в первом кадре мелькало имя обычным шрифтом посередине — запасной
 * заголовок, пока сцена не поднялась, — «заглянули под капот». Заставка
 * отрисована сервером, поэтому закрывает экран с самого первого кадра.
 * Язык сайта: кольцо точек загорается по кругу, как шкала прибора, рядом
 * счётчик. Держится, пока сцена не готова, но не меньше MIN_MS; уходя,
 * кольцо наплывает на зрителя и гаснет, и в тот же миг точки собирают имя.
 * Если скрипты не запустились, CSS убирает её сам через 9 секунд.
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
    const t0 = performance.now();
    let last = t0;
    let p = 0;
    let lit = 0;
    let shown = -1;
    let raf = 0;
    let timer = 0;
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = now - t0;
      // Кольцо заполняется в такт времени на всю длину заставки — не быстрее:
      // сцена бывает готова почти сразу, и иначе счётчик секунду стоял на 99.
      // Пока сцена не готова, он не уходит дальше 86%.
      const pace = Math.min(1, t / MIN_MS);
      const target = readyRef.current ? pace : Math.min(pace, 0.86);
      p += (target - p) * (1 - Math.pow(0.015, dt));
      const on = Math.round(p * DOTS);
      for (; lit < on; lit++) dots.current[lit]?.setAttribute("data-on", "");
      const pct = Math.min(100, Math.round(p * 100));
      if (pct !== shown && count.current) {
        shown = pct;
        count.current.textContent = String(pct).padStart(3, "0");
      }
      if (readyRef.current && p > 0.995 && t >= MIN_MS) {
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
      <span className="instrument mt-6 text-[var(--color-sand)]">{title}</span>
      <span ref={count} className="instrument mt-1 tabular-nums text-[var(--sand-faint)]">
        000
      </span>
    </div>
  );
}
