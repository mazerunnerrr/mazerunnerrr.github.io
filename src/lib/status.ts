import type { Project } from "@/content";

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
};
