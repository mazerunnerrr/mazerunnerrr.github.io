import { useEffect, useState } from "react";

/** Сколько стоит одно фото, пока не сменится следующим. */
const SLIDE = 7000;

/** Фото фоном «обо мне» (Илья, 2026-11-12: «чисто для вайба»): притушены под
    вуалью комнаты, текст поверх. Несколько — сменяются наплывом, пока комната
    открыта. Обычный `<img>`: `next/image` пишет цвет в `style`. */
export function AboutPhotos({ photos, open }: { photos: string[]; open: boolean }) {
  const [at, setAt] = useState(0);
  useEffect(() => {
    if (!open || photos.length < 2) return;
    const id = setInterval(() => setAt((i) => (i + 1) % photos.length), SLIDE);
    return () => clearInterval(id);
  }, [open, photos.length]);
  if (photos.length === 0) return null;
  return (
    <div className="about-photos absolute inset-0 overflow-hidden" aria-hidden>
      {photos.map((src, i) => (
        // eslint-disable-next-line @next/next/no-img-element -- см. комментарий над функцией
        <img
          key={src}
          src={src}
          alt=""
          decoding="async"
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-[2400ms] ease-[var(--ease-out-deep)] ${i === at % photos.length ? "opacity-100" : "opacity-0"}`}
        />
      ))}
    </div>
  );
}
