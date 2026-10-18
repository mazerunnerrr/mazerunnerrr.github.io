/**
 * Маршрут вместо страницы.
 *
 * Секции — не блоки друг под другом, а точки на пути камеры.
 * Колесо и палец не прокручивают документ, а двигают по маршруту:
 * `nativeScroll = false`, весь ввод перехвачен.
 *
 * Единица измерения — сама секция: прогресс 1.0 означает «камера
 * стоит на первой точке», 2.4 — «прошла две с половиной». Так любую
 * анимацию можно писать от расстояния до своей точки, не пересчитывая
 * пиксели.
 *
 * Маршрут — кольцо, как у igloo.inc: после последней точки колесо ведёт
 * дальше, к первой, а вверх с первой — к последней. Концов нет, поэтому
 * `current` всегда нормализован в [0, stops), а `target` может убегать
 * за края — разница между ними и есть оставшийся путь.
 *
 * Колесо свободное, но между точками маршрут не застревает: стоило руке
 * затихнуть, и камера сама доезжает до ближайшей точки, вперёд или назад.
 * Так у igloo.inc — без доводки колесо останавливалось где попало, и
 * посетитель сам искал, сколько докрутить.
 */

/* Доводка начинается не по таймеру от последнего щелчка, а когда камера
   действительно встала: раньше она дёргала назад, пока прокрутка ещё
   докатывалась (Илья, 2026-10-18). Встала — ещё полсекунды стоит, чтобы
   посетитель успел увидеть, куда докрутил, и только потом откат. */
/** Сколько секунд колесо должно молчать, чтобы считать, что рука отпустила. */
const QUIET = 0.25;
/** Сколько секунд камера стоит на месте перед откатом к точке. */
const DWELL = 0.5;

/** Сколько пикселей колеса вверх выводит из комнаты. Чуть больше одного
    щелчка мыши: случайное касание тачпада не выбрасывает наружу. */
const EXIT_PX = 150;
/** Пауза в колесе, после которой события считаются новым жестом, мс. */
const GESTURE_GAP = 250;

export type JourneyOptions = {
  /** Сколько всего точек на маршруте. */
  stops: number;
  /** За сколько пикселей колеса проходится одна точка. */
  pxPerStop?: number;
};

export class Journey {
  /** Куда едем. Меняется мгновенно от ввода. */
  target = 0;
  /** Где камера на самом деле. Догоняет target с инерцией. */
  current = 0;
  /** Скорость в точках за секунду — на ней держится глитч и разгон роя. */
  velocity = 0;

  readonly stops: number;
  private pxPerStop: number;
  private detach: Array<() => void> = [];
  /** Когда рука последний раз двигала маршрут. Пока палец на экране — не доводим. */
  private lastInput = 0;
  private touching = false;
  /** Открыта комната: сцена в ней статична, колесо маршрут не двигает. */
  private locked = false;
  /** Выход из комнаты прокруткой вверх, как у igloo. Назначает сцена. */
  onExit: (() => void) | null = null;
  /** Сколько уже провели вверх в этом жесте. */
  private exitAcc = 0;
  /** Жест начался у верха колонки комнаты — только такой и выводит наружу. */
  private exitArmed = false;
  /** Когда пришло последнее событие колеса — по паузам делим их на жесты. */
  private wheelAt = 0;
  /** После выхода хвост того же жеста доедаем: инерция тачпада иначе
      сразу утаскивала бы аллею назад. */
  private swallow = false;
  /** Доводка в пути: откуда, куда, когда началась и сколько длится. */
  private glide: { from: number; to: number; t0: number; dur: number } | null = null;
  /** Когда камера встала после прокрутки; 0 — ещё едет. */
  private restAt = 0;

  constructor({ stops, pxPerStop = 900 }: JourneyOptions) {
    this.stops = stops;
    this.pxPerStop = pxPerStop;
  }

  /**
   * Подписка на ввод.
   *
   * @param root  корень сайта. События, пришедшие НЕ отсюда, не трогаем:
   *   иначе `preventDefault` съедает прокрутку в дев-оверлее Next, в
   *   модалках и вообще везде поверх страницы — колесо крутит фон, а
   *   содержимое панели стоит на месте.
   */
  attach(root: HTMLElement | null) {
    /** Событие адресовано сайту, а не панели поверх него? */
    const mine = (e: Event) => {
      const el = e.target as Element | null;
      // Дев-оверлей Next и любые диалоги живут в своих порталах за
      // пределами нашего дерева. Их прокрутку не трогаем.
      if (el?.closest?.("nextjs-portal, [data-nextjs-dialog], dialog")) return false;
      if (!root || !el) return true;
      // Всё остальное — наше: страница занимает весь экран, и событие
      // с body или html означает пустое место сайта, а не чужую панель.
      return true;
    };

    const push = (dy: number) => {
      this.target += dy / this.pxPerStop;
      this.lastInput = performance.now();
      this.glide = null;
    };

    const onWheel = (e: WheelEvent) => {
      if (!mine(e)) return;
      // deltaMode === 1 — Firefox шлёт строки, а не пиксели. Без
      // пересчёта там прокрутка идёт в сорок раз медленнее.
      const raw = e.deltaMode === 1 ? e.deltaY * 40 : e.deltaY;
      const now = performance.now();
      const fresh = now - this.wheelAt > GESTURE_GAP;
      this.wheelAt = now;
      if (this.swallow) {
        if (!fresh) {
          e.preventDefault();
          return;
        }
        this.swallow = false;
      }
      // В комнате колесо отдаётся ей: длинный текст прокручивается сам,
      // а маршрут стоит. Вверх от верха колонки — выход.
      if (this.locked) {
        this.roomScroll(raw, e.target, fresh);
        return;
      }
      e.preventDefault();
      push(raw);
    };

    let ty = 0;
    /** Первое движение пальца после касания — начало нового жеста. */
    let touchFresh = false;
    const onTouchStart = (e: TouchEvent) => {
      ty = e.touches[0]?.clientY ?? 0;
      this.touching = true;
      touchFresh = true;
    };
    const onTouchEnd = (e: TouchEvent) => {
      this.touching = e.touches.length > 0;
      this.lastInput = performance.now();
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!mine(e)) return;
      const y = e.touches[0]?.clientY ?? ty;
      if (this.locked) {
        this.roomScroll((ty - y) * 2.2, e.target, touchFresh);
        touchFresh = false;
        ty = y;
        return;
      }
      e.preventDefault();
      push((ty - y) * 2.2);
      ty = y;
    };

    // Клавиатура: без неё до контактов не добраться без мыши, а это
    // первое, что ломается на сайтах с перехваченным скроллом.
    const onKey = (e: KeyboardEvent) => {
      const step = { ArrowDown: 1, PageDown: 1, ArrowUp: -1, PageUp: -1, " ": 1 }[e.key];
      if (step === undefined || this.locked) return;
      // В поле ввода и в панелях поверх сайта стрелки принадлежат им.
      const t = e.target as Element | null;
      if (t?.closest?.("input, textarea, select, [contenteditable], nextjs-portal")) return;
      e.preventDefault();
      this.glide = null;
      this.target = Math.round(this.target) + step;
    };

    // Слушаем на window, но фильтруем по источнику: так курсор может
    // стоять над любым слоем сайта, и колесо всё равно ведёт камеру.
    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("touchcancel", onTouchEnd, { passive: true });
    window.addEventListener("keydown", onKey);

    this.detach = [
      () => window.removeEventListener("wheel", onWheel),
      () => window.removeEventListener("touchstart", onTouchStart),
      () => window.removeEventListener("touchmove", onTouchMove),
      () => window.removeEventListener("touchend", onTouchEnd),
      () => window.removeEventListener("touchcancel", onTouchEnd),
      () => window.removeEventListener("keydown", onKey),
    ];
    return () => this.dispose();
  }

  dispose() {
    this.detach.forEach((f) => f());
    this.detach = [];
  }

  /** Замок на время комнаты. Кнопки и якоря (`goTo`) работают и под ним. */
  lock(on: boolean) {
    // Вышли посреди жеста — его хвост маршрут не двигает.
    if (this.locked && !on) this.swallow = true;
    this.locked = on;
    this.exitAcc = 0;
    this.exitArmed = false;
  }

  /** Прокрутка внутри комнаты. Вниз и посреди текста — забота самой колонки
      (`data-room-scroll`). Вверх — выход, но только жестом, начатым у верха
      колонки: иначе долистал текст до начала, инерция докатила — и тебя
      выбросило из комнаты посреди чтения. */
  private roomScroll(dy: number, target: EventTarget | null, fresh: boolean) {
    const col = (target as Element | null)?.closest?.("[data-room-scroll]") as HTMLElement | null;
    if (fresh) {
      this.exitAcc = 0;
      this.exitArmed = !col || col.scrollTop <= 0;
    }
    if (dy >= 0 || !this.exitArmed) {
      this.exitAcc = 0;
      return;
    }
    this.exitAcc -= dy;
    if (this.exitAcc > EXIT_PX) {
      this.exitAcc = 0;
      this.exitArmed = false;
      this.onExit?.();
    }
  }

  /** Прямой переход — для кнопок и якорей. На кольце у точки бесконечно
      много копий; едем к ближайшей, а не отматываем круг назад. */
  goTo(stop: number) {
    this.glide = null;
    const n = this.stops;
    this.target = stop + n * Math.round((this.target - stop) / n);
  }

  /** Встать на точку сразу, без пролёта: возврат со страницы проекта. */
  jumpTo(stop: number) {
    this.glide = null;
    this.target = this.current = stop;
    this.velocity = 0;
  }

  /** Доводка: рука затихла — цель переезжает на ближайшую точку. Ближайшую
      к цели, а не по ходу движения: перекрутил чуть дальше — вернёт назад. */
  private settle() {
    const now = performance.now();
    if (this.glide || this.touching) return;
    const still = now - this.lastInput > QUIET * 1000 && Math.abs(this.target - this.current) < 0.012;
    if (!still) {
      this.restAt = 0;
      return;
    }
    if (!this.restAt) this.restAt = now;
    if (now - this.restAt < DWELL * 1000) return;
    const to = Math.round(this.target);
    this.target = to;
    /* Откат — с разгоном и торможением, а не по экспоненте, которая
       стартует на полной скорости и читается рывком. Длительность растёт
       с расстоянием: полшага — около 1,7 с, чуть-чуть — около секунды. */
    const dist = Math.abs(to - this.current);
    if (dist > 0.001) this.glide = { from: this.current, to, t0: now, dur: 1000 + dist * 1400 };
  }

  /** Режим без движения: камера сразу на цели. */
  snap() {
    this.settle();
    this.glide = null;
    this.current = this.target;
    this.velocity = 0;
    this.wrap();
    return this.current;
  }

  /** Держит `current` в [0, stops), сдвигая `target` на те же целые круги —
      путь между ними не меняется, поэтому скачка не видно. */
  private wrap() {
    const n = this.stops;
    if (this.current >= 0 && this.current < n) return;
    const shift = Math.floor(this.current / n) * n;
    this.current -= shift;
    this.target -= shift;
    if (this.glide) {
      this.glide.from -= shift;
      this.glide.to -= shift;
    }
  }

  update(dt: number) {
    this.settle();
    const prev = this.current;
    if (this.glide) {
      const g = this.glide;
      const t = Math.min(1, (performance.now() - g.t0) / g.dur);
      /* Кубическая кривая, как откат у igloo: трогается мягко, в середине
         уверенно разгоняется и долго, гладко встаёт. Синус был слишком
         ровным — без этого «премиального» рывка в середине. */
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      this.current = g.from + (g.to - g.from) * e;
      if (t >= 1) this.glide = null;
    } else {
      // Кадронезависимо, тот же закон, что и у всей остальной механики:
      // при просадке fps движение замедляется по времени, а не по кадрам.
      // Отзывчивее прежнего: камера догоняет колесо примерно за четверть
      // секунды вместо сорока сотых — прокрутка ощущается прямой.
      const k = 1 - Math.pow(0.0022, dt);
      this.current += (this.target - this.current) * Math.min(1, k * 0.62);
    }
    this.velocity = dt > 0 ? (this.current - prev) / dt : 0;
    this.wrap();
    return this.current;
  }

  /** Насколько камера близка к точке: 1 — стоит на ней, 0 — дальше секции.
      Расстояние по кольцу: последняя точка соседствует с первой. */
  proximity(stop: number) {
    const n = this.stops;
    const d = Math.abs((((this.current - stop) % n) + n) % n);
    return Math.max(0, 1 - Math.min(d, n - d));
  }
}
