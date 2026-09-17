import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Значок дев-сборки в углу лезет в кадр на видеотурах.
  devIndicators: false,
  // Сайт собирается в готовые файлы: GitHub Pages ничего не выполняет,
  // он только раздаёт HTML, CSS и JS. Контент читается с диска при сборке.
  output: "export",
  // Адрес каждой страницы заканчивается слэшем, и страница становится папкой
  // с index.html. Так её одинаково отдают и Pages, и любой статический сервер;
  // без этого страницы проектов открывались бы только как /work/имя.html.
  trailingSlash: true,
  // Картинки отдаются как есть: оптимизатор Next — серверная работа,
  // а на Pages сервера нет. Сжимаем их сами при загрузке в админку.
  images: { unoptimized: true },
};

export default nextConfig;
