"use client";

import Image from "next/image";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

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
}: {
  video?: string;
  shots: string[];
  alt: string;
  active: boolean;
}) {
  const reduced = useReducedMotion();
  const [frame, setFrame] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);

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
    <div className="relative aspect-[3/2] w-full overflow-hidden bg-[var(--color-surface)]">
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
          <Image
            key={src}
            src={src}
            alt={n === 0 ? alt : ""}
            fill
            sizes="(max-width: 1024px) 100vw, 50vw"
            className={`object-cover transition-opacity duration-[1100ms] ease-[var(--ease-out-deep)] ${
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
