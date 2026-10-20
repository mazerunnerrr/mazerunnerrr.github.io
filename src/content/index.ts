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
 *
 * Языка два (см. `src/lib/i18n.ts`). Русский лежит в корне файла, английский —
 * в ключе `en`: так пишет админка (`single_file_default_root`). Каждое чтение
 * берёт язык параметром; не переведённое поле отдаёт русское.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Lang } from "@/lib/i18n";

const ROOT = join(process.cwd(), "content");

/** Боевой адрес сайта. Нужен мета-данным, карте сайта и robots: там
    относительные пути не годятся. */
export const SITE_URL = "https://mazerunnerrr.github.io";

export type ProjectStatus = "в работе" | "личный проект" | "разбор и архитектура" | "запущен";

/** Акцент карточки — только из палитры сайта, иначе карточки разъедутся по стилю. */
export type Accent = "amber" | "clay" | "azure" | "sage";

export type Link = { label: string; url: string };

/** Скриншот с подписью: что на экране и зачем. Подпись видна под кадром
    и в комнате, и на странице проекта. */
export type Shot = { image: string; caption?: string };

/** Пункт «что сделал»: коротко — строка в комнате, подробно — продолжение
    на странице проекта. Комната — несколько строк у кадра, длинный пункт
    там не помещается (Илья, 2026-10-19). */
export type Done = { title: string; detail?: string };

export type Site = {
  /** Слово, которое собирается из частиц, и заголовок вкладки. */
  alias: string;
  thesis: string;
  /** Абзац под тезисом на первом экране. */
  intro: string;
  /** Строка в углу первого экрана: формат работы, часовой пояс, занятость. */
  status: string;
  /** Трек сайта, путь от корня. Пусто — играет процедурный звук мира. */
  music?: string;
};

export type Contacts = {
  /** Живое имя — показывается только рядом с контактами. */
  name: string;
  /** Необязательная строка над ссылками: что писать и чего ждать в ответ. */
  note?: string;
  links: Link[];
  /** Адрес воркера-приёмника формы. Пусто — формы на сайте нет, только ссылки. */
  formUrl?: string;
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
  /* Кейс главами: задача → решение → итог. Каждая — глава комнаты проекта,
     пустая пропускается (Илья, 2026-10-19). */
  task?: string;
  solution?: string;
  result?: string;
  /** 3–6 пунктов строго о сделанном. Без «участвовал» и «помогал». */
  did: Done[];
  stack: string[];
  /** Цифры вида «90» + «коммитов». */
  facts: { value: string; label: string }[];
  /** Схема устройства картинкой — кадр главы «как устроено». */
  scheme?: string;
  /** Видео на обложку, путь от корня сайта. Нет видео — обложка из скриншотов. */
  video?: string;
  shots: Shot[];
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

/** Английское поверх русского: пустая строка или пустой список в переводе
    не затирают оригинал. Списки сводятся по порядку, пункт к пункту; пункт,
    которого в переводе нет, остаётся русским, а не пропадает — иначе один
    подписанный по-английски скриншот съедал остальные. */
const fill = (ru: unknown, en: unknown): unknown => {
  if (typeof ru === "string") return typeof en === "string" && en.trim() ? en : ru;
  if (Array.isArray(ru)) {
    if (!Array.isArray(en) || en.length === 0) return ru;
    return Array.from({ length: Math.max(ru.length, en.length) }, (_, i) =>
      i >= en.length ? ru[i] : i < ru.length ? fill(ru[i], en[i]) : en[i]
    );
  }
  if (ru && typeof ru === "object") {
    const out: Record<string, unknown> = { ...ru };
    if (en && typeof en === "object")
      for (const [k, v] of Object.entries(en)) out[k] = fill((ru as Record<string, unknown>)[k], v);
    return out;
  }
  return en ?? ru;
};

/** Файл на нужном языке. Служебное поле `lang` админка ведёт сама — оно не нужно. */
const readIn = <T>(file: string, lang: Lang): T => {
  const { en, ...ru } = read<Record<string, unknown>>(file);
  delete ru.lang;
  return (lang === "ru" ? ru : fill(ru, en)) as T;
};

/** Порядок на аллее: готовые проекты первыми, «в работе» — в конце
    (Илья, 2026-10-18). Внутри статуса — свежие первыми. */
const STATUS_ORDER: Record<ProjectStatus, number> = {
  запущен: 0,
  "личный проект": 1,
  "разбор и архитектура": 2,
  "в работе": 3,
};

/** Последний год из «2025–2026»: по нему свежие проекты идут первыми. */
const lastYear = (year: string) => Math.max(0, ...(year.match(/\d{4}/g) ?? []).map(Number));

export const getSite = (lang: Lang = "en"): Site => {
  const s = readIn<Site>("site.json", lang);
  return { ...s, music: opt(s.music) };
};

export const getContacts = (lang: Lang = "en"): Contacts => {
  const c = readIn<Contacts>("contacts.json", lang);
  return { ...c, note: opt(c.note), formUrl: opt(c.formUrl) };
};

export const getSkills = (lang: Lang = "en") => readIn<{ items: Skill[] }>("skills.json", lang).items;

/** Порядок проектов один на оба языка — по русскому тексту: иначе точки
    маршрута менялись бы местами при смене языка. */
export const getProjects = (lang: Lang = "en"): Project[] =>
  readdirSync(join(ROOT, "projects"))
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      const p = readIn<
        Omit<Project, "slug" | "did" | "shots"> & { accent?: string; did?: (Done | string)[]; shots?: (Shot | string)[] }
      >(`projects/${name}`, lang);
      const project: Project = {
        ...p,
        slug: name.slice(0, -".json".length),
        summary: opt(p.summary),
        task: opt(p.task),
        solution: opt(p.solution),
        result: opt(p.result),
        scheme: opt(p.scheme),
        video: opt(p.video),
        accent: opt(p.accent) as Accent | undefined,
        // Строка вместо объекта — запись старого вида: читаем её как пункт без подробностей.
        did: (p.did ?? []).map((d) => (typeof d === "string" ? { title: d } : { ...d, detail: opt(d.detail) })),
        stack: p.stack ?? [],
        facts: p.facts ?? [],
        shots: (p.shots ?? [])
          .map((x) => (typeof x === "string" ? { image: x } : { ...x, caption: opt(x.caption) }))
          .filter((x) => x.image),
        links: p.links ?? [],
      };
      return { project, ru: readIn<Omit<Project, "slug">>(`projects/${name}`, "ru") };
    })
    .sort(
      ({ ru: a }, { ru: b }) =>
        STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
        lastYear(b.year) - lastYear(a.year) ||
        a.title.localeCompare(b.title, "ru")
    )
    .map(({ project }) => project);
