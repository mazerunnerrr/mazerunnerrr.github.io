"use client";

import { useEffect, useRef, useState } from "react";
import { Clicks, ENTER_KEY } from "@/lib/ambience";

/** Сколько точек в кольце и его радиус. */
const DOTS = 64;
const R = 62;
/* Скорость кольца (Илья, 2026-11-10): было ~2,5 с — «чтобы не ждать», 1,5 с по
   кубической кривой — резко: первые щелчки за 0,15 с сливались в дробь (83 → 50 →
   39 → 31 мс). Разгон — четверть синуса за RISE: 91 → 63 → 52 → 45 мс между
   щелчками. Торможение — cos³ за FALL, длиннее разгона: «в конце плавнее» —
   … 42 → 46 → 51 → 59 → 72 → 95 → 161 мс, кольцо садится мягко. */
const RISE = 1100;
const FALL = 1650;
const DUR = RISE + FALL;
/** Пока сцена не готова, кольцо не заходит дальше этой доли. */
const HOLD = 0.86;
/** Доля кольца по доле времени — таблицей: у такой кривой нет формулы. */
const STEPS = 1024;
const CURVE = (() => {
  const v = (u: number) => {
    const t = u * DUR;
    return t < RISE ? Math.sin((Math.PI / 2) * (t / RISE)) : Math.cos((Math.PI / 2) * ((t - RISE) / FALL)) ** 3;
  };
  const p = new Float64Array(STEPS + 1);
  for (let i = 1; i <= STEPS; i++) p[i] = p[i - 1] + (v((i - 1) / STEPS) + v(i / STEPS)) / 2;
  for (let i = 0; i <= STEPS; i++) p[i] /= p[STEPS];
  return p;
})();
const inOut = (u: number) => {
  const x = Math.min(1, Math.max(0, u)) * STEPS;
  const i = Math.min(STEPS - 1, Math.floor(x));
  return CURVE[i] + (CURVE[i + 1] - CURVE[i]) * (x - i);
};
/** Доля времени, когда кольцо доходит до доли `p`. */
const timeOf = (p: number) => {
  let lo = 0;
  let hi = STEPS;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (CURVE[m] < p) lo = m;
    else hi = m;
  }
  return (lo + (p - CURVE[lo]) / (CURVE[hi] - CURVE[lo] || 1)) / STEPS;
};
const U_HOLD = timeOf(HOLD);
/** Последняя точка загорелась — столько кольцо стоит полным, мс, и уходит:
    хвост кривой после неё почти недвижим, ждать его до конца незачем. */
const LAST_PAUSE = 150;

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
    /** Когда загорелась последняя точка. */
    let litAt = 0;
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
        const at = timeOf((lit + 0.5) / DOTS);
        clicks?.tick(0.8, Math.max(0, ((u - at) * DUR) / 1000));
      }
      if (lit >= DOTS && !litAt) litAt = now;
      const pct = lit >= DOTS ? 100 : Math.min(99, Math.round(p * 100));
      if (pct !== shown && count.current) {
        shown = pct;
        count.current.textContent = String(pct).padStart(3, "0");
      }
      if (readyRef.current && (u >= 1 || (litAt && now - litAt >= LAST_PAUSE))) {
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
