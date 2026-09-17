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
 */

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
    const max = this.stops - 1;

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
      this.target = Math.max(0, Math.min(max, this.target + dy / this.pxPerStop));
    };

    const onWheel = (e: WheelEvent) => {
      if (!mine(e)) return;
      e.preventDefault();
      // deltaMode === 1 — Firefox шлёт строки, а не пиксели. Без
      // пересчёта там прокрутка идёт в сорок раз медленнее.
      const raw = e.deltaMode === 1 ? e.deltaY * 40 : e.deltaY;
      push(raw);
    };

    let ty = 0;
    const onTouchStart = (e: TouchEvent) => {
      ty = e.touches[0]?.clientY ?? 0;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!mine(e)) return;
      const y = e.touches[0]?.clientY ?? ty;
      e.preventDefault();
      push((ty - y) * 2.2);
      ty = y;
    };

    // Клавиатура: без неё до контактов не добраться без мыши, а это
    // первое, что ломается на сайтах с перехваченным скроллом.
    const onKey = (e: KeyboardEvent) => {
      const step = { ArrowDown: 1, PageDown: 1, ArrowUp: -1, PageUp: -1, " ": 1 }[e.key];
      if (step === undefined) return;
      // В поле ввода и в панелях поверх сайта стрелки принадлежат им.
      const t = e.target as Element | null;
      if (t?.closest?.("input, textarea, select, [contenteditable], nextjs-portal")) return;
      e.preventDefault();
      this.target = Math.max(0, Math.min(max, Math.round(this.target) + step));
    };

    // Слушаем на window, но фильтруем по источнику: так курсор может
    // стоять над любым слоем сайта, и колесо всё равно ведёт камеру.
    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("keydown", onKey);

    this.detach = [
      () => window.removeEventListener("wheel", onWheel),
      () => window.removeEventListener("touchstart", onTouchStart),
      () => window.removeEventListener("touchmove", onTouchMove),
      () => window.removeEventListener("keydown", onKey),
    ];
    return () => this.dispose();
  }

  dispose() {
    this.detach.forEach((f) => f());
    this.detach = [];
  }

  /** Прямой переход — для кнопок и якорей. */
  goTo(stop: number) {
    this.target = Math.max(0, Math.min(this.stops - 1, stop));
  }

  update(dt: number) {
    const prev = this.current;
    // Кадронезависимо, тот же закон, что и у всей остальной механики:
    // при просадке fps движение замедляется по времени, а не по кадрам.
    const k = 1 - Math.pow(0.0022, dt);
    this.current += (this.target - this.current) * Math.min(1, k * 0.42);
    this.velocity = dt > 0 ? (this.current - prev) / dt : 0;
    return this.current;
  }

  /** Насколько камера близка к точке: 1 — стоит на ней, 0 — дальше секции. */
  proximity(stop: number) {
    return Math.max(0, 1 - Math.abs(this.current - stop));
  }
}
