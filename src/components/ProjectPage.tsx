"use client";

import Link from "next/link";
import type { Project } from "@/content";
import { ProjectBody } from "@/components/ProjectBody";
import { UI, type Lang } from "@/lib/i18n";
import { accentOf } from "@/lib/status";
import { useLang } from "@/lib/useLang";

/** Страница проекта на языке посетителя. Собирается английской, русский
    включается после загрузки — как и на главной (см. `src/lib/i18n.ts`). */
export function ProjectPage({ project: both }: { project: Record<Lang, Project> }) {
  const lang = useLang();
  const t = UI[lang];
  const project = both[lang];

  return (
    <main
      data-accent={accentOf(project)}
      className="mx-auto w-full max-w-[1100px] px-[clamp(18px,5vw,64px)] pb-[clamp(60px,12vh,140px)] pt-[clamp(22px,4vh,48px)]"
    >
      {/* Назад — к точке этого проекта на маршруте, а не к первой. */}
      <Link
        href={`/#${project.slug}`}
        className="eyebrow text-[var(--sand-faint)] transition-colors duration-500 ease-[var(--ease-out-deep)] hover:text-[var(--color-sand)]"
      >
        {t.backToRoute}
      </Link>

      <ProjectBody project={project} lang={lang} />

      <Link
        href={`/#${project.slug}`}
        className="eyebrow mt-[clamp(40px,7vh,90px)] inline-block border-t border-[var(--line)] pt-5 text-[var(--sand-faint)] transition-colors duration-500 ease-[var(--ease-out-deep)] hover:text-[var(--color-sand)]"
      >
        {t.backToRoute}
      </Link>
    </main>
  );
}
