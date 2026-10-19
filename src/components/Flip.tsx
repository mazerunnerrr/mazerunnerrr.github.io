"use client";

import { useEffect, useRef, useState } from "react";
import { FLIP_SHOW, scramble } from "@/lib/scramble";

/**
 * Мелкая надпись, которая перещёлкивается: при появлении страницы, при смене
 * текста (язык, номер точки) и по `flipIn` — когда её слой проявился или на
 * неё навели. Текст в DOM ведёт `scramble`, а не React: React рисует только
 * первый кадр и дальше в надпись не лезет, иначе они затирали бы друг друга.
 */
export function Flip({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [first] = useState(text);
  useEffect(() => {
    if (ref.current) scramble(ref.current, text);
  }, [text]);
  return (
    <span ref={ref} data-flip>
      {first}
    </span>
  );
}

/** Перещёлкнуть все надписи внутри элемента: слой проявился или на него навели. */
export const flipIn = (root: Element | null, dur = FLIP_SHOW) => {
  root?.querySelectorAll<HTMLElement>("[data-flip]").forEach((el) => scramble(el, undefined, dur));
};
