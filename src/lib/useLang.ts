import { useSyncExternalStore } from "react";
import type { Lang } from "@/lib/i18n";

/* Выбор языка помнит браузер. Статическая страница всегда собирается
   английской: сервер не знает, что выбрал посетитель, и гидратация обязана
   совпасть. Русский включается сразу после загрузки. */
const KEY = "lang";
/** Выбор в памяти страницы — на случай, если хранилище браузера закрыто. */
let chosen: Lang | null = null;
const listeners = new Set<() => void>();

const current = (): Lang => {
  if (chosen) return chosen;
  try {
    return localStorage.getItem(KEY) === "ru" ? "ru" : "en";
  } catch {
    return "en";
  }
};

export function setLang(lang: Lang) {
  chosen = lang;
  try {
    localStorage.setItem(KEY, lang);
  } catch {}
  document.documentElement.lang = lang;
  listeners.forEach((f) => f());
}

const subscribe = (f: () => void) => {
  listeners.add(f);
  document.documentElement.lang = current();
  return () => listeners.delete(f);
};

/** Язык посетителя. На сервере и при гидратации — английский. */
export const useLang = () => useSyncExternalStore(subscribe, current, (): Lang => "en");
