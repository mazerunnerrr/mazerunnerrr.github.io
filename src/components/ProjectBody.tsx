import type { ReactNode } from "react";
import type { Project } from "@/content";
import { STATUS } from "@/lib/status";

/**
 * Содержимое проекта — одно на отдельную страницу и на комнату проекта в мире,
 * чтобы они не разъехались. Главный кадр передаётся снаружи: на странице это
 * картинка или видео, в комнате — монитор, листающий кадры под рукой.
 *
 * Страница — длинная колонка сверху вниз. Комната — один экран внутри
 * раздутой сферы: слева кто это и зачем, справа экраны и что сделано.
 * Колонка-страница с полосой прокрутки поверх сцены читалась как веб-страница,
 * брошенная в мир, — Илья забраковал её 2026-10-16. В комнате заголовки
 * на ступень ниже: h1 у главной уже есть.
 */
export function ProjectBody({ project, hero, room = false }: { project: Project; hero: ReactNode; room?: boolean }) {
  const s = STATUS[project.status];
  const Title = room ? "h2" : "h1";
  const Sub = room ? "h3" : "h2";

  const header = (
    <header className={room ? "" : "mt-[clamp(40px,10vh,110px)] border-b border-[var(--line)] pb-[clamp(22px,4vh,42px)]"}>
      <div className="flex items-center gap-2.5">
        <span className={`h-[5px] w-[5px] shrink-0 rounded-full ${s.dot}`} aria-hidden />
        <span className={`eyebrow ${s.text}`}>{project.status}</span>
      </div>

      <Title
        className={`font-display mt-4 font-light leading-[1.02] tracking-[-0.02em] ${
          room ? "text-[clamp(38px,4.2vw,62px)]" : "text-[clamp(38px,7vw,86px)]"
        }`}
      >
        {project.title}
      </Title>

      {project.summary ? (
        <p
          className={`max-w-[52ch] font-extralight leading-[1.6] text-[var(--sand-dim)] ${
            room ? "mt-3 text-[clamp(15px,1.5vw,19px)]" : "mt-4 text-[clamp(15px,1.7vw,19px)]"
          }`}
        >
          {project.summary}
        </p>
      ) : null}

      <p className={`eyebrow text-[var(--sand-faint)] ${room ? "mt-4" : "mt-7"}`}>
        {project.year} · {project.role}
      </p>
    </header>
  );

  const facts =
    project.facts.length > 0 ? (
      <ul className={room ? "grid grid-cols-3 gap-x-8 gap-y-6" : "mt-[clamp(30px,5vh,56px)] grid gap-x-10 gap-y-7 sm:grid-cols-3"}>
        {project.facts.map((f) => (
          <li key={f.label}>
            <span
              className={`font-display block font-light leading-none text-[var(--accent)] ${
                room ? "text-[clamp(28px,2.6vw,40px)]" : "text-[clamp(30px,4vw,52px)]"
              }`}
            >
              {f.value}
            </span>
            <span className="mt-2 block max-w-[24ch] text-[12.5px] font-extralight leading-[1.5] text-[var(--sand-dim)]">
              {f.label}
            </span>
          </li>
        ))}
      </ul>
    ) : null;

  const lead = (
    <p
      className={`max-w-[62ch] font-extralight text-[var(--sand-dim)] ${
        room ? "text-[14px] leading-[1.7]" : "mt-[clamp(30px,5vh,56px)] text-[clamp(14px,1.6vw,17px)] leading-[1.8]"
      }`}
    >
      {project.lead}
    </p>
  );

  const did = (
    <div>
      <Sub
        className={`font-display font-light leading-tight ${
          room ? "text-[clamp(20px,1.8vw,26px)]" : "mt-[clamp(36px,6vh,72px)] text-[clamp(22px,2.6vw,32px)]"
        }`}
      >
        Что сделал
      </Sub>
      <ul className={room ? "mt-4 space-y-2.5" : "mt-5 space-y-3"}>
        {project.did.map((item) => (
          <li
            key={item}
            className={`relative max-w-[66ch] pl-5 font-extralight text-[var(--sand-dim)] ${
              room ? "text-[13px] leading-[1.6]" : "text-[13.5px] leading-[1.75]"
            }`}
          >
            {/* Волосяная черта вместо галочки: галочки в списках — примета шаблона. */}
            <span
              className={`absolute left-0 h-px w-[9px] bg-[var(--accent)] opacity-70 ${room ? "top-[10px]" : "top-[11px]"}`}
              aria-hidden
            />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );

  const stack = (
    <p
      className={`max-w-[62ch] border-t border-[var(--line)] pt-4 text-[13px] font-extralight leading-[1.7] text-[var(--sand-dim)] ${
        room ? "" : "mt-[clamp(28px,4vh,44px)]"
      }`}
    >
      {project.stack.join(" · ")}
    </p>
  );

  const links =
    project.links.length > 0 ? (
      <div className={`flex flex-wrap gap-x-7 gap-y-2 ${room ? "" : "mt-6"}`}>
        {project.links.map((l) => (
          <a
            key={l.url}
            href={l.url}
            target="_blank"
            rel="noreferrer noopener"
            className="eyebrow text-[var(--sand-dim)] underline decoration-[var(--line)] underline-offset-[5px] transition-colors duration-500 ease-[var(--ease-out-deep)] hover:text-[var(--color-sand)] hover:decoration-current"
          >
            {l.label} ↗
          </a>
        ))}
      </div>
    ) : null;

  /* Комната — три колонки, читаются слева направо: кто это и зачем, что
     сделано, как выглядит. В две колонки правая с монитором и списком
     не влезала в 900 пикселей и наезжала на подсказку выхода. */
  if (room) {
    return (
      <div className="grid grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)_minmax(0,0.95fr)] gap-x-[clamp(28px,4vw,64px)]">
        <div className="flex flex-col gap-[clamp(16px,2.6vh,26px)]">
          {header}
          {facts}
          {lead}
          {stack}
          {links}
        </div>
        {did}
        <div>{hero}</div>
      </div>
    );
  }

  const rest = project.shots.slice(1);
  return (
    <>
      {header}
      {hero}
      {facts}
      {lead}
      {did}
      {stack}
      {links}

      {rest.length > 0 ? (
        <div className="mt-[clamp(36px,6vh,72px)] space-y-[clamp(14px,2vh,22px)]">
          {rest.map((src, i) => (
            // Обычный <img>, а не next/image: тот пишет color в атрибут style,
            // и Dark Reader ломает гидратацию (как в Cover.tsx).
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={src}
              src={src}
              alt={`${project.title}: экран ${i + 2}`}
              width={1600}
              height={1000}
              loading="lazy"
              decoding="async"
              className="h-auto w-full border border-[var(--line)]"
            />
          ))}
        </div>
      ) : null}
    </>
  );
}
