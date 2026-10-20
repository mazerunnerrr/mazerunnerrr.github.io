"use client";

import { useEffect, useRef, useState } from "react";
import type { Project } from "@/content";
import { Cover } from "@/components/Cover";
import { Flip } from "@/components/Flip";
import { STATUS } from "@/lib/status";
import { STATUS_LABEL, UI, type Lang } from "@/lib/i18n";

/**
 * Комната проекта — один экран, как у Active Theory (Илья, 2026-10-20):
 * крупный кадр с видео или скриншотами и под ним сжатый текст — статус,
 * название, суть, цифры, ссылки. Весь кейс главами — на странице проекта
 * («полный кейс»). Главы прямо в комнате пробовали: листание кадров выбивалось
 * из характера аллеи. Колесо в комнате только выводит наверх, на аллею.
 */

/** Каждый кадр: куда наклонить кадр за рукой, −1..1 от центра окна. */
export type RoomUpdate = (tiltX: number, tiltY: number) => void;

export function ProjectRoom({
  project: p,
  lang,
  open,
  bind,
}: {
  project: Project;
  lang: Lang;
  /** Комната открыта — её ссылки ловят нажатия, обложка играет. */
  open: boolean;
  /** Отдаёт наружу обновление на кадр — его зовёт кадровый обработчик главной. */
  bind: (update: RoomUpdate | null) => void;
}) {
  const t = UI[lang];
  const st = STATUS[p.status];
  const frame = useRef<HTMLDivElement>(null);
  /* Картинки комнаты грузятся, только когда в неё впервые вошли: все комнаты
     смонтированы сразу, и lazy у прозрачного кадра посреди экрана ничего
     не откладывал — главная тянула скриншоты всех проектов разом. */
  const [seen, setSeen] = useState(open);
  if (open && !seen) setSeen(true);

  useEffect(() => {
    bind((tx, ty) => {
      const el = frame.current;
      if (el) el.style.transform = `rotateY(${tx * 5}deg) rotateX(${-ty * 3.5}deg)`;
    });
    return () => bind(null);
  }, [bind]);

  const link =
    "instrument pointer-events-auto text-[var(--sand-dim)] underline decoration-[var(--line)] underline-offset-[5px] transition-colors duration-500 ease-[var(--ease-out-deep)] hover:text-[var(--color-sand)] hover:decoration-current";

  return (
    <>
      {/* Цвет проекта — свечение из глубины комнаты. */}
      <div className="room-tint absolute inset-0" aria-hidden />

      <span className="instrument pointer-events-none absolute left-1/2 top-[calc(var(--gutter)+40px)] -translate-x-1/2 whitespace-nowrap text-[var(--sand-faint)]">
        <Flip text={t.scrollBack} />
      </span>

      <div className="absolute left-1/2 top-[calc(var(--gutter)+84px)] w-[min(60vw,calc((100vh-400px)*1.6),980px)] -translate-x-1/2">
        <div className="[perspective:1600px]" aria-hidden>
          <div ref={frame} className="room-frame relative aspect-[16/10] w-full">
            {seen && (p.video || p.shots.length) ? (
              <Cover video={p.video} shots={p.shots.map((s) => s.image)} alt="" active={open} fill />
            ) : null}
          </div>
        </div>

        <div className="mt-6 flex items-start justify-between gap-x-10 gap-y-5">
          <div className="min-w-0">
            <span className="flex items-center gap-2.5">
              <span className={`h-[5px] w-[5px] shrink-0 rounded-full ${st.dot}`} aria-hidden />
              <span className={`instrument ${st.text}`}>
                <Flip text={`${STATUS_LABEL[lang][p.status]} · ${p.year} / ${p.role}`} />
              </span>
            </span>
            <h2 className="font-display mt-2.5 text-[clamp(32px,3.2vw,46px)] font-light leading-[1.02] tracking-[-0.02em]">
              {p.title}
            </h2>
            {p.summary ? <p className="room-text mt-2.5">{p.summary}</p> : null}
            <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
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

          {p.facts.length ? (
            <ul className="flex shrink-0 gap-x-7">
              {p.facts.map((f, i) => (
                <li key={i} className="max-w-[14ch]">
                  <span className="font-display block whitespace-nowrap text-[clamp(26px,2.4vw,36px)] font-light leading-none text-[var(--accent)]">
                    {f.value}
                  </span>
                  <span className="mt-2 block text-[12px] font-extralight leading-[1.45] text-[var(--sand-dim)]">{f.label}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </>
  );
}
