import type { Project, Shot } from "@/content";
import { STATUS } from "@/lib/status";
import { Flip } from "@/components/Flip";
import { STATUS_LABEL, UI, type Lang } from "@/lib/i18n";

/**
 * Страница проекта — длинная колонка сверху вниз: полный кейс, на который
 * можно дать ссылку. Комната проекта в мире показывает то же главами,
 * коротко (`ProjectRoom.tsx`); здесь — всё целиком, с подробностями
 * пунктов и подписями к экранам.
 */
export function ProjectBody({ project, lang }: { project: Project; lang: Lang }) {
  const s = STATUS[project.status];
  const t = UI[lang];

  /** Скриншот с подписью. Обычный <img>, а не next/image: тот пишет color
      в атрибут style, и Dark Reader ломает гидратацию (как в Cover.tsx). */
  const figure = (shot: Shot, n: number, first = false) => (
    <figure key={n} className="mt-[clamp(14px,2vh,22px)]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={shot.image}
        alt={shot.caption ?? `${project.title}: ${t.screen} ${n + 1}`}
        width={1600}
        height={1000}
        {...(first ? { fetchPriority: "high" as const } : { loading: "lazy" as const })}
        decoding="async"
        className="h-auto w-full border border-[var(--line)]"
      />
      {shot.caption ? (
        <figcaption className="mt-2.5 max-w-[66ch] text-[13px] font-extralight leading-[1.6] text-[var(--sand-dim)]">
          {shot.caption}
        </figcaption>
      ) : null}
    </figure>
  );

  const heading = (text: string) => (
    <h2 className="font-display mt-[clamp(36px,6vh,72px)] text-[clamp(22px,2.6vw,32px)] font-light leading-tight">{text}</h2>
  );
  const paragraph = (text: string) => (
    <p className="mt-4 max-w-[62ch] text-[clamp(14px,1.6vw,17px)] font-extralight leading-[1.8] text-[var(--sand-dim)]">{text}</p>
  );

  // Видео — обложка, и тогда все скриншоты идут ниже; иначе обложка — первый скриншот.
  const [hero, ...rest] = project.video ? [undefined, ...project.shots] : project.shots;

  return (
    <>
      <header className="mt-[clamp(40px,10vh,110px)] border-b border-[var(--line)] pb-[clamp(22px,4vh,42px)]">
        <div className="flex items-center gap-2.5">
          <span className={`h-[5px] w-[5px] shrink-0 rounded-full ${s.dot}`} aria-hidden />
          <span className={`eyebrow ${s.text}`}>
            <Flip text={STATUS_LABEL[lang][project.status]} />
          </span>
        </div>
        <h1 className="font-display mt-4 text-[clamp(38px,7vw,86px)] font-light leading-[1.02] tracking-[-0.02em]">
          {project.title}
        </h1>
        {project.summary ? (
          <p className="mt-4 max-w-[52ch] text-[clamp(15px,1.7vw,19px)] font-extralight leading-[1.6] text-[var(--sand-dim)]">
            {project.summary}
          </p>
        ) : null}
        <p className="eyebrow mt-7 text-[var(--sand-faint)]">
          <Flip text={`${project.year} · ${project.role}`} />
        </p>
      </header>

      {project.video ? (
        <video
          src={project.video}
          poster={project.poster}
          controls
          playsInline
          preload="metadata"
          className="mt-[clamp(26px,5vh,54px)] w-full border border-[var(--line)]"
        />
      ) : hero ? (
        <div className="mt-[clamp(26px,5vh,54px)]">{figure(hero, 0, true)}</div>
      ) : null}

      {project.facts.length > 0 ? (
        <ul className="mt-[clamp(30px,5vh,56px)] grid gap-x-10 gap-y-7 sm:grid-cols-3">
          {project.facts.map((f, i) => (
            <li key={i}>
              <span className="font-display block text-[clamp(30px,4vw,52px)] font-light leading-none text-[var(--accent)]">
                {f.value}
              </span>
              <span className="mt-2 block max-w-[24ch] text-[12.5px] font-extralight leading-[1.5] text-[var(--sand-dim)]">
                {f.label}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {project.task ? (
        <>
          {heading(t.chTask)}
          {paragraph(project.task)}
        </>
      ) : null}
      {project.solution ? (
        <>
          {heading(t.chSolution)}
          {paragraph(project.solution)}
        </>
      ) : null}
      {project.result ? (
        <>
          {heading(t.chResult)}
          {paragraph(project.result)}
        </>
      ) : null}

      {project.scheme || project.did.length || project.stack.length ? (
        <>
          {heading(t.chBuild)}
          {project.scheme ? (
            // eslint-disable-next-line @next/next/no-img-element -- см. figure выше
            <img
              src={project.scheme}
              alt={`${project.title}: ${t.chBuild}`}
              loading="lazy"
              decoding="async"
              className="mt-5 h-auto w-full border border-[var(--line)]"
            />
          ) : null}
          {project.did.length ? (
            <>
              <h3 className="eyebrow mt-7 text-[var(--sand-faint)]">{t.whatIDid}</h3>
              <ul className="mt-4 space-y-3">
                {project.did.map((d, i) => (
                  <li key={i} className="relative max-w-[66ch] pl-5 text-[13.5px] font-extralight leading-[1.75] text-[var(--sand-dim)]">
                    {/* Волосяная черта вместо галочки: галочки в списках — примета шаблона. */}
                    <span className="absolute left-0 top-[11px] h-px w-[9px] bg-[var(--accent)] opacity-70" aria-hidden />
                    <span className="text-[var(--color-sand)]">{d.title}</span>
                    {d.detail ? `: ${d.detail}` : null}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {project.stack.length ? (
            <p className="mt-[clamp(28px,4vh,44px)] max-w-[62ch] border-t border-[var(--line)] pt-4 text-[13px] font-extralight leading-[1.7] text-[var(--sand-dim)]">
              {project.stack.join(" · ")}
            </p>
          ) : null}
        </>
      ) : null}

      {project.links.length > 0 ? (
        <div className="mt-6 flex flex-wrap gap-x-7 gap-y-2">
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
      ) : null}

      {rest.length > 0 ? (
        <>
          {heading(t.chScreens)}
          {rest.map((shot, i) => (shot ? figure(shot, i + (project.video ? 0 : 1)) : null))}
        </>
      ) : null}
    </>
  );
}
