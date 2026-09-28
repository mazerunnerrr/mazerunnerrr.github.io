"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Scene, type FrameInfo } from "@/components/Scene";
import type { Contacts, Project, Site, Skill } from "@/content";
import { ContactForm } from "@/components/ContactForm";
import { Ambience } from "@/lib/ambience";
import { Cover } from "@/components/Cover";
import type { ShapeSpec } from "@/lib/shapes";
import { STATUS } from "@/lib/status";

/** Точки маршрута. Секции — не блоки друг под другом, а места на пути.
    Маршрут — кольцо: за последней точкой снова первая. */
const STOPS = 4;

/** Номер точки на круге для прибора слева сверху. Нумерация здесь честная:
    это последовательность маршрута, а не украшение. */
const ROUTE = ["01 / 04 · имя", "02 / 04 · что делаю", "03 / 04 · проекты", "04 / 04 · контакты"];

/** Якоря, с которых можно встать на точку сразу, без пролёта: так страница
    проекта возвращает на «Проекты», а не заново на имя. */
const HASH_STOPS: Record<string, number> = { "#skills": 1, "#projects": 2, "#contacts": 3 };

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Где точка k относительно камеры на кольце: минус — ещё впереди,
    плюс — уже позади. У последней точки соседом слева идёт первая. */
const offset = (p: number, k: number) => {
  let d = (((p - k) % STOPS) + STOPS) % STOPS;
  if (d > STOPS / 2) d -= STOPS;
  return d;
};

/* Прозрачность слоя плюс метка «погас» для CSS: кнопки погасшего слоя
   перестают ловить клики. Метка пишется только при смене, не каждый кадр.

   Метка зависит не только от прозрачности, но и от того, чья сейчас точка.
   Камера, застывшая между точками, оставляла соседний слой почти невидимым,
   но кликабельным: на 2,4 невидимые контакты перехватывали нажатие на плитку
   проекта. Теперь нажатия принимает только ближайшая к камере точка. */
const fade = (el: HTMLElement, opacity: number, own: boolean) => {
  el.style.opacity = String(opacity);
  const off = !own || opacity < 0.05;
  if (el.hasAttribute("data-faded") !== off) el.toggleAttribute("data-faded", off);
};

/** Адрес без служебной части: в строке рядом со ссылкой она лишняя. */
const plain = (url: string) => url.replace(/^mailto:/, "").replace(/^https?:\/\//, "");

/* Объект из частиц — герой, текст — приборы. Всё, что написано, стоит
   по углам мелким моноширинным шрифтом, центр экрана отдан объекту. */
export function Home({
  site,
  skills,
  projects,
  contacts,
}: {
  site: Site;
  skills: Skill[];
  projects: Project[];
  contacts: Contacts;
}) {
  const project = projects[0];
  /* Объект-герой каждой точки — из той же материи, что и имя. Массив
     мемоизирован по значениям, а не по ссылкам на пропсы: новый на каждый
     рендер пересобирал бы сцену. */
  const projectTitle = project?.title ?? site.alias;
  const shapes = useMemo<ShapeSpec[]>(
    () => [
      { kind: "text", text: site.alias },
      { kind: "rings", count: skills.length },
      { kind: "text", text: projectTitle },
      { kind: "text", text: "@" },
    ],
    [site.alias, skills.length, projectTitle]
  );
  const heroRef = useRef<HTMLDivElement>(null);
  const skillsRef = useRef<HTMLDivElement>(null);
  const glitchRef = useRef<HTMLHeadingElement>(null);
  const hintRef = useRef<HTMLSpanElement>(null);
  const projectsRef = useRef<HTMLDivElement>(null);
  const projectsTitleRef = useRef<HTMLHeadingElement>(null);
  const contactsRef = useRef<HTMLDivElement>(null);
  const contactsTitleRef = useRef<HTMLHeadingElement>(null);
  const routeRef = useRef<HTMLSpanElement>(null);
  const fpsRef = useRef<HTMLElement>(null);
  const pointsRef = useRef<HTMLElement>(null);
  const movingRef = useRef<HTMLElement>(null);
  const lastNear = useRef(-1);
  const lastStats = useRef(0);
  const goToRef = useRef<((stop: number) => void) | null>(null);
  // Монитор с обложкой проекта листает кадры только под рукой или в фокусе.
  const [monitor, setMonitor] = useState(false);

  // Звук выключен по умолчанию и собирается только по первому нажатию:
  // браузер не даёт аудио начаться без жеста посетителя.
  const [sound, setSound] = useState(false);
  const ambienceRef = useRef<Ambience | null>(null);
  const lastSound = useRef(0);
  useEffect(() => () => ambienceRef.current?.close(), []);
  const toggleSound = () => {
    const next = !sound;
    if (next && !ambienceRef.current) ambienceRef.current = new Ambience();
    ambienceRef.current?.set(next);
    setSound(next);
  };

  // useCallback обязателен: onReady попал бы в зависимости эффекта сцены,
  // и та пересобиралась бы на каждый рендер, теряя инерцию маршрута.
  const onReady = useCallback((api: { goTo: (stop: number) => void; jumpTo: (stop: number) => void }) => {
    goToRef.current = api.goTo;
    const stop = HASH_STOPS[window.location.hash];
    if (stop !== undefined) api.jumpTo(stop);
  }, []);

  /* Обработчики не каррированы нарочно: вызов вида jump(2) в разметке
     выполнялся бы во время рендера, а рефы там читать нельзя. */
  const jump = (stop: number, e: React.MouseEvent) => {
    if (!goToRef.current) return;
    e.preventDefault();
    goToRef.current(stop);
    // Фокус едет вместе с камерой. Иначе после Enter на «Смотреть проекты»
    // он остаётся на погасшей кнопке первого экрана, и следующий Tab
    // возвращает камеру назад.
    const titles: Record<number, HTMLHeadingElement | null> = {
      1: glitchRef.current,
      2: projectsTitleRef.current,
      3: contactsTitleRef.current,
    };
    titles[stop]?.focus({ preventScroll: true });
  };

  /* Tab ведёт по маршруту: фокус, попавший в погасший слой, зовёт камеру
     к его точке. Раньше он молча вставал на невидимую ссылку. */
  const follow = (stop: number) => goToRef.current?.(stop);

  /* Всё, что меняется каждый кадр, пишется прямо в style и textContent.
     Через состояние React это был бы ре-рендер шестьдесят раз в секунду.

     pointer-events здесь НЕ трогаем. Слои лежат поверх канваса на весь
     экран, и стоит выставить им `auto` — они перехватывают всю мышь,
     до сцены не доходит ни одного события, и кажется, что интерактив
     мёртв. Слои сквозные всегда, а кликабельность включают сами кнопки
     и ссылки классом `pointer-events-auto`. */
  const onFrame = ({ progress, velocity, stats }: FrameInfo) => {
    /** Чья сейчас точка: к ней камера ближе всего, ей и принимать нажатия. */
    const near = Math.round(progress) % STOPS;

    if (heroRef.current) {
      const d = offset(progress, 0);
      // Первый экран уходит быстрее остальных: освобождает место под пролёт.
      const vis = d > 0 ? Math.max(0, 1 - d * 1.7) : clamp01((d + 0.55) / 0.55);
      fade(heroRef.current, vis, near === 0);
      // Слой уезжает на зрителя вместе с материей, иначе вёрстка стоит
      // на месте, пока частицы улетают, и связь распадается.
      heroRef.current.style.transform = `translate3d(0,0,0) scale(${1 + Math.max(0, d) * 0.5})`;
    }

    if (hintRef.current) {
      hintRef.current.style.opacity = String(Math.max(0, 1 - Math.abs(offset(progress, 0)) * 4));
    }

    // Остальные точки устроены одинаково: появляются на подлёте, уходят
    // на вылете. На кольце «подлёт» к первой точке идёт от последней.
    const layers = [
      [skillsRef.current, 1],
      [projectsRef.current, 2],
      [contactsRef.current, 3],
    ] as const;
    for (const [el, k] of layers) {
      if (!el) continue;
      const d = offset(progress, k);
      const appear = d <= 0 ? clamp01((d + 0.55) / 0.55) : 1;
      const leave = d > 0 ? clamp01((d - 0.1) / 0.6) : 0;
      fade(el, appear * (1 - leave), near === k);
      el.style.transform = `scale(${0.94 + appear * 0.06 + leave * 0.4})`;
    }

    // Номер точки на круге — только при смене, а не каждый кадр.
    if (near !== lastNear.current) {
      lastNear.current = near;
      if (routeRef.current) routeRef.current.textContent = ROUTE[near];
    }

    // Живые показания — четыре раза в секунду: чаще число не успевают прочитать.
    const now = performance.now();
    if (now - lastStats.current > 250) {
      lastStats.current = now;
      const fmt = (x: number) => x.toLocaleString("ru-RU");
      if (fpsRef.current) fpsRef.current.textContent = stats.fps ? String(Math.round(stats.fps)) : "—";
      if (pointsRef.current) pointsRef.current.textContent = stats.points ? fmt(stats.points) : "—";
      if (movingRef.current) movingRef.current.textContent = stats.points ? fmt(stats.moving) : "—";
    }

    // Звук слушает руку и пролёт несколько раз в секунду — чаще не нужно.
    if (ambienceRef.current && now - lastSound.current > 80) {
      lastSound.current = now;
      ambienceRef.current.drive(stats.hand, Math.min(1, Math.abs(velocity) * 0.9));
    }

    // Расслоение текста на скорости: тот же приём, что держит характер
    // у Dreamzone, и то, из-за чего у Active Theory буквы «плывут»
    // при пролёте. Порог нужен, иначе в покое видна цветная кайма.
    const v = Math.min(1, Math.abs(velocity) * 0.85);
    const shadow =
      v > 0.02
        ? `${-v * 7}px 0 rgba(143,179,204,.55), ${v * 7}px 0 rgba(232,223,205,.35)`
        : "none";
    if (glitchRef.current) glitchRef.current.style.textShadow = shadow;
    if (projectsTitleRef.current) projectsTitleRef.current.style.textShadow = shadow;
    if (contactsTitleRef.current) contactsTitleRef.current.style.textShadow = shadow;
  };

  const status = project ? STATUS[project.status] : null;

  return (
    <main className="relative h-screen w-full overflow-hidden">
      <Scene shapes={shapes} onFrame={onFrame} onReady={onReady} />

      {/* Заголовок для поиска и скринридеров: частицы их не заменяют. */}
      <h1 className="sr-only">
        {site.alias} — {site.thesis}
      </h1>

      {/* ── точка 0: имя ───────────────────────────────────────── */}
      <div
        ref={heroRef}
        onFocus={() => follow(0)}
        className="pointer-events-none absolute inset-0 flex flex-col justify-end p-[var(--gutter)]"
      >
        <div className="flex max-w-[460px] flex-col items-start gap-5">
          <p className="font-display text-[clamp(22px,2.2vw,30px)] font-light leading-[1.15] tracking-[-0.01em]">
            {site.thesis}
          </p>
          <p className="max-w-[44ch] text-[14px] font-extralight leading-[1.7] text-[var(--sand-dim)]">
            {site.intro}
          </p>

          <div className="pointer-events-auto flex flex-wrap items-center gap-3">
            <a
              href="#projects"
              onClick={(e) => jump(2, e)}
              className="rounded-[3px] bg-[var(--color-sand)] px-7 py-3.5 text-[13px] font-medium text-[var(--color-void)] transition-opacity duration-500 hover:opacity-80"
            >
              Смотреть проекты
            </a>
            <a
              href="#contacts"
              onClick={(e) => jump(3, e)}
              className="rounded-[3px] px-7 py-3.5 text-[13px] text-[var(--color-sand)] shadow-[inset_0_0_0_1px_var(--line)] transition-colors duration-500 hover:shadow-[inset_0_0_0_1px_var(--color-azure)]"
            >
              Написать
            </a>
          </div>
          <span ref={hintRef} className="instrument text-[var(--sand-dim)]">
            колесо или ↑ ↓ — по кругу
          </span>
        </div>
      </div>

      {/* ── точка 1: что делаю — подписи у колец-узлов ──────────── */}
      <div
        ref={skillsRef}
        data-faded
        onFocus={() => follow(1)}
        className="rings pointer-events-none absolute inset-0 opacity-0"
      >
        <h2
          ref={glitchRef}
          id="skills"
          tabIndex={-1}
          className="instrument absolute bottom-[var(--gutter)] left-[var(--gutter)] text-[var(--sand-dim)]"
        >
          Что делаю
        </h2>

        {skills.length === 4 ? (
          <ul>
            {skills.map((s, i) => (
              <li
                key={s.title}
                className="ring-label"
                data-side={i % 2 === 0 ? "left" : "right"}
                data-row={i < 2 ? "top" : "bottom"}
              >
                <h3 className="instrument text-[var(--color-sand)]">{s.title}</h3>
                <p className="mt-1.5 text-[13px] font-extralight leading-[1.6] text-[var(--sand-dim)]">{s.lead}</p>
              </li>
            ))}
          </ul>
        ) : (
          /* Не четыре направления — кольца стоят рядом, и подписи уходят
             списком в угол: выноски рассчитаны на сетку 2×2. */
          <ul className="absolute bottom-[calc(var(--gutter)+28px)] left-[var(--gutter)] grid max-w-[420px] gap-3">
            {skills.map((s) => (
              <li key={s.title}>
                <h3 className="instrument text-[var(--color-sand)]">{s.title}</h3>
                <p className="mt-1 text-[13px] font-extralight leading-[1.6] text-[var(--sand-dim)]">{s.lead}</p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── точка 2: проекты ───────────────────────────────────── */}
      <div
        ref={projectsRef}
        data-faded
        data-accent={project?.accent}
        onFocus={() => follow(2)}
        className="pointer-events-none absolute inset-0 opacity-0"
      >
        {project && status ? (
          <>
            {/* Внизу слева: что это и куда нажать. */}
            <div className="absolute bottom-[var(--gutter)] left-[var(--gutter)] flex max-w-[440px] flex-col items-start gap-3">
              <h2 ref={projectsTitleRef} id="projects" tabIndex={-1} className="instrument text-[var(--sand-dim)]">
                Проекты · {project.year}
              </h2>
              <div className="flex items-center gap-2.5">
                <span className={`h-[5px] w-[5px] shrink-0 rounded-full ${status.dot}`} aria-hidden />
                <span className={`instrument ${status.text}`}>{project.status}</span>
              </div>
              <h3 className="font-display text-[clamp(22px,2.2vw,30px)] font-light leading-tight">{project.title}</h3>
              {project.summary ? (
                <p className="text-[15px] font-light leading-[1.5] text-[var(--color-sand)]">{project.summary}</p>
              ) : null}
              <p className="instrument text-[var(--sand-dim)]">
                {project.role} · {project.stack.slice(0, 4).join(" · ")}
              </p>
              <Link
                href={`/work/${project.slug}/`}
                className="pointer-events-auto mt-1 rounded-[3px] bg-[var(--color-sand)] px-6 py-3 text-[13px] font-medium text-[var(--color-void)] transition-opacity duration-500 hover:opacity-80"
              >
                Смотреть проект
              </Link>
            </div>

            {/* Внизу справа: цифры проекта — его показания. */}
            {project.facts.length > 0 ? (
              <dl className="absolute bottom-[var(--gutter)] right-[var(--gutter)] grid gap-y-4 text-right">
                {project.facts.map((f) => (
                  // Подпись идёт первой, как требует HTML, а число встаёт над ней
                  // обратным порядком колонки.
                  <div key={f.label} className="flex flex-col-reverse">
                    <dt className="instrument mt-1 text-[var(--sand-dim)]">{f.label}</dt>
                    <dd className="font-display text-[clamp(22px,2.2vw,30px)] font-light leading-none text-[var(--accent)]">
                      {f.value}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}

            {/* Справа сверху, под показаниями сцены: монитор с обложкой.
                Дубль ссылки «Смотреть проект» для мыши, поэтому вне обхода Tab
                и скрыт от скринридера — второй раз ту же ссылку ему не читать. */}
            {project.video || project.shots.length ? (
              <Link
                href={`/work/${project.slug}/`}
                tabIndex={-1}
                aria-hidden
                onPointerEnter={() => setMonitor(true)}
                onPointerLeave={() => setMonitor(false)}
                className="pointer-events-auto absolute right-[var(--gutter)] top-[calc(var(--gutter)+104px)] block w-[min(280px,22vw)]"
              >
                <Cover video={project.video} shots={project.shots} alt="" active={monitor} />
                <span className="instrument mt-2 block text-right text-[var(--sand-dim)]">экран проекта · наведи</span>
              </Link>
            ) : null}
          </>
        ) : null}
      </div>

      {/* ── точка 3: контакты ──────────────────────────────────── */}
      <div
        ref={contactsRef}
        data-faded
        onFocus={() => follow(3)}
        className="pointer-events-none absolute inset-0 opacity-0"
      >
        <div className="absolute bottom-[var(--gutter)] left-[var(--gutter)] flex w-[min(460px,40vw)] flex-col items-start gap-3">
          <h2 ref={contactsTitleRef} id="contacts" tabIndex={-1} className="instrument text-[var(--sand-dim)]">
            Контакты · {contacts.name}
          </h2>
          {contacts.note ? (
            <p className="max-w-[40ch] text-[14px] font-extralight leading-[1.7] text-[var(--sand-dim)]">
              {contacts.note}
            </p>
          ) : null}
          <ul className="mt-1 w-full">
            {contacts.links.map((l) => (
              <li key={l.url} className="border-t border-[var(--line)]">
                {/* pointer-events включает сама ссылка: слой сквозной всегда. */}
                <a
                  href={l.url}
                  {...(l.url.startsWith("mailto:") ? {} : { target: "_blank", rel: "noreferrer noopener" })}
                  className="group pointer-events-auto flex items-baseline justify-between gap-6 py-3 transition-colors duration-500 ease-[var(--ease-out-deep)] hover:text-[var(--color-azure)]"
                >
                  <span className="font-display text-[26px] font-light leading-none">{l.label}</span>
                  <span className="instrument text-[var(--sand-dim)] transition-colors duration-500 ease-[var(--ease-out-deep)] group-hover:text-[var(--color-azure)]">
                    {plain(l.url)}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </div>

        {/* Форма появляется, только когда в админке указан адрес приёмника.
            Нет адреса — остаются ссылки, и экран не врёт пустой формой. */}
        {contacts.formUrl ? (
          <div className="absolute bottom-[var(--gutter)] right-[var(--gutter)] w-[min(420px,36vw)]">
            <ContactForm url={contacts.formUrl} />
          </div>
        ) : null}
      </div>

      {/* ── приборы: на всём круге ─────────────────────────────── */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-[var(--gutter)] top-[var(--gutter)] flex flex-col gap-0.5">
          <span className="instrument text-[var(--color-sand)]">{site.alias}</span>
          <span className="instrument text-[var(--sand-dim)]">{site.status}</span>
          <span ref={routeRef} className="instrument text-[var(--sand-dim)]">
            {ROUTE[0]}
          </span>
        </div>

        {/* Живые показания сцены — настоящие числа, не декор. Для скринридера
            это шум: числа меняются четыре раза в секунду. */}
        <dl
          aria-hidden
          className="absolute right-[var(--gutter)] top-[var(--gutter)] grid grid-cols-[auto_auto] gap-x-5 gap-y-0.5 text-right"
        >
          <dt className="instrument text-[var(--sand-dim)]">к/с</dt>
          <dd ref={fpsRef} className="instrument text-[var(--color-sand)]">
            —
          </dd>
          <dt className="instrument text-[var(--sand-dim)]">точек</dt>
          <dd ref={pointsRef} className="instrument text-[var(--color-sand)]">
            —
          </dd>
          <dt className="instrument text-[var(--sand-dim)]">в движении</dt>
          <dd ref={movingRef} className="instrument text-[var(--color-sand)]">
            —
          </dd>
        </dl>

        <button
          type="button"
          onClick={toggleSound}
          aria-pressed={sound}
          className="instrument pointer-events-auto absolute right-[var(--gutter)] top-[calc(var(--gutter)+62px)] text-[var(--sand-dim)] transition-colors duration-500 ease-[var(--ease-out-deep)] hover:text-[var(--color-sand)]"
        >
          звук · {sound ? "вкл" : "выкл"}
        </button>
      </div>
    </main>
  );
}
