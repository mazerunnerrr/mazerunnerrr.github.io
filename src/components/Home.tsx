"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Scene, type FrameInfo, type SceneApi, type StationSpec } from "@/components/Scene";
import type { ChapterLight, Landmark } from "@/lib/environment";
import type { Contacts, Project, Site, Skill } from "@/content";
import { ContactForm } from "@/components/ContactForm";
import { Ambience } from "@/lib/ambience";
import { Cover } from "@/components/Cover";
import { ProjectBody } from "@/components/ProjectBody";
import { STATUS } from "@/lib/status";

/* Маршрут — аллея-кольцо, как у igloo.inc: имя → проекты по одному →
   контакты, и снова имя. У имени и у каждого проекта своя комната: нажал
   на объект — вошёл, колесо её не двигает. Отдельной точки «Что делаю»
   больше нет: всё обо мне — в комнате имени (Илья, 2026-10-18). */
type Stop =
  | { kind: "name"; label: string }
  | { kind: "project"; label: string; project: Project }
  | { kind: "contacts"; label: string };

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
/** Проявление с разгоном и торможением: по прямой оно обрывается на полной
    яркости, и конец читается скачком. */
const ease = (x: number) => x * x * (3 - 2 * x);

/* Свет глав. Каждая точка подсвечена по-своему внутри полночного синего:
   имя — тёплым снизу, как рассвет; у раздела проектов свой голографический
   свет снизу; контакты — янтарём сбоку. Сила малая: это настроение, а не пятно. */
const LIGHT: Record<"name" | "projects" | "contacts", ChapterLight> = {
  name: { color: "#d8b98a", amount: 0.1, dir: [-0.55, -0.85] },
  projects: { color: "#6f8fff", amount: 0.16, dir: [0, -1] },
  contacts: { color: "#d6a96a", amount: 0.11, dir: [0.9, -0.4] },
};
const pad = (n: number) => String(n).padStart(2, "0");

/** Волна в переключателе звука: столько точек на линии и её размер. */
const WAVE = 48;
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

/* Прозрачность слоя плюс метка «погас» для CSS: кнопки погасшего слоя
   перестают ловить клики. Метка пишется только при смене, не каждый кадр.

   Метка зависит не только от прозрачности, но и от того, чья сейчас точка.
   Камера, застывшая между точками, оставляла соседний слой почти невидимым,
   но кликабельным: невидимые контакты перехватывали нажатие на соседа.
   Теперь нажатия принимает только ближайшая к камере точка. */
const fade = (el: HTMLElement, opacity: number, own: boolean) => {
  el.style.opacity = String(opacity);
  const off = !own || opacity < 0.05;
  if (el.hasAttribute("data-faded") !== off) el.toggleAttribute("data-faded", off);
};

/** Адрес без служебной части: в строке рядом со ссылкой она лишняя. */
const plain = (url: string) => url.replace(/^mailto:/, "").replace(/^https?:\/\//, "");

/* Объект из частиц — герой, текст — приборы. Всё, что написано, стоит
   по углам мелким моноширинным шрифтом или выноской у объекта. */
export function Home({
  site,
  skills,
  projects,
  contacts,
}: {
  site: Site;
  skills: Skill[];
  projects: Project[];
  contacts: Contacts;
}) {
  const stops = useMemo<Stop[]>(
    () => [
      { kind: "name", label: "имя" },
      ...projects.map((p): Stop => ({ kind: "project", label: `проект · ${p.title}`, project: p })),
      { kind: "contacts", label: "контакты" },
    ],
    [projects]
  );
  const N = stops.length;
  const FIRST_PROJECT = 1;
  const CONTACTS = N - 1;

  /** Номер точки на круге для прибора слева сверху. Нумерация честная:
      это последовательность маршрута, а не украшение. */
  const route = useMemo(() => stops.map((s, i) => `${pad(i + 1)} / ${pad(stops.length)} · ${s.label}`), [stops]);

  /** Якоря, с которых встают на точку сразу, без пролёта: так страница
      проекта возвращает к своему проекту, а не заново на имя. */
  const hashStops = useMemo(() => {
    const map: Record<string, number> = { "#about": 0, "#skills": 0, "#contacts": stops.length - 1 };
    stops.forEach((s, i) => {
      if (s.kind !== "project") return;
      map[`#${s.project.slug}`] = i;
      map["#projects"] ??= i;
    });
    return map;
  }, [stops]);

  /* Объекты точек. Массив мемоизирован по значениям, а не по ссылкам
     на пропсы: новый на каждый рендер пересобирал бы сцену. */
  /** Кадры проектов — по значениям, а не по ссылкам: см. выше. */
  const media = JSON.stringify(projects.map((p) => ({ video: p.video, images: p.shots })));
  const stations = useMemo<StationSpec[]>(
    () => [
      /* Имя. Распыление зажатой рукой — только у него: это первый экран
         и его фирменный жест. Нажатие раскрывает имя облаком — комната
         «обо мне». */
      { shape: { kind: "text", text: site.alias }, room: "burst", grip: "spray", dim: 0.6, light: LIGHT.name },
      /* Проекты — сферы-сетки одного вида, на каждой проступает кадр
         проекта: сразу видно, что это работы и что по ним можно нажать.
         Зажал и повёл — сфера вертится в любую сторону; нажал — она
         раскрывается, как раскладная игрушка, и ты внутри (Илья,
         2026-10-16 и 18). Оболочку внутри притушиваем слабо: ты должен
         видеть, что стоишь внутри сферы. */
      ...(JSON.parse(media) as StationSpec["media"][]).map(
        (m): StationSpec => ({
          shape: { kind: "sphere", r: 0.2 },
          room: { kind: "sphere", r: 1.5, cz: 0.55 },
          grip: "spin",
          dim: 0.05,
          media: m,
          light: LIGHT.projects,
        })
      ),
      { shape: { kind: "text", text: "@" }, light: LIGHT.contacts },
    ],
    [site.alias, media]
  );

  /* Ориентиры на переходах: перед первым проектом — ворота раздела, на
     остальных — арки. Между двумя проектами ориентира нет: там сфера не
     улетает, а пересобирается на месте. */
  const landmarks = useMemo<Landmark[]>(
    () =>
      stops.flatMap((s, k): Landmark[] => {
        const next = stops[(k + 1) % stops.length];
        if (s.kind === "project" && next.kind === "project") return [];
        const gate = next.kind === "project" && s.kind !== "project";
        return [{ at: k + 0.5, kind: gate ? "gate" : "arcs" }];
      }),
    [stops]
  );
  const GATE = landmarks.findIndex((m) => m.kind === "gate");

  /** Строка-связка на переходе от точки k к следующей. Между проектами
      связок нет: это один раздел. */
  const bridgeOf = (k: number) => {
    const to = stops[(k + 1) % stops.length].kind;
    const from = stops[k].kind;
    if (to === "project" && from !== "project") return site.bridges.toProjects;
    if (to === "contacts") return site.bridges.toContacts;
    if (to === "name") return site.bridges.toName;
    return undefined;
  };

  const layers = useRef<(HTMLDivElement | null)[]>([]);
  const tagTop = useRef<(HTMLDivElement | null)[]>([]);
  const tagBottom = useRef<(HTMLDivElement | null)[]>([]);
  const rooms = useRef<(HTMLDivElement | null)[]>([]);
  const enterRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const closeRefs = useRef<(HTMLButtonElement | null)[]>([]);
  /** Заголовки, которые расслаиваются на скорости. */
  const glitch = useRef<(HTMLElement | null)[]>([]);
  const contactsTitleRef = useRef<HTMLHeadingElement>(null);
  const routeRef = useRef<HTMLSpanElement>(null);
  const lastLabel = useRef("");
  const gateRef = useRef<HTMLSpanElement>(null);
  const bridgeRef = useRef<HTMLParagraphElement>(null);
  /** Связка задерживается после прибытия: с какой точки пришли и когда. */
  const bridgeNear = useRef(0);
  const bridgeAt = useRef(-1e9);
  const bridgeSeg = useRef(-1);
  const waveRefs = useRef<(SVGPathElement | null)[]>([]);
  const wavePhase = useRef(new Float32Array(LINES.length));
  const waveBands = useRef(new Float32Array(LINES.length));
  const waveFlat = useRef(true);
  const waveAt = useRef(0);
  const apiRef = useRef<SceneApi | null>(null);
  // Монитор с обложкой проекта листает кадры только под рукой.
  const [monitor, setMonitor] = useState(false);

  /* Открытая комната. Состояние React — меняется по нажатию, а не каждый
     кадр. Слой комнаты гаснет вслед за материей уже после закрытия, поэтому
     помним и ту, что была открыта последней. */
  const [room, setRoom] = useState<number | null>(null);
  const lastRoom = useRef<number | null>(null);

  // Звук выключен по умолчанию и собирается только по первому нажатию:
  // браузер не даёт аудио начаться без жеста посетителя.
  const [sound, setSound] = useState(false);
  const ambienceRef = useRef<Ambience | null>(null);
  const lastSound = useRef(0);
  useEffect(() => () => ambienceRef.current?.close(), []);
  const toggleSound = () => {
    const next = !sound;
    if (next && !ambienceRef.current) {
      ambienceRef.current = new Ambience(site.music);
      ambienceRef.current.duck(room !== null);
    }
    ambienceRef.current?.set(next);
    setSound(next);
  };
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
  const openRoom = (k: number, keyboard = false) => {
    keyboardEntry.current = keyboard;
    const kind = stops[k]?.kind;
    if (kind !== "name" && kind !== "project") return;
    lastRoom.current = k;
    setRoom(k);
    apiRef.current?.setRoom(k);
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

  /* Переход из переключателя: к работам или к контактам — откуда угодно,
     в том числе из комнаты. Фокус едет вместе с камерой, иначе следующий
     Tab вернул бы её назад. Обработчики не каррированы нарочно: вызов вида
     jump(2) в разметке выполнялся бы во время рендера. */
  const jump = (stop: number, e: React.MouseEvent) => {
    if (!apiRef.current) return;
    e.preventDefault();
    if (room !== null) closeRoom();
    apiRef.current.goTo(stop);
    (stop === CONTACTS ? contactsTitleRef.current : enterRefs.current[stop])?.focus({ preventScroll: true });
  };

  /* Tab ведёт по маршруту: фокус, попавший в погасший слой, зовёт камеру
     к его точке. Раньше он молча вставал на невидимую ссылку. */
  const follow = (stop: number) => apiRef.current?.goTo(stop);

  /* Всё, что меняется каждый кадр, пишется прямо в style и textContent.
     Через состояние React это был бы ре-рендер шестьдесят раз в секунду.

     pointer-events здесь НЕ трогаем. Слои лежат поверх канваса на весь
     экран, и стоит выставить им `auto` — они перехватывают всю мышь,
     до сцены не доходит ни одного события, и кажется, что интерактив
     мёртв. Слои сквозные всегда, а кликабельность включают сами кнопки
     и ссылки классом `pointer-events-auto`. */
  const onFrame = ({ progress, velocity, stations: at, room: amount, marks, hand }: FrameInfo) => {
    /** Чья сейчас точка: к ней камера ближе всего, ей и принимать нажатия. */
    const near = ((Math.round(progress) % N) + N) % N;
    /** Пока открыта комната, аллея гаснет целиком. */
    const corridor = 1 - amount;
    const free = room === null;

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
      } else {
        // Выноска у объекта: видна, пока он стоит перед камерой, и едет
        // вместе с ним — подпись сверху слева, вход снизу справа.
        // Раскрывают объект рукой — подписи уходят вдвое быстрее материи,
        // иначе они висят внутри раскрытой сферы.
        fade(el, ease(clamp01(1 - Math.abs(f.d) * 4)) * f.vis * ease(clamp01(1 - amount * 2)), near === k && free);
        const top = tagTop.current[k];
        const bottom = tagBottom.current[k];
        if (top) top.style.transform = `translate3d(${f.x - f.hw}px, ${f.y - f.hh}px, 0)`;
        if (bottom) bottom.style.transform = `translate3d(${f.x + f.hw}px, ${f.y + f.hh}px, 0)`;
      }
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

    /* Подпись ворот раздела — над их верхней дугой, пока ворота в кадре. */
    const gate = GATE >= 0 ? marks[GATE] : undefined;
    if (gateRef.current) {
      const vis = gate ? gate.vis * corridor : 0;
      gateRef.current.style.opacity = String(vis);
      if (gate && vis > 0.01) gateRef.current.style.transform = `translate(-50%, ${-gate.r - 34}px)`;
    }

    /* Строка-связка — титр внизу по центру: видна на переходе и ещё
       несколько секунд после прибытия, чтобы её успели прочитать. На ходу
       вперёд — связка этого перехода; назад — та же, но без задержки. */
    const now = performance.now();
    if (bridgeRef.current) {
      if (near !== bridgeNear.current) {
        if (near === (bridgeNear.current + 1) % N) bridgeAt.current = now;
        bridgeNear.current = near;
      }
      const base = Math.floor(progress);
      const frac = progress - base;
      const seg = ((base % N) + N) % N;
      const flight = Math.min(clamp01((frac - 0.08) / 0.2), clamp01((0.92 - frac) / 0.2));
      const linger = clamp01(1 - (now - bridgeAt.current - 3500) / 700);
      const lingerSeg = (near - 1 + N) % N;
      /* Перелёт и задержка складываются через максимум: на ходу вперёд
         связка набирает яркость в полёте и так и стоит, пока не истечёт
         задержка. Раньше прозрачность в конце перехода прыгала с нуля
         сразу на полную. Текст при этом тот же — сегмент один. */
      const k = flight > 0.01 ? seg : lingerSeg;
      const text = bridgeOf(k) ?? "";
      if (k !== bridgeSeg.current) {
        bridgeSeg.current = k;
        bridgeRef.current.textContent = text;
      }
      bridgeRef.current.style.opacity = String(ease(Math.max(flight, linger)) * corridor * (text ? 1 : 0));
    }

    // Номер точки на круге — только при смене, а не каждый кадр.
    const label = room !== null ? `${route[room]} · внутри` : route[near];
    if (label !== lastLabel.current) {
      lastLabel.current = label;
      if (routeRef.current) routeRef.current.textContent = label;
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
  const closeButton = (k: number) => (
    <>
      <span className="instrument pointer-events-none absolute bottom-[var(--gutter)] left-1/2 -translate-x-1/2 whitespace-nowrap text-[var(--sand-dim)]">
        ↑ прокрути вверх — назад
      </span>
      <button
        ref={(el) => {
          closeRefs.current[k] = el;
        }}
        type="button"
        onClick={closeRoom}
        className="instrument pointer-events-auto absolute right-[var(--gutter)] top-[calc(var(--gutter)+40px)] text-[var(--sand-dim)] transition-colors duration-500 ease-[var(--ease-out-deep)] hover:text-[var(--color-sand)]"
      >
        закрыть · esc
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
      className="instrument pointer-events-auto text-[var(--color-sand)] transition-colors duration-500 ease-[var(--ease-out-deep)] hover:text-[var(--color-azure)]"
    >
      {text}
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

  /** Комната — один экран поверх притушенной сцены. Если окно ниже,
      содержимое прокручивается целиком, без видимой полосы: в комнате
      колесо отдано ему. */
  const roomShell = (k: number, label: string, children: React.ReactNode, accent?: string) => (
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
      {closeButton(k)}
      <div
        data-room-scroll
        className="no-scrollbar pointer-events-auto absolute inset-0 overflow-y-auto overscroll-contain px-[var(--gutter)] pb-[calc(var(--gutter)+40px)] pt-[calc(var(--gutter)+150px)]"
      >
        {children}
      </div>
    </div>
  );

  return (
    /* Текст мира не выделяется: синяя заливка выделения поверх сцены
       читалась багом и ломала погружение (Илья, 2026-10-18). Заодно
       жест кистью больше не протаскивает выделение по слоям. */
    <main className="relative h-screen w-full select-none overflow-hidden">
      <Scene
        stations={stations}
        landmarks={landmarks}
        onFrame={onFrame}
        onReady={onReady}
        onPick={openRoom}
        onExit={closeRoom}
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
              <div className="absolute bottom-[var(--gutter)] left-[var(--gutter)] flex w-[min(460px,40vw)] flex-col items-start gap-3">
                <h2 ref={contactsTitleRef} id="contacts" tabIndex={-1} className="instrument text-[var(--sand-dim)]">
                  Контакты · {contacts.name}
                </h2>
                {contacts.note ? (
                  <p className="max-w-[40ch] text-[14px] font-extralight leading-[1.7] text-[var(--sand-dim)]">
                    {contacts.note}
                  </p>
                ) : null}
                <ul className="mt-1 w-full">
                  {contacts.links.map((l) => (
                    <li key={l.url} className="border-t border-[var(--line)]">
                      {/* pointer-events включает сама ссылка: слой сквозной всегда. */}
                      <a
                        href={l.url}
                        {...(l.url.startsWith("mailto:") ? {} : { target: "_blank", rel: "noreferrer noopener" })}
                        className="group pointer-events-auto flex items-baseline justify-between gap-6 py-3 transition-colors duration-500 ease-[var(--ease-out-deep)] hover:text-[var(--color-azure)]"
                      >
                        <span className="font-display text-[26px] font-light leading-none">{l.label}</span>
                        <span className="instrument text-[var(--sand-dim)] transition-colors duration-500 ease-[var(--ease-out-deep)] group-hover:text-[var(--color-azure)]">
                          {plain(l.url)}
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Форма появляется, только когда в админке указан адрес приёмника.
                  Нет адреса — остаются ссылки, и экран не врёт пустой формой. */}
              {contacts.formUrl ? (
                // В полях формы выделять и править текст нужно — им можно.
                <div className="absolute bottom-[var(--gutter)] right-[var(--gutter)] w-[min(420px,36vw)] select-text">
                  <ContactForm url={contacts.formUrl} />
                </div>
              ) : null}
            </div>
          );
        }

        /* Точка с комнатой: на аллее только выноска у объекта, как у igloo —
           у проекта номер и имя сверху слева, вход снизу справа; у имени —
           только вход. Текст первого экрана Илья убрал: «не смотрится». */
        const t = tags(k);
        const st = s.kind === "project" ? STATUS[s.project.status] : null;
        return (
          <div
            key={s.kind === "project" ? s.project.slug : s.kind}
            ref={layerRef(k)}
            data-faded={k === 0 ? undefined : true}
            inert={room !== null}
            data-accent={s.kind === "project" ? s.project.accent : undefined}
            onFocus={() => follow(k)}
            className={`pointer-events-none absolute inset-0 ${k === 0 ? "" : "opacity-0"}`}
          >
            {s.kind === "project" && st ? (
              <div ref={t.top} className="absolute left-0 top-0">
                <div className="flex -translate-y-full flex-col gap-1 pb-4">
                  <h2
                    ref={t.title}
                    id={k === FIRST_PROJECT ? "projects" : undefined}
                    className="instrument whitespace-nowrap text-[var(--color-sand)]"
                  >
                    {`проект ${pad(k - FIRST_PROJECT + 1)} / ${pad(projects.length)} · ${s.project.title}`}
                  </h2>
                  <span className="flex items-center gap-2.5 whitespace-nowrap">
                    <span className={`h-[5px] w-[5px] shrink-0 rounded-full ${st.dot}`} aria-hidden />
                    <span className={`instrument ${st.text}`}>
                      {s.project.status} · {s.project.year}
                    </span>
                  </span>
                </div>
              </div>
            ) : null}
            <div ref={t.bottom} className="absolute left-0 top-0">
              <div className="-translate-x-full whitespace-nowrap pt-4 text-right">
                {enterButton(k, s.kind === "project" ? "открыть проект ↵" : "обо мне ↵")}
              </div>
            </div>
          </div>
        );
      })}

      {/* ── комнаты ───────────────────────────────────────────── */}
      {stops.map((s, k) => {
        if (s.kind === "name") {
          /* «Обо мне»: кто я и что делаю — то, что раньше было текстом
             первого экрана и отдельной точкой с кольцами. */
          return roomShell(
            k,
            "Обо мне",
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-[clamp(32px,6vw,110px)]">
              <div className="flex flex-col gap-[clamp(16px,2.6vh,26px)]">
                <p className="eyebrow text-[var(--sand-faint)]">{site.status}</p>
                <h2 className="font-display text-[clamp(38px,4.2vw,62px)] font-light leading-[1.02] tracking-[-0.02em]">
                  {site.alias}
                </h2>
                <p className="font-display max-w-[24ch] text-[clamp(22px,2.1vw,30px)] font-light leading-[1.2]">
                  {site.thesis}
                </p>
                <p className="max-w-[52ch] text-[14.5px] font-extralight leading-[1.75] text-[var(--sand-dim)]">
                  {site.intro}
                </p>
              </div>
              <div>
                <h3 className="font-display text-[clamp(20px,1.8vw,26px)] font-light leading-tight">Что делаю</h3>
                <ul className="mt-5 space-y-5">
                  {skills.map((x) => (
                    <li key={x.title}>
                      <h4 className="instrument text-[var(--color-sand)]">{x.title}</h4>
                      <p className="mt-1.5 max-w-[56ch] text-[13.5px] font-extralight leading-[1.65] text-[var(--sand-dim)]">
                        {x.lead}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          );
        }
        if (s.kind !== "project") return null;
        const p = s.project;
        return roomShell(
          k,
          p.title,
          <ProjectBody
            project={p}
            room
            hero={
              p.video || p.shots.length ? (
                <div onPointerEnter={() => setMonitor(true)} onPointerLeave={() => setMonitor(false)}>
                  <Cover video={p.video} shots={p.shots} alt={`${p.title}: экраны`} active={monitor && room === k} />
                  <span className="instrument mt-2 block text-[var(--sand-dim)]">экраны проекта · наведи</span>
                </div>
              ) : null
            }
          />,
          p.accent
        );
      })}

      {/* ── повествование: подпись ворот и строка-связка ────────── */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <span
          ref={gateRef}
          className="instrument absolute left-1/2 top-1/2 whitespace-nowrap text-[var(--color-sand)] opacity-0"
        >
          проекты · 01–{pad(projects.length)}
        </span>
        <p
          ref={bridgeRef}
          className="font-display absolute bottom-[calc(var(--gutter)+36px)] left-1/2 w-[min(640px,80vw)] -translate-x-1/2 text-center text-[clamp(18px,1.6vw,24px)] font-light leading-[1.3] text-[var(--color-sand)] opacity-0"
        />
      </div>

      {/* ── приборы: на всём круге ─────────────────────────────── */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-[var(--gutter)] top-[var(--gutter)] flex flex-col gap-0.5">
          <span className="instrument text-[var(--color-sand)]">{site.alias}</span>
          <span className="instrument text-[var(--sand-dim)]">{site.status}</span>
          <span ref={routeRef} className="instrument text-[var(--sand-dim)]">
            {route[0]}
          </span>
        </div>

        {/* Переключатель: к работам, звук, к контактам. Мысль подсмотрена
            у Active Theory, вид свой: без капсулы и свечения — строка
            приборов, а звук — линия, которая оживает волной того, что
            играет. Работает и из комнаты: сначала выводит на аллею. */}
        <nav
          aria-label="Переходы и звук"
          className="pointer-events-auto absolute right-[var(--gutter)] top-[var(--gutter)] flex items-center gap-4"
        >
          {projects.length > 0 ? (
            <a
              href="#projects"
              onClick={(e) => jump(FIRST_PROJECT, e)}
              className="instrument text-[var(--sand-dim)] transition-colors duration-500 ease-[var(--ease-out-deep)] hover:text-[var(--color-sand)]"
            >
              работы
            </a>
          ) : null}
          <button
            type="button"
            onClick={toggleSound}
            aria-pressed={sound}
            aria-label={sound ? "Выключить звук" : "Включить звук"}
            className={`flex h-6 items-center transition-colors duration-500 ease-[var(--ease-out-deep)] ${
              sound ? "text-[var(--color-azure)]" : "text-[var(--sand-faint)] hover:text-[var(--color-sand)]"
            }`}
          >
            <svg
              width={WAVE_W}
              height={WAVE_H}
              viewBox={`0 0 ${WAVE_W} ${WAVE_H}`}
              aria-hidden
              className={`overflow-visible ${sound ? "wave-glow" : ""}`}
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
                />
              ))}
            </svg>
          </button>
          <a
            href="#contacts"
            onClick={(e) => jump(CONTACTS, e)}
            className="instrument text-[var(--sand-dim)] transition-colors duration-500 ease-[var(--ease-out-deep)] hover:text-[var(--color-sand)]"
          >
            контакт
          </a>
        </nav>
      </div>
    </main>
  );
}
