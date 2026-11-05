import type { Accent, Project } from "@/content";

/**
 * Цвет статуса проекта — классом, а не инлайн-стилем: инлайн `style` переписывает
 * Dark Reader ещё до того, как React сверит разметку, и гидратация падает.
 * Один словарь на маршрут и страницу проекта, чтобы цвета не разъехались.
 */
export const STATUS: Record<Project["status"], { dot: string; text: string }> = {
  "в работе": { dot: "bg-[var(--st-work)]", text: "text-[var(--st-work)]" },
  "личный проект": { dot: "bg-[var(--st-personal)]", text: "text-[var(--st-personal)]" },
  "разбор и архитектура": { dot: "bg-[var(--st-research)]", text: "text-[var(--st-research)]" },
  запущен: { dot: "bg-[var(--st-live)]", text: "text-[var(--st-live)]" },
  концепт: { dot: "bg-[var(--st-concept)]", text: "text-[var(--st-concept)]" },
  "ищем инвестиции": { dot: "bg-[var(--st-raise)]", text: "text-[var(--st-raise)]" },
  заморожен: { dot: "bg-[var(--st-frozen)]", text: "text-[var(--st-frozen)]" },
};

/** Цвет комнаты, когда в админке он не выбран, — цвет статуса. */
const STATUS_ACCENT: Record<Project["status"], Accent> = {
  "в работе": "amber",
  "личный проект": "clay",
  "разбор и архитектура": "azure",
  запущен: "sage",
  концепт: "azure",
  "ищем инвестиции": "clay",
  заморожен: "azure",
};
export const accentOf = (p: Project): Accent => p.accent ?? STATUS_ACCENT[p.status];

/** Те же цвета, что `--st-*` в globals.css, — для света сцены: шейдеру
    CSS-переменная недоступна. */
export const ACCENT_HEX: Record<Accent, string> = {
  amber: "#d6a96a",
  clay: "#c4907a",
  azure: "#8fb3cc",
  sage: "#a8c0a0",
};
