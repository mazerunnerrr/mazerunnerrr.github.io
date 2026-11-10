"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Scene, type FrameInfo, type SceneApi, type StationSpec } from "@/components/Scene";
import type { RoomLayout } from "@/lib/roomSurface";
import type { ChapterLight, Landmark } from "@/lib/environment";
import type { Contacts, Experience, Project, Site, Skill } from "@/content";
import { starSpots } from "@/lib/shapes";
import { ContactForm } from "@/components/ContactForm";
import { Loader } from "@/components/Loader";
import { Ambience, SOUND_KEY } from "@/lib/ambience";
import { attachFlipHand, Flip, flipIn } from "@/components/Flip";
import { WaveText } from "@/components/WaveText";
import { attachWave } from "@/lib/wave";
import { clamp01, ease, fade, lightUp } from "@/lib/layer";
import { ProjectRoom, type RoomUpdate } from "@/components/ProjectRoom";
import { ACCENT_HEX, STATUS, accentOf } from "@/lib/status";
import { FLIP_HOVER, scramble, setTicker } from "@/lib/scramble";
import { LANGS, STATUS_LABEL, UI, type Lang } from "@/lib/i18n";
import { setLang, useLang } from "@/lib/useLang";

/* Маршрут — аллея-кольцо, как у igloo.inc: имя → проекты по одному →
   контакты, и снова имя. У имени и у каждого проекта своя комната: нажал
   на объект — вошёл, колесо её не двигает. Отдельной точки «Что делаю»
   больше нет: всё обо мне — в комнате имени (Илья, 2026-10-18). */
type Stop =
  | { kind: "name"; label: string }
  | { kind: "project"; label: string; project: Project }
  | { kind: "experience"; label: string }
  | { kind: "contacts"; label: string };

/* Свет глав. Каждая точка подсвечена по-своему внутри полночного синего:
   у раздела проектов свой голографический свет снизу; контакты — янтарём
   сбоку. Сила малая: это настроение, а не пятно. У имени света нет: тёплый
   «рассвет» снизу слева читался на синем грязно-серым пятном (Илья,
   2026-10-20). */
const LIGHT: Record<"projects" | "contacts", ChapterLight> = {
  projects: { color: "#6f8fff", amount: 0.16, dir: [0, -1] },
  contacts: { color: "#d6a96a", amount: 0.11, dir: [0.9, -0.4] },
};
const pad = (n: number) => String(n).padStart(2, "0");

/** Волна в переключателе звука: столько точек на линии и её размер. */
const WAVE = 48;
/** Цвет подписи комнаты из среднего цвета кадра (0..1): оттенок кадра,
    насыщенность поджата (до 0,3), светлота 0,82 — читается на тёмном. */
function inkOf(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d < 1e-4 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d >= 1e-4) {
    if (max === r) h = ((g - b) / d + 6) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  const S = Math.min(0.3, s * 0.6 + 0.06);
  const L = 0.82;
  const c = (1 - Math.abs(2 * L - 1)) * S;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = L - c / 2;
  const [r1, g1, b1] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r1 + m) * 255, (g1 + m) * 255, (b1 + m) * 255];
}

/** Где браузер помнит, какие подсказки на главной уже отработали. */
const HINTS_KEY = "helias:hints";
/* Переходы «имя ↔ проекты» и «проекты ↔ контакты» заметнее прочих:
   колесом на них уходит полтора-два крутка, пальцем доезд тянется дольше
   (Илья, 2026-11-06: «чтобы переход был заметнее, а не проскипан»). */
const STRETCH = 1.75;
/** Сколько пикселей строки `.instrument` (11/17,6 px) над верхом заглавных. */
const NAME_LEAD = 5;

const WAVE_W = 64;
const WAVE_H = 20;
const FLAT = `M0 ${WAVE_H / 2} H${WAVE_W}`;
/* Линии волны — по одной на полосу звука (BANDS в ambience.ts): ноты
   фортепиано и синтезатора, бочка, бас, мелкая мелодика. Одна линия
   выглядела бедно (Илья, 2026-10-18). crests — сколько полуволн на ширине,
   speed — бег, amp — доля высоты; главная, самая яркая и толстая, — ноты. */
const LINES = [
  { crests: 2, speed: 1.8, amp: 1, width: 1.3, opacity: 0.95 },
  { crests: 3, speed: 1.2, amp: 0.75, width: 1, opacity: 0.6 },
  { crests: 4, speed: 2.4, amp: 0.7, width: 0.9, opacity: 0.55 },
  { crests: 6, speed: 3.2, amp: 0.5, width: 0.7, opacity: 0.45 },
];

/** Навели на кнопку или ссылку — её надпись перещёлкивается со щелчками. */
const flipHover = (e: React.PointerEvent<HTMLElement>) => flipIn(e.currentTarget, FLIP_HOVER, true);

/** Адрес без служебной части: в строке рядом со ссылкой она лишняя. */
const plain = (url: string) => url.replace(/^mailto:/, "").replace(/^https?:\/\//, "");

/* Объект из частиц — герой, текст — приборы. Всё, что написано, стоит
   по углам мелким моноширинным шрифтом или выноской у объекта. */
export function Home({
  content,
}: {
  content: Record<Lang, { site: Site; skills: Skill[]; projects: Project[]; experience: Experience; contacts: Contacts }>;
}) {
  /* Язык меняет только текст: сцена и маршрут от него не зависят, поэтому
     всё, что уходит в сцену, мемоизировано по значениям, общим для обоих. */
  const lang = useLang();
  const t = UI[lang];
  const { site, skills, projects, experience, contacts } = content[lang];
  /** Сколько огоньков у точки «Опыт»; нет работ или выключена в админке — нет и точки. */
  const jobs = experience.show ? experience.items.length : 0;
  const stops = useMemo<Stop[]>(
    () => [
      { kind: "name", label: t.stopName },
      ...projects.map((p): Stop => ({ kind: "project", label: `${t.stopProject} · ${p.title}`, project: p })),
      ...(jobs > 0 ? [{ kind: "experience", label: t.stopExperience } as const] : []),
      { kind: "contacts", label: t.stopContacts },
    ],
    [projects, jobs, t]
  );
  const N = stops.length;
  const FIRST_PROJECT = 1;
  const CONTACTS = N - 1;
  const EXPERIENCE = jobs > 0 ? N - 2 : -1;
  /** Огоньки россыпи в долях её полуразмеров — для подписей под рукой. */
  const spots = useMemo(() => starSpots(jobs), [jobs]);

  /** Номер точки на круге для прибора слева сверху. Нумерация честная:
      это последовательность маршрута, а не украшение. */
  const route = useMemo(() => stops.map((s, i) => `${pad(i + 1)} / ${pad(stops.length)} · ${s.label}`), [stops]);

  /** Якоря, с которых встают на точку сразу, без пролёта: так страница
      проекта возвращает к своему проекту, а не заново на имя. */
  const slugs = projects.map((p) => p.slug).join(" ");
  const hashStops = useMemo(() => {
    const list = slugs ? slugs.split(" ") : [];
    const map: Record<string, number> = { "#about": 0, "#skills": 0, "#contacts": list.length + (jobs > 0 ? 2 : 1) };
    if (jobs > 0) map["#experience"] = list.length + 1;
    list.forEach((slug, i) => {
      map[`#${slug}`] = i + 1;
      map["#projects"] ??= i + 1;
    });
    return map;
  }, [slugs, jobs]);

  /* Объекты точек. Массив мемоизирован по значениям, а не по ссылкам
     на пропсы: новый на каждый рендер пересобирал бы сцену. */
  /** Кадры и цвет комнаты проектов — по значениям, а не по ссылкам: см. выше. */
  const spheres = JSON.stringify(
    projects.map((p) => ({ media: { video: p.video, images: p.shots.map((s) => s.image) }, tint: ACCENT_HEX[accentOf(p)] }))
  );
  const stations = useMemo<StationSpec[]>(
    () => [
      /* Имя. Распыление зажатой рукой — только у него: это первый экран
         и его фирменный жест. Нажатие раскрывает имя облаком — комната
         «обо мне». */
      /* Имя уходит к проектам, как прыжок на скорость света: точки по очереди
         с разгоном летят по своим лучам в камеру, слово расходится от центра,
         не теряя линий букв. После контактов «@» пересобирается в имя прямо
         на месте — круг замкнулся, мы снова в начале (Илья, 2026-10-20). */
      {
        shape: { kind: "text", text: site.alias },
        room: "burst",
        grip: "spray",
        dim: 0.6,
        leave: "streak",
        reform: true,
        stretch: STRETCH,
      },
      /* Проекты — сферы-сетки одного вида, на каждой проступает кадр
         проекта: сразу видно, что это работы и что по ним можно нажать.
         Зажал и повёл — сфера вертится в любую сторону; нажал — она
         раскрывается, как раскладная игрушка, и ты внутри (Илья,
         2026-10-16 и 18). Оболочку внутри притушиваем слабо: ты должен
         видеть, что стоишь внутри сферы. */
      /* Первая сфера сгущается из ничего — обратный разлёт последней, но
         закручиваясь в другую сторону (Илья, 2026-10-21: стяжка уже есть
         у «@»). Материя имени тем временем пролетает сквозь камеру.
         Последняя уходит к контактам разлётом:
         раскручивается, и точки срываются во все стороны. Между двумя
         сферами — пересборка на месте. */
      ...(JSON.parse(spheres) as { media: StationSpec["media"]; tint: string }[]).map(
        ({ media, tint }, i, all): StationSpec => ({
          ...(i === 0 ? { arrive: "condense" as const } : {}),
          ...(i === all.length - 1 ? { leave: "scatter" as const, stretch: STRETCH } : {}),
          shape: { kind: "sphere", r: 0.2 },
          room: { kind: "sphere", r: 1.5, cz: 0.55 },
          grip: "spin",
          dim: 0.05,
          media,
          light: LIGHT.projects,
          // В комнате фон уходит в цвет проекта (Илья, 2026-10-19).
          roomLight: { color: tint, amount: 0.24, dir: [0.2, -1] },
        })
      ),
      /* Другой опыт — россыпь огоньков, по огоньку на работу. Прилетают
         вихрем из глубины, каждый в свой черёд; уходят, сплетаясь вихрем
         в «@». Нажатие на огонёк раскрывает только его — комната одной
         работы; зажатая рука ведёт огоньки за собой лентой (Илья,
         2026-10-26 и 2026-11-02). */
      ...(jobs > 0
        ? [
            {
              shape: { kind: "stars", count: jobs },
              room: "burst",
              grip: "magnet",
              // Облако раскрытого огонька не гасим сильно: в тёмном не видно руки.
              dim: 0.3,
              arrive: "vortex",
              reform: true,
            } satisfies StationSpec,
          ]
        : []),
      /* «@» приходит стяжкой из-за краёв экрана, уходит пересборкой в имя;
         зажатая рука распыляет и крутит его, как имя (Илья, 2026-10-20). */
      /* «@» выше середины: под ним строка контактов, и знак с ней вместе
         стоят по центру кадра (Илья, 2026-11-03: «слишком низко, дисбаланс»). */
      {
        shape: { kind: "text", text: "@" },
        grip: "spray",
        light: LIGHT.contacts,
        arrive: "implode",
        reform: true,
        rise: 0.12,
      },
    ],
    [site.alias, spheres, jobs]
  );

  /* Ориентир на переходах один — ворота раздела перед первым проектом.
     Арки на остальных переходах убраны: вокруг уходящей сферы они читались
     рваным ореолом (Илья, 2026-10-20). */
  const count = projects.length;
  const landmarks = useMemo<Landmark[]>(() => {
    const kinds: Stop["kind"][] = [
      "name",
      ...Array<Stop["kind"]>(count).fill("project"),
      ...(jobs > 0 ? (["experience"] as const) : []),
      "contacts",
    ];
    return kinds.flatMap((s, k): Landmark[] => {
      const next = kinds[(k + 1) % kinds.length];
      return next === "project" && s !== "project" ? [{ at: k + 0.5, kind: "gate" }] : [];
    });
  }, [count, jobs]);
  const GATE = landmarks.findIndex((m) => m.kind === "gate");

  const layers = useRef<(HTMLDivElement | null)[]>([]);
  const tagTop = useRef<(HTMLDivElement | null)[]>([]);
  const tagBottom = useRef<(HTMLDivElement | null)[]>([]);
  /* Подсказки на главной (Илья, 2026-11-05): еле заметные, каждая гаснет после
     первого раза и больше не показывается — браузер помнит (`HINTS_KEY`). Пока
     память не прочитана, их нет вовсе: вернувшийся гость не видит вспышки. */
  const hintRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [hintsDone, setHintsDone] = useState<ReadonlySet<string> | null>(null);
  const hintsSeen = useRef<Set<string>>(new Set());
  useEffect(() => {
    let saved: string[] = [];
    try {
      saved = JSON.parse(localStorage.getItem(HINTS_KEY) ?? "[]");
    } catch {
      /* Память браузера закрыта — подсказки просто покажутся снова. */
    }
    hintsSeen.current = new Set(saved);
    setHintsDone(new Set(saved));
  }, []);
  const hintDone = (id: string) => {
    if (hintsSeen.current.has(id)) return;
    hintsSeen.current.add(id);
    const all = [...hintsSeen.current];
    try {
      localStorage.setItem(HINTS_KEY, JSON.stringify(all));
    } catch {
      /* Не запомнили — покажутся при следующем визите, не страшно. */
    }
    setHintsDone(new Set(all));
  };
  const rooms = useRef<(HTMLDivElement | null)[]>([]);
  const enterRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const closeRefs = useRef<(HTMLButtonElement | null)[]>([]);
  /** Заголовки, которые расслаиваются на скорости. */
  const glitch = useRef<(HTMLElement | null)[]>([]);
  const contactsTitleRef = useRef<HTMLHeadingElement>(null);
  const routeRef = useRef<HTMLSpanElement>(null);
  const lastLabel = useRef("");
  /** Подписи огоньков «Опыта» по номеру работы и огонёк под рукой (−1 — нет). */
  const starLabels = useRef<(HTMLButtonElement | null)[]>([]);
  const hoverStar = useRef(-1);
  /** Чья работа открыта в комнате «Опыта». */
  const [star, setStar] = useState(0);
  /** Насколько раскрыта комната — из последнего кадра. */
  const roomOpen = useRef(0);
  /** Полоска справа, её черты по номеру точки и чья горит сейчас. */
  const stripRef = useRef<HTMLElement>(null);
  const stripRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  const lastNear = useRef(-1);
  const gateRef = useRef<HTMLSpanElement>(null);
  const waveRefs = useRef<(SVGPathElement | null)[]>([]);
  const wavePhase = useRef(new Float32Array(LINES.length));
  const waveBands = useRef(new Float32Array(LINES.length));
  const waveFlat = useRef(true);
  const waveAt = useRef(0);
  const apiRef = useRef<SceneApi | null>(null);

  /* Комната проекта пишет каждый кадр в style сама (`bind`): кадр
     наклоняется за рукой. */
  const roomUpdaters = useRef<(RoomUpdate | null)[]>([]);
  const binders = useMemo(
    () =>
      Array.from({ length: N }, (_, k) => (fn: RoomUpdate | null) => {
        roomUpdaters.current[k] = fn;
      }),
    [N]
  );
  /** Мерки комнат проекта — сцене, которая рисует их кадр и название. */
  const layouts = useMemo(
    () => Array.from({ length: N }, (_, k) => (l: RoomLayout | null) => apiRef.current?.roomLayout(k, l)),
    [N]
  );
  /** Рука над окном, −1..1 от центра: кадр комнаты наклоняется за ней. */
  const pointer = useRef({ x: 0, y: 0 });
  const tilt = useRef({ x: 0, y: 0, at: 0 });
  /** Цвет подписи комнаты проекта, 0..255, и что последним записано в `--room-ink`. */
  const ink = useRef({ r: 232, g: 223, b: 205, at: 0, written: "" });
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      pointer.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.current.y = (e.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  /* Заставка: сцена сообщает, что первый кадр готов; заставка, уходя,
     разрешает сборку имени — её должно быть видно. */
  const [loaded, setLoaded] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const onLoaded = useCallback(() => setLoaded(true), []);
  const onRevealed = useCallback(() => setRevealed(true), []);

  /* Открытая комната. Состояние React — меняется по нажатию, а не каждый
     кадр. Слой комнаты гаснет вслед за материей уже после закрытия, поэтому
     помним и ту, что была открыта последней. */
  const [room, setRoom] = useState<number | null>(null);
  const lastRoom = useRef<number | null>(null);

  /* Звук включён по умолчанию (Илья, 2026-11-06), а выключенный посетителем
     остаётся выключенным и при следующем визите (`SOUND_KEY`). Заиграть
     браузер даёт только после жеста: первый клик, тап или клавиша — колесо
     и движение мыши жестом не считаются. До него прибор горит, но молчит. */
  const [sound, setSound] = useState(true);
  const ambienceRef = useRef<Ambience | null>(null);
  const soundRef = useRef(sound);
  const roomNow = useRef(room);
  useEffect(() => {
    soundRef.current = sound;
    roomNow.current = room;
  }, [sound, room]);
  const startSound = useCallback(() => {
    if (ambienceRef.current) return;
    ambienceRef.current = new Ambience(site.music);
    ambienceRef.current.duck(roomNow.current !== null);
    ambienceRef.current.set(true);
  }, [site.music]);
  useEffect(() => {
    try {
      if (localStorage.getItem(SOUND_KEY) === "off") setSound(false);
    } catch {}
    const onGesture = (e: Event) => {
      // Нажатие по самому прибору решает toggleSound: первое — «заиграй».
      if ((e.target as Element | null)?.closest?.(".sound-toggle")) return;
      if (soundRef.current) startSound();
      stop();
    };
    const kinds = ["pointerdown", "keydown", "touchend"] as const;
    const stop = () => kinds.forEach((k) => window.removeEventListener(k, onGesture, true));
    kinds.forEach((k) => window.addEventListener(k, onGesture, true));
    return stop;
  }, [startSound]);
  const lastSound = useRef(0);
  useEffect(() => () => ambienceRef.current?.close(), []);
  // Надписи под рукой: цифры и щелчки. Щёлкает звук мира, пока он включён.
  useEffect(() => {
    setTicker((k) => ambienceRef.current?.tick(k));
    const detach = attachFlipHand();
    return () => {
      setTicker(null);
      detach();
    };
  }, []);
  /* Буквы комнаты отвечают руке волной, как у igloo (`wave.ts`). Волна читает
     буквы открытой комнаты; язык сменился — перечитывает. */
  const waveRef = useRef<ReturnType<typeof attachWave> | null>(null);
  useEffect(() => {
    const w = attachWave();
    waveRef.current = w;
    return () => w.detach();
  }, []);
  useEffect(() => {
    waveRef.current?.setRoot(room !== null ? rooms.current[room] : null);
  }, [room, lang]);
  const toggleSound = () => {
    hintDone("sound");
    // Прибор горит, но ещё молчал: первое нажатие — «заиграй», а не «выключи».
    if (sound && !ambienceRef.current) {
      startSound();
      return;
    }
    const next = !sound;
    if (next) startSound();
    ambienceRef.current?.set(next);
    setSound(next);
    try {
      localStorage.setItem(SOUND_KEY, next ? "on" : "off");
    } catch {}
  };
  /* Ушёл со вкладки — звук стихает, вернулся — возвращается, если был
     включён (Илья, 2026-10-19, по образцу igloo.inc). */
  useEffect(() => {
    const onVisibility = () => ambienceRef.current?.setAway(document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);
  /* В комнате музыка плавно уходит «за стену» и играет фоном, на аллее
     возвращается — как у Active Theory (Илья, 2026-10-18). */
  useEffect(() => {
    ambienceRef.current?.duck(room !== null);
  }, [room]);

  // useCallback обязателен: onReady попал бы в зависимости эффекта сцены,
  // и та пересобиралась бы на каждый рендер, теряя инерцию маршрута.
  const onReady = useCallback(
    (api: SceneApi) => {
      apiRef.current = api;
      const stop = hashStops[window.location.hash];
      if (stop !== undefined) api.jumpTo(stop);
    },
    [hashStops]
  );

  /** Вошли с клавиатуры — фокус встаёт на «закрыть». Мышью — не трогаем:
      рамка фокуса вокруг кнопки при клике по сфере только мешала. */
  const keyboardEntry = useRef(false);
  const openRoom = (k: number, keyboard = false, job = hoverStar.current) => {
    keyboardEntry.current = keyboard;
    const kind = stops[k]?.kind;
    if (kind !== "name" && kind !== "project" && kind !== "experience") return;
    // У «Опыта» открывается огонёк под рукой; нажали мимо огоньков — ничего.
    if (kind === "experience" && job < 0) return;
    // Другой огонёк — только когда прежний собрался: его комната строится заново.
    if (kind === "experience" && job !== star && roomOpen.current > 0.01) return;
    lastRoom.current = k;
    if (kind === "experience") setStar(job);
    setRoom(k);
    apiRef.current?.setRoom(k, kind === "experience" ? job : -1);
  };

  /** Куда вернуть фокус после выхода из комнаты. */
  const returnTo = useRef<number | null>(null);
  const closeRoom = useCallback(() => {
    if (room === null) return;
    returnTo.current = room;
    setRoom(null);
    apiRef.current?.setRoom(null);
  }, [room]);

  /* В комнате фокус встаёт на «закрыть», Esc выводит обратно на аллею.

     Вернуть фокус ко входу можно только здесь, после рендера: в момент
     закрытия аллея ещё инертна, и focus() на ней молча не срабатывает. */
  useEffect(() => {
    if (room === null) {
      const k = returnTo.current;
      returnTo.current = null;
      if (k !== null && keyboardEntry.current) enterRefs.current[k]?.focus({ preventScroll: true });
      return;
    }
    if (keyboardEntry.current) closeRefs.current[room]?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRoom();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [room, closeRoom]);

  /* Переход из переключателя: к работам, к контактам или к имени — откуда
     угодно, в том числе из комнаты. Фокус едет вместе с камерой, иначе следующий
     Tab вернул бы её назад. Обработчики не каррированы нарочно: вызов вида
     jump(2) в разметке выполнялся бы во время рендера. */
  /** `along` — одним шагом, без пролёта через точки между ними: так ходят полоска
      проектов, «работы», «контакт» и псевдоним в углу (`hopTo` в Scene.tsx). */
  const jump = (stop: number, e: React.MouseEvent, along = false) => {
    if (!apiRef.current) return;
    e.preventDefault();
    if (room !== null) closeRoom();
    apiRef.current.goTo(stop, along);
    // Этот фокус камеру не зовёт: она уже едет, а `follow` повёз бы её пролётом.
    focusing.current = true;
    (stop === CONTACTS ? contactsTitleRef.current : enterRefs.current[stop])?.focus({ preventScroll: true });
    focusing.current = false;
  };

  /* Tab ведёт по маршруту: фокус, попавший в погасший слой, зовёт камеру
     к его точке. Раньше он молча вставал на невидимую ссылку. */
  const focusing = useRef(false);
  const follow = (stop: number) => {
    if (!focusing.current) apiRef.current?.goTo(stop);
  };

  /* Всё, что меняется каждый кадр, пишется прямо в style и textContent.
     Через состояние React это был бы ре-рендер шестьдесят раз в секунду.

     pointer-events здесь НЕ трогаем. Слои лежат поверх канваса на весь
     экран, и стоит выставить им `auto` — они перехватывают всю мышь,
     до сцены не доходит ни одного события, и кажется, что интерактив
     мёртв. Слои сквозные всегда, а кликабельность включают сами кнопки
     и ссылки классом `pointer-events-auto`. */
  const onFrame = ({ progress, velocity, stations: at, room: amount, marks, hand, tint, grip }: FrameInfo) => {
    /** Чья сейчас точка: к ней камера ближе всего, ей и принимать нажатия. */
    const near = ((Math.round(progress) % N) + N) % N;
    /** Пока открыта комната, аллея гаснет целиком. */
    const corridor = 1 - amount;
    const free = room === null;
    roomOpen.current = amount;

    for (let k = 0; k < N; k++) {
      const el = layers.current[k];
      const f = at[k];
      if (!el || !f) continue;
      if (stops[k].kind === "contacts") {
        // Появляется на подлёте, уходит на вылете.
        const appear = f.d <= 0 ? clamp01((f.d + 0.55) / 0.55) : 1;
        const leave = f.d > 0 ? clamp01((f.d - 0.1) / 0.6) : 0;
        fade(el, appear * (1 - leave) * corridor, near === k && free);
        el.style.transform = `scale(${0.94 + appear * 0.06 + leave * 0.4})`;
        const under = tagBottom.current[k];
        if (under) under.style.transform = `translate3d(${f.x}px, ${f.y + f.ink}px, 0)`;
      } else {
        // Выноска у объекта: видна, пока он стоит перед камерой, и едет
        // вместе с ним — подпись сверху слева, вход снизу справа.
        // Раскрывают объект рукой — подписи уходят вдвое быстрее материи,
        // иначе они висят внутри раскрытой сферы.
        fade(el, ease(clamp01(1 - Math.abs(f.d) * 4)) * f.vis * ease(clamp01(1 - amount * 2)), near === k && free);
        const top = tagTop.current[k];
        const bottom = tagBottom.current[k];
        if (top) top.style.transform = `translate3d(${f.x - f.hw}px, ${f.y - f.hh}px, 0)`;
        /* «обо мне» — под последней буквой имени, на просвет между буквами
           ниже них, правым краем по букве (Илья, 2026-11-06); `NAME_LEAD` —
           воздух строки над заглавными. Вход проекта — у угла сферы. */
        if (bottom)
          bottom.style.transform =
            stops[k].kind === "name"
              ? `translate3d(${f.x + f.inkR}px, ${f.y + f.ink + f.gap - NAME_LEAD}px, 0)`
              : `translate3d(${f.x + f.hw}px, ${f.y + f.hh}px, 0)`;
        // Подсказка — под объектом по центру; у сферы ниже строки «открыть»,
        // у имени — сразу под буквами (полувысота имени с запасом под шрифт, буквы
        // кончаются около её середины) и выше строки «обо мне».
        const hint = hintRefs.current[k];
        if (hint) hint.style.transform = `translate3d(${f.x}px, ${f.y + (stops[k].kind === "project" ? f.hh + 58 : f.hh * 0.5 + 16)}px, 0)`;
      }
    }
    // Подсказка гаснет, как только жест сделан: ушёл с имени, распылил, покрутил.
    if (hintsDone) {
      if (near !== 0) hintDone("enjoy");
      if (grip === "spray") hintDone("grip");
      if (grip === "spin") hintDone("spin");
    }

    /* Комната проявляется вслед за материей, когда та уже пошла раскрываться.
       Закрытую забываем, как только материя собралась: иначе раскрытие
       сферы рукой проявляло бы текст комнаты, открытой до этого. */
    if (room === null && amount < 0.01) lastRoom.current = null;
    for (let k = 0; k < N; k++) {
      const el = rooms.current[k];
      if (!el) continue;
      fade(el, lastRoom.current === k ? ease(clamp01((amount - 0.35) / 0.65)) : 0, room === k);
    }

    /* Комната проекта: наклон кадра за рукой. Сглажен кадронезависимо,
       иначе кадр дрожит вслед за каждым пикселем мыши. */
    const lit = lastRoom.current;
    const update = lit === null ? null : roomUpdaters.current[lit];
    if (update) {
      const at = performance.now();
      const dtt = Math.min(0.05, (at - (tilt.current.at || at)) / 1000);
      tilt.current.at = at;
      const kt = 1 - Math.pow(0.04, dtt);
      tilt.current.x += (pointer.current.x - tilt.current.x) * kt;
      tilt.current.y += (pointer.current.y - tilt.current.y) * kt;
      update(tilt.current.x, tilt.current.y);
    }
    // Кадр и название комнаты рисует сцена — ей те же проявление и рука.
    apiRef.current?.roomView(lit, lit === null ? 0 : ease(clamp01((amount - 0.35) / 0.65)), tilt.current.x, tilt.current.y);

    /* Подпись комнаты проекта — в тон кадру (Илья, 2026-11-05: «эмбиентно,
       как у Active Theory»): оттенок — от среднего цвета ролика, светлота
       и приглушённость свои, как их холодно-серые подписи в синей комнате.
       Кадр сменился — цвет перетекает за полсекунды. */
    const roomEl = lit === null ? null : rooms.current[lit];
    if (roomEl && tint) {
      const [tr, tg, tb] = inkOf(tint.r, tint.g, tint.b);
      const at = performance.now();
      const dti = Math.min(0.1, (at - (ink.current.at || at)) / 1000);
      ink.current.at = at;
      const ki = 1 - Math.pow(0.02, dti);
      const c = ink.current;
      c.r += (tr - c.r) * ki;
      c.g += (tg - c.g) * ki;
      c.b += (tb - c.b) * ki;
      const v = `${Math.round(c.r)} ${Math.round(c.g)} ${Math.round(c.b)}`;
      if (v !== c.written) {
        c.written = v;
        roomEl.style.setProperty("--room-ink", v);
      }
    }

    /* Подпись ворот раздела — над их верхней дугой, пока ворота в кадре. */
    const gate = GATE >= 0 ? marks[GATE] : undefined;
    if (gateRef.current) {
      const vis = gate ? gate.vis * corridor : 0;
      gateRef.current.style.opacity = String(vis);
      lightUp(gateRef.current, vis);
      if (gate && vis > 0.01) gateRef.current.style.transform = `translate(-50%, ${-gate.r - 34}px)`;
    }

    const now = performance.now();

    /* Подписи огоньков «Опыта» стоят под своими огоньками и проявляются
       под рукой — так видно, что огонёк это работа, ещё до входа в комнату.
       Огонёк под рукой и откроется по нажатию. */
    const ex = EXPERIENCE >= 0 ? at[EXPERIENCE] : undefined;
    if (ex && ex.vis > 0.01 && Math.abs(ex.d) < 0.6) {
      const hx = ((pointer.current.x + 1) / 2) * window.innerWidth;
      const hy = ((pointer.current.y + 1) / 2) * window.innerHeight;
      let best = -1;
      let gap = 72;
      spots.forEach((s, i) => {
        const d = Math.hypot(hx - (ex.x + s.x * ex.hw), hy - (ex.y - s.y * ex.hh));
        if (d < gap) [best, gap] = [i, d];
      });
      hoverStar.current = free && near === EXPERIENCE ? best : -1;
      spots.forEach((s, i) => {
        const el = starLabels.current[i];
        if (!el) return;
        // Под галактикой, ниже её края.
        el.style.transform = `translate3d(${ex.x + s.x * ex.hw}px, ${ex.y - s.y * ex.hh + s.r * 0.8 + 10}px, 0) translateX(-50%)`;
        const on = hoverStar.current === i;
        if (el.hasAttribute("data-on") === on) return;
        el.toggleAttribute("data-on", on);
        if (on) flipIn(el, undefined, true);
      });
    } else hoverStar.current = -1;

    // Черта ближайшей сферы на полоске горит и подписана — тоже только при смене.
    if (near !== lastNear.current) {
      stripRefs.current[lastNear.current]?.removeAttribute("aria-current");
      const tick = stripRefs.current[near];
      if (tick) {
        tick.setAttribute("aria-current", "location");
        flipIn(tick);
      }
      lastNear.current = near;
    }
    // Полоска видна только у сфер: на имени и контактах её нет (Илья, 2026-10-26).
    const strip = stripRef.current;
    const hideStrip = !free || stops[near]?.kind !== "project";
    if (strip && strip.hasAttribute("data-faded") !== hideStrip) strip.toggleAttribute("data-faded", hideStrip);

    // Номер точки на круге — только при смене, а не каждый кадр.
    const label = room !== null ? `${route[room]} · ${t.inside}` : route[near];
    if (label !== lastLabel.current) {
      lastLabel.current = label;
      if (routeRef.current) scramble(routeRef.current, label);
    }

    // Звук слушает руку и пролёт несколько раз в секунду — чаще не нужно.
    const amb = ambienceRef.current;
    if (amb && now - lastSound.current > 80) {
      lastSound.current = now;
      amb.drive(hand, Math.min(1, Math.abs(velocity) * 0.9));
    }

    /* Волна в переключателе — четыре линии, каждая слушает свою полосу:
       удар в ней подбрасывает свою линию. Края всех прижаты к концам, как
       у струн. Выключен звук — одна ровная линия, и пути не переписываются
       каждый кадр. */
    const paths = waveRefs.current;
    const dtw = Math.min(0.05, (now - waveAt.current) / 1000);
    waveAt.current = now;
    if (amb && sound) {
      const bands = waveBands.current;
      const phase = wavePhase.current;
      amb.bands(dtw, bands);
      LINES.forEach((ln, li) => {
        const path = paths[li];
        if (!path) return;
        const a = bands[li] * ln.amp * (WAVE_H / 2 - 1.5);
        phase[li] += dtw * ln.speed * (1 + bands[li]);
        let d = "";
        for (let i = 0; i < WAVE; i++) {
          const u = i / (WAVE - 1);
          const y = WAVE_H / 2 - Math.sin(u * Math.PI * ln.crests - phase[li] + li * 1.3) * a * Math.sin(Math.PI * u);
          d += `${i ? "L" : "M"}${(u * WAVE_W).toFixed(1)} ${y.toFixed(2)}`;
        }
        path.setAttribute("d", d);
      });
      waveFlat.current = false;
    } else if (!waveFlat.current) {
      for (const path of paths) path?.setAttribute("d", FLAT);
      waveFlat.current = true;
    }

    // Расслоение текста на скорости: тот же приём, что держит характер
    // у Dreamzone, и то, из-за чего у Active Theory буквы «плывут»
    // при пролёте. Порог нужен, иначе в покое видна цветная кайма.
    const v = Math.min(1, Math.abs(velocity) * 0.85);
    const shadow =
      v > 0.02
        ? `${-v * 7}px 0 rgba(143,179,204,.55), ${v * 7}px 0 rgba(232,223,205,.35)`
        : "none";
    for (const el of glitch.current) if (el) el.style.textShadow = shadow;
    if (contactsTitleRef.current) contactsTitleRef.current.style.textShadow = shadow;
  };

  /** Выход из комнаты: кнопка вверху справа и подсказка внизу по центру —
      путь назад прокруткой вверх, как у igloo. Кнопку одну Илья не нашёл. */
  const closeButton = (k: number, hint: boolean) => (
    <>
      {/* Пальцем прокрутка из «обо мне» не выводит — на телефоне подсказки нет. */}
      {hint ? (
        <span className="instrument pointer-events-none absolute bottom-[var(--gutter)] left-1/2 -translate-x-1/2 whitespace-nowrap text-[var(--sand-dim)] pointer-coarse:hidden">
          <Flip text={t.scrollBack} />
        </span>
      ) : null}
      <button
        ref={(el) => {
          closeRefs.current[k] = el;
        }}
        type="button"
        onClick={closeRoom}
        onPointerEnter={flipHover}
        className="instrument pointer-events-auto absolute right-[var(--gutter)] top-[calc(var(--gutter)+56px)] z-10 text-[var(--sand-dim)] transition-colors duration-500 ease-[var(--ease-out-deep)] hover:text-[var(--color-sand)]"
      >
        {/* Esc на тач-экране нет — там подпись без него. Кнопка везде справа
            сверху под языком: на телефоне она стояла внизу, но вверху её видно
            лучше (Илья, 2026-11-10). */}
        <span className="pointer-coarse:hidden">
          <Flip text={t.close} />
        </span>
        <span className="hidden pointer-coarse:inline">
          <Flip text={t.closeTouch} />
        </span>
      </button>
    </>
  );

  /** Кнопка входа в комнату у выноски. Вход нажатием по самому объекту
      работает и так — кнопка нужна клавиатуре и тем, кто не догадался. */
  const enterButton = (k: number, text: string) => (
    <button
      ref={(el) => {
        enterRefs.current[k] = el;
      }}
      type="button"
      // detail === 0 — нажали Enter или пробел, а не мышью.
      onClick={(e) => openRoom(k, e.detail === 0)}
      onPointerEnter={flipHover}
      className="instrument pointer-events-auto text-[var(--color-sand)] transition-colors duration-500 ease-[var(--ease-out-deep)] hover:text-[var(--color-azure)]"
    >
      <Flip text={text} />
    </button>
  );

  const layerRef = (k: number) => (el: HTMLDivElement | null) => {
    layers.current[k] = el;
  };
  const roomRef = (k: number) => (el: HTMLDivElement | null) => {
    rooms.current[k] = el;
  };
  const tags = (k: number) => ({
    top: (el: HTMLDivElement | null) => {
      tagTop.current[k] = el;
    },
    bottom: (el: HTMLDivElement | null) => {
      tagBottom.current[k] = el;
    },
    title: (el: HTMLElement | null) => {
      glitch.current[k] = el;
    },
  });

  /** Строка подсказки: на мышь и на палец текст свой. Видна, пока жест не сделан. */
  const hintLine = (id: string, mouse: string, touch: string) => (
    <span className="hint instrument" data-on={hintsDone && !hintsDone.has(id) ? "" : undefined}>
      <span className="pointer-coarse:hidden">
        <Flip text={mouse} />
      </span>
      <span className="hidden pointer-coarse:inline">
        <Flip text={touch} />
      </span>
    </span>
  );

  /** Звук — линия, которая оживает волной того, что играет. Стоит под
      псевдонимом (Илья, 2026-11-05) во всю его ширину: `w-0 min-w-full` не даёт
      ей самой раздвинуть колонку.
      Пока её ни разу не нажимали, она изредка мягко вспыхивает: без этого
      линию принимали за деталь интерьера (Илья, 2026-11-05). Играет — горит песком,
      как остальные приборы, а не голубым (Илья, 2026-11-10). */
  const soundButton = (className: string) => (
    <button
      type="button"
      onClick={toggleSound}
      aria-pressed={sound}
      aria-label={sound ? t.soundOff : t.soundOn}
      data-hint={hintsDone && !hintsDone.has("sound") ? "" : undefined}
      className={`sound-toggle flex h-6 items-center transition-colors duration-500 ease-[var(--ease-out-deep)] ${
        sound ? "text-[var(--color-sand)]" : "text-[var(--sand-faint)] hover:text-[var(--color-sand)]"
      } ${className}`}
    >
      <svg
        width={WAVE_W}
        height={WAVE_H}
        viewBox={`0 0 ${WAVE_W} ${WAVE_H}`}
        preserveAspectRatio="none"
        aria-hidden
        className={`w-full overflow-visible ${sound ? "wave-glow" : ""}`}
      >
        {LINES.map((ln, i) => (
          <path
            key={i}
            ref={(el) => {
              waveRefs.current[i] = el;
            }}
            d={FLAT}
            fill="none"
            stroke="currentColor"
            strokeWidth={ln.width}
            strokeOpacity={ln.opacity}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
    </button>
  );

  /** Комната — один экран поверх притушенной сцены. Если окно ниже,
      содержимое прокручивается целиком, без видимой полосы: в комнате
      колесо отдано ему. Комната проекта (`fixed`) не прокручивается: она
      ровно в экран, и подсказка выхода у неё своя, сверху. */
  const roomShell = (k: number, label: string, children: React.ReactNode, accent?: string, fixed = false) => (
    <div
      key={`room-${k}`}
      ref={roomRef(k)}
      data-faded
      inert={room !== k}
      role="dialog"
      aria-label={label}
      data-accent={accent}
      className="pointer-events-none absolute inset-0 opacity-0"
    >
      {/* Ровная синева под текстом: материя вокруг видна, но не спорит с буквами. */}
      <div className="room-veil absolute inset-0" aria-hidden />
      {closeButton(k, !fixed)}
      {fixed ? (
        children
      ) : (
        <div
          data-room-scroll
          className="no-scrollbar pointer-events-auto absolute inset-0 touch-pan-y overflow-y-auto overscroll-contain px-[var(--gutter)] pb-[calc(var(--gutter)+40px)] pt-[calc(var(--gutter)+150px)]"
        >
          {children}
        </div>
      )}
    </div>
  );

  return (
    /* Текст мира не выделяется: синяя заливка выделения поверх сцены
       читалась багом и ломала погружение (Илья, 2026-10-18). Заодно
       жест кистью больше не протаскивает выделение по слоям. Палец — маршруту,
       не браузеру (`touch-none`): без этого Chrome не давал отменить свайп,
       и на Android он грозил перезагрузкой страницы. Колонка комнаты свою
       прокрутку возвращает (`touch-pan-y`). Высота — видимая (`svh`), а не
       100vh: на телефоне 100vh захватывает и место под адресной строкой, и всё,
       что стоит у низа, уходило за край (Илья, 2026-11-05: «меток снизу нет»). */
    <main className="relative h-svh w-full touch-none select-none overflow-hidden">
      <Scene
        stations={stations}
        landmarks={landmarks}
        onFrame={onFrame}
        onReady={onReady}
        onPick={openRoom}
        onExit={closeRoom}
        onLoaded={onLoaded}
        start={revealed}
      />

      {/* Заголовок для поиска и скринридеров: частицы их не заменяют. */}
      <h1 className="sr-only">
        {site.alias} — {site.thesis}
      </h1>

      {/* ── аллея ─────────────────────────────────────────────── */}
      {stops.map((s, k) => {
        if (s.kind === "contacts") {
          return (
            <div
              key="contacts"
              ref={layerRef(k)}
              data-faded
              inert={room !== null}
              onFocus={() => follow(k)}
              className="pointer-events-none absolute inset-0 opacity-0"
            >
              {/* Контакты строкой под «@», по оси экрана (Илья, 2026-11-03): угол
                  слева снизу при знаке по центру смотрелся неказисто. Слой едет
                  за низом знака — его ставит кадровый обработчик. */}
              <div ref={tags(k).bottom} className="absolute left-0 top-0">
                <div className="flex w-max max-w-[calc(100vw-2*var(--gutter))] -translate-x-1/2 flex-col items-center pt-[clamp(28px,5vh,52px)] text-center">
                  <h2 ref={contactsTitleRef} id="contacts" tabIndex={-1} className="instrument text-[var(--sand-dim)]">
                    <Flip text={`${t.contacts} · ${contacts.name}`} />
                  </h2>
                  {contacts.note ? (
                    <p className="mt-3 max-w-[44ch] text-[14px] font-extralight leading-[1.7] text-[var(--sand-dim)]">
                      {contacts.note}
                    </p>
                  ) : null}
                  {/* На телефоне — столбиком: строкой ссылки расходились к краям (Илья, 2026-11-10). */}
                  <ul className="mt-[18px] flex flex-wrap justify-center gap-x-[clamp(40px,6vw,88px)] gap-y-5 max-md:flex-col max-md:items-center max-md:gap-y-6">
                    {contacts.links.map((l) => (
                      <li key={l.url}>
                        {/* pointer-events включает сама ссылка: слой сквозной всегда. */}
                        <a
                          href={l.url}
                          {...(l.url.startsWith("mailto:") ? {} : { target: "_blank", rel: "noreferrer noopener" })}
                          onPointerEnter={flipHover}
                          className="group pointer-events-auto flex flex-col items-center transition-colors duration-500 ease-[var(--ease-out-deep)] hover:text-[var(--color-azure)]"
                        >
                          <span className="font-display text-[clamp(30px,2.8vw,40px)] font-light leading-none">{l.label}</span>
                          <span className="instrument mt-2.5 text-[var(--sand-dim)] transition-colors duration-500 ease-[var(--ease-out-deep)] group-hover:text-[var(--color-azure)]">
                            <Flip text={plain(l.url)} />
                          </span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Форма появляется, только когда в админке указан адрес приёмника.
                  Нет адреса — остаются ссылки, и экран не врёт пустой формой. */}
              {contacts.formUrl ? (
                // В полях формы выделять и править текст нужно — им можно.
                <div className="absolute bottom-[var(--gutter)] right-[var(--gutter)] w-[min(420px,36vw)] select-text">
                  <ContactForm url={contacts.formUrl} lang={lang} />
                </div>
              ) : null}
            </div>
          );
        }

        /* Точка с комнатой: на аллее только выноска у объекта, как у igloo —
           у проекта номер и имя сверху слева, вход снизу справа; у имени —
           только вход. Текст первого экрана Илья убрал: «не смотрится». */
        const tag = tags(k);
        const st = s.kind === "project" ? STATUS[s.project.status] : null;
        return (
          <div
            key={s.kind === "project" ? s.project.slug : s.kind}
            ref={layerRef(k)}
            data-faded={k === 0 ? undefined : true}
            inert={room !== null}
            data-accent={s.kind === "project" ? accentOf(s.project) : undefined}
            onFocus={() => follow(k)}
            className={`pointer-events-none absolute inset-0 ${k === 0 ? "" : "opacity-0"}`}
          >
            {s.kind === "project" && st ? (
              <div ref={tag.top} className="absolute left-0 top-0">
                <div className="flex -translate-y-full flex-col gap-1 pb-4">
                  <h2
                    ref={tag.title}
                    id={k === FIRST_PROJECT ? "projects" : undefined}
                    className="instrument max-w-[calc(100vw-2*var(--gutter)-16px)] text-[var(--color-sand)] md:max-w-none md:whitespace-nowrap"
                  >
                    {/* Без слова «проект»: и так ясно, что это работы (Илья, 2026-11-10). */}
                    <Flip text={`${pad(k - FIRST_PROJECT + 1)} / ${pad(projects.length)} · ${s.project.title}`} />
                  </h2>
                  <span className="flex items-center gap-2.5 whitespace-nowrap">
                    <span className={`h-[5px] w-[5px] shrink-0 rounded-full ${st.dot}`} aria-hidden />
                    <span className={`instrument ${st.text}`}>
                      <Flip text={`${STATUS_LABEL[lang][s.project.status]} · ${s.project.year}`} />
                    </span>
                  </span>
                </div>
              </div>
            ) : null}
            {s.kind === "experience" ? (
              /* У «Опыта» вход — сами огоньки: подпись под огоньком и есть
                 его кнопка, с клавиатуры тоже. */
              experience.items.map((j, i) => (
                <button
                  key={i}
                  ref={(el) => {
                    starLabels.current[i] = el;
                  }}
                  type="button"
                  onClick={(e) => openRoom(k, e.detail === 0, i)}
                  className="star-label instrument pointer-events-auto absolute left-0 top-0 whitespace-nowrap text-[var(--color-sand)]"
                >
                  <Flip text={j.place} />
                </button>
              ))
            ) : (
              <div ref={tag.bottom} className="absolute left-0 top-0">
                <div className={`-translate-x-full whitespace-nowrap text-right ${s.kind === "name" ? "" : "pt-4"}`}>
                  {enterButton(k, s.kind === "project" ? t.openProject : t.aboutEnter)}
                </div>
              </div>
            )}
            {s.kind === "name" || s.kind === "project" ? (
              <div
                ref={(el) => {
                  hintRefs.current[k] = el;
                }}
                aria-hidden
                className="absolute left-0 top-0"
              >
                <div className="flex -translate-x-1/2 flex-col items-center gap-1.5 whitespace-nowrap">
                  {s.kind === "name" ? (
                    <>
                      {hintLine("enjoy", t.hintEnjoy, t.hintEnjoyTouch)}
                      {hintLine("grip", t.hintGrip, t.hintGripTouch)}
                    </>
                  ) : (
                    hintLine("spin", t.hintSpin, t.hintSpinTouch)
                  )}
                </div>
              </div>
            ) : null}
          </div>
        );
      })}

      {/* ── комнаты ───────────────────────────────────────────── */}
      {stops.map((s, k) => {
        if (s.kind === "name") {
          /* «Обо мне»: кто я и что делаю — то, что раньше было текстом
             первого экрана и отдельной точкой с кольцами. Колонкой по центру,
             направления строкой внизу; имени крупно нет — оно и так облаком
             вокруг (Илья, 2026-11-03: две колонки «плохо читаются»). */
          return roomShell(
            k,
            t.about,
            <div data-wave className="mx-auto flex min-h-full max-w-[1160px] flex-col">
              <div className="my-auto flex flex-col items-center py-[clamp(24px,5vh,56px)] text-center">
                <p className="instrument text-[var(--sand-dim)]">
                  <Flip text={site.status} />
                </p>
                <h2 className="font-display mt-[clamp(18px,3vh,30px)] max-w-[22ch] text-[clamp(28px,2.4vw,40px)] font-light leading-[1.18]">
                  <WaveText text={site.thesis} still />
                </h2>
                <p className="mt-[clamp(18px,3vh,26px)] max-w-[54ch] text-[16px] font-extralight leading-[1.75] text-[var(--sand-dim)]">
                  <WaveText text={site.intro} />
                </p>
                {/* «Откуда я это умею» и «Как работаю» — двумя строками под абзацем
                    (Илья, 2026-11-06); на телефоне — как направления: подпись слева. */}
                {site.origin || site.process ? (
                  <div className="mt-[clamp(22px,3.4vh,34px)] grid w-full max-w-[720px] grid-cols-1 gap-x-[clamp(24px,3vw,44px)] gap-y-[18px] text-left md:grid-cols-2">
                    {(
                      [
                        [t.originLabel, site.origin],
                        [t.processLabel, site.process],
                      ] as const
                    ).map(([label, text]) =>
                      text ? (
                        <div key={label} className="grid grid-cols-[104px_1fr] gap-x-[14px] md:block">
                          <h3 className="instrument text-[var(--color-sand)]">
                            <Flip text={label} />
                          </h3>
                          <p className="text-[13.5px] font-extralight leading-[1.6] text-[var(--sand-dim)] md:mt-2">
                            <WaveText text={text} />
                          </p>
                        </div>
                      ) : null
                    )}
                  </div>
                ) : null}
              </div>
              <h3 className="sr-only">{t.whatIDo}</h3>
              {/* На узком экране — строками: название слева, описание справа
                  (Илья, 2026-11-05); четыре колонки там рвались по слову. */}
              <ul className="grid grid-cols-1 gap-x-[clamp(24px,2.8vw,40px)] gap-y-[18px] border-t border-[var(--line)] pt-[22px] md:grid-cols-4">
                {skills.map((x) => (
                  <li key={x.title} className="grid grid-cols-[104px_1fr] gap-x-[14px] md:block">
                    <h4 className="instrument text-[var(--color-sand)]">
                      <Flip text={x.title} />
                    </h4>
                    <p className="text-[13.5px] font-extralight leading-[1.6] text-[var(--sand-dim)] md:mt-2">
                      <WaveText text={x.lead} />
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          );
        }
        if (s.kind === "experience") {
          /* Комната одного огонька: где, кем, когда и что это дало.
             Один экран — закрывает прокрутка в любую сторону. */
          const j = experience.items[star] ?? experience.items[0];
          return roomShell(
            k,
            t.experience,
            <>
              <span className="instrument pointer-events-none absolute left-1/2 top-[calc(var(--gutter)+76px)] -translate-x-1/2 whitespace-nowrap text-[var(--sand-faint)] md:top-[calc(var(--gutter)+40px)]">
                <Flip text={t.scrollClose} />
              </span>
              <div className="absolute bottom-[calc(var(--gutter)+24px)] left-[var(--gutter)] flex max-w-[min(560px,46vw)] flex-col gap-3">
                <p className="instrument text-[var(--sand-dim)]">
                  <Flip text={`${t.experience} · ${pad(star + 1)} / ${pad(jobs)}`} />
                </p>
                <h2 className="font-display text-[clamp(38px,4.2vw,62px)] font-light leading-[1.02] tracking-[-0.02em]">
                  {j.place}
                </h2>
                <p className="instrument text-[var(--color-sand)]">
                  <Flip text={`${j.role} · ${j.years}`} />
                </p>
                {j.lesson ? (
                  <p className="max-w-[52ch] text-[14.5px] font-extralight leading-[1.75] text-[var(--sand-dim)]">{j.lesson}</p>
                ) : null}
              </div>
            </>,
            undefined,
            true
          );
        }
        if (s.kind !== "project") return null;
        const p = s.project;
        return roomShell(
          k,
          p.title,
          <ProjectRoom
            project={p}
            lang={lang}
            open={room === k}
            bind={binders[k]}
            layout={layouts[k]}
          />,
          accentOf(p),
          true
        );
      })}

      {/* ── повествование: подпись ворот ───────────────────────── */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <span
          ref={gateRef}
          className="instrument absolute left-1/2 top-1/2 whitespace-nowrap text-[var(--color-sand)] opacity-0"
        >
          <Flip text={`${t.projects} · 01–${pad(projects.length)}`} />
        </span>
      </div>

      {/* ── приборы: на всём круге ─────────────────────────────── */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-[var(--gutter)] top-[var(--gutter)] flex flex-col gap-0.5">
          {/* Имя — не слово: переводчик браузера его не трогает (Илья, 2026-11-05).
              Нажатие везёт на главную, к имени, одним шагом (Илья, 2026-11-10). */}
          <button
            type="button"
            translate="no"
            aria-label={`${site.alias} · ${t.home}`}
            onClick={(e) => jump(0, e, true)}
            onPointerEnter={flipHover}
            className="notranslate instrument pointer-events-auto self-start text-left text-[var(--color-sand)]"
          >
            <Flip text={site.alias} />
          </button>
          {/* Только псевдоним: статус есть в «обо мне», проект — в выноске над
              сферой (Илья, 2026-11-05: «лишний текст», сперва на телефоне, потом
              и на десктопе). Номер точки остаётся скринридеру. Под псевдонимом —
              звук, дорожкой во всю его ширину. */}
          <span ref={routeRef} className="sr-only">
            {route[0]}
          </span>
          {soundButton("pointer-events-auto mt-1 w-0 min-w-full")}
        </div>

        {/* Переключатель: к работам, звук, к контактам. Мысль подсмотрена
            у Active Theory, вид свой: без капсулы и свечения — строка
            приборов, а звук — линия, которая оживает волной того, что
            играет. Работает и из комнаты: сначала выводит на аллею.
            С 2026-11-05 (Илья) — «работы | контакт» строкой, язык под ними,
            звук — слева под псевдонимом; сперва на телефоне, потом везде. */}
        <nav
          aria-label={t.nav}
          className="pointer-events-auto absolute right-[var(--gutter)] top-[var(--gutter)] flex flex-col items-end gap-2"
        >
          <span className="flex items-center gap-2.5">
            {projects.length > 0 ? (
              <a
                href="#projects"
                onClick={(e) => jump(FIRST_PROJECT, e, true)}
                onPointerEnter={flipHover}
                className="instrument text-[var(--sand-dim)] transition-colors duration-500 ease-[var(--ease-out-deep)] hover:text-[var(--color-sand)]"
              >
                <Flip text={t.work} />
              </a>
            ) : null}
            {projects.length > 0 ? (
              <span aria-hidden className="instrument text-[var(--sand-faint)]">
                |
              </span>
            ) : null}
            <a
              href="#contacts"
              onClick={(e) => jump(CONTACTS, e, true)}
              onPointerEnter={flipHover}
              className="instrument text-[var(--sand-dim)] transition-colors duration-500 ease-[var(--ease-out-deep)] hover:text-[var(--color-sand)]"
            >
              <Flip text={t.contact} />
            </a>
          </span>
          {/* Язык: английский по умолчанию, русский и украинский — по выбору.
              Мир при смене не перезагружается, меняются только надписи. */}
          <span role="group" aria-label={t.language} className="flex items-center gap-1.5">
            {LANGS.map((l, i) => (
              <span key={l} className="flex items-center gap-1.5">
                {i > 0 ? (
                  <span aria-hidden className="instrument text-[var(--sand-faint)]">
                    /
                  </span>
                ) : null}
                <button
                  type="button"
                  lang={l}
                  onClick={() => setLang(l)}
                  onPointerEnter={flipHover}
                  aria-pressed={lang === l}
                  className={`instrument transition-colors duration-500 ease-[var(--ease-out-deep)] ${
                    lang === l ? "text-[var(--color-sand)]" : "text-[var(--sand-dim)] hover:text-[var(--color-sand)]"
                  }`}
                >
                  <Flip text={l} />
                </button>
              </span>
            ))}
          </span>
        </nav>

        {/* Полоска проектов справа (Илья, 2026-10-26): по черте на сферу, еле
            видны — сразу ясно, сколько их и где ты. Черта ближайшей горит
            и подписана, остальные подписываются под рукой. Нажатие везёт
            к сфере, как «работы» вверху. Видна только у сфер: на имени,
            у контактов и в комнатах гаснет. На телефоне — рядом внизу, черты
            стоймя и без подписей: справа она ложилась на сферу (Илья, 2026-11-05). */}
        {projects.length > 0 ? (
          <nav
            ref={stripRef}
            aria-label={t.projects}
            data-faded
            className="strip absolute bottom-[var(--gutter)] left-1/2 flex -translate-x-1/2 items-end md:bottom-auto md:left-auto md:right-[var(--gutter)] md:top-1/2 md:translate-x-0 md:-translate-y-1/2 md:flex-col"
          >
            {projects.map((p, i) => (
              <a
                key={p.slug}
                ref={(el) => {
                  stripRefs.current[i + FIRST_PROJECT] = el;
                }}
                href={`#${p.slug}`}
                aria-label={p.title}
                onClick={(e) => jump(i + FIRST_PROJECT, e, true)}
                onPointerEnter={flipHover}
                className="pointer-events-auto flex h-[32px] w-[16px] items-end justify-center md:h-[14px] md:w-auto md:items-center md:justify-start md:gap-3"
              >
                <span className="strip-label instrument whitespace-nowrap">
                  <Flip text={p.title} />
                </span>
                <span aria-hidden className="strip-line" />
              </a>
            ))}
          </nav>
        ) : null}
      </div>

      <Loader title={site.alias} ready={loaded} onDone={onRevealed} />
    </main>
  );
}
