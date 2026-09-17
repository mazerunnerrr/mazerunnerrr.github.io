import type { Metadata, Viewport } from "next";
import { Cormorant, Manrope } from "next/font/google";
import { getSite } from "@/content";
import "./globals.css";

/* Дисплейный сериф + чистый гротеск, оба с кириллицей — это не опция.
   Ни Inter, ни Geist, ни Space Grotesk: они выдают шаблон с первого экрана. */
const cormorant = Cormorant({
  variable: "--font-cormorant",
  subsets: ["cyrillic", "latin"],
  weight: ["300", "400", "500"],
  style: ["normal", "italic"],
  display: "swap",
});

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["cyrillic", "latin"],
  weight: ["200", "300", "400", "500"],
  display: "swap",
});

// Функцией, а не константой: в дев-режиме правка site.json видна по перезагрузке.
export function generateMetadata(): Metadata {
  const site = getSite();
  return { title: site.alias, description: `${site.thesis}.` };
}

export const viewport: Viewport = {
  themeColor: "#0a0908",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    /* Переменные шрифтов висят на <html>, а не на <body>: Tailwind v4
       вычисляет @theme в контексте :root, и переменная, объявленная ниже
       по дереву, там не видна — --font-display молча разворачивается
       в системный гротеск. */
    /* Расширения (Dark Reader и подобные) дописывают свои атрибуты
       в <html> раньше, чем React успевает загрузиться, и гидратация
       падает на чужой разметке: `data-darkreader-proxy-injected`.
       Глушим расхождение ровно на корневом теге — глубже оно
       по-прежнему видно. */
    <html
      lang="ru"
      className={`${cormorant.variable} ${manrope.variable}`}
      suppressHydrationWarning
    >
      <body>
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
