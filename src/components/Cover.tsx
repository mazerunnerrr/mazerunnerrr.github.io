"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

/* Обычный <img>, а не next/image: тот вписывает в атрибут style
   `color: transparent` (а с fill — ещё и позицию), Dark Reader переписывает
   такой атрибут до гидратации, и React падает на несовпадении разметки
   (2026-10-18). Оптимизации картинок при статической выкладке всё равно
   нет — images.unoptimized. */

const QUERY = "(prefers-reduced-motion: reduce)";

const subscribe = (notify: () => void) => {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", notify);
  return () => mq.removeEventListener("change", notify);
};

/* Через useSyncExternalStore, а не через состояние в эффекте: значение
   спрашивается у браузера в момент рендера, на сервере честно отдаётся
   «движение разрешено», и лишнего перерисовывания нет. */
export const useReducedMotion = () =>
  useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false
  );

/**
 * Обложка проекта: видео, если оно загружено, иначе слайд-шоу скриншотов.
 *
 * Ничего не движется само по себе: кадры сменяются, только пока карточка
 * под курсором или в фокусе (`active`) — движение отвечает на действие,
 * а не идёт фоном. При «уменьшить движение» остаётся первый кадр.
 */
export function Cover({
  video,
  shots,
  alt,
  active,
  fill = false,
}: {
  video?: string;
  shots: string[];
  alt: string;
  active: boolean;
  /** Заполнить рамку целиком: в кадре комнаты пропорции задаёт сам кадр. */
  fill?: boolean;
}) {
  const reduced = useReducedMotion();
  const [frame, setFrame] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  /* Кадры декодируются сразу, как обложка появилась в DOM, а не в миг
     первого показа: в комнате проекта слой проявляется в конце погружения,
     и декодирование трёх скриншотов в этот миг останавливало картинку
     на пятую долю секунды — погружение читалось оборванным. */
  useEffect(() => {
    boxRef.current?.querySelectorAll("img").forEach((img) => void img.decode().catch(() => {}));
  }, [shots]);

  useEffect(() => {
    if (!active || reduced || shots.length < 2) return;
    const id = window.setInterval(() => setFrame((n) => (n + 1) % shots.length), 2600);
    return () => window.clearInterval(id);
  }, [active, reduced, shots.length]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (active && !reduced) void el.play().catch(() => {});
    else el.pause();
  }, [active, reduced]);

  if (!video && !shots.length) return null;

  return (
    <div ref={boxRef} className={`${fill ? "absolute inset-0" : "relative aspect-[3/2] w-full"} overflow-hidden bg-[var(--color-surface)]`}>
      {video ? (
        <video
          ref={videoRef}
          src={video}
          muted
          loop
          playsInline
          preload="metadata"
          className="h-full w-full object-cover"
        />
      ) : (
        shots.map((src, n) => (
          // eslint-disable-next-line @next/next/no-img-element -- см. комментарий в начале файла
          <img
            key={src}
            src={src}
            alt={n === 0 ? alt : ""}
            loading="lazy"
            decoding="async"
            className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-[1100ms] ease-[var(--ease-out-deep)] ${
              n === frame ? "opacity-100" : "opacity-0"
            }`}
          />
        ))
      )}
      {/* Волосяная рамка вместо тени: тени в этом дизайне не используются. */}
      <div className="pointer-events-none absolute inset-0 shadow-[inset_0_0_0_1px_var(--line)]" />
    </div>
  );
}
