/**
 * Контент сайта: типы и чтение.
 *
 * Сам текст лежит в JSON в корневой папке `content/` — её правит админка,
 * вёрстка его только отображает. Модуль читает диск во время сборки, поэтому
 * подключать его можно лишь из серверных компонентов; клиентским хватает
 * `import type`.
 *
 * Обязательность полей и допустимые значения держит форма админки. Здесь
 * только то, чего она не знает: пустая строка из формы значит «не заполнено»,
 * а кривой JSON роняет сборку с именем файла — прежняя версия сайта остаётся.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(process.cwd(), "content");

/** Боевой адрес сайта. Нужен мета-данным, карте сайта и robots: там
    относительные пути не годятся. */
export const SITE_URL = "https://mazerunnerrr.github.io";

export type ProjectStatus = "в работе" | "личный проект" | "разбор и архитектура" | "запущен";

/** Акцент карточки — только из палитры сайта, иначе карточки разъедутся по стилю. */
export type Accent = "amber" | "clay" | "azure" | "sage";

export type Link = { label: string; url: string };

export type Site = {
  /** Слово, которое собирается из частиц, и заголовок вкладки. */
  alias: string;
  thesis: string;
  /** Абзац под тезисом на первом экране. */
  intro: string;
  /** Строка в углу первого экрана: формат работы, часовой пояс, занятость. */
  status: string;
};

export type Contacts = {
  /** Живое имя — показывается только рядом с контактами. */
  name: string;
  /** Необязательная строка над ссылками: что писать и чего ждать в ответ. */
  note?: string;
  links: Link[];
};

export type Skill = {
  title: string;
  /** Одна строка о том, что это даёт заказчику. */
  lead: string;
};

/* Task Manager сверен с исходниками 2026-09-11: 90 коммитов с 07.05 по
   03.09.2026, 16 327 строк в 103 файлах, веб-сервер Caddy, а не nginx.
   Причину и роль Илья продиктовал сам. */
export type Project = {
  /** Имя файла без .json — оно же адрес страницы проекта. */
  slug: string;
  title: string;
  /** Год или диапазон. */
  year: string;
  role: string;
  status: ProjectStatus;
  /** Суть одной строкой — для плитки на маршруте. */
  summary?: string;
  /** Абзац: что за задача и почему она так решена. */
  lead: string;
  /** 3–6 пунктов строго о сделанном. Без «участвовал» и «помогал». */
  did: string[];
  stack: string[];
  /** Цифры вида «90» + «коммитов». */
  facts: { value: string; label: string }[];
  /** Видео на обложку, путь от корня сайта. Нет видео — обложка из скриншотов. */
  video?: string;
  shots: string[];
  links: Link[];
  accent?: Accent;
};

const read = <T>(file: string): T => {
  try {
    return JSON.parse(readFileSync(join(ROOT, file), "utf8")) as T;
  } catch (e) {
    // Без имени файла ошибка разбора JSON не говорит, где искать.
    throw new Error(`content/${file}: ${(e as Error).message}`);
  }
};

/** Пустая строка из формы админки означает «не заполнено». */
const opt = (v?: string) => (v?.trim() ? v : undefined);

/** Последний год из «2025–2026»: по нему свежие проекты идут первыми. */
const lastYear = (year: string) => Math.max(0, ...(year.match(/\d{4}/g) ?? []).map(Number));

export const getSite = () => read<Site>("site.json");

export const getContacts = (): Contacts => {
  const c = read<Contacts>("contacts.json");
  return { ...c, note: opt(c.note) };
};

export const getSkills = () => read<{ items: Skill[] }>("skills.json").items;

export const getProjects = (): Project[] =>
  readdirSync(join(ROOT, "projects"))
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      const p = read<Omit<Project, "slug"> & { accent?: string }>(`projects/${name}`);
      return {
        ...p,
        slug: name.slice(0, -".json".length),
        summary: opt(p.summary),
        video: opt(p.video),
        accent: opt(p.accent) as Accent | undefined,
        did: p.did ?? [],
        stack: p.stack ?? [],
        facts: p.facts ?? [],
        shots: p.shots ?? [],
        links: p.links ?? [],
      };
    })
    .sort((a, b) => lastYear(b.year) - lastYear(a.year) || a.title.localeCompare(b.title, "ru"));
