"use client";

import { useEffect, useRef, useState } from "react";
import { Clicks, ENTER_KEY } from "@/lib/ambience";

/** Сколько точек в кольце и его радиус. */
const DOTS = 64;
const R = 62;
/** За сколько кольцо проходит круг, мс (Илья, 2026-11-10: было ~2,5 с, «чтобы не ждать»;
    1,5 с оказалось резко — «чуть длиннее и плавнее»). */
const DUR = 2200;
/** Пока сцена не готова, кольцо не заходит дальше этой доли. */
const HOLD = 0.86;
/* Разгон к середине и торможение к концу — по синусу. Кубическая кривая
   трогалась позже и тут же срывалась: первые щелчки за 0,15 с сливались
   в дробь (83 → 50 → 39 → 31 мс между ними); у синуса на 2,2 с — 91 → 63 →
   52 → 45 мс, разгон слышно (Илья, 2026-11-10). */
const inOut = (u: number) => (1 - Math.cos(Math.PI * u)) / 2;
/** Доля времени, на которой кривая доходит до HOLD. */
const U_HOLD = Math.acos(1 - 2 * HOLD) / Math.PI;

/**
 * Заставка на первые секунды (Илья, 2026-10-20, по образцу Active Theory).
 *
 * Без неё в первом кадре мелькало имя обычным шрифтом посередине — запасной
 * заголовок, пока сцена не поднялась, — «заглянули под капот». Заставка
 * отрисована сервером, поэтому закрывает экран с самого первого кадра.
 * Язык сайта: кольцо точек посреди экрана загорается по кругу, как шкала
 * прибора, внутри — счётчик. Круг — за DUR: медленно трогается, разгоняется к середине и мягко
 * встаёт; каждая загоревшаяся точка щёлкает, как буквы под рукой. Сцена не
 * готова — кольцо ждёт на HOLD; уходя, наплывает на зрителя и гаснет, и в тот
 * же миг точки собирают имя. Если скрипты не запустились, CSS убирает её сам
 * через 9 секунд.
 *
 * На первом визите кольцо ждёт нажатия — «старт» внутри кольца (Илья,
 * 2026-11-10): до первого жеста браузер не даёт звучать, а загрузка со
 * щелчками — часть входа. Сцена тем временем строится. Метку первого визита
 * (`data-first` на <html>) ставит инлайн-скрипт в layout.tsx до отрисовки,
 * по ней CSS показывает надпись вместо счётчика; нажатие её снимает и
 * запоминает вход (`ENTER_KEY`). Дальше заставка идёт сама.
 */
export function Loader({
  enter,
  ready,
  onDone,
}: {
  enter: string;
  ready: boolean;
  onDone: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  /** Вход по нажатию — живёт в эффекте, кнопка зовёт его через ссылку. */
  const begin = useRef(() => {});
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
    const root = document.documentElement;
    let last = performance.now();
    /** Доля пройденного времени круга: стоит, пока сцена не готова. */
    let u = 0;
    let lit = 0;
    let shown = -1;
    let raf = 0;
    let timer = 0;
    /** Кольцо пошло: сразу у вернувшегося, по нажатию — на первом визите. */
    let started = !root.hasAttribute("data-first");
    let clicks = started ? new Clicks() : null;
    begin.current = () => {
      if (started) return;
      started = true;
      // Это нажатие — жест: звук разрешён с первой же точки.
      clicks = new Clicks(true);
      root.removeAttribute("data-first");
      try {
        localStorage.setItem(ENTER_KEY, "1");
      } catch {}
    };
    const onKey = (e: KeyboardEvent) => {
      if (started || (e.key !== "Enter" && e.key !== " ")) return;
      e.preventDefault();
      begin.current();
    };
    window.addEventListener("keydown", onKey);
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!started) {
        raf = requestAnimationFrame(tick);
        return;
      }
      u = Math.min(readyRef.current ? 1 : U_HOLD, u + (dt * 1000) / DUR);
      const p = inOut(u);
      const on = Math.round(p * DOTS);
      for (; lit < on; lit++) {
        dots.current[lit]?.setAttribute("data-on", "");
        // Когда точка загорелась на самом деле — внутри прошедшего кадра.
        const at = Math.acos(1 - (2 * (lit + 0.5)) / DOTS) / Math.PI;
        clicks?.tick(0.8, Math.max(0, ((u - at) * DUR) / 1000));
      }
      const pct = Math.min(100, Math.round(p * 100));
      if (pct !== shown && count.current) {
        shown = pct;
        count.current.textContent = String(pct).padStart(3, "0");
      }
      if (readyRef.current && u >= 1) {
        clicks?.close();
        window.removeEventListener("keydown", onKey);
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
      window.removeEventListener("keydown", onKey);
      clicks?.close();
    };
  }, []);

  if (gone) return null;
  return (
    <div ref={box} className="loader fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-void)]">
      {/* Только кольцо по центру, без имени: «Хелиас убери вообще» (Илья, 2026-11-10). */}
      <div className="relative">
        <svg aria-hidden className="loader-ring" width="160" height="160" viewBox="0 0 160 160">
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
        {/* Счётчик и «старт» — в середине кольца, на одном месте; на первом визите
            до нажатия виден «старт» (CSS по `data-first`). */}
        <span aria-hidden className="absolute inset-0 grid place-items-center">
          <span ref={count} className="loader-count instrument tabular-nums text-[var(--sand-faint)] [grid-area:1/1]">
            000
          </span>
          <span className="loader-hint instrument whitespace-nowrap text-[var(--color-sand)] [grid-area:1/1]">{enter}</span>
        </span>
      </div>
      {/* Нажать можно куда угодно: весь экран — кнопка входа. */}
      <button type="button" aria-label={enter} onClick={() => begin.current()} className="loader-enter absolute inset-0 outline-none" />
    </div>
  );
}
