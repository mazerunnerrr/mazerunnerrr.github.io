import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getProjects, getSite } from "@/content";
import { ProjectBody } from "@/components/ProjectBody";

/* Адреса страниц известны на сборке — их ровно столько, сколько файлов
   в content/projects. Ничего динамического на Pages появиться не может. */
export const dynamicParams = false;

export function generateStaticParams() {
  return getProjects().map((p) => ({ slug: p.slug }));
}

const find = (slug: string) => getProjects().find((p) => p.slug === slug);


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
        к маршруту
      </Link>

      <ProjectBody
        project={project}
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
              alt={`${project.title}: главный экран`}
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
        к маршруту
      </Link>
    </main>
  );
}
