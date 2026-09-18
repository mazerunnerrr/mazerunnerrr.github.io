import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getProjects, getSite, type Project } from "@/content";

/* Адреса страниц известны на сборке — их ровно столько, сколько файлов
   в content/projects. Ничего динамического на Pages появиться не может. */
export const dynamicParams = false;

export function generateStaticParams() {
  return getProjects().map((p) => ({ slug: p.slug }));
}

const find = (slug: string) => getProjects().find((p) => p.slug === slug);

const STATUS: Record<Project["status"], { dot: string; text: string }> = {
  "в работе": { dot: "bg-[var(--st-work)]", text: "text-[var(--st-work)]" },
  "личный проект": { dot: "bg-[var(--st-personal)]", text: "text-[var(--st-personal)]" },
  "разбор и архитектура": { dot: "bg-[var(--st-research)]", text: "text-[var(--st-research)]" },
  запущен: { dot: "bg-[var(--st-live)]", text: "text-[var(--st-live)]" },
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const project = find((await params).slug);
  const site = getSite();
  if (!project) return { title: site.alias };
  const description = project.summary ?? project.lead.slice(0, 160);
  const url = `/work/${project.slug}/`;
  /* Канонический адрес и превью задаём здесь же: из корневого layout сюда
     протекали адрес главной и её картинка, и ссылка на проект в мессенджере
     показывала первый экран сайта вместо самого проекта. */
  return {
    title: `${project.title} — ${site.alias}`,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: "article",
      url,
      title: `${project.title} — ${site.alias}`,
      description,
      ...(project.shots[0] ? { images: [project.shots[0]] } : {}),
    },
  };
}

export default async function ProjectPage({ params }: { params: Promise<{ slug: string }> }) {
  const project = find((await params).slug);
  if (!project) notFound();

  const s = STATUS[project.status];
  const [hero, ...rest] = project.shots;

  return (
    <main
      data-accent={project.accent}
      className="mx-auto w-full max-w-[1100px] px-[clamp(18px,5vw,64px)] pb-[clamp(60px,12vh,140px)] pt-[clamp(22px,4vh,48px)]"
    >
      <Link
        href="/"
        className="eyebrow text-[var(--sand-faint)] transition-colors duration-500 ease-[var(--ease-out-deep)] hover:text-[var(--color-sand)]"
      >
        к маршруту
      </Link>

      <header className="mt-[clamp(40px,10vh,110px)] border-b border-[var(--line)] pb-[clamp(22px,4vh,42px)]">
        <div className="flex items-center gap-2.5">
          <span className={`h-[5px] w-[5px] shrink-0 rounded-full ${s.dot}`} aria-hidden />
          <span className={`eyebrow ${s.text}`}>{project.status}</span>
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
          {project.year} · {project.role}
        </p>
      </header>

      {/* Первый экран проекта — картинка, а не текст: сначала видно, о чём речь. */}
      {project.video ? (
        <video
          src={project.video}
          controls
          playsInline
          preload="metadata"
          className="mt-[clamp(26px,5vh,54px)] w-full border border-[var(--line)]"
        />
      ) : hero ? (
        <Image
          src={hero}
          alt={`${project.title}: главный экран`}
          width={1600}
          height={1000}
          priority
          className="mt-[clamp(26px,5vh,54px)] h-auto w-full border border-[var(--line)]"
        />
      ) : null}

      {project.facts.length > 0 ? (
        <ul className="mt-[clamp(30px,5vh,56px)] grid gap-x-10 gap-y-7 sm:grid-cols-3">
          {project.facts.map((f) => (
            <li key={f.label}>
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

      <p className="mt-[clamp(30px,5vh,56px)] max-w-[62ch] text-[clamp(14px,1.6vw,17px)] font-extralight leading-[1.8] text-[var(--sand-dim)]">
        {project.lead}
      </p>

      <h2 className="font-display mt-[clamp(36px,6vh,72px)] text-[clamp(22px,2.6vw,32px)] font-light leading-tight">
        Что сделал
      </h2>
      <ul className="mt-5 space-y-3">
        {project.did.map((item) => (
          <li
            key={item}
            className="relative max-w-[66ch] pl-5 text-[13.5px] font-extralight leading-[1.75] text-[var(--sand-dim)]"
          >
            {/* Волосяная черта вместо галочки: галочки в списках — примета шаблона. */}
            <span className="absolute left-0 top-[11px] h-px w-[9px] bg-[var(--accent)] opacity-70" aria-hidden />
            {item}
          </li>
        ))}
      </ul>

      <p className="mt-[clamp(28px,4vh,44px)] max-w-[62ch] border-t border-[var(--line)] pt-4 text-[13px] font-extralight leading-[1.7] text-[var(--sand-dim)]">
        {project.stack.join(" · ")}
      </p>

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
        <div className="mt-[clamp(36px,6vh,72px)] space-y-[clamp(14px,2vh,22px)]">
          {rest.map((src, i) => (
            <Image
              key={src}
              src={src}
              alt={`${project.title}: экран ${i + 2}`}
              width={1600}
              height={1000}
              className="h-auto w-full border border-[var(--line)]"
            />
          ))}
        </div>
      ) : null}

      <Link
        href="/"
        className="eyebrow mt-[clamp(40px,7vh,90px)] inline-block border-t border-[var(--line)] pt-5 text-[var(--sand-faint)] transition-colors duration-500 ease-[var(--ease-out-deep)] hover:text-[var(--color-sand)]"
      >
        к маршруту
      </Link>
    </main>
  );
}
