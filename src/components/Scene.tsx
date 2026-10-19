"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { buildShape, burstShape, textShape, type Shape, type ShapeSpec } from "@/lib/shapes";
import { FIELD_VERT, FIELD_FRAG, PARTICLE_VERT, PARTICLE_FRAG } from "@/lib/shaders";
import { Journey } from "@/lib/journey";
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
/** Секунды на раскрытие комнаты и на обратную сборку. */
const UNFOLD = 1.2;

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
      Нет — зажатие объект не трогает: свою реакцию придумаем позже. */
  grip?: "spray" | "spin";
  /** Насколько притушить объект в комнате, чтобы текст поверх читался: 0..1. */
  dim?: number;
  /** Кадры проекта, которые проступают на сфере: видео или скриншоты. */
  media?: { video?: string; images: string[] };
  /** Свет главы — подсветка фона, пока камера у этой точки. */
  light?: ChapterLight;
};

/** Во сколько раз гуще имени сфера проекта: мелкой сетке нужна сплошная
    линия на каждом ребре, а на редкой и кадр не разобрать. */
const SPHERE_DENSITY = 4.4;
/** Радиан поворота имени на пиксель хода руки. */
const TWIST_PER_PX = 0.0055;
/** Собственное вращение сферы, радиан в секунду: оборот за три минуты.
    Втрое быстрее мешало глазам (Илья, 2026-10-18). */
const SPHERE_SPIN = 0.035;
/** Каждые сколько секунд на сфере сменяется скриншот и за сколько. */
const SHOT_HOLD = 4.5;
const SHOT_FADE = 1.2;

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
};

export type SceneApi = {
  goTo: (stop: number) => void;
  jumpTo: (stop: number) => void;
  /** Войти в комнату точки или выйти из неё (null). */
  setRoom: (stop: number | null) => void;
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
    uSwap: { value: number };
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
  vel: Float32Array;
  disp: Float32Array;
  /** Податливость каждой точки: без разброса облако летит ровным строем. */
  give: Float32Array;
  /** 1 — точку унесло распылением, и домой её ведёт прежний медленный возврат. */
  sprayed: Uint8Array;
  /** Насколько точку «разбудил» удар руки: пока не угасло, её крутит вихрь. */
  stir: Float32Array;
  /** Куда и насколько далеко уходит точка при распылении рукой. */
  spray: Float32Array;
  dispAttr: THREE.BufferAttribute;
  velAttr: THREE.BufferAttribute;
  /** Раскрытие в комнату сейчас, 0..1. */
  morph: number;
  /** Рука его растрепала, и он ещё не улёгся: физика ведёт такой объект,
      даже когда тот уже не перед камерой. */
  restless: boolean;
};

const NO_MARKS: Landmark[] = [];

export function Scene({ stations, onFrame, onReady, onPick, onExit, landmarks = NO_MARKS }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const fallbackRef = useRef<HTMLDivElement>(null);
  // Колбэк держим в рефе: попади он в зависимости эффекта, сцена
  // пересобиралась бы на каждый рендер и теряла всю инерцию.
  const onFrameRef = useRef(onFrame);
  const onPickRef = useRef(onPick);
  const onExitRef = useRef(onExit);
  // Свежий колбэк кладём в реф после рендера, а не во время него.
  useEffect(() => {
    onFrameRef.current = onFrame;
    onPickRef.current = onPick;
    onExitRef.current = onExit;
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
    const journey = new Journey({ stops: N });
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
    const setRoom = (k: number | null) => {
      if (k !== null && !stations[k]?.room) return;
      room = k;
      journey.lock(k !== null);
      if (k !== null) journey.goTo(k);
    };
    // Якоря вида href="#projects" при перехваченном скролле не работают:
    // прокручивать нечего. Кнопки должны двигать камеру.
    onReady?.({
      goTo: (stop: number) => journey.goTo(stop),
      jumpTo: (stop: number) => journey.jumpTo(stop),
      setRoom,
    });

    /** Положение объектов для вёрстки. Заводится однажды и переписывается
        на месте: новый массив каждый кадр — лишняя работа сборщику мусора. */
    const frames: StationFrame[] = stations.map(() => ({ d: 0, x: 0, y: 0, hw: 0, hh: 0, vis: 0 }));
    let raf = 0;

    /* При «уменьшить движение» камера не едет, а переставляется: положение
       на маршруте сразу равно цели, как у обычной прокрутки, и скорость
       нулевая — расслоения текста тоже нет. */
    const advance = (dt: number) => (reduced ? journey.snap() : journey.update(dt));

    const renderer = (() => {
      try {
        const r = new THREE.WebGLRenderer({ antialias: false, alpha: false });
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
        });
      };
      tick();
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
      if (!spinning) {
        // Отпустили — сфера докручивается по инерции и плавно гаснет.
        turnSphere(spinVel.x * dt, spinVel.y * dt);
        spinVel.multiplyScalar(Math.exp(-dt * 2.4));
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

    /** Сглаженная скорость руки в пикселях за кадр. */
    const handVel = new THREE.Vector2();
    /** Скорость руки над объектом, от 0 до 1 — для звука. */
    let handNow = 0;
    const ptrPrev = new THREE.Vector2(-9999, -9999);

    /** Общие настройки шейдера: одни и те же значения у всех объектов. */
    const shared = {
      uRes: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 },
      uEnter: { value: 0 },
      uPixelRatio: { value: dpr },
      uSand: { value: SAND },
      uCamZ: { value: 1000 },
      uBaseZ: { value: 1000 },
    };

    /* Среда маршрута: пыль, ориентиры, свет глав. */
    const env = new Environment(
      scene,
      { ...shared, ...waterU, uAzure: fieldUniforms.uAzure },
      landmarks,
      N
    );
    const lights = stations.map((s) => s.light);
    /** Свет главы на этом положении маршрута — в фон. Цвет в sRGB, как и фон. */
    const lightUp = (progress: number) => {
      const l = chapterLight(lights, progress);
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
        seed[i] = Math.random();
      }

      // Физика начинается с чистого листа: скорости и смещения по нулям.
      const vel = new Float32Array(n * 3);
      const disp = new Float32Array(n * 3);
      const give = new Float32Array(n);
      const sprayed = new Uint8Array(n);
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
      geo.setAttribute("aFrom", new THREE.BufferAttribute(from, 2));
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
        uRot: { value: solid ? sphereRot : spec.grip === "spray" ? nameRot : noRot },
        uCzA: { value: a.cz ?? 0 },
        uCzB: { value: b.cz ?? 0 },
        // Надпись раскрывается волной, с отрывом от плоскости; сетка сферы —
        // разом и ровно, как раскладная игрушка: точки только расходятся.
        uLag: { value: solid ? 0 : 0.35 },
        uLift: { value: solid ? 0 : 1 },
        uSolid: { value: solid ? 1 : 0 },
        uSwap: { value: 0 },
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
        points, geo, mat, u, a, b, n, vel, disp, give, sprayed, stir, spray, dispAttr, velAttr,
        morph: 0, restless: false, solid, grip: spec.grip, shots: [], video: null, shot: 0, shotAt: 0,
      };
      if (spec.media) loadMedia(body, spec.media);
      return body;
    };

    /* Кадры проекта на сфере. Видео — если загружено: оно идёт по точкам
       само, без звука и по кругу. Иначе скриншоты сменяют друг друга.
       Пока кадр не пришёл, сфера просто песочная. */
    const loader = new THREE.TextureLoader();
    const loadMedia = (body: Body, media: NonNullable<StationSpec["media"]>) => {
      /* Средняя яркость кадра — по уменьшенной копии. По ней все сферы
         приводятся к одному уровню: светлый скриншот не выжигает сферу
         в белое, тёмный не гасит её до черноты. */
      const meanLum = (src: CanvasImageSource) => {
        const c = document.createElement("canvas");
        c.width = c.height = 24;
        const g = c.getContext("2d", { willReadFrequently: true });
        if (!g) return 0.35;
        g.drawImage(src, 0, 0, 24, 24);
        const d = g.getImageData(0, 0, 24, 24).data;
        let sum = 0;
        for (let i = 0; i < d.length; i += 4) sum += (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255;
        return sum / (d.length / 4);
      };
      const ready = (tex: THREE.Texture, w: number, h: number, src: CanvasImageSource) => {
        if (!alive || !bodies.includes(body)) return;
        tex.minFilter = THREE.LinearFilter;
        tex.generateMipmaps = false;
        body.u.uTexAspect.value = w / Math.max(h, 1);
        body.u.uTexGain.value = Math.max(0.35, Math.min(3, 0.35 / Math.max(0.02, meanLum(src))));
        body.u.uTexAmt.value = 1;
        dirty = true;
      };
      if (media.video) {
        const v = document.createElement("video");
        v.src = media.video;
        v.muted = true;
        v.loop = true;
        v.playsInline = true;
        v.preload = "auto";
        const tex = new THREE.VideoTexture(v);
        body.video = v;
        body.shots = [tex];
        body.u.uTex0.value = body.u.uTex1.value = tex;
        v.addEventListener("loadeddata", () => ready(tex, v.videoWidth, v.videoHeight, v), { once: true });
        return;
      }
      media.images.forEach((src, i) => {
        loader.load(src, (tex) => {
          if (!alive) return tex.dispose();
          body.shots[i] = tex;
          const img = tex.image as HTMLImageElement;
          if (i === 0) {
            body.u.uTex0.value = body.u.uTex1.value = tex;
            ready(tex, img.width, img.height, img);
          }
        });
      });
    };

    /** Смена скриншотов на сфере: держим кадр, затем плавно переливаем
        в следующий. Видео меняется само. */
    const stepShots = (b: Body, t: number) => {
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
        for (const t of b.shots) t?.dispose();
        if (b.video) {
          b.video.pause();
          b.video.removeAttribute("src");
          b.video.load();
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
      const first: Shape = { points: sampled.points, halfW: sampled.width / 2, halfH: sampled.height / 2 };

      for (let i = 0; i < N; i++) {
        const st = stations[i];
        // Сфере точек нужно больше: по ней проступает кадр проекта.
        const nk = st.shape.kind === "sphere" ? Math.round(n * SPHERE_DENSITY) : n;
        const a = i === 0 ? first : await buildShape(st.shape, w, h, nk);
        const b = st.room === "burst" ? burstShape(a) : st.room ? await buildShape(st.room, w, h, nk) : a;
        if (!alive || gen !== build) return;
        const body = makeBody(a, b, w, h, st);
        // Ресайз посреди открытой комнаты не должен заново её раскрывать.
        body.morph = room === i ? 1 : 0;
        bodies[i] = body;
        dirty = true;
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
    let water = new Water(1, 1);
    let waterData = new Float32Array(4);
    /* Линейная выборка из float-текстуры — расширение; без него вода
       ступенчатая, но работает. */
    const waterFilter = renderer.extensions.has("OES_texture_float_linear") ? THREE.LinearFilter : THREE.NearestFilter;
    const resize = () => {
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

    const onMove = (e: PointerEvent) => {
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
        if (spinning) {
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
      if (el?.closest?.("a, button, input, textarea, select, label, video, [contenteditable], nextjs-portal")) return;
      const r = rect;
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
      twisting = settledNow && stations[nearNow]?.grip === "spray" && (room === null || room === nearNow);
      const sb = bodies[nearNow];
      if (spinning && sb) {
        // Снаружи под рукой ближняя к зрителю поверхность, изнутри — дальняя.
        const inside = room === nearNow;
        const R = inside ? sb.b.halfW : sb.a.halfW;
        const cz = (inside ? sb.b.cz : sb.a.cz) ?? 0;
        const ps = baseZ / Math.max(baseZ - (inside ? cz - R : cz + R), 60);
        spinK = 1 / Math.max(1, R * ps);
      }
      spinAt = performance.now();
      if (spinning) spinVel.set(0, 0);
    };
    const onUp = (e: PointerEvent) => {
      dragging = false;
      // Отпустили — цель сбрасывается, и точки идут домой напрямую,
      // из того положения, в котором их застали.
      dragTravel = 0;
      twisting = false;

      // Нажатие на объект с комнатой — вход, в любом месте аллеи.
      const click =
        pressed &&
        e.type === "pointerup" &&
        Math.hypot(e.clientX - pressAt.x, e.clientY - pressAt.y) < 6 &&
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
    type Probe = { rawSpeed: number; speed: number; maxDisp: number; moved: number };
    const probe: Probe | null =
      process.env.NODE_ENV === "production"
        ? null
        : ((window as unknown as { __probe: Probe }).__probe = {
            rawSpeed: 0,
            speed: 0,
            maxDisp: 0,
            moved: 0,
          });

    const HIT = 52;         // радиус, в котором рука вообще что-то задевает
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
    const CARRY = 0.85; // доля скорости руки, которую берёт точка (Илья: 85%)
    const GRIP = 0.9;                     // как быстро берёт: доля разницы за кадр
    /** Скачок курсора больше этого за кадр — не мах, а возврат руки в окно. */
    const TELEPORT = 160;

    let physT = 0;
    const stepPhysics = (dt: number, active: Body | null, settled: boolean) => {
      physT += dt;
      // Скорость руки сглаживаем и ограничиваем: рывок мышью через весь
      // экран иначе выстреливает облако одним кадром.
      const raw = ptrPrev.x > -9000 && rawMouse.x > -9000
        ? { x: rawMouse.x - ptrPrev.x, y: rawMouse.y - ptrPrev.y }
        : { x: 0, y: 0 };
      ptrPrev.copy(rawMouse);
      /* Сглаживание и потолок решают, сколько удара доходит до точек.

         Было 0.3 и 55: рука на 120 пикселях за кадр отдавала облаку 55 —
         меньше половины, и сильный мах ощущался как слабый. Сглаживание
         держим слабым, чтобы рывок не размазывался по кадрам, а потолок
         поднимаем — он остаётся только страховкой от броска мышью через
         весь экран. */
      handVel.lerp(new THREE.Vector2(raw.x, raw.y), 0.55);
      const speed = Math.min(handVel.length(), 120);
      const moving = speed > 0.35 && hover > 0.01 && settled;
      handNow = Math.min(1, speed / 60) * hover;

      /* Вода — везде, где прошла рука, и на ходу тоже: мешаешь толщу, а не
         объект. Успокоилась — ни шага, ни заливки текстуры. */
      if ((raw.x || raw.y) && Math.hypot(raw.x, raw.y) < TELEPORT && hover > 0.01)
        water.splat(rawMouse.x - raw.x, rawMouse.y - raw.y, rawMouse.x, rawMouse.y, h * WATER_R);
      if (water.stirred) {
        water.step(dt * 60);
        water.fill(waterData);
        waterU.uWaterTex.value.needsUpdate = true;
      }
      if (probe) {
        probe.rawSpeed = Math.max(probe.rawSpeed, Math.hypot(raw.x, raw.y));
        probe.speed = Math.max(probe.speed, speed);
      }
      const hx = rawMouse.x;
      const hy = rawMouse.y;
      const vhx = handVel.x;
      const vhy = handVel.y;

      // Трение и возврат — за кадр, приведённые к реальному шагу времени.
      const fric = Math.pow(FRICTION, dt * 60);
      const step = dt * 60;
      // Скорость руки в тех же единицах, что у точек: пиксели за кадр по 60 к/с.
      const perFrame = 1 / Math.max(step, 0.25);
      const pull = SPRING * dt * 60;
      const wane = Math.exp(-dt / WEAVE_T);
      // Возврат вдвое медленнее прежнего: точка дольше идёт домой, и
      // доворот отдачи успевает прочитаться целиком.
      const home = 1 - Math.pow(1 - 0.0075, dt * 60);
      /* Распыление — не удар, а удержание.

         Пока кнопка зажата, точка тянется к своей цели и там стоит: облако
         замирает в том виде, в каком его раздули, и рукой можно возить
         сколько угодно. Раньше это были случайные толчки, и облако, пока
         рука стоит, потихоньку сползалось обратно. */
      dragAmount = dragging ? Math.min(1, dragTravel / DRAG_FULL) : 0;
      const hold = dragging ? 1 - Math.pow(1 - 0.09, dt * 60) : 0;

      for (const body of bodies) {
        if (!body) continue;
        const isActive = body === active;
        /* Шагаем и перезаливаем буферы только объект в работе: под рукой,
           в распылении, на отдаче или ещё не улёгшийся. Спокойный объект
           не трогаем вовсе — заливка в видеокарту стоит дороже всей
           физики, и на пролёте по аллее она давала заминки по 200 мс. */
        const engaged = isActive && (moving || (dragging && body.grip === "spray"));
        if (!engaged && !body.restless) continue;
        const { vel, disp, give, sprayed, stir, spray } = body;
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
        let restless = false;

        for (let i = 0; i < n; i++) {
          const i3 = i * 3;
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
              const ps = baseZ / Math.max(baseZ - (rm[2] * x + rm[5] * y + rm[8] * z + homeCz), 60);
              bx = (rm[0] * x + rm[3] * y + rm[6] * z) * ps;
              by = (rm[1] * x + rm[4] * y + rm[7] * z) * ps;
            }
            const dx = bx + disp[i3] - hx;
            const dy = by + disp[i3 + 1] - hy;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < HIT) {
              const t2 = dist / HIT;
              const near = (1 - t2) * (1 - t2);
              const s = speed * near * give[i];
              const k = s * KICK;
              vx += vhx * k * SWEEP;
              vy += vhy * k * SWEEP;
              if (dist > 1) {
                vx += (dx / dist) * k * PUSH;
                vy += (dy / dist) * k * PUSH;
              }
              vx += (-dy / (dist + 60)) * k * CURL;
              vy += (dx / (dist + 60)) * k * CURL;
              vz += (Math.random() - 0.5) * k * DEPTH;
              carry = near;
              if (near > stir[i]) stir[i] = near;
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
          if (spread) sprayed[i] = 1;
          else if (sprayed[i] && disp[i3] * disp[i3] + disp[i3 + 1] * disp[i3 + 1] + disp[i3 + 2] * disp[i3 + 2] < 1)
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
            /* Домой — по прямой из того места, где точку застали.

               Чем дальше её унесло, тем резвее она возвращается: после
               распыления облако собирается бодро, а лёгкое касание всё так
               же оседает мягко. */
            /* Возврат ускоряется у самого дома, а не вдали от него.

               Раньше разгон зависел только от дальности: далёкие точки шли
               резво, а у своих мест еле ползли — облако подолгу висело
               расплывчатым, хотя все уже почти на местах. Теперь дальний
               участок медленный, а у самого дома точка разгоняется. */
            const away = Math.hypot(dx2, dy2, dz2);
            const near = 1 - Math.min(1, away / 200);
            // Ускорение у дома мягче прежнего (было ×12): последний отрезок
            // читался щелчком — скачком в конце, а не посадкой.
            const rate = Math.min(0.35, home * (1 + away / 400) * (1 + near * near * 5));
            dx2 *= 1 - rate;
            dy2 *= 1 - rate;
            dz2 *= 1 - rate;
          }

          disp[i3] = dx2;
          disp[i3 + 1] = dy2;
          disp[i3 + 2] = dz2;
          const r2 = dx2 * dx2 + dy2 * dy2;
          if (r2 + dz2 * dz2 > 0.25 || vx * vx + vy * vy + vz * vz > 0.01) restless = true;
        }
        body.restless = restless;

        if (probe && isActive) {
          let max = 0;
          let cnt = 0;
          for (let i = 0; i < n; i++) {
            const i3 = i * 3;
            const d = Math.hypot(disp[i3], disp[i3 + 1], disp[i3 + 2]);
            if (d > max) max = d;
            if (d > 2) cnt++;
          }
          probe.maxDisp = Math.max(probe.maxDisp, max);
          probe.moved = Math.max(probe.moved, cnt);
        }

        body.dispAttr.needsUpdate = true;
        body.velAttr.needsUpdate = true;
      }
    };

    /* ── аллея ─────────────────────────────────────────────────── */

    /** Насколько раскрыта комната — всем остальным это сигнал уйти в туман. */
    let roomAmount = 0;

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
        b.morph = reduced ? want : Math.max(0, Math.min(1, b.morph + Math.sign(want - b.morph) * (dt / UNFOLD)));
        roomAmount = Math.max(roomAmount, b.morph);
      }

      for (let k = 0; k < N; k++) {
        const d = ringOffset(progress, k, N);
        const b = bodies[k];
        /* Две сферы подряд не улетают в камеру, а пересобираются одна
           в другую на месте: сетка та же, волна снизу вверх переплетает
           точки, и на шаре уже другой проект (Илья, 2026-10-18). */
        const other = (((k + (d > 0 ? 1 : -1)) % N) + N) % N;
        const swap = other !== k && !!b?.solid && !!bodies[other]?.solid;
        // Подлёт — минус, уход — плюс; на точке ноль.
        const pass = swap ? 0 : Math.sign(d) * Math.min(1, Math.abs(d) / PASS);
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
        f.vis = b ? vis * (1 - away) : 0;
        if (!b) continue;

        b.points.visible = vis > 0.002 && away < 0.999;
        // Уходящий ближе к камере, чем подлетающий: рисуется поверх.
        b.points.renderOrder = d > 0 ? 1 : 0;
        b.u.uPass.value = pass;
        b.u.uSwap.value = swap ? Math.max(-1, Math.min(1, d)) : 0;
        b.u.uVis.value = vis;
        b.u.uMorph.value = b.morph;
        b.u.uDim.value = (stations[k].dim ?? 0) * b.morph;
        stepShots(b, t);
        // Видео на сфере крутится, только пока она рядом: дальние стоят.
        if (b.video) {
          const play = Math.abs(d) < 1 && vis > 0.01;
          if (play && b.video.paused) b.video.play().catch(() => {});
          else if (!play && !b.video.paused) b.video.pause();
        }
      }

      const active = bodies[near] ?? null;
      const settled =
        !!active && Math.abs(ringOffset(progress, near, N)) < 0.12 && (active.morph < 0.01 || active.morph > 0.99);
      nearNow = near;
      settledNow = settled;
      return { active, settled };
    };


    /* ── кадр ──────────────────────────────────────────────────── */

    let last = performance.now();
    const started = last;
    let enter = 0;

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
      const speed = Math.min(1, Math.abs(journey.velocity) * 1.4);
      camera.position.z = baseZ;
      stepSphereRot(dt);
      const { active, settled } = place(progress, dt, t);
      stepPhysics(dt, active, settled);
      env.update(progress, speed, roomAmount, baseZ, camera.position.z);
      lightUp(progress);

      enter = Math.min(1, enter + dt / 1.6);
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
        velocity: journey.velocity,
        stations: frames,
        room: roomAmount,
        marks: env.marksOnScreen,
        hand: handNow,
      });

      fieldUniforms.uTime.value = t;
      fieldUniforms.uEnter.value = eased;
      shared.uTime.value = t;
      shared.uEnter.value = enter;
      // Отпустили — слово ложится обратно читаемым: поворот плавно сходит
      // к исходному, без отскока.
      if (!twisting) nameQ.slerp(QUAT_ID, 1 - Math.exp(-dt * 2.2));
      nameRot.setFromMatrix4(rotM4.makeRotationFromQuaternion(nameQ));
      shared.uCamZ.value = camera.position.z;
      shared.uBaseZ.value = baseZ;

      // Крен сцены за рукой — маленький, иначе вёрстка поверх канваса
      // разъезжается с картинкой под ней.
      camera.position.x = -dragVec.x * 0.05 * drag;
      camera.position.y = -dragVec.y * 0.05 * drag;

      renderer.render(scene, camera);
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
        });
        renderer.render(scene, camera);
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
      env.dispose();
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
        className="font-display absolute inset-0 flex items-center justify-center px-6 text-center text-[clamp(30px,7vw,86px)] leading-[1.04]"
      >
        {first?.kind === "text" ? first.text : null}
      </div>
    </div>
  );
}
