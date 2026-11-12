/* «Назад» ведёт по пройденному пути, а не сразу с сайта (Илья, 2026-11-12):
   жест назад и кнопка «назад» внизу экрана телефона, стрелка браузера. Из
   комнаты — на аллею, с точки — на ту, откуда пришли; дошли так до имени —
   следующий «назад» уводит с сайта.

   Шаг пути — запись истории браузера на том же адресе: точка, где встала
   камера, или открытая комната. Вернулся рукой на пройденную точку — записи
   после неё снимаются (`history.go`): путь без петель, и с имени «назад»
   уводит с сайта, как бы до него ни дошли.

   Запись ставится только в миг касания, клика или клавиши (`arm`): Safari при
   «назад» пропускает записи, добавленные без жеста, даже секундой позже, а
   камера доезжает до точки за секунду-две. Поэтому на жест ставится
   заготовка — копия текущего шага, а доехавшая камера или открытая комната
   её заполняют (`replaceState` жеста не требует). «Назад» на незаполненную
   заготовку видимо ничего не меняет — такой шаг сцена проходит сама
   следующим `history.back()`. */

export type Step = { p: number; room: boolean; spare?: boolean };
type Entry = Step & { trail: number };

const isEntry = (x: unknown): x is Entry =>
  typeof (x as Entry | null)?.trail === "number" && typeof (x as Entry | null)?.p === "number";

/** Сколько ждать своего перехода по истории, прежде чем счесть его потерянным. */
const SELF_WAIT = 1500;

export class BackTrail {
  /** Шаги по глубине записи; после перезагрузки нижние неизвестны — дыры. */
  private path: (Step | undefined)[] = [];
  private depth = 0;
  /** Переходы по истории, которые сделала сама сцена (`history.go`). */
  private selfPops = 0;
  private selfAt = 0;

  /** Где встать при загрузке: вернулись «назад» со страницы кейса — на точку
      из записи истории; иначе по адресу `#`, без него — на имени. Перезагрузка
      начинает с имени, как раньше: тур и проверки заходят заново тем же адресом. */
  static startPoint(fallback: number) {
    const st = history.state;
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    return isEntry(st) && nav?.type === "back_forward" ? st.p : fallback;
  }

  start(fallback: number) {
    const st = history.state;
    this.path = [];
    this.depth = isEntry(st) ? st.trail : 0;
    // Комната после перезагрузки закрыта: шаг — её точка.
    this.path[this.depth] = { p: BackTrail.startPoint(fallback), room: false };
    this.write(false);
  }

  private write(push: boolean) {
    const s = this.path[this.depth];
    if (!s) return;
    const data: Entry = { trail: this.depth, p: s.p, room: s.room, ...(s.spare ? { spare: true } : {}) };
    if (push) history.pushState(data, "");
    else history.replaceState(data, "");
  }

  private get busy() {
    if (this.selfPops > 0 && performance.now() - this.selfAt > SELF_WAIT) this.selfPops = 0;
    return this.selfPops > 0;
  }

  /** Жест посетителя: поставить заготовку, если её ещё нет. */
  arm() {
    if (this.busy) return;
    const top = this.path[this.depth];
    if (top?.spare) return;
    this.path.length = this.depth + 1;
    this.path.push({ p: top?.p ?? 0, room: top?.room ?? false, spare: true });
    this.depth++;
    this.write(true);
  }

  private advance(s: Step) {
    if (this.path[this.depth]?.spare) {
      this.path[this.depth] = s;
      this.write(false);
      return;
    }
    this.path.length = this.depth + 1;
    this.path.push(s);
    this.depth++;
    this.write(true);
  }

  /** Камера встала на точку `q`. false — рано: идёт свой переход по истории. */
  arrive(q: number) {
    if (this.busy) return false;
    for (let i = this.depth; i >= 0; i--) {
      const s = this.path[i];
      if (!s || s.room || s.spare || s.p !== q) continue;
      // Уже здесь; лежащую сверху заготовку заполнит следующий шаг.
      if (i === this.depth || (i === this.depth - 1 && this.path[this.depth]?.spare)) return true;
      this.selfPops++;
      this.selfAt = performance.now();
      const back = i - this.depth;
      this.depth = i;
      this.path.length = i + 1;
      history.go(back);
      return true;
    }
    this.advance({ p: q, room: false });
    return true;
  }

  openRoom(k: number) {
    this.advance({ p: k, room: true });
  }

  /** Комнату закрыли кнопкой, Esc или колесом: её шаг становится точкой. */
  closeRoom() {
    const top = this.path[this.depth];
    if (!top?.room) return;
    this.path[this.depth] = { ...top, room: false };
    this.write(false);
  }

  /** popstate. null — запись не наша (её ведёт Next), "self" — переход сделала
      сама сцена, иначе — шаг, на который вернулись. */
  pop(state: unknown): Step | "self" | null {
    if (!isEntry(state)) return null;
    this.depth = state.trail;
    this.path.length = state.trail + 1;
    this.path[state.trail] = { p: state.p, room: state.room, ...(state.spare ? { spare: true } : {}) };
    if (this.selfPops > 0) {
      this.selfPops--;
      return "self";
    }
    return this.path[state.trail]!;
  }
}
