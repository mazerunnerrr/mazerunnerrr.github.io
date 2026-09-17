"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { sampleText } from "@/lib/textParticles";
import { FIELD_VERT, FIELD_FRAG, PARTICLE_VERT, PARTICLE_FRAG } from "@/lib/shaders";
import { Journey } from "@/lib/journey";

const VOID = new THREE.Color("#0a0908");
const AZURE = new THREE.Color("#8fb3cc");
const SAND = new THREE.Color("#e8dfcd");

const TRAIL = 8;

export type FrameInfo = {
  /** Положение на маршруте в точках: 0 — заголовок, 1 — «что делаю». */
  progress: number;
  /** Скорость движения по маршруту, точек в секунду. */
  velocity: number;
};

type Props = {
  lines: string[];
  /** Своя разбивка для узкого экрана: та же фраза, но короткими строками. */
  linesNarrow?: string[];
  /** Сколько точек на маршруте. */
  stops: number;
  /**
   * Вызывается каждый кадр. Писать отсюда только в style напрямую:
   * состояние React на шестидесяти кадрах в секунду недопустимо.
   */
  onFrame?: (f: FrameInfo) => void;
  /** Отдаёт наружу управление маршрутом — для кнопок и якорей. */
  onReady?: (api: { goTo: (stop: number) => void }) => void;
};

export function Scene({ lines, linesNarrow, stops, onFrame, onReady }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const fallbackRef = useRef<HTMLDivElement>(null);
  // Колбэк держим в рефе: попади он в зависимости эффекта, сцена
  // пересобиралась бы на каждый рендер и теряла всю инерцию.
  const onFrameRef = useRef(onFrame);
  // Свежий колбэк кладём в реф после рендера, а не во время него.
  useEffect(() => {
    onFrameRef.current = onFrame;
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    /* Маршрут подключается до WebGL и от него не зависит.

       Раньше эффект выходил на отсутствии WebGL ещё до подписки на ввод,
       а при «уменьшить движение» кадр рисовался однажды и больше никогда.
       В обоих случаях слои не проявлялись, и сайт сворачивался в первый
       экран: до «Что делаю» и «Проектов» было не добраться ничем. */
    const journey = new Journey({ stops });
    // Корень — вся страница сайта, а не только канвас: курсор часто
    // стоит над текстовым слоем, и оттуда колесо тоже должно вести камеру.
    const detachJourney = journey.attach(host.closest("main") ?? host);
    // Якоря вида href="#projects" при перехваченном скролле не работают:
    // прокручивать нечего. Кнопки должны двигать камеру.
    onReady?.({ goTo: (stop: number) => journey.goTo(stop) });
    let raf = 0;

    /* При «уменьшить движение» камера не едет, а переставляется: положение
       на маршруте сразу равно цели, как у обычной прокрутки, и скорость
       нулевая — расслоения текста тоже нет. */
    const advance = (dt: number) => {
      if (!reduced) return journey.update(dt);
      journey.current = journey.target;
      journey.velocity = 0;
      return journey.current;
    };

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
         Заголовок гаснет вместе с первым экраном, иначе он так и стоит
         поверх «Что делаю» и «Проектов». */
      let last = performance.now();
      const tick = () => {
        raf = requestAnimationFrame(tick);
        const now = performance.now();
        const progress = advance(Math.min((now - last) / 1000, 0.05));
        last = now;
        const fb = fallbackRef.current;
        if (fb) fb.style.opacity = String(Math.max(0, 1 - Math.min(1, progress) * 1.7));
        onFrameRef.current?.({ progress, velocity: journey.velocity });
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

    /** Насколько далеко камера уезжает за одну точку маршрута. */
    const SPAN = 1500;

    /* ── фон ───────────────────────────────────────────────────── */

    const trailPos = Array.from({ length: TRAIL }, () => new THREE.Vector2(0.5, 0.5));
    const trailW = new Float32Array(TRAIL);
    // Пока руки на экране не было, следа нет вовсе. Иначе в центре
    // с первого кадра горит круглое пятно — ровно то размытое радиальное
    // свечение, по которому шаблонный лендинг видно за секунду.
    let touched = false;

    const fieldUniforms = {
      uRes: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 },
      // На узком экране режем октавы шума: телефон этого не тянет,
      // а разницу на глаз там не видно.
      uOct: { value: 5 },
      uEnter: { value: 0 },
      uTrail: { value: trailPos },
      uTrailW: { value: trailW },
      uVoid: { value: VOID },
      uAzure: { value: AZURE },
      uSpeed: { value: 0 },
      uLens: { value: new THREE.Vector2(0.5, 0.5) },
      uDrag: { value: 0 },
      uHasPtr: { value: 0 },
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

       Буферы заводятся вместе с облаком, в buildParticles. */
    let vel: Float32Array | null = null;
    let disp: Float32Array | null = null;
    let dispAttr: THREE.BufferAttribute | null = null;
    let velAttr: THREE.BufferAttribute | null = null;
    /** Домашние позиции в пикселях — по ним физика ищет, кого задела рука. */
    let base2: Float32Array | null = null;
    /** Податливость каждой точки: без разброса облако летит ровным строем. */
    let give: Float32Array | null = null;
    /** Куда и насколько далеко уходит точка при распылении рукой. */
    let spray: Float32Array | null = null;

    /** Сглаженная скорость руки в пикселях за кадр. */
    const handVel = new THREE.Vector2();
    const ptrPrev = new THREE.Vector2(-9999, -9999);

    const particleUniforms = {
      uRes: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 },
      uEnter: { value: 0 },
      uPixelRatio: { value: dpr },
      uSand: { value: SAND },
      uDrag: { value: 0 },
      uDragVec: { value: new THREE.Vector2() },
      uDepart: { value: 0 },
      uCamZ: { value: 1000 },
      uBaseZ: { value: 1000 },
      uHalfW: { value: 400 },
      uWordSpin: { value: 0 },
    };

    const particleMat = new THREE.ShaderMaterial({
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      uniforms: particleUniforms,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });

    let points: THREE.Points | null = null;
    let alive = true;
    /** Кадр устарел: пересобралось облако или сменился размер. Нужен режиму
        без движения, где сцена перерисовывается только по делу. */
    let dirty = true;

    const buildParticles = async (w: number, h: number) => {
      const narrow = w < 720;
      // На узком экране фраза идёт короткими строками, поэтому кегль можно
      // взять крупнее: на общей разбивке он падал до 28px и буквы крошились.
      const src = narrow ? linesNarrow ?? lines : lines;
      // Одно слово, поэтому кегль берём заметно крупнее, чем под фразу.
      const fontSize = narrow
        ? Math.max(56, Math.min(110, w * 0.24))
        : Math.max(90, Math.min(230, w * 0.14));
      // Шаг сетки: Cormorant даёт тонкие штрихи, и на шаге 4px буквы
      // рвутся в пунктир. На 1px это порядка 50 тысяч точек — облако
      // читается сплошной надписью, но зерно в нём видно.
      const step = 1;
      const sampled = await sampleText({
        lines: src,
        fontSize,
        fontFamily: "var(--font-cormorant), Georgia, serif",
        lineHeight: 1.12,
        fontWeight: "400",
        step,
      });
      if (!alive || !sampled.count) return;
      // Очередь на оборот отсчитывается от места точки в слове, поэтому
      // шейдеру нужна фактическая полуширина облака, а не ширина экрана.
      particleUniforms.uHalfW.value = sampled.width / 2;

      if (points) {
        scene.remove(points);
        points.geometry.dispose();
      }

      const n = sampled.count;
      const base = new Float32Array(n * 2);
      const from = new Float32Array(n * 2);
      const seed = new Float32Array(n);
      const dummy = new Float32Array(n * 3);
      const spread = Math.max(w, h) * 0.75;

      for (let i = 0; i < n; i++) {
        base[i * 2] = sampled.points[i * 2];
        base[i * 2 + 1] = sampled.points[i * 2 + 1];
        // Стартовая точка — по кольцу вокруг центра: облако собирается
        // внутрь, а не выпадает сверху.
        const a = Math.random() * Math.PI * 2;
        const r = spread * (0.5 + Math.random() * 0.6);
        from[i * 2] = Math.cos(a) * r;
        from[i * 2 + 1] = Math.sin(a) * r;
        seed[i] = Math.random();
      }

      // Физика начинается с чистого листа: скорости и смещения по нулям.
      vel = new Float32Array(n * 3);
      disp = new Float32Array(n * 3);
      give = new Float32Array(n);
      spray = new Float32Array(n * 3);
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
      base2 = base;
      dispAttr = new THREE.BufferAttribute(disp, 3);
      dispAttr.setUsage(THREE.DynamicDrawUsage);
      // Тот же буфер скоростей уходит в шейдер как атрибут: лишней памяти
      // не нужно, физика и смаз смотрят на одни и те же числа.
      velAttr = new THREE.BufferAttribute(vel, 3);
      velAttr.setUsage(THREE.DynamicDrawUsage);

      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(dummy, 3));
      geo.setAttribute("aDisp", dispAttr);
      geo.setAttribute("aVel", velAttr);
      geo.setAttribute("aBase", new THREE.BufferAttribute(base, 2));
      geo.setAttribute("aFrom", new THREE.BufferAttribute(from, 2));
      geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), spread * 2);

      points = new THREE.Points(geo, particleMat);
      points.frustumCulled = false;
      scene.add(points);
      dirty = true;
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
    const resize = () => {
      w = host.clientWidth;
      h = host.clientHeight;
      // updateStyle НЕ отключать: без CSS-размера канвас растягивается
      // до своих физических пикселей, и на экране с dpr=2 сцена выходит
      // вдвое крупнее вёрстки и уезжает за край.
      renderer.setSize(w, h);
      camera.aspect = w / Math.max(h, 1);
      baseZ = fitZ(h);
      camera.updateProjectionMatrix();
      fieldUniforms.uRes.value.set(w, h);
      particleUniforms.uRes.value.set(w, h);
      fieldUniforms.uOct.value = w < 640 ? 3 : 5;
      syncRect();
      dirty = true;
      void buildParticles(w, h);
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
    const uvMouse = new THREE.Vector2(0.5, 0.5);

    /* Присутствие руки, 0..1.

       Раньше уход курсора швырял позицию в −9999, и вмятина уезжала
       через весь экран одним скачком — выглядело как сбой. Теперь
       позиция остаётся последней известной, а плавно гаснет сила:
       рука «отпускает» слово и так же плавно берёт его обратно. */
    let hover = 0;
    let hoverTarget = 0;

    const onMove = (e: PointerEvent) => {
      touched = true;
      hoverTarget = 1;
      const r = rect;
      rawMouse.set(e.clientX - r.left - w / 2, -(e.clientY - r.top) + h / 2);
      uvMouse.set((e.clientX - r.left) / w, 1 - (e.clientY - r.top) / h);
      if (dragging) {
        // Путь считаем до того, как сдвинем опору, иначе он всегда ноль.
        dragTravel += Math.hypot(e.clientX - dragLast.x, e.clientY - dragLast.y);
        /* Горизонталь крутит облако вокруг оси: примерно четверть оборота
           на четверть экрана хода.

           Знак отрицательный, и это не мелочь. При движении вправо ближняя
           к зрителю сторона должна уходить вправо и вглубь — так ведёт
           себя предмет, который тянут за бок. С обратным знаком правый
           край выезжал на камеру, и слово доворачивалось будто против
           руки: в облаке это незаметно, а на буквах сразу видно. */
        orbit -= (e.clientX - dragLast.x) * 0.009;
        dragVec.set(e.clientX - r.left - dragFrom.x, -(e.clientY - r.top) + dragFrom.y);
        // Без потолка длинный жест разносит слово в кашу: смещение
        // растёт линейно, а читаемость падает куда быстрее.
        if (dragVec.length() > 240) dragVec.setLength(240);
      }
      dragLast.set(e.clientX, e.clientY);
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

    /* Раскрутка облака. Горизонтальный ход зажатой руки копится в угловую
       скорость, та крутит слово вокруг той же оси, что и маршрут, и гаснет
       сама. Отсюда и оборот на любой угол, и докручивание по инерции после
       того, как кнопку отпустили. */
    /* Распыление рукой копится ходом, а не выстреливает сразу.

       Держим суммарный путь курсора с зажатой кнопкой: полтора экрана
       хода — и облако раздуто до предела. Раньше пара сантиметров сразу
       давала полный размах, а дальше вести было незачем. */
    const DRAG_FULL = 1600;
    let dragTravel = 0;
    let dragAmount = 0;
    /** Угол раскрытого облака: копится горизонтальным ходом руки. */
    let orbit = 0;
    /* Отдача после отпускания: сколько ещё осталось довернуть и как
       резво это делать.

       Угол берётся от накрученного и есть всегда — отпустил, значит
       облако доворачивает назад. А темп решает последний рывок: дёрнул
       резко — отдача хлёсткая, повёл медленно — она тягучая. Раньше сила
       считалась прямо из скорости руки, и при плавном движении отдача
       пропадала совсем. */
    let recoilLeft = 0;
    let recoilRate = 1;
    /** Текущий угол самого слова. Меняется только плавно — иначе прыжок. */
    let wordSpin = 0;
    /** Каким был угол слова и остаток отдачи в момент отпускания. */
    let wordAtRelease = 0;
    let recoilStart = 0;
    /* Разгон отдачи. Стартует с нуля в момент отпускания: включённая на
       полную, она проворачивает облако рывком, и это читается как
       пропущенный кадр. */
    let recoilRamp = 0;
    /** Угловая скорость раскрутки — по ней считается сила отдачи. */
    let orbitVel = 0;
    let orbitPrev = 0;
    const dragLast = new THREE.Vector2();

    const onDown = (e: PointerEvent) => {
      const r = rect;
      dragging = true;
      recoilLeft = 0;
      dragLast.set(e.clientX, e.clientY);
      dragFrom.set(e.clientX - r.left, e.clientY - r.top);
      dragVec.set(0, 0);
    };
    const onUp = () => {
      dragging = false;
      // Отпустили — цель сбрасывается, и точки идут домой напрямую,
      // из того положения, в котором их застали.
      dragTravel = 0;
      /* Отдача — та самая «пружина», которой не хватало отпусканию.

         Облако не просто замирает и втягивается: оно ещё доворачивается
         против той стороны, в которую его крутили, и гаснет за треть
         секунды. Шаги подбора: 0.7 с потолком 1.5 — градусов двадцать,
         еле заметно; дальше по удвоениям — 1.4/3.0, 2.8/6.0, сейчас
         5.6/12.0. */
      // Угол доворота — от накрученного, резкость — от последнего рывка.
      recoilLeft = -Math.sign(orbit) * Math.min(Math.abs(orbit) * 0.34, 2.5);
      recoilRate = Math.max(0.9, Math.min(4.5, Math.abs(orbitVel) * 0.3));
      recoilRamp = 0;
      wordAtRelease = wordSpin;
      recoilStart = recoilLeft;
      orbit = 0;
      orbitVel = 0;
      orbitPrev = 0;
    };
    host.addEventListener("pointerdown", onDown, { passive: true });
    window.addEventListener("pointerup", onUp, { passive: true });
    window.addEventListener("pointercancel", onUp, { passive: true });

    /* Шаг физики.

       Сила бьёт не от курсора, а по ходу его движения: главное слагаемое —
       сама скорость руки, и лишь малой добавкой идёт отталкивание от точки
       касания. Из-за обратного порядка у меня раньше и выходил антимагнит:
       точки разбегались строго прочь, ровно и мертво.

       Возврат — простое притяжение к дому, без пружины через ускорение.
       Пружина проскакивала ноль и отбрасывала облако назад: то самое
       «слишком сильный bounce». Здесь точка просто замедляется и встаёт.

       Затраты: около пятидесяти тысяч точек, десяток операций на каждую. */
    /* Коэффициенты пересчитаны под пиксели.

       У брата сцена в условных единицах, там скорость руки редко больше
       единицы, и множитель 0.6 уместен. В пикселях та же формула даёт
       полторы сотни пикселей за кадр — слово улетает за край экрана
       с первого же взмаха. */
    const HIT = 210;        // радиус, в котором рука вообще что-то задевает
    const SWEEP = 0.0018;   // увлечение по ходу руки — основная сила
    const PUSH = 0.0006;    // отталкивание от точки касания
    const CURL = 0.0009;    // закрутка вбок, чтобы не расходились строем
    const DEPTH = 0.0035;   // разброс по глубине: одни ближе, другие дальше

    const stepPhysics = (dt: number) => {
      if (!vel || !disp || !dispAttr || !base2 || !give || !spray) return;
      const n = disp.length / 3;

      // Скорость руки сглаживаем и ограничиваем: рывок мышью через весь
      // экран иначе выстреливает облако одним кадром.
      const raw = ptrPrev.x > -9000 && rawMouse.x > -9000
        ? { x: rawMouse.x - ptrPrev.x, y: rawMouse.y - ptrPrev.y }
        : { x: 0, y: 0 };
      ptrPrev.copy(rawMouse);
      handVel.lerp(new THREE.Vector2(raw.x, raw.y), 0.3);
      const speed = Math.min(handVel.length(), 55);
      const moving = speed > 0.35 && hover > 0.01;
      const hx = rawMouse.x;
      const hy = rawMouse.y;
      const vhx = handVel.x;
      const vhy = handVel.y;

      // Трение и возврат — за кадр, приведённые к реальному шагу времени.
      const drag = Math.pow(0.95, dt * 60);
      // Возврат вдвое медленнее прежнего: точка дольше идёт домой, и
      // доворот отдачи успевает прочитаться целиком.
      const home = 1 - Math.pow(1 - 0.0075, dt * 60);
      /* Распыление — не удар, а удержание.

         Пока кнопка зажата, точка тянется к своей цели и там стоит: облако
         замирает в том виде, в каком его раздули, и рукой можно возить
         сколько угодно. Раньше это были случайные толчки, и облако, пока
         рука стоит, потихоньку сползалось обратно. */
      dragAmount = dragging ? Math.min(1, dragTravel / DRAG_FULL) : 0;
      // Угловая скорость руки — сглаженная, иначе один дёрганый кадр
      // перед отпусканием решал бы всё.
      const ov = dt > 0 ? (orbit - orbitPrev) / dt : 0;
      orbitVel += (ov - orbitVel) * Math.min(1, dt * 12);
      orbitPrev = orbit;
      // Кусок доворота, который отрабатывается в этом кадре. Первые
      // полсекунды отдача набирает силу, а не включается разом.
      recoilRamp = Math.min(1, recoilRamp + dt * 2.4);
      const recoilStep = recoilLeft * Math.min(1, recoilRate * dt) * recoilRamp;
      recoilLeft -= recoilStep;
      const hold = dragging ? 1 - Math.pow(1 - 0.09, dt * 60) : 0;

      for (let i = 0; i < n; i++) {
        const i3 = i * 3;
        let vx = vel[i3];
        let vy = vel[i3 + 1];
        let vz = vel[i3 + 2];

        if (moving) {
          // Расстояние считаем до точки там, где она сейчас, а не где её
          // дом: иначе разлетевшийся песок рука перестаёт задевать.
          const dx = base2[i * 2] + disp[i3] - hx;
          const dy = base2[i * 2 + 1] + disp[i3 + 1] - hy;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < HIT) {
            const t2 = dist / HIT;
            const near = (1 - t2) * (1 - t2);
            const s = speed * near * give[i];
            vx += vhx * s * SWEEP;
            vy += vhy * s * SWEEP;
            if (dist > 1) {
              vx += (dx / dist) * s * PUSH;
              vy += (dy / dist) * s * PUSH;
            }
            vx += (-dy / (dist + 60)) * s * CURL;
            vy += (dx / (dist + 60)) * s * CURL;
            vz += (Math.random() - 0.5) * s * DEPTH;
          }
        }

        vx *= drag;
        vy *= drag;
        vz *= drag;
        vel[i3] = vx;
        vel[i3 + 1] = vy;
        vel[i3 + 2] = vz;

        let dx2 = disp[i3] + vx;
        let dy2 = disp[i3 + 1] + vy;
        let dz2 = disp[i3 + 2] + vz;

        if (dragging) {
          /* Форма — облако, движение — по кругу.

             Строить позицию в полярных координатах было ошибкой: радиус
             с минимумом давал пустую сердцевину, и получалась труба,
             обтекающая невидимый столб. Здесь точка сперва уходит в своё
             место в объёме — то самое, равномерное распыление, — а потом
             всё облако целиком проворачивается вокруг вертикали. Оси не
             видно, потому что её и нет: есть только вращение.

             Ближние к вертикали идут чуть быстрее дальних — от этого
             облако закручивается, а не едет жёсткой каруселью. */
          const x0 = base2[i * 2];
          const sx = spray[i3] * dragAmount;
          const sy = spray[i3 + 1] * dragAmount * 0.7;
          const sz = spray[i3 + 2] * dragAmount;
          const px = x0 + sx;
          const rad = Math.hypot(px, sz);
          const th = orbit * (1 + (1 - Math.min(1, rad / 900)) * 0.4);
          const ct = Math.cos(th);
          const st = Math.sin(th);
          dx2 += (px * ct - sz * st - x0 - dx2) * hold;
          dy2 += (sy - dy2) * hold;
          dz2 += (px * st + sz * ct - dz2) * hold;
        } else {
          /* Домой — по прямой из того места, где точку застали.

             Чем дальше её унесло, тем резвее она возвращается: после
             распыления облако собирается бодро, а лёгкое касание всё так
             же оседает мягко. */
          if (Math.abs(recoilStep) > 0.000001) {
            /* Доворот и возврат — одно движение, а не два подряд.

               Угол поворота тем больше, чем дальше точке ещё лететь:
               у дома вращение сходит на нет само. Поэтому точка идёт
               по дуге, сразу и по кругу, и к своему месту — а не так,
               что сперва всё облако откручивается, а потом отдельной
               фазой садится на позиции. */
            const x0 = base2[i * 2];
            // Порог ниже прежнего: доворот держится почти до самого дома,
            // поэтому точка заходит на место по дуге, а не по прямой.
            const left = Math.min(1, Math.hypot(dx2, dy2, dz2) / 170);
            const a = recoilStep * left;
            const ca = Math.cos(a);
            const sa = Math.sin(a);
            const px = x0 + dx2;
            const pz = dz2;
            dx2 = px * ca - pz * sa - x0;
            dz2 = px * sa + pz * ca;
          }

          /* Возврат ускоряется у самого дома, а не вдали от него.

             Раньше разгон зависел только от дальности: далёкие точки шли
             резво, а у своих мест еле ползли — облако подолгу висело
             расплывчатым, хотя все уже почти на местах. Теперь дальний
             участок остался небронзовым и медленным (на нём и читается
             доворот отдачи), а последние два десятка пикселей точка
             проходит в десяток раз быстрее и щёлкает на место. */
          const away = Math.hypot(dx2, dy2, dz2);
          const near = 1 - Math.min(1, away / 200);
          const rate = Math.min(0.35, home * (1 + away / 400) * (1 + near * near * 12));
          dx2 *= 1 - rate;
          dy2 *= 1 - rate;
          dz2 *= 1 - rate;
        }

        disp[i3] = dx2;
        disp[i3 + 1] = dy2;
        disp[i3 + 2] = dz2;
      }
      dispAttr.needsUpdate = true;
      if (velAttr) velAttr.needsUpdate = true;
    };

    /* ── кадр ──────────────────────────────────────────────────── */

    let last = performance.now();
    const started = last;
    let enter = 0;
    let trailTick = 0;

    // На первом переходе камера почти стоит: движение делают частицы,
    // летящие в неё. Дальше, где частиц уже нет, камера идёт как шла.
    const camZ = (progress: number) =>
      baseZ - (progress <= 1 ? progress * 320 : 320 + (progress - 1) * SPAN);

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
      // Пока руки нет, весь шлейф переносим мгновенно: при нулевой силе
      // этого не видно, зато вернувшийся курсор не тащит вмятину через
      // весь экран из того места, где его оставили.
      stepPhysics(dt);

      enter = Math.min(1, enter + dt / 1.6);
      const eased = 1 - Math.pow(1 - enter, 3);

      // След обновляем не каждый кадр, иначе восемь точек лежат
      // друг на друге и хвоста не видно.
      trailTick += dt;
      if (trailTick > 0.055) {
        trailTick = 0;
        for (let i = TRAIL - 1; i > 0; i--) trailPos[i].copy(trailPos[i - 1]);
        trailPos[0].copy(uvMouse);
      }
      const trailGain = touched ? 0.5 * hover : 0;
      for (let i = 0; i < TRAIL; i++) trailW[i] = (1 - i / TRAIL) * trailGain;

      // Сила перетаскивания нарастает и спадает плавно: резкий перепад
      // рвёт штрихи роя пополам.
      drag += ((dragging ? 1 : 0) - drag) * Math.min(1, k * 0.9);
      if (!dragging) dragVec.multiplyScalar(Math.pow(0.86, dt * 60));

      // Маршрут ведёт камеру. Прогресс 0 — заголовок, 1 — «что делаю».
      const progress = journey.update(dt);
      const speed = Math.min(1, Math.abs(journey.velocity) * 1.4);
      camera.position.z = camZ(progress);

      particleUniforms.uDepart.value = Math.min(1, progress);
      // Поле светлеет на разгоне: движение чувствуется всем экраном,
      // а не только тем, что уезжает.
      fieldUniforms.uSpeed.value = speed;
      fieldUniforms.uLens.value = uvMouse;
      fieldUniforms.uDrag.value = drag;
      fieldUniforms.uHasPtr.value = rawMouse.x > -9000 ? hover : 0;

      onFrameRef.current?.({ progress, velocity: journey.velocity });

      fieldUniforms.uTime.value = t;
      fieldUniforms.uEnter.value = eased;
      particleUniforms.uTime.value = t;
      particleUniforms.uEnter.value = enter;
      particleUniforms.uDrag.value = drag;
      particleUniforms.uDragVec.value.copy(dragVec);
      /* Слово поворачивается вместе с раскруткой и ложится обратно.

         Прыжок кадра при отпускании был отсюда: угол слова считался прямо
         из остатка отдачи, а тот в момент отпускания скакал с нуля на
         полтора-два радиана — дом мгновенно проворачивался, и точки
         оказывались совсем не там, где их отпустили. Теперь угол живёт
         сам по себе и меняется только плавно: пока рука крутит, слово
         идёт за ней; отпустили — возвращается в ноль с темпом отдачи,
         в ту же сторону, в какую крутили.

         Наклон вокруг горизонтали привязан к тому же углу, поэтому
         и заваливается слово в сторону вращения, а не куда попало. */
      if (dragging) {
        wordSpin += (orbit * 0.35 - wordSpin) * Math.min(1, 6 * dt);
      } else if (recoilStart !== 0) {
        /* Слово доворачивается ровно в темпе отдачи, а не своим ходом.

           Со своим темпом получалось, что к концу сборки угол слова уже
           нулевой, и последнее, что видно, — одинаковая доводка в обе
           стороны: сторона раскрутки терялась. Теперь угол — это доля
           оставшейся отдачи, поэтому слово идёт с облаком в одну сторону
           и приходит на место вместе с ним. */
        wordSpin = wordAtRelease * (recoilLeft / recoilStart);
      } else {
        wordSpin += (0 - wordSpin) * Math.min(1, recoilRate * dt);
      }
      particleUniforms.uWordSpin.value = wordSpin;
      particleUniforms.uCamZ.value = camera.position.z;
      particleUniforms.uBaseZ.value = baseZ;

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
      particleUniforms.uEnter.value = 1;
      /* Маршрут при этом работает: кадр перерисовывается, когда камеру
         переставили или облако пересобралось, остальное время сцена стоит. */
      let shown = -1;
      const still = () => {
        raf = requestAnimationFrame(still);
        const progress = advance(0);
        if (progress === shown && !dirty) return;
        shown = progress;
        dirty = false;
        camera.position.z = camZ(progress);
        particleUniforms.uDepart.value = Math.min(1, progress);
        particleUniforms.uCamZ.value = camera.position.z;
        particleUniforms.uBaseZ.value = baseZ;
        onFrameRef.current?.({ progress, velocity: 0 });
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
      host.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      renderer.dispose();
      if (renderer.domElement.parentNode === host) host.removeChild(renderer.domElement);
    };
  }, [lines, linesNarrow, stops, onReady]);

  return (
    // Скринридеру здесь читать нечего: заголовок страницы — скрытый h1
    // в page.tsx, а канвас и фолбэк лишь рисуют то же слово.
    <div ref={hostRef} className="absolute inset-0" aria-hidden>
      {/* Не h1: без WebGL заголовков выходило два. */}
      <div
        ref={fallbackRef}
        className="font-display absolute inset-0 flex items-center justify-center px-6 text-center text-[clamp(30px,7vw,86px)] leading-[1.04]"
      >
        {lines.join(" ")}
      </div>
    </div>
  );
}
