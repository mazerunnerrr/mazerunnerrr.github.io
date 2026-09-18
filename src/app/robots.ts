import type { MetadataRoute } from "next";
import { SITE_URL } from "@/content";

/* Админку из поиска убираем: она не часть сайта и в выдаче только мешает. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: "/admin/" },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}

/* При статическом экспорте маршруты мета обязаны объявить себя статическими
   явно, иначе сборка падает: Next считает их динамическими по умолчанию. */
export const dynamic = "force-static";
