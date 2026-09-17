"use client";

import Link from "next/link";
import { useState } from "react";
import type { Project } from "@/content";
import { Cover } from "@/components/Cover";

/**
 * Плитка проекта на маршруте.
 *
 * Здесь только приманка: обложка, название и суть одной строкой. Подробности
 * — на странице проекта, иначе точка маршрута превращается в простыню, через
 * которую надо прокручивать, а маршрут этого не умеет.
 *
 * Цвет статуса берётся классом, а не инлайн-стилем: инлайн `style` переписывает
 * Dark Reader ещё до того, как React сверит разметку, и гидратация падает.
 */
const STATUS: Record<Project["status"], { dot: string; text: string }> = {
  "в работе": { dot: "bg-[var(--st-work)]", text: "text-[var(--st-work)]" },
  "личный проект": { dot: "bg-[var(--st-personal)]", text: "text-[var(--st-personal)]" },
  "разбор и архитектура": { dot: "bg-[var(--st-research)]", text: "text-[var(--st-research)]" },
  запущен: { dot: "bg-[var(--st-live)]", text: "text-[var(--st-live)]" },
};

export function ProjectCard({ project }: { project: Project }) {
  const s = STATUS[project.status];
  // Обложка оживает только под рукой или в фокусе — сама по себе не крутится.
  const [active, setActive] = useState(false);

  return (
    <article data-accent={project.accent}>
      {/* pointer-events включает сама ссылка: слой карточек лежит поверх
          канваса и обязан пропускать события к сцене. */}
      <Link
        href={`/work/${project.slug}/`}
        className="pointer-events-auto group block border-t border-[var(--line)] pt-5"
        onPointerEnter={() => setActive(true)}
        onPointerLeave={() => setActive(false)}
        onFocus={() => setActive(true)}
        onBlur={() => setActive(false)}
      >
        <div className="mb-4 flex items-center gap-2.5">
          <span className={`h-[5px] w-[5px] shrink-0 rounded-full ${s.dot}`} aria-hidden />
          <span className={`eyebrow ${s.text}`}>{project.status}</span>
          <span className="eyebrow ml-auto text-[var(--sand-faint)]">{project.year}</span>
        </div>

        <Cover
          video={project.video}
          shots={project.shots}
          alt={`${project.title}: как выглядит`}
          active={active}
        />

        <h3 className="font-display mt-5 text-[clamp(24px,3vw,38px)] font-normal leading-[1.05] tracking-[-0.01em]">
          {project.title}
        </h3>

        {project.summary ? (
          <p className="mt-2 max-w-[46ch] text-[13.5px] font-extralight leading-[1.7] text-[var(--sand-dim)]">
            {project.summary}
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap items-baseline gap-x-6 gap-y-1 border-t border-[var(--line)] pt-3">
          <span className="eyebrow text-[var(--sand-faint)]">{project.role}</span>
          <span className="eyebrow text-[var(--sand-faint)]">{project.stack.slice(0, 4).join(" · ")}</span>
          <span className="eyebrow ml-auto text-[var(--sand-dim)] transition-colors duration-500 ease-[var(--ease-out-deep)] group-hover:text-[var(--accent)] group-focus-visible:text-[var(--accent)]">
            смотреть проект
          </span>
        </div>
      </Link>
    </article>
  );
}
