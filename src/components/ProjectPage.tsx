"use client";

import Link from "next/link";
import type { Project } from "@/content";
import { ProjectBody } from "@/components/ProjectBody";
import { UI, type Lang } from "@/lib/i18n";
import { useLang } from "@/lib/useLang";

/** Страница проекта на языке посетителя. Собирается английской, русский
    включается после загрузки — как и на главной (см. `src/lib/i18n.ts`). */
export function ProjectPage({ project: both }: { project: Record<Lang, Project> }) {
  const lang = useLang();
  const t = UI[lang];
  const project = both[lang];
  const hero = project.shots[0];

  return (
    <main
      data-accent={project.accent}
      className="mx-auto w-full max-w-[1100px] px-[clamp(18px,5vw,64px)] pb-[clamp(60px,12vh,140px)] pt-[clamp(22px,4vh,48px)]"
    >
      {/* Назад — к точке этого проекта на маршруте, а не к первой. */}
      <Link
        href={`/#${project.slug}`}
        className="eyebrow text-[var(--sand-faint)] transition-colors duration-500 ease-[var(--ease-out-deep)] hover:text-[var(--color-sand)]"
      >
        {t.backToRoute}
      </Link>

      <ProjectBody
        project={project}
        lang={lang}
        hero={
          project.video ? (
            <video
              src={project.video}
              controls
              playsInline
              preload="metadata"
              className="mt-[clamp(26px,5vh,54px)] w-full border border-[var(--line)]"
            />
          ) : hero ? (
            // Обычный <img>, а не next/image: тот пишет color в атрибут style,
            // и Dark Reader ломает гидратацию (как в Cover.tsx).
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={hero}
              alt={`${project.title}: ${t.mainScreen}`}
              width={1600}
              height={1000}
              fetchPriority="high"
              className="mt-[clamp(26px,5vh,54px)] h-auto w-full border border-[var(--line)]"
            />
          ) : null
        }
      />

      <Link
        href={`/#${project.slug}`}
        className="eyebrow mt-[clamp(40px,7vh,90px)] inline-block border-t border-[var(--line)] pt-5 text-[var(--sand-faint)] transition-colors duration-500 ease-[var(--ease-out-deep)] hover:text-[var(--color-sand)]"
      >
        {t.backToRoute}
      </Link>
    </main>
  );
}
