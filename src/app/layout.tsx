import type { Metadata, Viewport } from "next";
import { preload } from "react-dom";
import { SITE_URL, getSite } from "@/content";
import { ENTER_KEY } from "@/lib/ambience";
import "./fonts.css";
import "./globals.css";

/* Дисплейный сериф Cormorant + чистый гротеск Manrope, оба с кириллицей — это
   не опция. Ни Inter, ни Geist, ни Space Grotesk: они выдают шаблон с первого
   экрана. Приборы — моноширинным IBM Plex Mono: живые показания меняются каждый
   кадр, и в пропорциональном шрифте цифры прыгали бы по ширине.

   Шрифты — файлами из репозитория (fonts.css, public/fonts): next/font/google
   на GitHub через раз ронял сборку. Заранее грузим то же, что грузил он, —
   латиницу и кириллицу каждого начертания. */
const FONT_PRELOAD = [
  "cormorant-normal-latin",
  "cormorant-normal-cyrillic",
  "cormorant-italic-latin",
  "cormorant-italic-cyrillic",
  "manrope-normal-latin",
  "manrope-normal-cyrillic",
  "plex-mono-normal-latin-400",
  "plex-mono-normal-cyrillic-400",
  "plex-mono-normal-latin-500",
  "plex-mono-normal-cyrillic-500",
];

/* Функцией, а не константой: в дев-режиме правка site.json видна по перезагрузке.

   Картинку превью и значки Next подхватывает сам — по именам файлов рядом:
   `opengraph-image.png`, `icon.svg`, `apple-icon.png`. Абсолютные адреса для них
   собираются из `metadataBase`, без него в разметку попадут относительные пути,
   и Telegram с поиском картинку не увидят. */
export function generateMetadata(): Metadata {
  const site = getSite();
  const description = `${site.thesis}.`;
  return {
    metadataBase: new URL(SITE_URL),
    title: site.alias,
    description,
    alternates: { canonical: "/" },
    openGraph: {
      type: "website",
      locale: "en_US",
      alternateLocale: ["ru_RU"],
      url: "/",
      siteName: site.alias,
      title: site.alias,
      description,
    },
    twitter: { card: "summary_large_image", title: site.alias, description },
    /* Сайт и так тёмный. Dark Reader, не видя этой метки, дописывал свои
       атрибуты к линиям волны звука до гидратации, и React ругался на
       несовпадение разметки (Илья, 2026-10-20). Метку он соблюдает сам. */
    other: { "darkreader-lock": "true" },
  };
}

export const viewport: Viewport = {
  themeColor: "#0b1633",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  for (const f of FONT_PRELOAD) preload(`/fonts/${f}.woff2`, { as: "font", type: "font/woff2", crossOrigin: "" });
  return (
    /* Расширения (Dark Reader и подобные) дописывают свои атрибуты
       в <html> раньше, чем React успевает загрузиться, и гидратация
       падает на чужой разметке: `data-darkreader-proxy-injected`.
       Глушим расхождение ровно на корневом теге — глубже оно
       по-прежнему видно. */
    <html lang="en" suppressHydrationWarning>
      <body>
        {/* Первый визит — экран входа: кольцо заставки ждёт нажатия, и загрузка
            звучит (Илья, 2026-11-10). Метка ставится до первой отрисовки: иначе
            вернувшийся на миг видел бы «старт», а новичок — счётчик. Хранилище
            закрыто — считаем визит первым. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(!localStorage.getItem("${ENTER_KEY}"))document.documentElement.setAttribute("data-first","")}catch(_){document.documentElement.setAttribute("data-first","")}`,
          }}
        />
        {/*
          Гасит ошибки, прилетевшие из расширений браузера: MetaMask и
          подобные валятся собственным кодом на любой странице, а дев-оверлей
          Next считает каждую такую ошибку своей и закрывает ею экран.

          Почему инлайн-скриптом, а не компонентом с useEffect: слушатели
          вызываются в порядке регистрации, и рантайм Next подписывается
          раньше любого эффекта — событие уже у него. Обычный тег в разметке
          выполняется при парсинге HTML, до отложенных скриптов Next.
          `beforeInteractive` из next/script здесь не годится вовсе: в App
          Router он откладывается в очередь __next_s и стартует уже после
          загрузки рантайма.

          Гасим строго по источнику и только на локальной машине: своя
          ошибка покажется как обычно.
        */}
        <script
          dangerouslySetInnerHTML={{
            // Ни регулярок, ни обратных слэшей: в шаблонной строке `\/`
            // схлопывается в `/`, из-за чего литерал превращался
            // в `-extension:///`, две косые начинали комментарий, и весь
            // остаток скрипта молча отваливался с «Unexpected end of input».
            __html: [
              "(function(){",
              'var h=location.hostname;',
              'if(h!=="localhost"&&h!=="127.0.0.1")return;',
              'var M="-extension:";',
              "function ext(v){try{",
              'if(v&&typeof v==="object")',
              'return String(v.stack||"").indexOf(M)>=0||String(v.message||"").indexOf(M)>=0;',
              'return String(v||"").indexOf(M)>=0;',
              "}catch(_){return false}}",
              'window.addEventListener("unhandledrejection",function(e){',
              "if(ext(e.reason)){e.stopImmediatePropagation();e.preventDefault()}",
              "},true);",
              'window.addEventListener("error",function(e){',
              'if(String(e.filename||"").indexOf(M)>=0||ext(e.error)){',
              "e.stopImmediatePropagation();e.preventDefault()}",
              "},true);",
              "})();",
            ].join(""),
          }}
        />
        {children}
        <div className="grain-overlay" />
      </body>
    </html>
  );
}
