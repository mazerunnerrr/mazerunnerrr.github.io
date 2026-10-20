import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getProjects, getSite } from "@/content";
import { ProjectPage } from "@/components/ProjectPage";
import { LANGS } from "@/lib/i18n";

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
  const description = project.summary ?? project.task?.slice(0, 160);
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
      ...(project.shots[0] ? { images: [project.shots[0].image] } : {}),
    },
  };
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!find(slug)) notFound();
  const project = Object.fromEntries(
    LANGS.map((lang) => [lang, getProjects(lang).find((p) => p.slug === slug)!])
  ) as React.ComponentProps<typeof ProjectPage>["project"];
  return <ProjectPage project={project} />;
}
