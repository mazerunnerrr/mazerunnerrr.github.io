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
 * ни к чему» (Илья). Комнату в один экран закрывает прокрутка в любую сторону.
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
  /* Картинки комнаты грузятся, только когда в неё впервые вошли: все комнаты
     смонтированы сразу, и lazy у прозрачного кадра посреди экрана ничего
     не откладывал — главная тянула скриншоты всех проектов разом. */
  const [seen, setSeen] = useState(open);
  if (open && !seen) setSeen(true);

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
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [seen, layout]);

  const link =
    "instrument pointer-events-auto text-[var(--sand-dim)] underline decoration-[var(--line)] underline-offset-[5px] transition-colors duration-500 ease-[var(--ease-out-deep)] hover:text-[var(--color-sand)] hover:decoration-current";

  return (
    <>
      {/* Цвет проекта — свечение из глубины комнаты. При WebGL его даёт сцена. */}
      <div className="room-tint absolute inset-0" aria-hidden />

      <span className="instrument pointer-events-none absolute left-1/2 top-[calc(var(--gutter)+40px)] -translate-x-1/2 whitespace-nowrap text-[var(--sand-faint)]">
        <Flip text={t.scrollClose} />
      </span>

      {/* Экран проекта — крупно, по центру. */}
      <div
        ref={frameBox}
        className="absolute left-1/2 top-[47%] w-[min(60vw,calc((100vh-300px)*1.6),1100px)] -translate-x-1/2 -translate-y-1/2 [perspective:1600px]"
        aria-hidden
      >
        <div ref={frame} className="room-frame room-gl-media relative aspect-[16/10] w-full">
          {seen && (p.video || p.shots.length) ? (
            <Cover video={p.video} poster={p.poster} shots={p.shots.map((s) => s.image)} alt="" active={open} fill />
          ) : null}
        </div>
      </div>

      {/* Подпись — мелко, в левом нижнем углу. */}
      <div className="absolute bottom-[var(--gutter)] left-[var(--gutter)] w-[min(380px,calc(100vw-2*var(--gutter)))]">
        <h2 className="instrument text-[var(--color-sand)]">
          {/* Название играет под рукой, как кнопки (attachFlipHand). */}
          <span data-hand className="pointer-events-auto">
            <Flip text={p.title} />
          </span>
        </h2>
        <p className={`instrument mt-1.5 ${st.text}`}>
          <Flip text={`${p.year} / ${p.role} / ${STATUS_LABEL[lang][p.status]}`} />
        </p>
        {p.summary ? (
          <p className="instrument mt-3 text-[var(--sand-dim)]">
            <Flip text={p.summary} />
          </p>
        ) : null}
        <div className="mt-3.5 flex flex-wrap gap-x-5 gap-y-1.5">
          <a href={`/work/${p.slug}/`} className={link}>
            <Flip text={`${t.fullCase} ↗`} />
          </a>
          {p.links.map((l, i) => (
            <a key={i} href={l.url} target="_blank" rel="noreferrer noopener" className={link}>
              <Flip text={`${l.label} ↗`} />
            </a>
          ))}
        </div>
      </div>
    </>
  );
}
