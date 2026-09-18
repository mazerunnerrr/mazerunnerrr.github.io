"use client";

import { useCallback, useMemo, useRef } from "react";
import { Scene, type FrameInfo } from "@/components/Scene";
import type { Contacts, Project, Site, Skill } from "@/content";
import { ProjectCard } from "@/components/ProjectCard";
import { ContactForm } from "@/components/ContactForm";

/** Точки маршрута. Секции — не блоки друг под другом, а места на пути. */
const STOPS = 4;

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
  /* Из частиц собирается псевдоним — одно слово держит удар лучше длинной
     фразы: его видно целиком и оно не рвётся при разлёте. Массив мемоизирован:
     новый на каждый рендер пересобирал бы сцену. */
  const lines = useMemo(() => [site.alias], [site.alias]);
  const heroRef = useRef<HTMLDivElement>(null);
  const skillsRef = useRef<HTMLDivElement>(null);
  const glitchRef = useRef<HTMLHeadingElement>(null);
  const hintRef = useRef<HTMLSpanElement>(null);
  const projectsRef = useRef<HTMLDivElement>(null);
  const projectsTitleRef = useRef<HTMLHeadingElement>(null);
  const contactsRef = useRef<HTMLDivElement>(null);
  const contactsTitleRef = useRef<HTMLHeadingElement>(null);
  const goToRef = useRef<((stop: number) => void) | null>(null);

  // useCallback обязателен: onReady попал бы в зависимости эффекта сцены,
  // и та пересобиралась бы на каждый рендер, теряя инерцию маршрута.
  const onReady = useCallback((api: { goTo: (stop: number) => void }) => {
    goToRef.current = api.goTo;
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

  /* Всё, что меняется каждый кадр, пишется прямо в style. Через
     состояние React это был бы ре-рендер шестьдесят раз в секунду.

     pointer-events здесь НЕ трогаем. Слои лежат поверх канваса на весь
     экран, и стоит выставить им `auto` — они перехватывают всю мышь,
     до сцены не доходит ни одного события, и кажется, что интерактив
     мёртв. Слои сквозные всегда, а кликабельность включают сами кнопки
     и ссылки классом `pointer-events-auto`. */
  const onFrame = ({ progress, velocity }: FrameInfo) => {
    const p = Math.min(1, progress);
    /** Чья сейчас точка: к ней камера ближе всего, ей и принимать нажатия. */
    const near = Math.round(progress);

    if (heroRef.current) {
      fade(heroRef.current, Math.max(0, 1 - p * 1.7), near === 0);
      // Слой уезжает на зрителя вместе с камерой, иначе вёрстка
      // стоит на месте, пока частицы улетают, и связь распадается.
      heroRef.current.style.transform = `translate3d(0,0,0) scale(${1 + p * 0.5})`;
    }

    if (hintRef.current) hintRef.current.style.opacity = String(Math.max(0, 1 - p * 4));

    if (skillsRef.current) {
      // Появляется на подлёте к своей точке и уходит на вылете с неё.
      const appear = Math.max(0, Math.min(1, (progress - 0.45) / 0.55));
      const leave = Math.max(0, Math.min(1, (progress - 1.1) / 0.6));
      fade(skillsRef.current, appear * (1 - leave), near === 1);
      skillsRef.current.style.transform = `scale(${0.94 + appear * 0.06 + leave * 0.4})`;
    }

    if (projectsRef.current) {
      const appear = Math.max(0, Math.min(1, (progress - 1.45) / 0.55));
      // Уход появился вместе с четвёртой точкой: иначе карточки стояли
      // поверх контактов и перекрывали их.
      const leave = Math.max(0, Math.min(1, (progress - 2.1) / 0.6));
      fade(projectsRef.current, appear * (1 - leave), near === 2);
      projectsRef.current.style.transform = `scale(${0.94 + appear * 0.06 + leave * 0.4})`;
    }

    if (contactsRef.current) {
      const appear = Math.max(0, Math.min(1, (progress - 2.45) / 0.55));
      fade(contactsRef.current, appear, near === 3);
      contactsRef.current.style.transform = `scale(${0.94 + appear * 0.06})`;
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

  return (
    <main className="relative h-screen w-full overflow-hidden">
      <Scene lines={lines} stops={STOPS} onFrame={onFrame} onReady={onReady} />

      {/* Заголовок для поиска и скринридеров: частицы их не заменяют. */}
      <h1 className="sr-only">
        {site.alias} — {site.thesis}
      </h1>

      {/* ── точка 0: кто я ─────────────────────────────────────── */}
      <div
        ref={heroRef}
        onFocus={() => follow(0)}
        className="pointer-events-none absolute inset-0 flex flex-col justify-between p-[clamp(18px,3vw,40px)]"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          {/* Имени здесь нет: живое имя стоит только рядом с контактами. */}
          <span className="eyebrow text-[var(--sand-faint)]">{site.status}</span>
        </div>

        <div className="flex flex-col items-start gap-7 pb-[clamp(20px,6vh,64px)]">
          <p className="font-display max-w-[22ch] text-[clamp(21px,2.6vw,36px)] font-light leading-[1.15] tracking-[-0.01em] sm:max-w-[30ch]">
            {site.thesis}
          </p>
          <p className="max-w-[46ch] text-[clamp(14px,1.5vw,17px)] font-extralight leading-[1.75] text-[var(--sand-dim)]">
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
            <span ref={hintRef} className="eyebrow ml-2 text-[var(--sand-faint)]">
              крути дальше
            </span>
          </div>
        </div>
      </div>

      {/* ── точка 1: что делаю ─────────────────────────────────── */}
      <div
        ref={skillsRef}
        data-faded
        onFocus={() => follow(1)}
        className="pointer-events-none absolute inset-0 flex flex-col justify-center px-[clamp(18px,6vw,90px)] opacity-0"
      >
        <h2
          ref={glitchRef}
          id="skills"
          tabIndex={-1}
          className="font-display mb-[clamp(24px,4vh,52px)] text-[clamp(30px,5vw,64px)] font-light leading-[1.04] tracking-[-0.02em]"
        >
          Что делаю
        </h2>

        <ul className="grid gap-x-[clamp(20px,4vw,64px)] gap-y-[clamp(20px,3vh,38px)] sm:grid-cols-2">
          {skills.map((s) => (
            <li key={s.title} className="border-t border-[var(--line)] pt-4">
              <h3 className="font-display text-[clamp(19px,2vw,27px)] font-normal leading-tight">
                {s.title}
              </h3>
              <p className="mt-2 max-w-[38ch] text-[13.5px] font-extralight leading-[1.7] text-[var(--sand-dim)]">
                {s.lead}
              </p>
            </li>
          ))}
        </ul>
      </div>

      {/* ── точка 2: проекты ───────────────────────────────────── */}
      <div
        ref={projectsRef}
        data-faded
        onFocus={() => follow(2)}
        className="pointer-events-none absolute inset-0 flex flex-col justify-center overflow-y-auto px-[clamp(18px,6vw,90px)] py-[clamp(40px,8vh,90px)] opacity-0"
      >
        <h2
          ref={projectsTitleRef}
          id="projects"
          tabIndex={-1}
          className="font-display mb-[clamp(20px,3vh,40px)] text-[clamp(30px,5vw,64px)] font-light leading-[1.04] tracking-[-0.02em]"
        >
          Проекты
        </h2>
        {/* В две колонки — только когда проектов больше одного: единственная
            плитка в сетке оставляла пустой половину экрана. */}
        <div
          className={`grid gap-[clamp(24px,4vw,56px)] ${
            projects.length > 1 ? "lg:grid-cols-2" : "max-w-[860px]"
          }`}
        >
          {projects.map((p) => (
            <ProjectCard key={p.slug} project={p} />
          ))}
        </div>
      </div>

      {/* ── точка 3: контакты ──────────────────────────────────── */}
      <div
        ref={contactsRef}
        data-faded
        onFocus={() => follow(3)}
        className="pointer-events-none absolute inset-0 flex flex-col justify-center px-[clamp(18px,6vw,90px)] opacity-0"
      >
        <h2
          ref={contactsTitleRef}
          id="contacts"
          tabIndex={-1}
          className="font-display text-[clamp(30px,5vw,64px)] font-light leading-[1.04] tracking-[-0.02em]"
        >
          Контакты
        </h2>

        <p className="eyebrow mt-4 text-[var(--sand-faint)]">
          {contacts.name} · {site.status}
        </p>

        {contacts.note ? (
          <p className="mt-5 max-w-[46ch] text-[clamp(14px,1.5vw,17px)] font-extralight leading-[1.75] text-[var(--sand-dim)]">
            {contacts.note}
          </p>
        ) : null}

        {/* Ссылки и форма — в две колонки на широком экране. В столбик экран
            контактов перестал помещаться по высоте: заголовок срезало сверху,
            кнопку — снизу, а прокрутки на маршруте нет. */}
        <div className="mt-[clamp(18px,3vh,36px)] grid w-full max-w-[1060px] gap-x-[clamp(24px,5vw,72px)] gap-y-[clamp(16px,3vh,28px)] lg:grid-cols-2 lg:items-start">
        <ul className="w-full max-w-[640px]">
          {contacts.links.map((l) => (
            <li key={l.url} className="border-t border-[var(--line)]">
              {/* pointer-events включает сама ссылка: слой сквозной всегда. */}
              <a
                href={l.url}
                {...(l.url.startsWith("mailto:")
                  ? {}
                  : { target: "_blank", rel: "noreferrer noopener" })}
                className="group pointer-events-auto flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-[clamp(12px,2vh,20px)] transition-colors duration-500 ease-[var(--ease-out-deep)] hover:text-[var(--color-azure)]"
              >
                <span className="font-display text-[clamp(22px,3vw,38px)] font-light leading-none">
                  {l.label}
                </span>
                <span className="eyebrow text-[var(--sand-faint)] transition-colors duration-500 ease-[var(--ease-out-deep)] group-hover:text-[var(--color-azure)]">
                  {plain(l.url)}
                </span>
              </a>
            </li>
          ))}
        </ul>

        {/* Форма появляется, только когда в админке указан адрес приёмника.
            Нет адреса — остаются ссылки, и экран не врёт пустой формой. */}
        {contacts.formUrl ? <ContactForm url={contacts.formUrl} /> : null}
        </div>
      </div>
    </main>
  );
}
