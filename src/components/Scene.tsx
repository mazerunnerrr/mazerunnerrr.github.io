"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { buildShape, burstShape, focusShape, inkOf, textShape, type Shape, type ShapeSpec } from "@/lib/shapes";
import { FIELD_VERT, FIELD_FRAG, PARTICLE_VERT, PARTICLE_FRAG, REFORM_END } from "@/lib/shaders";
import { Journey } from "@/lib/journey";
import { RoomSurfaces, sphereGlow, type RoomLayout } from "@/lib/roomSurface";
import { Water } from "@/lib/fluid";
import {
  Environment,
  chapterLight,
  ringOffset,
  type ChapterLight,
  type Landmark,
  type MarkFrame,
} from "@/lib/environment";

/** Полночный синий — фон сайта (выбран Ильёй 2026-10-16). */
const VOID = new THREE.Color("#0b1633");
const AZURE = new THREE.Color("#8fb3cc");
const SAND = new THREE.Color("#e8dfcd");

/** Радиус мазка по воде — доля высоты экрана: воду рука мешает шире, чем точки. */
const WATER_R = 0.2;

/* Аллея-кольцо. Каждый объект собирается и рассыпается по центру экрана:
   подлетающий — из глубины, уходящий — сквозь камеру. Так было у одного
   мира, и Илье это нравилось; въезд объектов сбоку, вглубь аллеи, он
   забраковал (2026-10-16). Между точками — полёт сквозь материю, а доводка
   маршрута не даёт на нём остановиться. */
/** За какую долю пути до соседней точки объект собирается или уходит. */
const PASS = 0.6;
/** Секунды на раскрытие сферы в комнату и на обратную сборку. */
const UNFOLD = 2.1;
/* Ход раскрытия сферы во времени, таблицей по 1/20 (Илья, 2026-10-20:
   «погружение линейное — нужно как откат к сцене: плавно начинает и плавно
   останавливает внутри сферы»). Глаз читает погружение как наезд — по
   логарифму видимого масштаба, а не по пикселям. Таблица подобрана обратным
   счётом: наезд идёт той же кубической кривой, что откат аллеи к точке
   (journey.ts), — трогается мягко, быстрее всего на пролёте сквозь стенку
   и долго, гладко садится внутри. Считана для сферы 0.2 → 1.5 высоты
   со сдвигом 0.55, FOV 50: всё в долях высоты, от размера окна не зависит. */
const UNFOLD_CURVE = [
  0, 0.001, 0.004, 0.013, 0.032, 0.062, 0.107, 0.169, 0.249, 0.352, 0.481,
  0.611, 0.719, 0.806, 0.875, 0.926, 0.962, 0.984, 0.996, 1, 1,
];
const unfoldAt = (t: number) => {
  const x = Math.max(0, Math.min(1, t)) * 20;
  const k = Math.min(19, Math.floor(x));
  return UNFOLD_CURVE[k] + (UNFOLD_CURVE[k + 1] - UNFOLD_CURVE[k]) * (x - k);
};

/** Точка маршрута: объект на аллее и, если есть, его комната. */
export type StationSpec = {
  /** Каким объект стоит на аллее. */
  shape: ShapeSpec;
  /** Каким раскрывается в своей комнате. "burst" — та же форма, раздутая
      облаком (так имя раскрывается в «обо мне»). Нет комнаты — точка
      читается прямо на аллее, как контакты. */
  room?: ShapeSpec | "burst";
  /** Что делает зажатая кнопка. "spray" — распыление и раскрутка, только
      у имени; "spin" — сфера вертится за рукой в любую сторону, как планеты
      в приложении Mole, а раскрывается по нажатию (Илья, 2026-10-18).
      "magnet" — огоньки «Опыта» летят за рукой паровозиком (Илья, 2026-11-02).
      Нет — зажатие объект не трогает. */
  grip?: "spray" | "spin" | "magnet";
  /** Насколько притушить объект в комнате, чтобы текст поверх читался: 0..1. */
  dim?: number;
  /** Кадры проекта, которые проступают на сфере: видео или скриншоты. */
  media?: { video?: string; images: string[] };
  /** Свет главы — подсветка фона, пока камера у этой точки. */
  light?: ChapterLight;
  /** Свет комнаты: пока она открыта, фон тонируется её цветом. */
  roomLight?: ChapterLight;
  /** Как объект прилетает на аллею и как уходит с неё (`uFlow` в шейдере).
      Нет — разворот очередью и дождь в камеру, как у всех. "condense" —
      сгущение из ничего, как обратный "scatter", но закручиваясь в другую сторону. */
  arrive?: "implode" | "condense" | "vortex";
  leave?: "streak" | "scatter";
  /** Пересобирается на месте с соседней надписью, у которой тоже стоит этот
      флаг, — как две сферы подряд. */
  reform?: boolean;
  /** Насколько поднять объект над серединой окна, доля высоты: под «@» стоят
      контакты, и вместе они должны стоять по центру. Поднимается камера —
      плавно, по мере подлёта к точке, — поэтому формы, рука и пересборка
      в соседа не знают о сдвиге. */
  rise?: number;
  /** Во сколько раз длиннее колесом и пальцем путь от этой точки к следующей. */
  stretch?: number;
};

const FLOW = { streak: 1, implode: 2, scatter: 3, condense: 4, vortex: 5 } as const;
/* Свой путь у некоторых переходов вместо общего PASS (Илья, 2026-10-21).
   Имя уходит вслед за воротами, а не через полпути после них: ворота
   уже за краями кадра, а буквы всё висели. Первая сфера начинает сгущаться,
   когда ворота и имя ушли, — с общим PASS впереди потом долго было пусто,
   и казалось, что крутишь не туда. */
const REACH: Partial<Record<keyof typeof FLOW, number>> = { streak: 0.45, condense: 0.68 };

/** Во сколько раз гуще имени сфера проекта: мелкой сетке нужна сплошная
    линия на каждом ребре, а на редкой и кадр не разобрать. */
const SPHERE_DENSITY = 4.4;
/** Радиан поворота имени на пиксель хода руки. */
const TWIST_PER_PX = 0.0055;
/* Вход в «обо мне» — как распыление рукой: облако расходится от слова
   целиком и ровно; обратно собирается так же. Прежде точки трогались
   вразнобой и шли дугой к зрителю — «с разных сторон в разные позиции»;
   потом стартовали с полной скорости — «резко» (Илья, 2026-10-20). Синус
   за 2,1 с вышел «очень медленно» (2026-10-21): теперь экспонента в обе
   стороны за BURST — долгий мягкий разгон, быстрый пролёт, долгая посадка. */
/* У экспоненты на концах остаётся ~11% средней скорости: на облаке огонька
   (700 px пути) раскрытие не садилось, а обрывалось (Илья, 2026-11-02).
   Кубическая поправка гасит скорость на обоих концах, середину не трогает. */
const BURST_EDGE = (5 * Math.LN2 * Math.pow(2, -5)) / (1 - Math.pow(2, -5));
const burstAt = (t: number) => inOutExpo(t) - BURST_EDGE * (t - 3 * t * t + 2 * t * t * t);
/** Секунды на вход в «обо мне» и обратную сборку имени. */
const BURST = 1.4;
/** Экспонента в обе стороны: 0 → 1 с плавным разгоном и плавной посадкой.
    `s` — крутизна: чем больше, тем дольше хвосты и резче середина. */
const inOutExpo = (t: number, s = 5) => {
  const x = Math.max(0, Math.min(1, t));
  const lo = Math.pow(2, -s);
  const half = (y: number) => (Math.pow(2, s * (2 * y - 1)) - lo) / (2 * (1 - lo));
  return x < 0.5 ? half(x) : 1 - half(1 - x);
};
/** Собственное вращение сферы, радиан в секунду: оборот за три минуты.
    Втрое быстрее мешало глазам (Илья, 2026-10-18). */
const SPHERE_SPIN = 0.035;
/** Яркость кадра, светящегося внутри сферы (сам свет сжат в GLOW_FRAG). */
const GLOW = 1;
/** Инерция брошенной рукой сферы: вязкое трение, 1/с, и сухое, рад/с². */
const SPIN_DRAG = 0.5;
const SPIN_DRY = 0.4;
/** Каждые сколько секунд на сфере сменяется скриншот и за сколько. */
const SHOT_HOLD = 4.5;
const SHOT_FADE = 1.2;
/** Сколько пикселей рука может пройти с зажатой кнопкой, чтобы это ещё был клик. */
const CLICK_PX = 6;
/** Как часто мерить яркость кадра видео на сфере, секунды. Замер читает кадр
    с видеокарты, и главный поток ждёт её; 0,25 с давали рывки на телефоне,
    а яркость и оттенок и так подстраиваются плавно (2026-11-05). */
const LUM_EVERY = 0.6;

/** Где объект точки сейчас на экране — по этому вёрстка ставит выноски. */
export type StationFrame = {
  /** Где точка относительно камеры на кольце: минус — впереди, плюс — позади. */
  d: number;
  /** Центр объекта, пиксели от левого верхнего угла окна. */
  x: number;
  y: number;
  /** Полуширина и полувысота на экране с учётом глубины. */
  hw: number;
  hh: number;
  /** Нижний край точек под центром (`Shape.inkBottom`), иначе полувысота. */
  ink: number;
  /** Правый край точек от центра и просвет между буквами (`Shape.inkRight`, `gap`). */
  inkR: number;
  gap: number;
  /** Видимость объекта, 0..1. */
  vis: number;
};

export type FrameInfo = {
  /** Положение на маршруте в точках: 0 — имя, 1 — «что делаю». */
  progress: number;
  /** Скорость движения по маршруту, точек в секунду. */
  velocity: number;
  /** Объекты всех точек на экране. Массив один и тот же каждый кадр. */
  stations: StationFrame[];
  /** Насколько раскрыта комната: 0 — все на аллее, 1 — комната открыта. */
  room: number;
  /** Ориентиры на экране, по порядку `landmarks`: для подписи у ворот. */
  marks: MarkFrame[];
  /** Скорость руки над объектом, от 0 до 1 — для звука. */
  hand: number;
  /** Средний цвет кадра открытой комнаты, 0..1 (null — кадра нет): подпись
      комнаты берёт из него оттенок. Объект один и тот же каждый кадр. */
  tint: THREE.Color | null;
  /** Что рука делает с объектом прямо сейчас: распыляет имя или «@», вертит
      сферу. По первому разу гаснут подсказки на главной. */
  grip: "spray" | "spin" | null;
};

export type SceneApi = {
  /** `along` — вдоль аллеи, а не коротким путём через стык кольца. */
  goTo: (stop: number, along?: boolean) => void;
  jumpTo: (stop: number) => void;
  /** Войти в комнату точки или выйти из неё (null). `star` — какой огонёк
      россыпи раскрыть: у «Опыта» комната у каждой работы своя. */
  setRoom: (stop: number | null, star?: number) => void;
  /** Вёрстка комнаты проекта измерилась: где кадр и название — их рисует сцена. */
  roomLayout: (stop: number, layout: RoomLayout | null) => void;
  /** Каждый кадр из onFrame: чья комната видна, насколько проявилась и где рука (−1..1). */
  roomView: (stop: number | null, alpha: number, tiltX: number, tiltY: number) => void;
};

type Props = {
  /** Точки маршрута по порядку. Первая — имя: оно задаёт число частиц
      у каждого объекта. Массив должен быть стабильным: новый на каждый
      рендер пересобирал бы сцену. */
  stations: StationSpec[];
  /**
   * Вызывается каждый кадр. Писать отсюда только в style напрямую:
   * состояние React на шестидесяти кадрах в секунду недопустимо.
   */
  onFrame?: (f: FrameInfo) => void;
  /** Отдаёт наружу управление маршрутом — для кнопок и якорей. */
  onReady?: (api: SceneApi) => void;
  /** Клик по объекту, у которого есть комната, — где бы на аллее он ни был. */
  onPick?: (stop: number) => void;
  /** Посетитель прокрутил вверх в комнате — пора выходить. */
  onExit?: () => void;
  /** Ориентиры на переходах между точками. Массив стабильный, как и stations. */
  landmarks?: Landmark[];
  /** Первый кадр с объектами нарисован — можно снимать заставку. */
  onLoaded?: () => void;
  /** Начинать сборку имени из облака. Пока false, точки ждут на стартовых
      местах: сборку должно быть видно, а не пропустить за заставкой. */
  start?: boolean;
};


/** Объект одной точки: свои частицы, своя физика, свои настройки шейдера. */
type Body = {
  points: THREE.Points;
  geo: THREE.BufferGeometry;
  mat: THREE.ShaderMaterial;
  u: {
    uMorph: { value: number };
    uPass: { value: number };
    uVis: { value: number };
    uDim: { value: number };
    uHalfWA: { value: number };
    uHalfWB: { value: number };
    uThick: { value: number };
    uDepth: { value: number };
    uRot: { value: THREE.Matrix3 };
    uCzA: { value: number };
    uCzB: { value: number };
    uLag: { value: number };
    uLift: { value: number };
    uSolid: { value: number };
    uStretch: { value: number };
    uSwirl: { value: number };
    uSwap: { value: number };
    uFlow: { value: number };
    uTex0: { value: THREE.Texture | null };
    uTex1: { value: THREE.Texture | null };
    uTexMix: { value: number };
    uTexAmt: { value: number };
    uTexAspect: { value: number };
    uTexGain: { value: number };
  };
  /** Форма на аллее и форма в комнате. */
  a: Shape;
  b: Shape;
  n: number;
  /** Объёмный объект — сфера: вращается, кисть ищет точки с учётом поворота. */
  solid: boolean;
  /** Что делает зажатая кнопка. */
  grip: StationSpec["grip"];
  /** Кадры проекта и их смена. */
  shots: THREE.Texture[];
  video: HTMLVideoElement | null;
  shot: number;
  shotAt: number;
  /** Средняя яркость кадра видео, замер раз в `LUM_EVERY`; у скриншотов
      она лежит в `userData.lum` текстуры. По ней кадр приводится к общему уровню. */
  lum: number;
  lumAt: number;
  /** Средний цвет видео (как `lum`) и текущий цвет кадра с учётом смены скриншотов. */
  rgb: THREE.Color;
  tint: THREE.Color;
  vel: Float32Array;
  disp: Float32Array;
  /** Податливость каждой точки: без разброса облако летит ровным строем. */
  give: Float32Array;
  /** 1 — точку унесло распылением, и домой её ведёт свой возврат (`RETURN_T`). */
  sprayed: Uint8Array;
  /** Возврат распылённой точки: сколько пути пройдено (0..1, −1 — ещё не начат),
      откуда она пошла (`trip`) и как быстро идёт (доля пути в секунду). */
  back: Float32Array;
  trip: Float32Array;
  pace: Float32Array;
  /** Насколько точку «разбудил» удар руки: пока не угасло, её крутит вихрь. */
  stir: Float32Array;
  /** Куда и насколько далеко уходит точка при распылении рукой. */
  spray: Float32Array;
  /** Кадр проекта, светящийся внутри сферы; у надписей нет. */
  glow: ReturnType<typeof sphereGlow> | null;
  /** Распылили в комнате: облако идёт домой дольше и экспонентой (`ROOM_SLOW`). */
  calm: boolean;
  dispAttr: THREE.BufferAttribute;
  velAttr: THREE.BufferAttribute;
  /** Раскрытие в комнату сейчас, 0..1. */
  morph: number;
  /** Рука его растрепала, и он ещё не улёгся: физика ведёт такой объект,
      даже когда тот уже не перед камерой. */
  restless: boolean;
  /** Огоньки после магнита идут домой на его пружинах. */
  homing: boolean;
};

const NO_MARKS: Landmark[] = [];

export function Scene({ stations, onFrame, onReady, onPick, onExit, landmarks = NO_MARKS, onLoaded, start = true }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const fallbackRef = useRef<HTMLDivElement>(null);
  // Колбэк держим в рефе: попади он в зависимости эффекта, сцена
  // пересобиралась бы на каждый рендер и теряла всю инерцию.
  const onFrameRef = useRef(onFrame);
  const onPickRef = useRef(onPick);
  const onExitRef = useRef(onExit);
  const onLoadedRef = useRef(onLoaded);
  const startRef = useRef(start);
  // Свежий колбэк кладём в реф после рендера, а не во время него.
  useEffect(() => {
    onFrameRef.current = onFrame;
    onPickRef.current = onPick;
    onExitRef.current = onExit;
    onLoadedRef.current = onLoaded;
    startRef.current = start;
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const N = stations.length;

    /* Маршрут подключается до WebGL и от него не зависит.

       Раньше эффект выходил на отсутствии WebGL ещё до подписки на ввод,
       а при «уменьшить движение» кадр рисовался однажды и больше никогда.
       В обоих случаях слои не проявлялись, и сайт сворачивался в первый
       экран: до «Что делаю» и «Проектов» было не добраться ничем. */
    const journey = new Journey({ stops: N, stretch: (k) => stations[k]?.stretch ?? 1 });
    // Корень — вся страница сайта, а не только канвас: курсор часто
    // стоит над текстовым слоем, и оттуда колесо тоже должно вести камеру.
    const detachJourney = journey.attach(host.closest("main") ?? host);
    journey.onExit = () => onExitRef.current?.();
    // Замер доводки снаружи — только в дев-режиме, как и `__probe`.
    if (process.env.NODE_ENV !== "production") (window as unknown as { __journey: Journey }).__journey = journey;

    /* Комната. Вход — камера доезжает до точки и встаёт на замок, объект
       раскрывается во времени. Выход — замок снят, объект собирается
       обратно, и колесо ведёт дальше с того же места. */
    let room: number | null = null;
    /** Чьим светом тонирован фон: остаётся и после выхода, пока комната гаснет. */
    let litRoom: number | null = null;
    /** Какой огонёк россыпи раскрыт в её комнате: форма комнаты строится под него. */
    const focus = { k: -1, star: -1 };
    /** Перестроить комнату россыпи под огонёк — заводится вместе с объектами. */
    let refocus: (() => void) | null = null;
    const setRoom = (k: number | null, star = -1) => {
      if (k !== null && !stations[k]?.room) return;
      room = k;
      if (k !== null) litRoom = k;
      if (k !== null && star >= 0) {
        focus.k = k;
        focus.star = star;
        refocus?.();
      }
      // Комнату сферы закрывает колесо в любую сторону, Esc и «закрыть»; палец —
      // нет, на телефоне он в ней гладит точки (Илья, 2026-11-05). Комнату
      // огонька — прокрутка в любую сторону, «обо мне» — вверх от верха колонки.
      const st = k === null ? null : stations[k];
      journey.lock(
        k !== null,
        st?.shape.kind === "sphere" ? "wheel" : st && (st.room !== "burst" || star >= 0) ? "any" : "up"
      );
      if (k !== null) journey.goTo(k);
    };
    /** Комната проекта в сцене (roomSurface.ts) — есть, только когда есть WebGL. */
    let surfaces: RoomSurfaces | null = null;
    /** Что о комнате сказала вёрстка в этом кадре. */
    const view = { k: null as number | null, alpha: 0, tx: 0, ty: 0 };

    /* Шаг полоски (Илья, 2026-11-05): с одной сферы на любую другую — одной
       пересборкой, как к соседней, без пролёта через все сферы между ними.
       Камера сразу встаёт у нужной сферы, а уходящая и приходящая рисуются
       так, будто стоят рядом (`place`): у них расстояния соседей, свет главы
       перетекает от одной к другой, пыль проходит путь в один шаг. Темп — тот
       же, каким камера догоняет цель на обычном переходе. */
    /** `ramp` — разгон после разворота, 0..1: волна сперва встаёт, потом идёт назад. */
    type Hop = { from: number; to: number; dir: 1 | -1; t: number; v: number; ramp: number };
    /** За сколько секунд волна набирает ход после разворота. */
    const HOP_TURN = 0.3;
    let hop: Hop | null = null;
    /** Насколько пыль отстала от камеры после шагов: она прошла по шагу, а камера — дальше. */
    let dustShift = 0;
    /** Куда пыль смотрит при шаге — по нему сдвиг пыли остаётся непрерывным. */
    const dustAt = (x: Hop | null) => (x ? x.from + x.dir * x.t : journey.current);
    const hopTo = (stop: number) => {
      const wrap = (k: number) => ((k % N) + N) % N;
      const sphere = (k: number) => stations[k]?.shape.kind === "sphere";
      const calm = bodies.every((b) => !b || b.morph < 0.001);
      if (reduced || room !== null || !calm || !sphere(stop)) {
        journey.goTo(stop, true);
        return;
      }
      /* Что сейчас на экране как шаг: идущий шаг полоски или камера между
         двумя сферами (колесо, соседний переход). Прежде такой шаг отдавался
         маршруту, и передумавшего посреди пересборки камера везла через все
         сферы между ними (Илья, 2026-11-06). */
      let now: Hop | null = hop;
      if (!now) {
        const c = journey.current;
        const s0 = wrap(Math.floor(c));
        const f = c - Math.floor(c);
        if (f > 0.02 && f < 0.98 && sphere(s0) && sphere(wrap(s0 + 1)))
          now = { from: s0, to: wrap(s0 + 1), dir: 1, t: f, v: 0, ramp: 0 };
      }
      let next: Hop;
      if (now) {
        if (hop && stop === hop.to) return;
        /* Пересобираемся из того, что видно, — одной волной. Назад к уходящей —
           та же пересборка вспять. На другую — доля, что уже собрана, становится
           новой сферой: до середины пути уходящая уходит дальше, а приходящей
           становится новая; после середины собранная уходит обратно той же
           волной, а новая встаёт на место уходившей. Смещения обеих видимых
           сфер при этом те же, что были, — рывка нет. */
        next =
          stop === now.to
            ? now
            : stop === now.from || now.t >= 0.5
              ? { from: now.to, to: stop, dir: -now.dir as 1 | -1, t: 1 - now.t, v: 0, ramp: 0 }
              : { ...now, to: stop };
      } else {
        const from = wrap(Math.round(journey.current));
        if (from === stop || Math.abs(stop - from) === 1 || !sphere(from)) {
          journey.goTo(stop, true);
          return;
        }
        next = { from, to: stop, dir: stop > from ? 1 : -1, t: 0, v: 0, ramp: 1 };
      }
      dustShift += dustAt(hop) - dustAt(next);
      hop = next;
      journey.jumpTo(stop);
    };
    const endHop = () => {
      if (!hop) return;
      dustShift += hop.from + hop.dir - hop.to;
      hop = null;
    };
    /** Где точка на кольце относительно камеры — с поправкой на шаг полоски. */
    const ringD = (progress: number, k: number) =>
      hop && k === hop.from ? hop.dir * hop.t : hop && k === hop.to ? hop.dir * (hop.t - 1) : ringOffset(progress, k, N);
    // Якоря вида href="#projects" при перехваченном скролле не работают:
    // прокручивать нечего. Кнопки должны двигать камеру.
    onReady?.({
      goTo: (stop: number, along?: boolean) => (along ? hopTo(stop) : journey.goTo(stop)),
      jumpTo: (stop: number) => journey.jumpTo(stop),
      setRoom,
      roomLayout: (stop, layout) => {
        // Без WebGL рисовать нечего — и `dirty` в этом режиме не заведён.
        if (!surfaces) return;
        surfaces.layout(stop, layout);
        dirty = true;
      },
      roomView: (stop, alpha, tiltX, tiltY) => {
        view.k = stop;
        view.alpha = alpha;
        view.tx = tiltX;
        view.ty = tiltY;
      },
    });

    /** Положение объектов для вёрстки. Заводится однажды и переписывается
        на месте: новый массив каждый кадр — лишняя работа сборщику мусора. */
    const frames: StationFrame[] = stations.map(() => ({ d: 0, x: 0, y: 0, hw: 0, hh: 0, ink: 0, inkR: 0, gap: 0, vis: 0 }));
    let raf = 0;

    /* При «уменьшить движение» камера не едет, а переставляется: положение
       на маршруте сразу равно цели, как у обычной прокрутки, и скорость
       нулевая — расслоения текста тоже нет. */
    const advance = (dt: number) => (reduced ? journey.snap() : journey.update(dt));

    const renderer = (() => {
      try {
        const r = new THREE.WebGLRenderer({ antialias: false, alpha: false });
        /* Проверка шейдеров на ошибки держит главный поток, пока видеокарта не
           соберёт программу. В собранном сайте она не нужна — three сам советует
           выключать её в продакшене; в разработке остаётся. */
        r.debug.checkShaderErrors = process.env.NODE_ENV !== "production";
        return r.getContext() ? r : null;
      } catch {
        return null;
      }
    })();

    if (!renderer) {
      /* Без WebGL остаётся DOM-заголовок, а маршрут ведёт слои как обычно.
         Объектов нет, поэтому выноски встают по центру экрана, а видна
         только ближайшая точка. Заголовок гаснет вместе с первым экраном,
         иначе он так и стоит поверх остальных. */
      let last = performance.now();
      const tick = () => {
        raf = requestAnimationFrame(tick);
        const now = performance.now();
        const progress = advance(Math.min((now - last) / 1000, 0.05));
        last = now;
        const w = window.innerWidth;
        const h = window.innerHeight;
        for (let k = 0; k < N; k++) {
          const f = frames[k];
          f.d = ringOffset(progress, k, N);
          f.x = w / 2;
          f.y = h / 2;
          f.hw = Math.min(w * 0.3, 320);
          f.hh = 70;
          f.ink = 70;
          f.inkR = f.hw;
          f.gap = 16;
          f.vis = Math.max(0, 1 - Math.abs(f.d) * 2);
        }
        const fb = fallbackRef.current;
        if (fb) fb.style.opacity = String(room === null ? frames[0].vis : 0);
        onFrameRef.current?.({
          progress,
          velocity: journey.velocity,
          stations: frames,
          room: room === null ? 0 : 1,
          marks: [],
          hand: 0,
          tint: null,
          grip: null,
        });
      };
      tick();
      // Сцены не будет — заставке ждать нечего.
      onLoadedRef.current?.();
      return () => {
        cancelAnimationFrame(raf);
        detachJourney();
      };
    }

    // Пока сцена не встала, виден обычный текст; без WebGL он так и остаётся.
    // Прячем его прямо в DOM: состояние React ради одного флага не нужно.
    if (fallbackRef.current) fallbackRef.current.hidden = true;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr);
    renderer.setClearColor(VOID, 1);
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    // Перспектива, настроенная так, что на плоскости z=0 одна единица
    // равна одному пикселю экрана. Тогда весь код частиц остаётся
    // пиксельным, как при ортокамере, но появляется настоящая глубина
    // и пролёт вперёд.
    const FOV = 50;
    const camera = new THREE.PerspectiveCamera(FOV, 1, 10, 12000);
    const fitZ = (height: number) => height / (2 * Math.tan((FOV * Math.PI) / 360));

    /* ── фон ───────────────────────────────────────────────────── */

    /* Вода, которую мешает рука: поле в JS (`Water`), в шейдеры — текстурой.
       Её читают фон (муть, свет) и пыль (её уносит течением). */
    const waterU = {
      uWaterTex: { value: new THREE.DataTexture(new Float32Array(4), 1, 1, THREE.RGBAFormat, THREE.FloatType) },
      /** Из UV экрана в UV сетки: масштаб и сдвиг на полклетки. */
      uWaterMap: { value: new THREE.Vector4(1, 1, 0, 0) },
    };

    const fieldUniforms = {
      ...waterU,
      uRes: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 },
      // На узком экране режем октавы шума: телефон этого не тянет,
      // а разницу на глаз там не видно.
      uOct: { value: 5 },
      uEnter: { value: 0 },
      /* Фон — в том виде, в каком его выбрал Илья. three хранит цвет
         в линейном пространстве, а наш шейдер пишет значение на экран
         как есть, без перевода обратно: «#0b1633» выходил почти чёрным.
         Поэтому сюда — исходные sRGB-числа. */
      uVoid: { value: VOID.clone().convertLinearToSRGB() },
      uAzure: { value: AZURE },
      uSpeed: { value: 0 },
      uTint: { value: new THREE.Color() },
      uTintAmt: { value: 0 },
      uTintDir: { value: new THREE.Vector2(0, 1) },
    };

    const field = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        vertexShader: FIELD_VERT,
        fragmentShader: FIELD_FRAG,
        uniforms: fieldUniforms,
        depthTest: false,
        depthWrite: false,
      })
    );
    field.frustumCulled = false;
    field.renderOrder = -1;
    scene.add(field);
    surfaces = new RoomSurfaces(scene, waterU);
    // Шейдеры комнаты собираются сейчас, под заставкой, а не на первом входе в
    // комнату: на телефоне сборка — это заметный рывок в момент нажатия.
    surfaces.warm(renderer, scene, camera);
    // Вёрстка комнаты прячет то, что теперь рисует сцена (globals.css).
    document.documentElement.setAttribute("data-gl", "");
    /** Цвет кадра той комнаты, что сейчас видна, — для её подписи. */
    const frameTint = () => {
      const b = view.k === null ? null : bodies[view.k];
      return b?.solid && b.u.uTexAmt.value > 0 ? b.tint : null;
    };
    /** Комната проекта — перед самой отрисовкой, когда вёрстка уже сказала своё. */
    const drawRoom = () => {
      const k = view.k;
      const b = k === null ? null : bodies[k];
      surfaces?.update(k, view.alpha, view.tx, view.ty, b?.solid ? b.u : null, w, h);
      // Где экран — точкам стенок: они светятся кадром у его краёв (PARTICLE_VERT).
      const fr = k === null || !b?.solid ? undefined : surfaces?.frameOf(k);
      shared.uRoomFrame.value.set(fr?.x ?? 0, fr?.y ?? 0, fr?.w ?? 0, fr?.h ?? 0);
    };

    /* ── частицы ───────────────────────────────────────────────── */

    /* Физика на каждую частицу — как на лендинге у брата.

       Там у точки своя скорость, трение 5% за кадр и очень мягкий возврат
       к дому, меньше процента за кадр. Никакого потолка смещения нет
       вовсе, поэтому удары складываются: провёл рукой ещё раз по уже
       разлетевшемуся песку — он разлетится сильнее. Именно этого не
       умело поле на сетке: там все точки ячейки ехали одинаково и
       упирались в общий предел.

       Буферы у каждого объекта свои и заводятся вместе с ним, в makeBody. */

    /* Поворот сфер — общий на все: сетки соседних проектов при пересборке
       обязаны совпадать точка в точку. Сфера крутится сама по вертикали,
       а рукой — в любую сторону и с инерцией, как шар трекбола. */
    const sphereQ = new THREE.Quaternion();
    const sphereRot = new THREE.Matrix3();
    const noRot = new THREE.Matrix3();
    const rotM4 = new THREE.Matrix4();
    const qStep = new THREE.Quaternion();
    const AXIS_Y = new THREE.Vector3(0, 1, 0);
    const AXIS_X = new THREE.Vector3(1, 0, 0);
    /** Скорость вращения рукой, радиан в секунду: x — по вертикали, y — по горизонтали. */
    const spinVel = new THREE.Vector2();
    /** Рука сейчас вертит сферу. */
    let spinning = false;
    /** Сферу схватили — рука сдвинулась больше, чем на клик (`CLICK_PX`). До этого
        нажатие может быть кликом: сфера крутится по инерции дальше и открывается
        на ходу, а не встаёт намертво (Илья, 2026-11-05). */
    let spinGrab = false;
    /* Изнутри видна дальняя стенка сферы, а она при повороте едет в другую
       сторону, чем ближняя: рука вправо — купол уезжал влево (Илья,
       2026-10-18). В комнате направление разворачиваем. */
    let spinSign = 1;
    /** Радиан поворота на пиксель хода руки — чтобы точка под курсором шла
        ровно вместе с ним. Изнутри купол большой и далеко: с прежним общим
        коэффициентом он обгонял руку в несколько раз. */
    let spinK = 0.005;
    let spinAt = 0;
    /* Поворот в осях экрана, а не самой сферы: вправо — значит вправо,
       как бы сфера уже ни была повёрнута. */
    const turnSphere = (yaw: number, pitch: number) => {
      sphereQ.premultiply(qStep.setFromAxisAngle(AXIS_Y, yaw));
      sphereQ.premultiply(qStep.setFromAxisAngle(AXIS_X, pitch));
      sphereQ.normalize();
    };
    const stepSphereRot = (dt: number) => {
      // Палец, ведущий сферу вбок (`touchSpin`), вертит её сам — инерция ждёт отпускания.
      if ((!spinning || !spinGrab) && !touchSpin) {
        /* Отпустили — сфера докручивается, как фиджет-спиннер (Илья, 2026-10-21:
           «чуть меньше, чем у Mole»). Одно вязкое трение (было 2,4 в секунду)
           гасило шар за полсекунды, а слабое тянуло хвост без конца; с сухим
           остановка конечная: бросок на 8 рад/с крутится ~4,8 с, на 1 рад/с — ~1,6 с. */
        turnSphere(spinVel.x * dt, spinVel.y * dt);
        const v = spinVel.length();
        if (v > 0) spinVel.multiplyScalar(Math.max(0, v * Math.exp(-dt * SPIN_DRAG) - SPIN_DRY * dt) / v);
      }
      turnSphere(SPHERE_SPIN * dt, 0);
      sphereRot.setFromMatrix4(rotM4.makeRotationFromQuaternion(sphereQ));
    };

    /* Поворот имени зажатой рукой — в любую сторону, на полные 360°, как
       у сферы (Илья, 2026-10-18). Слово и облако распыления крутятся одним
       поворотом; отпустил — слово плавно ложится обратно читаемым. Прежде
       оно крутилось только вокруг вертикали, с отдачей в обратную сторону. */
    const nameQ = new THREE.Quaternion();
    const nameRot = new THREE.Matrix3();
    const QUAT_ID = new THREE.Quaternion();
    /** Рука сейчас крутит имя. */
    let twisting = false;
    /* Отпустил — слово раскручивается назад тем же законом, что облако идёт
       домой: синусом за UNSPIN_T, без рывка на старте. По экспоненте оно
       срывалось с полной скорости, а облако теперь раскручивается вместе
       со словом — и дёргалось бы с ним (Илья, 2026-10-20). */
    const unspinFrom = new THREE.Quaternion();
    let unspinT = 1;
    /** Отпустили в комнате — раскрутка дольше и экспонентой, как облако (`ROOM_SLOW`). */
    let unspinCalm = false;

    /** Сглаженная скорость руки в пикселях за кадр. */
    const handVel = new THREE.Vector2();
    /** Скорость руки над объектом, от 0 до 1 — для звука. */
    let handNow = 0;
    const ptrPrev = new THREE.Vector2(-9999, -9999);
    /** Рука только что вернулась (в окно или новым касанием): её прыжок
        с прошлого места — не мах, и кисть по нему не проходит. */
    let ptrFresh = true;

    /** Общие настройки шейдера: одни и те же значения у всех объектов. */
    const shared = {
      uRes: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 },
      uEnter: { value: 0 },
      uPixelRatio: { value: dpr },
      uSand: { value: SAND },
      uCamZ: { value: 1000 },
      uBaseZ: { value: 1000 },
      uRoomFrame: { value: new THREE.Vector4() },
    };

    /* Среда маршрута: пыль, ориентиры, свет глав. */
    const env = new Environment(
      scene,
      { ...shared, ...waterU, uAzure: fieldUniforms.uAzure },
      landmarks,
      N
    );
    const lights = stations.map((s) => s.light);
    const roomTint = new THREE.Color();
    /** Свет главы на этом положении маршрута — в фон. Цвет в sRGB, как и фон.
        В комнате проекта фон уходит в её цвет — как у Active Theory, где цвет
        проекта красит всю комнату (Илья, 2026-10-19). */
    const lightUp = (progress: number) => {
      const l = chapterLight(lights, hop ? hop.from : progress);
      if (hop) {
        // Как между соседями: свет переходит на средних трёх пятых пути.
        const lb = chapterLight(lights, hop.to);
        const u = Math.min(1, Math.max(0, (hop.t - 0.2) / 0.6));
        const e = u * u * (3 - 2 * u);
        l.color.lerp(lb.color, e);
        l.amount += (lb.amount - l.amount) * e;
        const dx = l.dir[0] + (lb.dir[0] - l.dir[0]) * e;
        const dy = l.dir[1] + (lb.dir[1] - l.dir[1]) * e;
        const len = Math.hypot(dx, dy) || 1;
        l.dir = [dx / len, dy / len];
      }
      const r = litRoom === null ? undefined : stations[litRoom]?.roomLight;
      if (r && roomAmount > 0) {
        const into = roomAmount;
        l.color.lerp(roomTint.set(r.color), into);
        l.amount += (r.amount - l.amount) * into;
        l.dir[0] += (r.dir[0] - l.dir[0]) * into;
        l.dir[1] += (r.dir[1] - l.dir[1]) * into;
      }
      fieldUniforms.uTint.value.copy(l.color).convertLinearToSRGB();
      fieldUniforms.uTintAmt.value = l.amount;
      fieldUniforms.uTintDir.value.set(l.dir[0], l.dir[1]);
    };

    let alive = true;
    /** Кадр устарел: пересобралось облако или сменился размер. Нужен режиму
        без движения, где сцена перерисовывается только по делу. */
    let dirty = true;
    /** Объекты точек по порядку. Пока объект не готов, на его месте null. */
    let bodies: (Body | null)[] = [];
    /** Номер сборки: ресайз посреди досчёта не должен смешать старые формы с новыми. */
    let build = 0;

    /** Плоская форма плюс глубина — в один массив xyz для шейдера. */
    const homes = (s: Shape) => {
      const n = s.points.length / 2;
      const out = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        out[i * 3] = s.points[i * 2];
        out[i * 3 + 1] = s.points[i * 2 + 1];
        out[i * 3 + 2] = s.z ? s.z[i] : 0;
      }
      return out;
    };

    /* Личное число точки — от её номера, а не случайное: от него в шейдере
       её размер, глубина в толще слова, шевеление и искры. При пересборке
       «@» в имя точка №i уезжает на место точки №i имени, и со случайными
       числами каждая в миг смены прыгала на несколько пикселей и меняла
       размер (Илья, 2026-10-20). С общим числом они совпадают во всём. */
    const seedOf = (i: number) => {
      const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
      return x - Math.floor(x);
    };

    const makeBody = (a: Shape, b: Shape, w: number, h: number, spec: StationSpec): Body => {
      const n = a.points.length / 2;
      const solid = !!a.z;
      const from = new Float32Array(n * 2);
      const seed = new Float32Array(n);
      const dummy = new Float32Array(n * 3);
      const spread = Math.max(w, h) * 0.75;

      for (let i = 0; i < n; i++) {
        // Стартовая точка — по кольцу вокруг центра: облако собирается
        // внутрь, а не выпадает сверху.
        const ang = Math.random() * Math.PI * 2;
        const r = spread * (0.5 + Math.random() * 0.6);
        from[i * 2] = Math.cos(ang) * r;
        from[i * 2 + 1] = Math.sin(ang) * r;
        seed[i] = seedOf(i);
      }

      // Физика начинается с чистого листа: скорости и смещения по нулям.
      const vel = new Float32Array(n * 3);
      const disp = new Float32Array(n * 3);
      const give = new Float32Array(n);
      const sprayed = new Uint8Array(n);
      const back = new Float32Array(n).fill(-1);
      const trip = new Float32Array(n * 3);
      const pace = new Float32Array(n);
      const stir = new Float32Array(n);
      const spray = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        give[i] = 0.35 + Math.random() * 1.5;
        // Своё направление в объёме и своя дальность: одни уходят под
        // самую камеру, другие проваливаются в темноту.
        const th = Math.random() * Math.PI * 2;
        const ph = Math.acos(2 * Math.random() - 1);
        const far = 150 + Math.random() * 900;
        spray[i * 3] = Math.sin(ph) * Math.cos(th) * far;
        spray[i * 3 + 1] = Math.sin(ph) * Math.sin(th) * far;
        spray[i * 3 + 2] = Math.cos(ph) * far;
      }
      const dispAttr = new THREE.BufferAttribute(disp, 3);
      dispAttr.setUsage(THREE.DynamicDrawUsage);
      // Тот же буфер скоростей уходит в шейдер как атрибут: лишней памяти
      // не нужно, физика и смаз смотрят на одни и те же числа.
      const velAttr = new THREE.BufferAttribute(vel, 3);
      velAttr.setUsage(THREE.DynamicDrawUsage);

      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(dummy, 3));
      geo.setAttribute("aDisp", dispAttr);
      geo.setAttribute("aVel", velAttr);
      geo.setAttribute("aHomeA", new THREE.BufferAttribute(homes(a), 3));
      geo.setAttribute("aHomeB", new THREE.BufferAttribute(homes(b), 3));
      // Дом у соседа по пересборке; пока соседа нет — свой же.
      geo.setAttribute("aOther", new THREE.BufferAttribute(homes(a), 3));
      geo.setAttribute("aFrom", new THREE.BufferAttribute(from, 2));
      // Центр огонька и его черёд — для вихря, которым огоньки прилетают.
      const hub = new Float32Array(n * 3);
      if (a.group && a.hubs) {
        const count = a.hubs.length / 2;
        for (let i = 0; i < n; i++) {
          const g = a.group[i];
          hub[i * 3] = a.hubs[g * 2];
          hub[i * 3 + 1] = a.hubs[g * 2 + 1];
          hub[i * 3 + 2] = count > 1 ? g / (count - 1) : 0;
        }
      }
      geo.setAttribute("aHub", new THREE.BufferAttribute(hub, 3));
      geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
      // Какие точки остаются видны внутри раскрытой сферы; у плоских форм — все.
      geo.setAttribute("aKeep", new THREE.BufferAttribute(a.keep ?? new Float32Array(n).fill(1), 1));

      const u = {
        uMorph: { value: 0 },
        uPass: { value: 0 },
        uVis: { value: 0 },
        uDim: { value: 0 },
        uHalfWA: { value: a.halfW },
        uHalfWB: { value: b.halfW },
        // Надпись плоская: микротолщина и поджатая глубина поворота.
        // Сфера объёмная сама по себе.
        uThick: { value: solid ? 0 : 130 },
        uDepth: { value: solid ? 1 : 0.42 },
        // Все сферы — один общий поворот: при пересборке их сетки совпадают.
        // Огоньки в своей комнате крутятся рукой, как имя в «обо мне».
        uRot: { value: solid ? sphereRot : spec.grip === "spray" || spec.grip === "magnet" ? nameRot : noRot },
        uCzA: { value: a.cz ?? 0 },
        uCzB: { value: b.cz ?? 0 },
        // Надпись раскрывается волной, с отрывом от плоскости; сетка сферы —
        // разом и ровно, как раскладная игрушка: точки только расходятся.
        // У облака «обо мне» ни очереди, ни дуги к зрителю — оно расходится
        // целиком, как при распылении рукой.
        uLag: { value: solid || spec.room === "burst" ? 0 : 0.35 },
        uLift: { value: solid || spec.room === "burst" ? 0 : 1 },
        uSolid: { value: solid ? 1 : 0 },
        uStretch: { value: 1 },
        uSwirl: { value: a.group ? 1 : 0 },
        uSwap: { value: 0 },
        uFlow: { value: 0 },
        uTex0: { value: null as THREE.Texture | null },
        uTex1: { value: null as THREE.Texture | null },
        uTexMix: { value: 0 },
        uTexAmt: { value: 0 },
        uTexAspect: { value: 1.6 },
        uTexGain: { value: 1 },
      };
      // Общие настройки входят по ссылке: ShaderMaterial их не копирует,
      // и время или размер экрана достаточно обновить в одном месте.
      // Шейдер у всех один — three собирает программу однажды.
      const mat = new THREE.ShaderMaterial({
        vertexShader: PARTICLE_VERT,
        fragmentShader: PARTICLE_FRAG,
        uniforms: { ...shared, ...u },
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: THREE.NormalBlending,
      });
      const points = new THREE.Points(geo, mat);
      points.frustumCulled = false;
      points.visible = false;
      scene.add(points);
      const body: Body = {
        points, geo, mat, u, a, b, n, vel, disp, give, sprayed, back, trip, pace, stir, spray, dispAttr, velAttr,
        glow: solid && spec.media ? sphereGlow(scene, u) : null,
        calm: false, morph: 0, restless: false, homing: false, solid, grip: spec.grip, shots: [], video: null, shot: 0, shotAt: 0,
        lum: 0.35, lumAt: 0, rgb: new THREE.Color(0.35, 0.35, 0.35), tint: new THREE.Color(0.35, 0.35, 0.35),
      };
      if (spec.media) loadMedia(body, spec.media);
      return body;
    };

    /* Кадры проекта на сфере. Видео — если загружено: оно идёт по точкам
       само, без звука и по кругу. Иначе скриншоты сменяют друг друга.
       Пока кадр не пришёл, сфера просто песочная. */
    const loader = new THREE.TextureLoader();
    /* Средняя яркость кадра — по уменьшенной копии. По ней все сферы
       приводятся к одному уровню: светлый скриншот не выжигает сферу
       в белое, тёмный не гасит её до черноты. Считается у каждого
       скриншота и у видео по ходу: прежде брался один первый кадр, и сфера
       с роликом из темноты или с тёмным первым экраном горела не так, как
       соседняя (Илья, 2026-11-03: «первая ярче, вторая тусклее»). */
    const lumCanvas = document.createElement("canvas");
    lumCanvas.width = lumCanvas.height = 24;
    const lumCtx = lumCanvas.getContext("2d", { willReadFrequently: true });
    /** Средняя яркость кадра; в `rgb` — его средний цвет (оттенок подписи комнаты). */
    const meanLum = (src: CanvasImageSource, rgb?: THREE.Color) => {
      if (!lumCtx) return 0.35;
      lumCtx.drawImage(src, 0, 0, 24, 24);
      const d = lumCtx.getImageData(0, 0, 24, 24).data;
      let sum = 0;
      let r = 0;
      let g = 0;
      let bl = 0;
      for (let i = 0; i < d.length; i += 4) {
        sum += (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255;
        r += d[i];
        g += d[i + 1];
        bl += d[i + 2];
      }
      const n = d.length / 4;
      rgb?.setRGB(r / n / 255, g / n / 255, bl / n / 255);
      return sum / n;
    };
    const gainOf = (lum: number) => Math.max(0.35, Math.min(3, 0.35 / Math.max(0.02, lum)));
    /* Кадры и видео переживают пересборку мира: от размера окна они не зависят.
       Прежде ресайз выбрасывал их вместе с телами — сферы гасли до песочных,
       а все ролики скачивались заново. Освобождаются только с самой сценой. */
    type Media = { shots: THREE.Texture[]; video: HTMLVideoElement | null; aspect: number; lum: number; rgb: THREE.Color; ready: boolean };
    const mediaOf = new Map<NonNullable<StationSpec["media"]>, Media>();
    const applyMedia = (body: Body, m: Media) => {
      body.shots = m.shots;
      body.video = m.video;
      if (!m.ready) return;
      body.u.uTex0.value = body.u.uTex1.value = m.shots[0];
      body.u.uTexAspect.value = m.aspect;
      body.lum = m.lum;
      body.rgb.copy(m.rgb);
      body.u.uTexGain.value = gainOf(m.lum);
      body.u.uTexAmt.value = 1;
      dirty = true;
    };
    const loadMedia = (body: Body, media: NonNullable<StationSpec["media"]>) => {
      const known = mediaOf.get(media);
      if (known) return applyMedia(body, known);
      const m: Media = { shots: [], video: null, aspect: 1.6, lum: 0.35, rgb: new THREE.Color(0.35, 0.35, 0.35), ready: false };
      mediaOf.set(media, m);
      applyMedia(body, m);
      const ready = (tex: THREE.Texture, w: number, h: number, src: CanvasImageSource) => {
        if (!alive) return;
        /* Мип-уровни нужны экрану комнаты: размытие в следе руки берёт
           выборки с уровня помельче (SURFACE_FRAG). У видео three пересобирает
           их на каждом новом кадре. */
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.generateMipmaps = true;
        tex.needsUpdate = true;
        m.aspect = w / Math.max(h, 1);
        m.lum = meanLum(src, m.rgb);
        m.ready = true;
        // Кадр мог прийти после ресайза — тогда он нужен уже новому телу.
        const owner = bodies.find((b) => b?.shots === m.shots);
        if (owner) applyMedia(owner, m);
      };
      if (media.video) {
        const v = document.createElement("video");
        v.src = media.video;
        v.muted = true;
        v.loop = true;
        v.playsInline = true;
        v.preload = "auto";
        const tex = new THREE.VideoTexture(v);
        m.video = body.video = v;
        m.shots.push(tex);
        v.addEventListener("loadeddata", () => ready(tex, v.videoWidth, v.videoHeight, v), { once: true });
        return;
      }
      media.images.forEach((src, i) => {
        loader.load(src, (tex) => {
          if (!alive) return tex.dispose();
          m.shots[i] = tex;
          const img = tex.image as HTMLImageElement;
          tex.userData.rgb = new THREE.Color();
          tex.userData.lum = meanLum(img, tex.userData.rgb);
          if (i === 0) ready(tex, img.width, img.height, img);
        });
      });
    };
    const dropMedia = () => {
      for (const m of mediaOf.values()) {
        for (const t of m.shots) t?.dispose();
        if (m.video) {
          m.video.pause();
          m.video.removeAttribute("src");
          m.video.load();
        }
      }
      mediaOf.clear();
    };

    /** Смена скриншотов на сфере: держим кадр, затем плавно переливаем
        в следующий. Видео меняется само. Заодно яркость сферы идёт за
        кадром — плавно, без мигания на смене. */
    const stepShots = (b: Body, t: number, dt: number) => {
      if (b.u.uTexAmt.value > 0) {
        const v = b.video;
        if (v && !v.paused && v.readyState >= 2 && t - b.lumAt > LUM_EVERY) {
          b.lumAt = t;
          b.lum = meanLum(v, b.rgb);
        }
        const c0 = b.u.uTex0.value?.userData.rgb as THREE.Color | undefined;
        const c1 = b.u.uTex1.value?.userData.rgb as THREE.Color | undefined;
        if (v || !c0) b.tint.copy(b.rgb);
        else b.tint.copy(c0).lerp(c1 ?? c0, b.u.uTexMix.value);
        const l0 = b.u.uTex0.value?.userData.lum as number | undefined;
        const l1 = b.u.uTex1.value?.userData.lum as number | undefined;
        const lum = v || l0 === undefined ? b.lum : l0 + ((l1 ?? l0) - l0) * b.u.uTexMix.value;
        b.u.uTexGain.value += (gainOf(lum) - b.u.uTexGain.value) * (1 - Math.pow(0.05, dt));
      }
      const list = b.shots.filter(Boolean);
      if (b.video || list.length < 2) return;
      if (!b.shotAt) b.shotAt = t;
      const into = t - b.shotAt - SHOT_HOLD;
      if (into < 0) return;
      const next = (b.shot + 1) % list.length;
      b.u.uTex0.value = list[b.shot];
      b.u.uTex1.value = list[next];
      b.u.uTexMix.value = Math.min(1, into / SHOT_FADE);
      if (into >= SHOT_FADE) {
        b.shot = next;
        b.shotAt = t;
        b.u.uTex0.value = list[next];
        b.u.uTexMix.value = 0;
      }
    };

    const dropBodies = () => {
      for (const b of bodies) {
        if (!b) continue;
        scene.remove(b.points);
        b.geo.dispose();
        b.mat.dispose();
        if (b.glow) {
          scene.remove(b.glow.mesh);
          b.glow.mesh.geometry.dispose();
          (b.glow.mesh.material as THREE.Material).dispose();
        }
      }
      bodies = [];
    };

    /* Объекты всех точек — из одной материи и одной плотности: имя строится
       сразу и задаёт число частиц, остальные досчитываются следом, пока
       посетитель смотрит на первый экран. */
    const buildWorld = async (w: number, h: number) => {
      const gen = ++build;
      const spec0 = stations[0]?.shape;
      // Шаг сетки 1px: Cormorant даёт тонкие штрихи, и на шаге 4px буквы
      // рвутся в пунктир.
      const sampled = await textShape(spec0?.kind === "text" ? spec0.text : "", w, h, true);
      if (!alive || gen !== build || !sampled.count) return;

      dropBodies();
      bodies = stations.map(() => null);
      const n = sampled.count;
      const ink = inkOf(sampled.points);
      const first: Shape = {
        points: sampled.points,
        halfW: sampled.width / 2,
        halfH: sampled.height / 2,
        inkBottom: ink.bottom,
        inkRight: ink.right,
        gap: ink.gap,
      };

      for (let i = 0; i < N; i++) {
        const st = stations[i];
        // Сфере точек нужно больше: по ней проступает кадр проекта.
        const nk = st.shape.kind === "sphere" ? Math.round(n * SPHERE_DENSITY) : n;
        const a = i === 0 ? first : await buildShape(st.shape, w, h, nk);
        const b =
          a.group && focus.k === i
            ? focusShape(a, focus.star, w, h)
            : st.room === "burst"
              ? burstShape(a)
              : st.room
                ? await buildShape(st.room, w, h, nk)
                : a;
        if (!alive || gen !== build) return;
        const body = makeBody(a, b, w, h, st);
        // Ресайз посреди открытой комнаты не должен заново её раскрывать.
        body.morph = room === i ? 1 : 0;
        bodies[i] = body;
        dirty = true;
      }
      // Комната россыпи — под нажатый огонёк: дома комнаты переписываются разом.
      refocus = () => {
        const body = bodies[focus.k];
        if (!body?.a.group) return;
        body.b = focusShape(body.a, focus.star, w, h);
        body.geo.setAttribute("aHomeB", new THREE.BufferAttribute(homes(body.b), 3));
        body.u.uHalfWB.value = body.b.halfW;
        body.u.uCzB.value = body.b.cz ?? 0;
        dirty = true;
      };
      // Надпись, которая пересобирается в следующую, получает её дома.
      for (let i = 0; i < N; i++) {
        const next = bodies[(i + 1) % N];
        const body = bodies[i];
        if (!body || !next || !stations[i].reform || !stations[(i + 1) % N].reform || body.n !== next.n) continue;
        body.geo.setAttribute("aOther", new THREE.BufferAttribute(homes(next.a), 3));
      }
    };

    /* ── размеры ───────────────────────────────────────────────── */

    /* Прямоугольник канваса кэшируем.

       getBoundingClientRect() на каждом pointermove — это форсированная
       синхронная перекомпоновка: кадром выше мы пишем в style слоёв
       (transform, opacity, text-shadow), браузер помечает layout грязным,
       а чтение геометрии заставляет пересчитать его немедленно. При сотне
       событий в секунду получаются рывки, и тем заметнее, чем больше
       рядом элементов с переходами — отсюда и «лагает в углу с кнопками».

       Канвас всегда на весь экран, поэтому достаточно обновлять кэш
       на resize и прокрутке. */
    let rect = host.getBoundingClientRect();
    const syncRect = () => {
      rect = host.getBoundingClientRect();
    };

    let w = 0;
    let h = 0;
    let baseZ = 1000;
    /** Насколько поднята камера сейчас (`StationSpec.rise`), пиксели. */
    let lift = 0;
    let water = new Water(1, 1);
    let waterData = new Float32Array(4);
    /* Линейная выборка из float-текстуры — расширение; без него вода
       ступенчатая, но работает. */
    const waterFilter = renderer.extensions.has("OES_texture_float_linear") ? THREE.LinearFilter : THREE.NearestFilter;
    const resize = () => {
      /* Окно шлёт resize и без смены размера сцены: на телефоне — когда
         прячется адресная строка, а сцена высотой в 100vh. Мир от этого
         не меняется, а пересборка стоит 130 мс на десктопе и ~400 на телефоне. */
      if (w === host.clientWidth && h === host.clientHeight) return syncRect();
      w = host.clientWidth;
      h = host.clientHeight;
      water = new Water(w, h);
      waterData = new Float32Array(water.nx * water.ny * 4);
      waterU.uWaterTex.value.dispose();
      const tex = new THREE.DataTexture(waterData, water.nx, water.ny, THREE.RGBAFormat, THREE.FloatType);
      tex.minFilter = tex.magFilter = waterFilter;
      tex.needsUpdate = true;
      waterU.uWaterTex.value = tex;
      waterU.uWaterMap.value.set(w / (water.cell * water.nx), h / (water.cell * water.ny), 0.5 / water.nx, 0.5 / water.ny);
      // updateStyle НЕ отключать: без CSS-размера канвас растягивается
      // до своих физических пикселей, и на экране с dpr=2 сцена выходит
      // вдвое крупнее вёрстки и уезжает за край.
      renderer.setSize(w, h);
      camera.aspect = w / Math.max(h, 1);
      baseZ = fitZ(h);
      camera.updateProjectionMatrix();
      fieldUniforms.uRes.value.set(w, h);
      shared.uRes.value.set(w, h);
      fieldUniforms.uOct.value = w < 640 ? 3 : 5;
      surfaces?.resize(w, h, dpr);
      syncRect();
      dirty = true;
      env.build(w, h, baseZ);
      void buildWorld(w, h);
    };
    resize();

    let resizeTimer = 0;
    const onResize = () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(resize, 180);
    };
    window.addEventListener("resize", onResize, { passive: true });
    window.addEventListener("scroll", syncRect, { passive: true });

    /* ── указатель ─────────────────────────────────────────────── */

    const rawMouse = new THREE.Vector2(-9999, -9999);

    /* Присутствие руки, 0..1.

       Раньше уход курсора швырял позицию в −9999, и вмятина уезжала
       через весь экран одним скачком — выглядело как сбой. Теперь
       позиция остаётся последней известной, а плавно гаснет сила:
       рука «отпускает» слово и так же плавно берёт его обратно. */
    let hover = 0;
    let hoverTarget = 0;

    /** Какой объект с комнатой под курсором. Прямоугольники посчитаны
        в кадре — в обработчике ничего не измеряется. Если объекты
        перекрываются, берётся ближний к камере. */
    const pick = (x: number, y: number) => {
      if (room !== null) return -1;
      let best = -1;
      for (let k = 0; k < N; k++) {
        const f = frames[k];
        if (!stations[k].room || f.vis < 0.3 || f.d < -0.5 || f.d > 0.25) continue;
        if (Math.abs(x - f.x) > f.hw + 24 || Math.abs(y - f.y) > f.hh + 24) continue;
        if (best < 0 || f.d > frames[best].d) best = k;
      }
      return best;
    };
    /** Курсор над объектом с комнатой — системная «рука». Пишется только при смене. */
    let cursor = "";

    /* Палец — только тому, чего коснулся (Илья, 2026-11-05). Лёг на имя или «@» —
       жест их, как зажатая мышь: распыление и поворот, тап открывает. Лёг на сферу —
       как мышь без нажатия: точки расходятся под пальцем, тап открывает комнату.
       В комнате сферы палец по экрану и по фону — тоже как мышь без нажатия, сфера
       не вертится. Маршрут этими жестами не едет (`journey.claimTouch`). Лёг мимо
       сферы на аллее — вбок вертит её по горизонтали, вверх-вниз листает маршрут;
       мимо имени — только листает. Ничей палец сцена не видит: ни кисти, ни света.
       У мыши всё как было. */
    let fingerFree = false;
    /** Палец мимо сферы: ещё не ясно, вбок он или вдоль маршрута. */
    let touchPending = false;
    /** Палец мимо сферы ведёт вбок — вертит её по горизонтали. */
    let touchSpin = false;
    const touchFrom = new THREE.Vector2();
    /** Сколько радиан поворота на пиксель руки: под рукой ближняя к зрителю
        поверхность, изнутри комнаты — дальняя. */
    const spinScale = (inside: boolean) => {
      const sb = bodies[nearNow];
      if (!sb) return spinK;
      const R = inside ? sb.b.halfW : sb.a.halfW;
      const cz = (inside ? sb.b.cz : sb.a.cz) ?? 0;
      const ps = baseZ / Math.max(baseZ - (inside ? cz - R : cz + R), 60);
      return 1 / Math.max(1, R * ps);
    };
    const touchesObject = (x: number, y: number) => {
      if (room !== null) {
        const fr = surfaces?.frameOf(room);
        return !!fr && x >= fr.x && x <= fr.x + fr.w && y >= fr.y && y <= fr.y + fr.h;
      }
      const f = frames[nearNow];
      const st = stations[nearNow];
      if (!settledNow || !f || f.vis < 0.3 || !(st?.grip || st?.room)) return false;
      if (bodies[nearNow]?.solid) return Math.hypot(x - f.x, y - f.y) <= f.hw + 12;
      return Math.abs(x - f.x) <= f.hw && Math.abs(y - f.y) <= f.hh;
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") {
        if (touchPending) {
          const dx = e.clientX - touchFrom.x;
          const dy = e.clientY - touchFrom.y;
          if (Math.hypot(dx, dy) > 10) {
            touchPending = false;
            if (Math.abs(dx) > Math.abs(dy) * 1.2) {
              touchSpin = true;
              journey.claimTouch();
              spinK = spinScale(false);
              spinAt = performance.now();
              spinVel.set(0, 0);
              dragLast.set(e.clientX, e.clientY);
            }
          }
        }
        if (touchSpin) {
          const yaw = (e.clientX - dragLast.x) * spinK;
          turnSphere(yaw, 0);
          const now = performance.now();
          const sec = Math.max(0.008, (now - spinAt) / 1000);
          spinAt = now;
          spinVel.x += (Math.max(-8, Math.min(8, yaw / sec)) - spinVel.x) * 0.4;
          spinVel.y = 0;
          dragLast.set(e.clientX, e.clientY);
          return;
        }
        if (fingerFree) return;
      }
      if (hoverTarget === 0) ptrFresh = true;
      hoverTarget = 1;
      const r = rect;
      rawMouse.set(e.clientX - r.left - w / 2, -(e.clientY - r.top) + h / 2);
      if (dragging) {
        // Путь считаем до того, как сдвинем опору, иначе он всегда ноль.
        dragTravel += Math.hypot(e.clientX - dragLast.x, e.clientY - dragLast.y);
        if (twisting) {
          nameQ.premultiply(qStep.setFromAxisAngle(AXIS_Y, (e.clientX - dragLast.x) * TWIST_PER_PX));
          nameQ.premultiply(qStep.setFromAxisAngle(AXIS_X, (e.clientY - dragLast.y) * TWIST_PER_PX));
          nameQ.normalize();
        }
        if (spinning && !spinGrab && dragTravel > CLICK_PX) {
          // Рука пошла — сфера в руке: инерция гаснет, дальше её ведёт мышь.
          spinGrab = true;
          spinVel.set(0, 0);
          spinAt = performance.now() - 16;
        }
        if (spinning && spinGrab) {
          const yaw = (e.clientX - dragLast.x) * spinK * spinSign;
          const pitch = (e.clientY - dragLast.y) * spinK * spinSign;
          turnSphere(yaw, pitch);
          const now = performance.now();
          const sec = Math.max(0.008, (now - spinAt) / 1000);
          spinAt = now;
          // Скорость для инерции — сглаженная, с потолком: рывок мышью
          // через весь экран не должен раскрутить шар волчком.
          spinVel.x += (Math.max(-8, Math.min(8, yaw / sec)) - spinVel.x) * 0.4;
          spinVel.y += (Math.max(-8, Math.min(8, pitch / sec)) - spinVel.y) * 0.4;
        }
        dragVec.set(e.clientX - r.left - dragFrom.x, -(e.clientY - r.top) + dragFrom.y);
        // Без потолка длинный жест разносит слово в кашу: смещение
        // растёт линейно, а читаемость падает куда быстрее.
        if (dragVec.length() > 240) dragVec.setLength(240);
      }
      dragLast.set(e.clientX, e.clientY);
      const c = !dragging && pick(e.clientX - r.left, e.clientY - r.top) >= 0 ? "pointer" : "";
      if (c !== cursor) {
        cursor = c;
        host.style.cursor = c;
      }
    };
    /* Слушаем на window, а не на канвасе.

       Канвас лежит под слоями вёрстки, и его `pointerleave` срабатывал
       всякий раз, когда курсор наезжал на кнопку: свет под рукой гас
       посреди экрана. Уход считается только настоящим — за пределы окна
       (`pointerout` без соседнего элемента) или потерей фокуса. */
    const onLeave = () => {
      hoverTarget = 0;
    };
    const onOut = (e: PointerEvent) => {
      if (!e.relatedTarget) hoverTarget = 0;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerout", onOut, { passive: true });
    window.addEventListener("blur", onLeave);

    // Перетаскивание: зажатая кнопка разгоняет рой и кренит сцену.
    // Вектор считаем от точки нажатия, а не от центра экрана — тогда
    // жест ощущается как «взял и потянул», а не как переключатель.
    let dragging = false;
    const dragFrom = new THREE.Vector2();
    const dragVec = new THREE.Vector2();
    let drag = 0;
    /* Клик отличаем от жеста: коротко и почти на месте — это нажатие
       на объект, всё остальное — работа кистью. */
    let pressed = false;
    const pressAt = new THREE.Vector2();
    let pressT = 0;

    /* Магнит «Другого опыта» (Илья, 2026-11-02): зажал — огоньки тянутся
       к руке и сплетаются за ней в волшебную ленту. Каждый огонёк — свой
       отрезок пути руки (ближний к руке первым, шаг CAR_GAP), его точки
       теряют форму огонька и расходятся по трём прядям, которые волной
       перевиваются вдоль пути и текут, даже когда рука стоит. Путь хранится
       по расстоянию, а не по времени: рука встала — лента лежит вдоль
       пройденного, не сбиваясь в комок. Точку ведёт пружина с критическим
       затуханием — резко, но без отскока; отпустил — она же, мягче, домой.
       Отвергнуто: отставание по времени со сжатием огоньков (белые комки,
       «криво-косо») и огоньки, хранившие форму на ходу («статично»).
       Включается не сразу: короткое нажатие — это вход в комнату огонька. */
    let magnetArmed = false;
    let magnetic = false;
    /** Путь руки от головы назад, пиксели сцены; длиннее ленты не хранится. */
    let pathX: number[] = [];
    let pathY: number[] = [];
    /** Место огонька в ленте. */
    let magnetRank: number[] = [];
    /** Шаг между огоньками в ленте, пиксели; длина волны прядей и выборка пути. */
    const CAR_GAP = 170;
    const WAVE = 230;
    const SAMPLE = 4;
    /** Путь, выбранный через SAMPLE пикселей от руки, и нормаль к нему в каждой точке. */
    let smpX = new Float32Array(0);
    let smpY = new Float32Array(0);
    let smpNX = new Float32Array(0);
    let smpNY = new Float32Array(0);
    let smpN = 0;
    /** У каждой точки: место на своём отрезке 0..1, размах пряди и её фаза. */
    let magU = new Float32Array(0);
    let magAmp = new Float32Array(0);
    let magPh = new Float32Array(0);

    /* Распыление рукой копится ходом, а не выстреливает сразу.

       Держим суммарный путь курсора с зажатой кнопкой: полтора экрана
       хода — и облако раздуто до предела. Раньше пара сантиметров сразу
       давала полный размах, а дальше вести было незачем. */
    const DRAG_FULL = 1600;
    /** Какая точка перед камерой и можно ли её трогать — из последнего кадра. */
    let nearNow = 0;
    let settledNow = false;
    let dragTravel = 0;
    let dragAmount = 0;
    const dragLast = new THREE.Vector2();

    /* Нажатие слушаем на всём окне, а не на канвасе: в комнате поверх сцены
       лежит слой с текстом, и до канваса не доходило ни одно нажатие —
       сферу внутри нельзя было повернуть, имя — распылить. Кнопки, ссылки
       и поля — их собственное дело, сцена их пропускает. */
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const el = e.target as Element | null;
      if (el?.closest?.("a, button, input, textarea, select, label, video, [contenteditable], nextjs-portal")) {
        // Палец на кнопке — её дело; кисть за ним по точкам не идёт.
        if (e.pointerType === "touch") fingerFree = true;
        return;
      }
      const r = rect;
      if (e.pointerType === "touch") {
        const onObject = touchesObject(e.clientX - r.left, e.clientY - r.top);
        const sphere = stations[nearNow]?.grip === "spin";
        touchPending = touchSpin = false;
        // В комнате сферы весь палец — рука без нажатия; комнату «обо мне» листает колонка.
        fingerFree = room !== null ? !(room === nearNow && sphere) : !onObject;
        if (fingerFree) {
          hoverTarget = 0;
          if (room === null && settledNow && sphere) {
            touchPending = true;
            touchFrom.set(e.clientX, e.clientY);
          }
          return;
        }
        journey.claimTouch();
        ptrFresh = true;
        hoverTarget = 1;
        rawMouse.set(e.clientX - r.left - w / 2, -(e.clientY - r.top) + h / 2);
        if (room !== null) return;
        if (sphere) {
          // Сфера под пальцем — как под мышью без нажатия; тап — вход.
          pressed = true;
          pressAt.set(e.clientX, e.clientY);
          pressT = performance.now();
          return;
        }
      }
      dragging = true;
      dragLast.set(e.clientX, e.clientY);
      dragFrom.set(e.clientX - r.left, e.clientY - r.top);
      dragVec.set(0, 0);
      pressed = true;
      pressAt.set(e.clientX, e.clientY);
      pressT = performance.now();
      // Перед камерой сфера — зажатая рука её вертит.
      // В комнате сферы её так же вертят — изнутри.
      spinning = settledNow && stations[nearNow]?.grip === "spin" && (room === null || room === nearNow);
      spinSign = room === nearNow ? -1 : 1;
      // Перед камерой имя (или его комната) — рука его крутит.
      twisting =
        settledNow &&
        ((stations[nearNow]?.grip === "spray" && (room === null || room === nearNow)) ||
          (stations[nearNow]?.grip === "magnet" && room === nearNow));
      if (spinning) spinK = spinScale(room === nearNow);
      spinAt = performance.now();
      spinGrab = false;
      magnetArmed = settledNow && stations[nearNow]?.grip === "magnet" && room === null;
    };
    const startMagnet = () => {
      const body = bodies[nearNow];
      const hubs = body?.a.hubs;
      if (!body || !hubs) return;
      magnetic = true;
      // Первым к руке идёт ближний огонёк. Путь начинается от руки и тянется
      // через огоньки по порядку: лента собирается с их мест, а не из точки.
      const count = hubs.length / 2;
      const order = Array.from({ length: count }, (_, j) => j).sort(
        (p, q) =>
          Math.hypot(hubs[p * 2] - rawMouse.x, hubs[p * 2 + 1] - rawMouse.y) -
          Math.hypot(hubs[q * 2] - rawMouse.x, hubs[q * 2 + 1] - rawMouse.y)
      );
      magnetRank = new Array(count);
      order.forEach((j, r) => (magnetRank[j] = r));
      pathX = [rawMouse.x, ...order.map((j) => hubs[j * 2])];
      pathY = [rawMouse.y, ...order.map((j) => hubs[j * 2 + 1])];
      const n = body.n;
      if (magU.length !== n) {
        const rnd = (x: number) => {
          const v = Math.sin(x * 12.9898 + 78.233) * 43758.5453;
          return v - Math.floor(v);
        };
        magU = new Float32Array(n);
        magAmp = new Float32Array(n);
        magPh = new Float32Array(n);
        for (let i = 0; i < n; i++) {
          magU[i] = rnd(i * 3 + 1);
          // Три пряди со сдвигом в треть волны. Размах у прядей почти один
          // и фаза разбросана чуть-чуть: со случайным размахом пряди сливались
          // в сплошную полосу и не было видно, как они перевиваются.
          magAmp[i] = 38 + 10 * rnd(i * 3 + 2);
          magPh[i] = (Math.floor(rnd(i * 3 + 3) * 3) * Math.PI * 2) / 3 + (rnd(i * 7 + 5) - 0.5) * 0.3;
        }
      }
    };
    const onUp = (e: PointerEvent) => {
      // Палец поднят — руки над сценой больше нет; ничей палец сцену не трогал.
      if (e.pointerType === "touch") {
        hoverTarget = 0;
        touchPending = false;
        if (touchSpin) {
          touchSpin = false;
          fingerFree = false;
          const idle = (performance.now() - spinAt) / 1000;
          if (idle > 0.06) spinVel.multiplyScalar(Math.exp(-(idle - 0.06) / 0.04));
          return;
        }
        if (fingerFree) {
          fingerFree = false;
          return;
        }
      }
      dragging = false;
      // Отпустили — цель сбрасывается, и точки идут домой напрямую,
      // из того положения, в котором их застали.
      dragTravel = 0;
      if (twisting) {
        unspinFrom.copy(nameQ);
        unspinT = 0;
        unspinCalm = room !== null;
      }
      /* Рука встала и только потом отпустила — бросать нечего: скорость от
         последнего движения гаснет за время стоянки. Иначе шар, долго
         крутившийся по инерции, срывался бы с места после паузы. */
      if (spinning && spinGrab) {
        const idle = (performance.now() - spinAt) / 1000;
        if (idle > 0.06) spinVel.multiplyScalar(Math.exp(-(idle - 0.06) / 0.04));
      }
      spinGrab = false;
      twisting = false;
      // Отпустили магнит — точки идут домой на тех же пружинах.
      const mb = bodies[nearNow];
      if (magnetic && mb) mb.homing = true;
      magnetArmed = false;
      magnetic = false;

      // Нажатие на объект с комнатой — вход, в любом месте аллеи.
      const click =
        pressed &&
        e.type === "pointerup" &&
        Math.hypot(e.clientX - pressAt.x, e.clientY - pressAt.y) < CLICK_PX &&
        performance.now() - pressT < 450;
      pressed = false;
      spinning = false;
      if (click) {
        const k = pick(e.clientX - rect.left, e.clientY - rect.top);
        if (k >= 0) onPickRef.current?.(k);
      }
    };
    window.addEventListener("pointerdown", onDown, { passive: true });
    window.addEventListener("pointerup", onUp, { passive: true });
    window.addEventListener("pointercancel", onUp, { passive: true });

    /* Шаг физики.

       Сила бьёт не от курсора, а по ходу его движения: главное слагаемое —
       сама скорость руки, и лишь малой добавкой идёт отталкивание от точки
       касания. Из-за обратного порядка у меня раньше и выходил антимагнит:
       точки разбегались строго прочь, ровно и мертво.

       Возврат — пружина с критическим затуханием (Илья, 2026-10-19: «как
       у пингвина igloo — по параболе от места и по параболе обратно»).
       Прежняя пружина проскакивала ноль и отбрасывала облако назад — «слишком
       сильный bounce»; эта ровно на границе, где отскока ещё нет: точка
       трогается домой сразу, разгоняется и мягко садится.

       Рука работает только по объекту перед камерой. Остальные шагают,
       лишь пока не улеглись после неё. */
    /* Коэффициенты пересчитаны под пиксели.

       У брата сцена в условных единицах, там скорость руки редко больше
       единицы, и множитель 0.6 уместен. В пикселях та же формула даёт
       полторы сотни пикселей за кадр — слово улетает за край экрана
       с первого же взмаха. */
    /* Замерная точка для доводки удара: сколько скорости руки доходит до точек
       и насколько их уносит. Живёт только в дев-режиме — в сборку не попадает,
       там `probe` равен null и лишний проход по облаку не делается. */
    type Probe = { rawSpeed: number; speed: number; maxDisp: number; moved: number; dispNow: number; meanNow: number };
    const probe: Probe | null =
      process.env.NODE_ENV === "production"
        ? null
        : ((window as unknown as { __probe: Probe }).__probe = {
            rawSpeed: 0,
            speed: 0,
            maxDisp: 0,
            moved: 0,
            dispNow: 0,
            meanNow: 0,
          });

    const HIT = 52;         // радиус, в котором рука вообще что-то задевает
    /* В облаке «обо мне» точки редкие: кистью в 52 px рука задевала единицы,
       и казалось, что ведёшь по облаку поверху (Илья, 2026-10-20). Отзывчивость
       подняли ещё раз (2026-10-21): кисть шире и бьёт в ROOM_KICK раз сильнее. */
    const HIT_ROOM = 170;
    const ROOM_KICK = 2.6;
    /* Но скорость руки в комнате берёт только ядро кисти. Весь круг в 170 px
       ехал за рукой как одна плита: ведёшь по кругу — точки изнутри и снаружи
       от курсора идут по той же дуге, будто привязаны ниточкой по радиусу
       (Илья, 2026-11-06). Остальная кисть точки расталкивает и закручивает. */
    const CORE_ROOM = 64;
    const SWEEP = 0.0030;   // увлечение по ходу руки — основная сила
    const PUSH = 0.0010;    // отталкивание от точки касания
    const CURL = 0.0015;    // закрутка вбок, чтобы не расходились строем
    const DEPTH = 0.0059;   // разброс по глубине: одни ближе, другие дальше

    /* Илья попросил возврат как у пингвина igloo и «быстрее, как на 120 к/с»
       (2026-10-19). Удар остался прежним, поменялись возврат и время полёта:
       трение выше (0.82 вместо 0.95) — без долгого дрейфа, — и пружина вместо
       притяжения по экспоненте: вместе с этим трением она критическая,
       точка трогается домой сразу, разгоняется и мягко садится, 90% пути —
       за ~0,65 с (подбирали 1,2 → 1,0 → 0,85 → 0,43 → 0,65; Илья: «чуть
       быстрее, так же плавно», «ещё в два раза», потом «в полтора раза
       медленнее»). Критичность держится парой: трение f и пружина
       K = 1 + f − 2√f. Трение и пружина гасят полёт раньше, поэтому удар сильнее
       в KICK раз — точки улетают так же далеко, как прежде (замер: мах
       800 px/с — 22 px против 21, 1600 px/с — 48 против 48).

       Пробовали и жидкость по образцу igloo (рука толкает поле, точки плывут
       по нему) — пропали мгновенный удар, закрутка и разлёт по глубине,
       Илья: «раньше было лучше». Поле осталось только у воды фона. Пробовали
       «стыковку» — домой с постоянной скоростью, без торможения у места, —
       Илья откатил: возврат вышел хуже. */
    const FRICTION = 0.82;
    const SPRING = 0.0089;
    /* Полёт вплетённым, а не по прямой (Илья, 2026-10-19: «у пингвина они
       в полёте переплетаются, играют между собой и только потом встают»).
       У igloo на каждую точку всё время действует вихревой шум, и каждая
       читает его в своём темпе — соседи расходятся и закручиваются. Здесь
       то же: вихревое течение без стоков (ротор от суммы синусов), темп
       свой у точки. Вихрь будит удар руки и гасит время, а не расстояние:
       привязанный к отлёту, он сам раскачивал точку и держал её в ~55 px
       от дома, слово не собиралось. */
    const WEAVE = 0.3;      // сила вихря, px/кадр²
    const WEAVE_L = 260;    // размер вихря, px
    const WEAVE_T = 0.35;   // сколько секунд точка «помнит» удар
    /* Пружина — для всего, что откинула кисть, с любого расстояния. Облако
       после распыления возвращается по-старому, медленно и от дальних
       к ближним: быстрым возвратом оно сжималось целиком «размытым
       прямоугольником» слова, разгоралось на скорости и обгоняло раскрутку
       слова назад (Илья, 2026-10-19). Такие точки метит само распыление,
       а не дальность: по дальности сильный мах кистью тоже попадал
       в медленный возврат, и дальние точки возвращались вдвое дольше ближних. */
    const KICK = 2.4;
    /* Рука сквозь зерно (Илья, 2026-10-19: «у пингвина ты проходишь через
       частицы, а не ведёшь по ним, как по ряби»). У igloo точки под рукой
       перенимают скорость течения и тянутся за ней — отлёт там ~25% высоты
       фигуры против наших ~6%. Здесь так же: к прежнему удару точка под
       кистью перенимает долю скорости самой руки — тем сильнее, чем ближе.
       Замер на сфере: мах 800 px/с уносит на ~90 px — 25% её высоты. */
    const CARRY = 0.95; // доля скорости руки, которую берёт точка (Илья, 2026-11-06: 95%, было 85%)
    const GRIP = 0.9;                     // как быстро берёт: доля разницы за кадр
    /* Скачок курсора больше этой доли окна за кадр — не мах, а сбой. Было
       160 px: резкий рывок мышью (от ~9000 px/с) целиком принимался за возврат
       руки в окно, и имя со сферой переставали отвечать (Илья, 2026-11-06;
       замер: 11 400 px/с — сдвинуто 1437 точек из ~12 тыс., 19 000 — ни одной).
       Возврат руки в окно теперь ловит `ptrFresh`, а это — страховка, как у
       igloo (0,3 окна за шаг). */
    const TELEPORT = 0.35;
    /** Потолок скорости руки, которую берут точки, — px за кадр. */
    const HAND_MAX = 120;
    /* Возврат облака после распыления (Илья, 2026-10-20: «слишком долго
       встают на места, вымораживает»). Было 5,9 с: самый быстрый ход в первые
       доли секунды, дальше длинный хвост. Теперь каждая точка идёт домой
       за своё время — от ~0,8 с для ближних до ~1,3 с для дальних: разгоняется
       от места, где её застали, и мягко садится. Ближние встают раньше, и
       слово собирается от середины облака, а не сжимается целиком. */
    const RETURN_T0 = 0.75; // с — время пути для точки у самого дома
    const RETURN_T1 = 0.55; // с — сколько добавляют 1000 px дальности (по корню)
    /** За сколько слово раскручивается назад — как самая дальняя точка облака. */
    const UNSPIN_T = RETURN_T0 + RETURN_T1;
    /* В «обо мне» облако на весь экран, и тот же возврат проносил точки через
       полэкрана за секунду и ставил разом (Илья, 2026-10-21: «быстро летят
       и быстро останавливаются»). Там путь в ROOM_SLOW раз дольше и идёт
       экспонентой: долгий разгон, быстрый пролёт, долгая посадка. */
    const ROOM_SLOW = 1.5;

    let physT = 0;
    const stepPhysics = (dt: number, active: Body | null, settled: boolean) => {
      physT += dt;
      // Скорость руки сглаживаем и ограничиваем: рывок мышью через весь
      // экран иначе выстреливает облако одним кадром.
      const fresh = ptrFresh;
      ptrFresh = false;
      const raw = !fresh && ptrPrev.x > -9000 && rawMouse.x > -9000
        ? { x: rawMouse.x - ptrPrev.x, y: rawMouse.y - ptrPrev.y }
        : { x: 0, y: 0 };
      ptrPrev.copy(rawMouse);
      const lost = fresh || Math.hypot(raw.x, raw.y) > Math.max(w, h) * TELEPORT;
      if (lost) raw.x = raw.y = 0;
      /* Сглаживание и потолок решают, сколько удара доходит до точек.

         Было 0.3 и 55: рука на 120 пикселях за кадр отдавала облаку 55 —
         меньше половины, и сильный мах ощущался как слабый. Сглаживание
         держим слабым, чтобы рывок не размазывался по кадрам, а потолок
         поднимаем — он остаётся только страховкой от броска мышью через
         весь экран. */
      // Скачок курсора — не мах: он влетел в окно или его бросили через
      // экран. Перенятая скорость такого скачка выстреливала точки столбом.
      if (lost) handVel.set(0, 0);
      else handVel.lerp(new THREE.Vector2(raw.x, raw.y), 0.55);
      const handLen = handVel.length();
      const speed = Math.min(handLen, HAND_MAX);
      const moving = speed > 0.35 && hover > 0.01 && settled;
      handNow = Math.min(1, speed / 60) * hover;

      /* Вода — везде, где прошла рука, и на ходу тоже: мешаешь толщу, а не
         объект. Успокоилась — ни шага, ни заливки текстуры. */
      if ((raw.x || raw.y) && hover > 0.01)
        water.splat(rawMouse.x - raw.x, rawMouse.y - raw.y, rawMouse.x, rawMouse.y, h * WATER_R);
      if (water.stirred) {
        // Быстрая вода — только в комнате проекта, по её экрану; «обо мне» не трогаем.
        water.quick(view.k !== null && stations[view.k]?.room !== "burst" ? view.alpha : 0);
        water.step(dt * 60);
        water.fill(waterData);
        waterU.uWaterTex.value.needsUpdate = true;
      }
      if (probe) {
        probe.rawSpeed = Math.max(probe.rawSpeed, Math.hypot(raw.x, raw.y));
        probe.speed = Math.max(probe.speed, speed);
      }
      // Рука — в координатах мира: камера у точки с `rise` поднята.
      const hx = rawMouse.x;
      const hy = rawMouse.y - lift;
      /* Кисть проходит весь путь руки за кадр, а не только место, где рука
         оказалась: на быстром рывке рука шагает за кадр на 100–300 px, и
         точки между этими местами не задевались вовсе. */
      const hx0 = hx - raw.x;
      const hy0 = hy - raw.y;
      const sgl2 = raw.x * raw.x + raw.y * raw.y;
      const capK = handLen > HAND_MAX ? HAND_MAX / handLen : 1;
      const vhx = handVel.x * capK;
      const vhy = handVel.y * capK;

      // Трение и возврат — за кадр, приведённые к реальному шагу времени.
      const fric = Math.pow(FRICTION, dt * 60);
      const step = dt * 60;
      // Скорость руки в тех же единицах, что у точек: пиксели за кадр по 60 к/с.
      const perFrame = 1 / Math.max(step, 0.25);
      const pull = SPRING * dt * 60;
      const wane = Math.exp(-dt / WEAVE_T);
      /* Распыление — не удар, а удержание.

         Пока кнопка зажата, точка тянется к своей цели и там стоит: облако
         замирает в том виде, в каком его раздули, и рукой можно возить
         сколько угодно. Раньше это были случайные толчки, и облако, пока
         рука стоит, потихоньку сползалось обратно. */
      dragAmount = dragging ? Math.min(1, dragTravel / DRAG_FULL) : 0;
      const hold = dragging ? 1 - Math.pow(1 - 0.09, dt * 60) : 0;

      if (magnetArmed && !magnetic && rawMouse.x > -9000 && (performance.now() - pressT > 180 || dragTravel > 6)) startMagnet();
      if (magnetic && rawMouse.x > -9000) {
        // Голова пути — рука: новая точка, когда рука ушла на 4 px.
        if (Math.hypot(rawMouse.x - pathX[0], rawMouse.y - pathY[0]) > 4) {
          pathX.unshift(rawMouse.x);
          pathY.unshift(rawMouse.y);
        }
        // Путь от руки через каждые SAMPLE пикселей — на длину всей ленты.
        const need = Math.ceil(((magnetRank.length + 0.7) * CAR_GAP) / SAMPLE) + 1;
        if (smpX.length < need) {
          smpX = new Float32Array(need);
          smpY = new Float32Array(need);
          smpNX = new Float32Array(need);
          smpNY = new Float32Array(need);
        }
        let walked = 0;
        let k = 0;
        for (let j = 0; j < need; j++) {
          const want = j * SAMPLE;
          let sl = 0;
          while (k < pathX.length - 1) {
            sl = Math.hypot(pathX[k + 1] - pathX[k], pathY[k + 1] - pathY[k]);
            if (walked + sl >= want) break;
            walked += sl;
            k++;
          }
          if (k >= pathX.length - 1) {
            smpX[j] = pathX[pathX.length - 1];
            smpY[j] = pathY[pathY.length - 1];
          } else {
            const f = sl > 1e-6 ? (want - walked) / sl : 0;
            smpX[j] = pathX[k] + (pathX[k + 1] - pathX[k]) * f;
            smpY[j] = pathY[k] + (pathY[k + 1] - pathY[k]) * f;
          }
        }
        smpN = need;
        // Нормаль — по соседям через две выборки: на коротком шаге она дрожала бы.
        for (let j = 0; j < need; j++) {
          const p = Math.max(0, j - 2);
          const q = Math.min(need - 1, j + 2);
          const tx = smpX[p] - smpX[q];
          const ty = smpY[p] - smpY[q];
          const l = Math.hypot(tx, ty);
          if (l > 1e-3) {
            smpNX[j] = -ty / l;
            smpNY[j] = tx / l;
          } else if (j > 0) {
            smpNX[j] = smpNX[j - 1];
            smpNY[j] = smpNY[j - 1];
          } else {
            smpNX[j] = 0;
            smpNY[j] = 1;
          }
        }
        // Путь дальше конца ленты не нужен.
        if (k + 2 < pathX.length) {
          pathX.length = k + 2;
          pathY.length = k + 2;
        }
      }

      for (const body of bodies) {
        if (!body) continue;
        const isActive = body === active;
        /* Шагаем и перезаливаем буферы только объект в работе: под рукой,
           в распылении, на отдаче или ещё не улёгшийся. Спокойный объект
           не трогаем вовсе — заливка в видеокарту стоит дороже всей
           физики, и на пролёте по аллее она давала заминки по 200 мс. */
        const magnet = isActive && magnetic && !!body.a.group && body.morph < 0.01;
        const engaged = isActive && (moving || magnet || (dragging && body.grip === "spray"));
        const homing = body.homing;
        body.u.uStretch.value = magnet || homing ? 0.15 : 1;
        if (!engaged && !body.restless && !homing) continue;
        const { vel, disp, give, sprayed, back, trip, pace, stir, spray } = body;
        // Дом — та форма, в которой объект сейчас стоит: на аллее или в комнате.
        const base2 = body.morph > 0.5 ? body.b.points : body.a.points;
        // У сферы дом ещё и повёрнут, и у каждой точки своя глубина: рука
        // ищет точку там, где та видна на экране, а не в исходной раскладке.
        const homeZ = body.morph > 0.5 ? body.b.z : body.a.z;
        const homeCz = (body.morph > 0.5 ? body.b.cz : body.a.cz) ?? 0;
        const rm = body.u.uRot.value.elements;
        const hand = isActive && moving && !spinning;
        const sprays = body.grip === "spray";
        const spread = isActive && dragging && sprays;
        const n = body.n;
        const roomy = !body.solid && body.morph > 0.5;
        const hit = roomy ? HIT_ROOM : HIT;
        const core = roomy ? CORE_ROOM : HIT;
        // Глубину шейдер у плоских форм поджимает (`uDepth`): рука ищет точку там же.
        const dk = body.u.uDepth.value;
        /* Длинный шаг руки за кадр — на подшаги не длиннее полукисти: прежде
           рука на рывке шагала дальше своей кисти и проскакивала точки. Пока
           шаг короче, подшаг один — ровно прежний счёт по месту руки. */
        const subs = Math.min(16, Math.max(1, Math.ceil(Math.sqrt(sgl2) / (hit * 0.5))));
        const kick = roomy ? KICK * ROOM_KICK : KICK;
        if (spread) body.calm = roomy;
        let restless = false;
        let homeLeft = false;
        /* Пружина магнита — радиан за кадр по 60 к/с: 0.3 в ленте (резко),
           0.13 на пути домой (мягко), у каждой точки свой разброс ±25%.
           Шаг не длиннее двух кадров — так она устойчива. Пряди дышат
           ходом руки: на скорости размах больше. */
        const ms = Math.min(step, 2);
        const swing = 0.55 + 0.65 * Math.min(1, speed / 25);
        const flowT = physT * 3;

        for (let i = 0; i < n; i++) {
          const i3 = i * 3;
          if (magnet || homing) {
            const own = (give[i] - 0.35) / 1.5;
            let wx = 0;
            let wy = 0;
            if (magnet && smpN > 0) {
              const r = magnetRank[body.a.group![i]] ?? 0;
              const along = Math.max(0, (r + (magU[i] - 0.5) * 1.3) * CAR_GAP);
              const j = Math.min(smpN - 1, Math.round(along / SAMPLE));
              const lat = magAmp[i] * swing * Math.sin((along / WAVE) * Math.PI * 2 - flowT + magPh[i]);
              wx = smpX[j] + smpNX[j] * lat - base2[i * 2];
              wy = smpY[j] + smpNY[j] * lat - base2[i * 2 + 1];
            }
            const w0 = (magnet ? 0.3 : 0.13) * (0.75 + 0.5 * own);
            let mvx = vel[i3];
            let mvy = vel[i3 + 1];
            mvx += ((wx - disp[i3]) * w0 * w0 - 2 * w0 * mvx) * ms;
            mvy += ((wy - disp[i3 + 1]) * w0 * w0 - 2 * w0 * mvy) * ms;
            const mvz = vel[i3 + 2] * Math.pow(0.85, ms) - disp[i3 + 2] * 0.05 * ms;
            vel[i3] = mvx;
            vel[i3 + 1] = mvy;
            vel[i3 + 2] = mvz;
            disp[i3] += mvx * ms;
            disp[i3 + 1] += mvy * ms;
            disp[i3 + 2] += mvz * ms;
            sprayed[i] = 0;
            stir[i] = 0;
            if (Math.abs(disp[i3]) + Math.abs(disp[i3 + 1]) + Math.abs(disp[i3 + 2]) > 0.6 || Math.abs(mvx) + Math.abs(mvy) > 0.05)
              homeLeft = true;
            restless = true;
            continue;
          }
          /* Точка стоит дома ровно и руки над объектом нет — шагать нечего: трение
             и пружина от нуля дают ноль. После касания объект успокаивается секунду-
             другую, и прежде все его точки считались, хотя двигались единицы. */
          if (
            !hand &&
            !spread &&
            !sprayed[i] &&
            stir[i] <= 0.01 &&
            disp[i3] === 0 &&
            disp[i3 + 1] === 0 &&
            disp[i3 + 2] === 0 &&
            vel[i3] === 0 &&
            vel[i3 + 1] === 0 &&
            vel[i3 + 2] === 0
          )
            continue;
          let vx = vel[i3];
          /** Насколько точка под рукой: от этого — какую долю её скорости берёт. */
          let carry = 0;
          let vy = vel[i3 + 1];
          let vz = vel[i3 + 2];

          if (hand) {
            // Расстояние считаем до точки там, где она сейчас, а не где её
            // дом: иначе разлетевшийся песок рука перестаёт задевать.
            let bx = base2[i * 2];
            let by = base2[i * 2 + 1];
            if (homeZ || body.u.uRot.value !== noRot) {
              const x = bx;
              const y = by;
              const z = homeZ ? homeZ[i] : 0;
              const ps = baseZ / Math.max(baseZ - ((rm[2] * x + rm[5] * y + rm[8] * z) * dk + homeCz), 60);
              bx = (rm[0] * x + rm[3] * y + rm[6] * z) * ps;
              by = (rm[1] * x + rm[4] * y + rm[7] * z) * ps;
            }
            const px = bx + disp[i3];
            const py = by + disp[i3 + 1];
            // Сперва — задевает ли точку путь руки за кадр вообще.
            let qx = px - hx;
            let qy = py - hy;
            if (subs > 1) {
              const t = Math.max(0, Math.min(1, ((px - hx0) * raw.x + (py - hy0) * raw.y) / sgl2));
              qx = px - (hx0 + raw.x * t);
              qy = py - (hy0 + raw.y * t);
            }
            if (qx * qx + qy * qy < hit * hit) {
              for (let j = 1; j <= subs; j++) {
                const dx = px - (subs > 1 ? hx0 + (raw.x * j) / subs : hx);
                const dy = py - (subs > 1 ? hy0 + (raw.y * j) / subs : hy);
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist >= hit) continue;
                const t2 = dist / hit;
                const near = (1 - t2) * (1 - t2);
                const s = speed * near * give[i];
                // Удар делится на подшаги: за кадр точка получает столько же,
                // сколько прежде, — только без пропусков на длинном шаге.
                const k = (s * kick) / subs;
                // По ходу руки ведёт только ядро: на аллее это вся кисть.
                const c2 = Math.max(0, 1 - dist / core);
                const along = core === hit ? 1 : (c2 * c2) / Math.max(near, 1e-6);
                vx += vhx * k * SWEEP * along;
                vy += vhy * k * SWEEP * along;
                if (dist > 1) {
                  vx += (dx / dist) * k * PUSH;
                  vy += (dy / dist) * k * PUSH;
                }
                vx += (-dy / (dist + 60)) * k * CURL;
                vy += (dx / (dist + 60)) * k * CURL;
                vz += (Math.random() - 0.5) * k * DEPTH;
                // Скорость руки берёт тот, кого рука накрыла хоть раз за кадр.
                carry = Math.max(carry, core === hit ? near : c2 * c2);
                if (near > stir[i]) stir[i] = near;
              }
            }
          }

          vx *= fric;
          vy *= fric;
          vz *= fric;
          /* Скорость руки точка берёт уже после трения: иначе трение съедало
             её в том же кадре, и при быстром возврате точки шли не на 85%
             скорости руки, а на 64%. */
          if (carry > 0) {
            const take = 1 - Math.pow(1 - GRIP * carry, step);
            const want = CARRY * (0.6 + 0.4 * Math.min(1, give[i] / 1.85));
            vx += (vhx * perFrame * want - vx) * take;
            vy += (vhy * perFrame * want - vy) * take;
          }
          if (spread) {
            sprayed[i] = 1;
            back[i] = -1;
            // Распыление — удержание, а не удар: вихрь от руки, задевавшей
            // облако, не должен раскачать точку, когда она долетит домой.
            stir[i] = 0;
          } else if (sprayed[i] && disp[i3] * disp[i3] + disp[i3 + 1] * disp[i3 + 1] + disp[i3 + 2] * disp[i3 + 2] < 1)
            sprayed[i] = 0;
          if (!spread && !sprayed[i]) {
            if (stir[i] > 0.01) {
              // Вихрь в месте точки, во времени точки: ψ = sin a·cos b + ½ sin c,
              // скорость — (∂ψ/∂y, −∂ψ/∂x), течение без стоков, точки не слипаются.
              const own = (give[i] - 0.35) / 1.5;
              const tt = physT * (1 + 0.7 * own) + own * 9;
              const wk = (Math.PI * 2) / WEAVE_L;
              const px = base2[i * 2] + disp[i3];
              const py = base2[i * 2 + 1] + disp[i3 + 1];
              const a = px * wk + tt * 0.9;
              const b = py * wk * 1.3 - tt * 0.7;
              const c = (px + py) * wk * 0.7 + tt * 1.3;
              const fly = stir[i] * WEAVE * step;
              stir[i] *= wane;
              vx += (-1.3 * Math.sin(a) * Math.sin(b) + 0.35 * Math.cos(c)) * fly;
              vy += -(Math.cos(a) * Math.cos(b) + 0.35 * Math.cos(c)) * fly;
              vz += Math.sin(tt * 1.1 + own * 20) * fly * 0.6;
            }
            vx -= disp[i3] * pull;
            vy -= disp[i3 + 1] * pull;
            vz -= disp[i3 + 2] * pull;
          }
          // Унесённую распылением ведёт прежний возврат — до самого дома.
          const scattered = sprayed[i] === 1;
          vel[i3] = vx;
          vel[i3 + 1] = vy;
          vel[i3 + 2] = vz;

          let dx2 = disp[i3] + vx * step;
          let dy2 = disp[i3 + 1] + vy * step;
          let dz2 = disp[i3 + 2] + vz * step;

          if (spread) {
            /* Форма — облако в объёме: каждая точка уходит в своё место
               равномерного распыления. Строить его в полярных координатах
               было ошибкой — пустая сердцевина, труба вокруг невидимого
               столба. Облако поворачивается вместе со словом тем же
               поворотом, что шейдер даёт дому: смещение — повёрнутый разлёт. */
            const sx = spray[i3] * dragAmount;
            const sy = spray[i3 + 1] * dragAmount * 0.7;
            const sz = spray[i3 + 2] * dragAmount;
            dx2 += (rm[0] * sx + rm[3] * sy + rm[6] * sz - dx2) * hold;
            dy2 += (rm[1] * sx + rm[4] * sy + rm[7] * sz - dy2) * hold;
            dz2 += (rm[2] * sx + rm[5] * sy + rm[8] * sz - dz2) * hold;
          } else if (scattered) {
            /* Домой — по прямой из того места, где точку застали: плавный
               разгон и такое же плавное торможение, по синусу. Кубы давали
               рывок — пик скорости втрое выше среднего — и долгое доползание
               в конце (Илья, 2026-10-20: «быстро, но плавно»); у синуса пик
               в полтора раза выше среднего, и последний отрезок не тянется.

               Путь запоминается в осях повёрнутого слова и каждый кадр
               поворачивается вместе с ним: слово раскручивается назад, и облако
               раскручивается с ним, стягиваясь, — точки идут домой по спирали,
               а не по прямой (Илья, 2026-10-20). Удар руки по летящей точке
               сдвигает начало её пути — она сбивается и летит дальше. */
            if (back[i] < 0) {
              trip[i3] = rm[0] * dx2 + rm[1] * dy2 + rm[2] * dz2;
              trip[i3 + 1] = rm[3] * dx2 + rm[4] * dy2 + rm[5] * dz2;
              trip[i3 + 2] = rm[6] * dx2 + rm[7] * dy2 + rm[8] * dz2;
              pace[i] = 1 / ((RETURN_T0 + RETURN_T1 * Math.sqrt(Math.hypot(dx2, dy2, dz2) / 1000)) * (body.calm ? ROOM_SLOW : 1));
              back[i] = 0;
            } else {
              trip[i3] += (rm[0] * vx + rm[1] * vy + rm[2] * vz) * step;
              trip[i3 + 1] += (rm[3] * vx + rm[4] * vy + rm[5] * vz) * step;
              trip[i3 + 2] += (rm[6] * vx + rm[7] * vy + rm[8] * vz) * step;
            }
            const t = (back[i] = Math.min(1, back[i] + dt * pace[i]));
            const left = body.calm ? 1 - inOutExpo(t) : 0.5 + 0.5 * Math.cos(Math.PI * t);
            const lx = trip[i3] * left;
            const ly = trip[i3 + 1] * left;
            const lz = trip[i3 + 2] * left;
            dx2 = rm[0] * lx + rm[3] * ly + rm[6] * lz;
            dy2 = rm[1] * lx + rm[4] * ly + rm[7] * lz;
            dz2 = rm[2] * lx + rm[5] * ly + rm[8] * lz;
          }

          const r2 = dx2 * dx2 + dy2 * dy2;
          const v2 = vx * vx + vy * vy + vz * vz;
          // Почти дома (меньше 0,05 px и почти без скорости) — сажаем ровно, и со
          // следующего кадра точка не считается вовсе. Разница глазу не видна.
          if (!spread && !scattered && stir[i] <= 0.01 && r2 + dz2 * dz2 < 0.0025 && v2 < 1e-6) {
            dx2 = dy2 = dz2 = 0;
            vel[i3] = vel[i3 + 1] = vel[i3 + 2] = 0;
          }
          disp[i3] = dx2;
          disp[i3 + 1] = dy2;
          disp[i3 + 2] = dz2;
          if (r2 + dz2 * dz2 > 0.25 || v2 > 0.01) restless = true;
        }
        body.restless = restless;
        if (homing && !homeLeft) body.homing = false;

        if (probe && isActive) {
          let max = 0;
          let cnt = 0;
          let sum = 0;
          for (let i = 0; i < n; i++) {
            const i3 = i * 3;
            const d = Math.hypot(disp[i3], disp[i3 + 1], disp[i3 + 2]);
            if (d > max) max = d;
            if (d > 2) cnt++;
            sum += d;
          }
          probe.maxDisp = Math.max(probe.maxDisp, max);
          probe.moved = Math.max(probe.moved, cnt);
          // Текущее, а не рекорд: по нему меряется время возврата.
          probe.dispNow = max;
          probe.meanNow = sum / n;
        }

        body.dispAttr.needsUpdate = true;
        body.velAttr.needsUpdate = true;
      }
    };

    /* ── аллея ─────────────────────────────────────────────────── */

    /** Насколько раскрыта комната — всем остальным это сигнал уйти в туман. */
    let roomAmount = 0;

    /* Пересборка надписи в соседнюю (контакты ⇄ имя): точки на виду у одной
       из двух надписей. В миг смены та, что выходит на вид, перенимает
       у прежней сдвиги и скорости точек от руки — иначе всё, что рука успела
       отодвинуть, разом прыгало на место: крутишь назад с имени, курсор
       над словом, и в первый же кадр перехода слово «перескакивало»
       (Илья, 2026-10-20). Точка №i у обеих одна и та же (seedOf). */
    /* Пар пересборки может быть несколько: огоньки «Другого опыта» → «@»
       и «@» → имя (Илья, 2026-11-02). У каждой пары своя держательница. */
    const reformPairs = stations.flatMap((s, k) => (s.reform && stations[(k + 1) % N]?.reform ? [k] : []));
    const reformHolder = new Map<number, number>();
    const handOver = (from: Body, to: Body) => {
      to.vel.set(from.vel);
      to.disp.set(from.disp);
      to.sprayed.set(from.sprayed);
      to.back.set(from.back);
      to.trip.set(from.trip);
      to.pace.set(from.pace);
      to.stir.set(from.stir);
      to.calm = from.calm;
      to.restless = true;
      to.dispAttr.needsUpdate = true;
      to.velAttr.needsUpdate = true;
    };
    const keepReform = (progress: number) => {
      for (const pair of reformPairs) {
        const a = bodies[pair];
        const b = bodies[(pair + 1) % N];
        if (!a || !b || a.n !== b.n) continue;
        const d = ringOffset(progress, pair, N);
        if (d <= 0 || d >= 1) {
          reformHolder.delete(pair);
          continue;
        }
        // Та же граница, что прячет уходящую и показывает приходящую.
        const holder = d < REFORM_END ? pair : (pair + 1) % N;
        const prev = reformHolder.get(pair);
        if (prev !== undefined && holder !== prev) {
          const from = bodies[prev];
          const to = bodies[holder];
          if (from && to) handOver(from, to);
        }
        reformHolder.set(pair, holder);
      }
    };

    /** Ставит объекты по местам на аллее и ведёт раскрытие комнат. Отдаёт
        объект перед камерой и можно ли сейчас трогать его рукой. */
    const place = (progress: number, dt: number, t: number) => {
      const near = ((Math.round(progress) % N) + N) % N;

      // Сперва раскрытие: от него зависит, насколько гаснут остальные.
      roomAmount = 0;
      for (let k = 0; k < N; k++) {
        const b = bodies[k];
        if (!b) continue;
        // Раскрываться комната начинает, когда камера уже почти у точки:
        // клик по дальнему объекту сперва подвозит к нему.
        const want = room === k && Math.abs(ringOffset(progress, k, N)) < 0.35 ? 1 : 0;
        b.morph = reduced
          ? want
          : Math.max(0, Math.min(1, b.morph + Math.sign(want - b.morph) * (dt / (b.solid ? UNFOLD : BURST))));
        // Мир гаснет и текст комнаты проявляется в такт видимому раскрытию, а не по часам.
        roomAmount = Math.max(roomAmount, b.solid ? unfoldAt(b.morph) : burstAt(b.morph));
      }

      for (let k = 0; k < N; k++) {
        const d = ringD(progress, k);
        const b = bodies[k];
        /* Две сферы подряд не улетают в камеру, а пересобираются одна
           в другую на месте: сетка та же, волна снизу вверх переплетает
           точки, и на шаре уже другой проект (Илья, 2026-10-18). На шаге
           полоски соседи — уходящая и приходящая. */
        const other =
          hop && (k === hop.from || k === hop.to)
            ? k === hop.from
              ? hop.to
              : hop.from
            : (((k + (d > 0 ? 1 : -1)) % N) + N) % N;
        const swap =
          other !== k &&
          ((!!b?.solid && !!bodies[other]?.solid) || (!!stations[k].reform && !!stations[other].reform));
        // Подлёт — минус, уход — плюс; на точке ноль.
        // Прилёт — пока объект впереди, уход — когда он позади.
        const flow = d < 0 ? stations[k].arrive : stations[k].leave;
        const pass = swap ? 0 : Math.sign(d) * Math.min(1, Math.abs(d) / ((flow && REACH[flow]) || PASS));
        const away = swap ? Math.min(1, Math.abs(d)) : Math.abs(pass);
        // В комнате остальной мир гаснет: сцена принадлежит ей одной.
        const own = room === k || (b?.morph ?? 0) > 0;
        const vis = own ? 1 : 1 - roomAmount;

        const f = frames[k];
        f.d = d;
        f.x = w / 2;
        f.y = h / 2;
        f.hw = b?.a.halfW ?? 0;
        f.hh = b?.a.halfH ?? 0;
        f.ink = b?.a.inkBottom ?? f.hh;
        f.inkR = b?.a.inkRight ?? f.hw;
        f.gap = b?.a.gap ?? 0;
        f.vis = b ? vis * (1 - away) : 0;
        if (!b) continue;

        // Уходящая надпись пересборки прячется раньше конца пути — там, где
        // приходящая уже встала на точку и её можно трогать (REFORM_END).
        const gone = swap && !b.solid && d > 0 ? REFORM_END : 0.999;
        b.points.visible = vis > 0.002 && away < gone;
        // Уходящий ближе к камере, чем подлетающий: рисуется поверх.
        b.points.renderOrder = d > 0 ? 1 : 0;
        b.u.uPass.value = pass;
        b.u.uFlow.value = flow ? FLOW[flow] : 0;
        /* Волна пересборки — только на аллее. В раскрытой сфере она прятала
           верхнюю половину: фронт волны считается по радиусу маленькой
           сферы, а комната в 7,5 раза больше. Камера после входа доезжает
           до точки бесконечно малыми шагами, волна оставалась включённой,
           и во второй сфере не хватало половины (Илья, 2026-10-20). */
        b.u.uSwap.value = swap && b.morph < 0.001 ? Math.max(-1, Math.min(1, d)) : 0;
        b.u.uVis.value = vis;
        b.u.uMorph.value = b.solid ? unfoldAt(b.morph) : burstAt(b.morph);
        /* Кадр внутри сферы (Илья, 2026-10-21: «сфера должна просвечивать,
           что в ней»): горит, пока сфера стоит собранной, — гаснет на подлёте
           и уходе, как кадр на её точках, при раскрытии в комнату и при
           пересборке в соседнюю, уступая её кадру. */
        if (b.glow) {
          const g = b.glow;
          const fly = Math.min(1, Math.abs(pass) / 0.35);
          const amt =
            GLOW * b.u.uTexAmt.value * vis * (1 - unfoldAt(b.morph)) * (1 - fly * fly * (3 - 2 * fly)) *
            (swap ? 1 - Math.min(1, Math.abs(d)) : 1);
          g.mesh.visible = amt > 0.002 && b.points.visible;
          g.u.uAmt.value = amt;
          g.mesh.position.set(0, 0, b.a.cz ?? 0);
          g.mesh.scale.set(2 * b.a.halfW, 2 * b.a.halfW, 1);
          const ta = b.u.uTexAspect.value;
          g.u.uScale.value.set(ta > 1 ? 1 / ta : 1, ta > 1 ? 1 : ta);
        }
        // Притушить — по той же кривой, что раскрытие: по прямой тень замирала рывком.
        b.u.uDim.value = (stations[k].dim ?? 0) * (b.solid ? unfoldAt(b.morph) : burstAt(b.morph));
        stepShots(b, t, dt);
        // Видео на сфере крутится, только пока она рядом: дальние стоят.
        if (b.video) {
          const play = Math.abs(d) < 1 && vis > 0.01;
          if (play && b.video.paused) b.video.play().catch(() => {});
          else if (!play && !b.video.paused) b.video.pause();
        }
      }

      // Подъём камеры у точек с `rise`: объект встаёт выше середины окна.
      lift = 0;
      for (let k = 0; k < N; k++) {
        const r = stations[k].rise;
        if (!r) continue;
        const a = Math.max(0, 1 - Math.abs(frames[k].d));
        lift += r * h * a * a * (3 - 2 * a);
      }
      if (lift) for (const f of frames) f.y -= lift;

      const active = bodies[near] ?? null;
      const settled =
        !hop && !!active && Math.abs(ringOffset(progress, near, N)) < 0.12 && (active.morph < 0.01 || active.morph > 0.99);
      nearNow = near;
      settledNow = settled;
      return { active, settled };
    };


    /* ── кадр ──────────────────────────────────────────────────── */

    let last = performance.now();
    const started = last;
    let enter = 0;
    /** Первый кадр с именем нарисован — заставку можно снимать. Один раз. */
    let loadedSent = false;
    const loaded = () => {
      if (loadedSent || !bodies[0]) return;
      loadedSent = true;
      onLoadedRef.current?.();
    };

    /* Камера стоит на месте, едут объекты.

       Кольцо без шва: каждый объект ставится по своему расстоянию до камеры
       на кольце, и после последней точки первая уже ждёт впереди — прыгать
       камере некуда. */

    const frame = () => {
      raf = requestAnimationFrame(frame);
      const now = performance.now();
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const t = (now - started) / 1000;

      // Кадронезависимое сглаживание: при просадке fps движение
      // замедляется по времени, а не по кадрам.
      const k = 1 - Math.pow(0.0022, dt);
      // Секунда на то, чтобы отпустить слово, и столько же, чтобы взять.
      hover += (hoverTarget - hover) * Math.min(1, k * 0.5);

      // Маршрут ведёт объекты.
      const progress = journey.update(dt);
      if (hop) {
        // Колесо или палец повели камеру — шаг кончен, дальше обычный маршрут.
        const off = Math.abs(progress - hop.to);
        if (off > 0.02 && off < N - 0.02) endHop();
        else {
          const prev = hop.t;
          // После разворота шаг не стартует с места на полной скорости, а разгоняется.
          if (hop.ramp < 1) hop.ramp = Math.min(1, hop.ramp + dt / HOP_TURN);
          const ramp = hop.ramp * hop.ramp * (3 - 2 * hop.ramp);
          hop.t += (1 - hop.t) * Math.min(1, k * 0.62) * ramp;
          if (1 - hop.t < 0.001) hop.t = 1;
          hop.v = dt > 0 ? ((hop.t - prev) * hop.dir) / dt : 0;
          if (hop.t >= 1) endHop();
        }
      }
      const velocity = hop ? hop.v : journey.velocity;
      const speed = Math.min(1, Math.abs(velocity) * 1.4);
      camera.position.z = baseZ;
      stepSphereRot(dt);
      const { active, settled } = place(progress, dt, t);
      keepReform(progress);
      stepPhysics(dt, active, settled);
      env.update(progress, speed, roomAmount, baseZ, camera.position.z, (hop ? hop.from + hop.dir * hop.t : progress) + dustShift);
      lightUp(progress);

      if (startRef.current) enter = Math.min(1, enter + dt / 1.6);
      const eased = 1 - Math.pow(1 - enter, 3);

      // Сила перетаскивания нарастает и спадает плавно: резкий перепад
      // рвёт штрихи роя пополам.
      drag += ((dragging && !spinning ? 1 : 0) - drag) * Math.min(1, k * 0.9);
      if (!dragging) dragVec.multiplyScalar(Math.pow(0.86, dt * 60));

      // Поле светлеет на разгоне: движение чувствуется всем экраном,
      // а не только тем, что уезжает.
      fieldUniforms.uSpeed.value = speed;

      onFrameRef.current?.({
        progress,
        velocity,
        stations: frames,
        room: roomAmount,
        marks: env.marksOnScreen,
        hand: handNow,
        tint: frameTint(),
        // Жест засчитывается, когда рука прошла хоть немного, а не от одного нажатия.
        grip: touchSpin || (spinning && dragTravel > 40) ? "spin" : twisting && dragTravel > 40 ? "spray" : null,
      });
      drawRoom();

      fieldUniforms.uTime.value = t;
      fieldUniforms.uEnter.value = eased;
      shared.uTime.value = t;
      shared.uEnter.value = enter;
      // Отпустили — слово ложится обратно читаемым: поворот плавно сходит
      // к исходному, без отскока.
      if (!twisting && unspinT < 1) {
        unspinT = Math.min(1, unspinT + dt / (UNSPIN_T * (unspinCalm ? ROOM_SLOW : 1)));
        const back = unspinCalm ? inOutExpo(unspinT) : 0.5 - 0.5 * Math.cos(Math.PI * unspinT);
        nameQ.slerpQuaternions(unspinFrom, QUAT_ID, back);
      }
      nameRot.setFromMatrix4(rotM4.makeRotationFromQuaternion(nameQ));
      shared.uCamZ.value = camera.position.z;
      shared.uBaseZ.value = baseZ;

      // Крен сцены за рукой — маленький, иначе вёрстка поверх канваса
      // разъезжается с картинкой под ней.
      camera.position.x = -dragVec.x * 0.05 * drag;
      camera.position.y = -dragVec.y * 0.05 * drag - lift;

      renderer.render(scene, camera);
      loaded();
    };

    if (reduced) {
      // Движения нет, но экран не пустой: собранное облако и статичное поле.
      enter = 1;
      fieldUniforms.uEnter.value = 1;
      shared.uEnter.value = 1;
      /* Маршрут при этом работает: кадр перерисовывается, когда камеру
         переставили, открыли комнату или облако пересобралось, остальное
         время сцена стоит. */
      let shown = "";
      const still = () => {
        raf = requestAnimationFrame(still);
        const progress = advance(0);
        const key = `${progress}:${room}`;
        if (key === shown && !dirty) return;
        shown = key;
        dirty = false;
        camera.position.z = baseZ;
        shared.uCamZ.value = camera.position.z;
        shared.uBaseZ.value = baseZ;
        place(progress, 0, 0);
        env.update(progress, 0, roomAmount, baseZ, camera.position.z);
        lightUp(progress);
        onFrameRef.current?.({
          progress,
          velocity: 0,
          stations: frames,
          room: roomAmount,
          marks: env.marksOnScreen,
          hand: 0,
          tint: null,
          grip: null,
        });
        drawRoom();
        renderer.render(scene, camera);
        loaded();
      };
      still();
    } else {
      frame();
    }

    return () => {
      alive = false;
      detachJourney();
      cancelAnimationFrame(raf);
      window.clearTimeout(resizeTimer);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", syncRect);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerout", onOut);
      window.removeEventListener("blur", onLeave);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      dropBodies();
      dropMedia();
      env.dispose();
      surfaces?.dispose();
      scene.remove(field);
      field.geometry.dispose();
      field.material.dispose();
      waterU.uWaterTex.value.dispose();
      document.documentElement.removeAttribute("data-gl");
      renderer.dispose();
      if (renderer.domElement.parentNode === host) host.removeChild(renderer.domElement);
    };
  }, [stations, onReady, landmarks]);

  const first = stations[0]?.shape;
  return (
    // Скринридеру здесь читать нечего: заголовок страницы — скрытый h1
    // в page.tsx, а канвас и фолбэк лишь рисуют то же слово.
    <div ref={hostRef} className="absolute inset-0" aria-hidden>
      {/* Не h1: без WebGL заголовков выходило два. */}
      <div
        ref={fallbackRef}
        className="font-display absolute inset-0 flex items-center justify-center px-6 text-center text-[clamp(30px,7vw,86px)] uppercase leading-[1.04]"
      >
        {first?.kind === "text" ? first.text : null}
      </div>
    </div>
  );
}
