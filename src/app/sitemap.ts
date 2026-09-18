import type { MetadataRoute } from "next";
import { SITE_URL, getProjects } from "@/content";

/* Карта собирается из тех же файлов, что и сам сайт: добавил проект
   в админке — он появился в карте, отдельной правки не нужно. */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${SITE_URL}/`, priority: 1 },
    ...getProjects().map((p) => ({ url: `${SITE_URL}/work/${p.slug}/`, priority: 0.8 })),
  ];
}

/* При статическом экспорте маршруты мета обязаны объявить себя статическими
   явно, иначе сборка падает: Next считает их динамическими по умолчанию. */
export const dynamic = "force-static";
