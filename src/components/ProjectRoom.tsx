"use client";

import { useEffect, useRef, useState } from "react";
import type { Project } from "@/content";
import { Cover } from "@/components/Cover";
import { Flip } from "@/components/Flip";
import { STATUS } from "@/lib/status";
import { STATUS_LABEL, UI, type Lang } from "@/lib/i18n";
import type { RoomLayout } from "@/lib/roomSurface";

/**
 * Комната проекта — как у Active Theory (разобрано по записи 2026-10-21):
 * экран проекта крупно по центру, подпись — мелко, моноширинным, в левом
 * нижнем углу: название, год / роль / статус цветом проекта, суть, ссылки.
 * Подпись стоит на месте, экран наклоняется к руке. Весь кейс главами
 * и цифры — на странице проекта («полный кейс»): «обычному посетителю цифры
 * ни к чему» (Илья). Закрывает её колесо в любую сторону, Esc и «закрыть»;
 * на телефоне палец её не закрывает — им гладят точки (Илья, 2026-11-05).
 *
 * Экран при WebGL рисует сцена (`roomSurface.ts`): рука ведёт по нему каплю,
 * его свет ложится на стены. Вёрстка экран только меряет и прячет
 * (`:root[data-gl]` в CSS); без WebGL показывает сама.
 */

/** Каждый кадр: куда наклонить экран за рукой, −1..1 от центра окна. */
export type RoomUpdate = (tiltX: number, tiltY: number) => void;

export function ProjectRoom({
  project: p,
  lang,
  open,
  bind,
  layout,
}: {
  project: Project;
  lang: Lang;
  /** Комната открыта — её ссылки ловят нажатия, обложка играет. */
  open: boolean;
  /** Отдаёт наружу обновление на кадр — его зовёт кадровый обработчик главной. */
  bind: (update: RoomUpdate | null) => void;
  /** Где лежит экран — сцене, которая его рисует. */
  layout: (l: RoomLayout | null) => void;
}) {
  const t = UI[lang];
  const st = STATUS[p.status];
  const frame = useRef<HTMLDivElement>(null);
  const frameBox = useRef<HTMLDivElement>(null);
  const caption = useRef<HTMLDivElement>(null);
  /* Картинки комнаты грузятся, только когда в неё впервые вошли: все комнаты
     смонтированы сразу, и lazy у прозрачного кадра посреди экрана ничего
     не откладывал — главная тянула скриншоты всех проектов разом. */
  const [seen, setSeen] = useState(open);
  if (open && !seen) setSeen(true);
  /* Экран — в пропорциях своего кадра: ролик без чёрных полос бывает шире 16:10,
     и в рамке 16:10 он обрезался бы по краям (Илья, 2026-11-05: «подтянуть экран
     под видео»). Пропорции — у постера или первого кадра; пока не узнали — 16:10. */
  const [ar, setAr] = useState(1.6);
  /** Экран рисует сцена (`:root[data-gl]`). До первого входа не читается — на сервере документа нет. */
  const gl = seen && typeof document !== "undefined" && document.documentElement.hasAttribute("data-gl");
  const arSrc = p.poster || p.shots[0]?.image;
  useEffect(() => {
    if (!seen || !arSrc) return;
    const img = new Image();
    img.onload = () => {
      if (img.naturalHeight) setAr(img.naturalWidth / img.naturalHeight);
    };
    img.src = arSrc;
  }, [seen, arSrc]);

  useEffect(() => {
    bind((tx, ty) => {
      const el = frame.current;
      // Лицом к руке — как экран в сцене (roomSurface.ts).
      if (el) el.style.transform = `rotateY(${-tx * 4.5}deg) rotateX(${ty * 3}deg)`;
    });
    return () => bind(null);
  }, [bind]);

  // Мерки экрана для сцены: при входе и при смене размера.
  useEffect(() => {
    const box = frameBox.current;
    if (!seen || !box) return;
    let raf = 0;
    const measure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const f = box.getBoundingClientRect();
        layout({ frame: { x: f.left, y: f.top, w: f.width, h: f.height } });
      });
    };
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    // На телефоне экран стоит посередине над подписью: выросла подпись — он сдвинулся.
    if (caption.current) ro.observe(caption.current);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [seen, layout]);

  const link =
    "instrument pointer-events-auto text-[var(--color-sand)] underline decoration-[var(--line)] underline-offset-[5px] transition-colors duration-500 ease-[var(--ease-out-deep)] hover:decoration-current";

  return (
    <>
      {/* Цвет проекта — свечение из глубины комнаты. При WebGL его даёт сцена. */}
      <div className="room-tint absolute inset-0" aria-hidden />

      {/* На компьютере комнату закрывает колесо — подсказка об этом; на телефоне
          прокрутка не закрывает, там только кнопка «закрыть» справа сверху. */}
      <span className="instrument pointer-events-none absolute left-1/2 top-[calc(var(--gutter)+40px)] -translate-x-1/2 whitespace-nowrap text-[var(--sand-faint)] max-md:hidden">
        <Flip text={t.scrollClose} />
      </span>

      {/* Экран проекта — крупно, по центру. На телефоне комната — столбиком, как
          у Active Theory: под приборами экран во всю ширину между полями, ровно
          посередине свободного места, внизу подпись (Илья, 2026-11-05: «не слишком
          высоко, но и не прятаться за текстом»). На десктопе обёртки растворяются
          (`md:contents`), и всё стоит как прежде. */}
      <div className="absolute inset-x-[var(--gutter)] bottom-[var(--gutter)] top-[calc(var(--gutter)+64px)] flex flex-col md:contents">
        <div className="flex min-h-0 flex-1 items-center py-4 md:contents">
          <div
            ref={frameBox}
            style={{ "--ar": ar } as React.CSSProperties}
            className="w-full [perspective:1600px] md:absolute md:left-1/2 md:top-[47%] md:w-[min(60vw,calc((100vh-300px)*var(--ar)),1100px)] md:-translate-x-1/2 md:-translate-y-1/2"
            aria-hidden
          >
            <div ref={frame} className="room-frame room-gl-media relative aspect-[var(--ar)] w-full">
              {/* При WebGL экран рисует сцена со своим видео — вёрстке своё не нужно:
                  лишний плеер и постер грузились и декодировались на входе в комнату. */}
              {seen && !gl && (p.video || p.shots.length) ? (
                <Cover video={p.video} poster={p.poster} shots={p.shots.map((s) => s.image)} alt="" active={open} fill />
              ) : null}
            </div>
          </div>
        </div>

        {/* Подпись — мелко, в левом нижнем углу, в тон кадру (`room-ink`, цвет пишет
            главная по ролику). Шаг строк ровный, как у Active Theory. */}
        <div
          ref={caption}
          data-wave
          className="room-caption md:absolute md:bottom-[var(--gutter)] md:left-[var(--gutter)] md:w-[min(380px,calc(100vw-2*var(--gutter)))]"
        >
          <h2 className="instrument room-ink">
            {/* Название играет под рукой, как кнопки (attachFlipHand). */}
            <span data-hand className="pointer-events-auto">
              <Flip text={p.title} />
            </span>
          </h2>
          <p className={`instrument mt-2 md:mt-1.5 ${st.text}`}>
            <Flip text={`${p.year} / ${p.role} / ${STATUS_LABEL[lang][p.status]}`} />
          </p>
          {p.summary ? (
            <p className="instrument room-ink mt-2 md:mt-3">
              <Flip text={p.summary} />
            </p>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5 md:mt-3.5">
            <a
              href={p.caseUrl ?? `/work/${p.slug}/`}
              {...(p.caseUrl ? { target: "_blank", rel: "noreferrer noopener" } : {})}
              className={link}
            >
              <Flip text={`${t.fullCase} ↗`} />
            </a>
            {p.links.map((l, i) => (
              <a key={i} href={l.url} target="_blank" rel="noreferrer noopener" className={link}>
                <Flip text={`${l.label} ↗`} />
              </a>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
