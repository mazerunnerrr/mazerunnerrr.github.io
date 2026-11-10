/**
 * Карта волны по буквам комнаты (`wave.ts`): мазок руки расходится кругом.
 *
 * Прежняя карта расползалась каждый шаг на клетку к четырём соседям, и фронт
 * шёл ромбом: вдоль осей на клетку за шаг, по диагонали — на 0,7. Повёл
 * мышь вправо — волна расходилась ромбом (Илья, 2026-11-10). Теперь клетка
 * помнит, из какой клетки мазка к ней пришла волна, и сила считается
 * по настоящему расстоянию до неё, а фронт — круг: клетка на расстоянии d
 * клеток зажигается на шаге d, не раньше. Всё остальное как было: фронт
 * ~300 px/с, ослабление на клетку пути, затухание за шаг, мазок прибавляется.
 *
 * Пересчитываются только клетки, у которых сменился сосед или фронт ещё
 * в пути: в покое за фронтом источник клетки не меняется. Всё гаснет
 * одинаково, поэтому сравнивать источники можно без времени, а гасить
 * клетку — по одному числу.
 *
 * Без DOM — проверяется пробой в node (`docs/probe-1110-wave-round.mjs`).
 */

/** Затухание карты за шаг. */
const DECAY = 0.985;
/** Ослабление фронта на клетку пути: у igloo его даёт шум сноса, без него
    кольцо перебора уходило бы через весь экран. Подобрано под их ~400 px. */
const SPREAD = 0.976;
const LN_DECAY = Math.log(DECAY);
const LN_SPREAD = Math.log(SPREAD);
/** Слабее — клетка гаснет: ни свет (от 0,6), ни перебор (рост от 0,045) от неё не зажгутся. */
const LN_CUT = Math.log(0.04);

export type Field = ReturnType<typeof createField>;

export function createField(texel: number) {
  /* Карта с полем в клетку по краям: у клетки внутри все восемь соседей
     есть, и проверять края во внутреннем цикле не нужно. */
  let gw = 0;
  let gh = 0;
  /** Откуда пришла волна: клетка мазка (−1 — волны нет), её сила в логарифме,
      приведённая к шагу 0, и шаг, на котором её нарисовали. */
  let qx = new Int16Array(0);
  let qy = new Int16Array(0);
  let qk = new Float64Array(0);
  let qn = new Float64Array(0);
  /** Сила этой волны в самой клетке — логарифм, тоже к шагу 0. */
  let qs = new Float64Array(0);
  /** Кого пересчитать на этом шаге и на следующем. */
  let dirty = new Uint8Array(0);
  let later = new Uint8Array(0);
  /** Сдвиги восьми соседей в массиве. */
  let nb: number[] = [];
  /** Номер шага; с пустой картой начинается заново. */
  let n = 0;
  /** Рамка клеток, где есть волна (пусто — x1 < x0). */
  let x0 = 0;
  let x1 = -1;
  let y0 = 0;
  let y1 = -1;

  const reset = () => {
    qx.fill(-1);
    dirty.fill(0);
    later.fill(0);
    n = 0;
    x0 = y0 = 0;
    x1 = y1 = -1;
  };
  /** Клетка сменила волну — ей и соседям пересчитаться на следующем шаге. */
  const touch = (i: number) => {
    later[i - gw - 1] = later[i - gw] = later[i - gw + 1] = 1;
    later[i - 1] = later[i] = later[i + 1] = 1;
    later[i + gw - 1] = later[i + gw] = later[i + gw + 1] = 1;
  };
  const value = (i: number) => (qx[i] < 0 ? 0 : Math.exp(qs[i] + LN_DECAY * n));

  return {
    /** Окно сменило размер — карта заново, пустая. */
    resize(w: number, h: number) {
      gw = Math.ceil(w / texel) + 3;
      gh = Math.ceil(h / texel) + 3;
      const len = gw * gh;
      nb = [-gw - 1, -gw, -gw + 1, -1, 1, gw - 1, gw, gw + 1];
      qx = new Int16Array(len);
      qy = new Int16Array(len);
      qk = new Float64Array(len);
      qn = new Float64Array(len);
      qs = new Float64Array(len);
      dirty = new Uint8Array(len);
      later = new Uint8Array(len);
      reset();
    },
    reset,
    get active() {
      return x1 >= x0;
    },
    /** Величина карты в точке экрана, px: 0..1. */
    at(x: number, y: number) {
      const cx = Math.floor(x / texel) + 1;
      const cy = Math.floor(y / texel) + 1;
      return cx >= 1 && cy >= 1 && cx < gw - 1 && cy < gh - 1 ? value(cy * gw + cx) : 0;
    },
    /** Шаг карты: волна проходит клетку, всё гаснет, мазок от (ax, ay) к (bx, by)
        радиусом r (px) прибавляется. r = 0 — мазка нет. */
    step(ax: number, ay: number, bx: number, by: number, r: number) {
      n++;
      [dirty, later] = [later, dirty];
      const cut = LN_CUT - LN_DECAY * n;
      let nx0 = gw;
      let nx1 = -1;
      let ny0 = gh;
      let ny1 = -1;
      if (x1 >= x0) {
        // Фронт за шаг уходит не дальше клетки — смотрим рамку с запасом в клетку.
        const ax0 = Math.max(1, x0 - 1);
        const ax1 = Math.min(gw - 2, x1 + 1);
        const ay0 = Math.max(1, y0 - 1);
        const ay1 = Math.min(gh - 2, y1 + 1);
        for (let y = ay0; y <= ay1; y++) {
          for (let x = ax0; x <= ax1; x++) {
            const i = y * gw + x;
            const had = qx[i] >= 0;
            // Погасла — соседям, может быть, есть что предложить взамен.
            if (had && qs[i] < cut) {
              qx[i] = -1;
              dirty[i] = 0;
              touch(i);
              continue;
            }
            if (!dirty[i]) {
              if (had) {
                if (x < nx0) nx0 = x;
                if (x > nx1) nx1 = x;
                if (y < ny0) ny0 = y;
                if (y > ny1) ny1 = y;
              }
              continue;
            }
            dirty[i] = 0;
            /* Сильнейший из источников, что держат клетка и восемь соседей,
               по расстоянию до него самого. Соседи по диагонали нужны: через
               них волна успевает за кругом и в косых направлениях. */
            let best = had ? qs[i] : -Infinity;
            let sx = had ? qx[i] : -1;
            let sy = had ? qy[i] : 0;
            let sn = had ? qn[i] : 0;
            let sk = had ? qk[i] : 0;
            let waits = false;
            for (let o = 0; o < 8; o++) {
              const j = i + nb[o];
              const px = qx[j];
              if (px < 0) continue;
              const py = qy[j];
              const pn = qn[j];
              if (px === sx && py === sy && pn === sn) continue;
              const dx = x - px;
              const dy = y - py;
              const d = Math.sqrt(dx * dx + dy * dy);
              const s = qk[j] + LN_SPREAD * d;
              if (s <= best) continue;
              // Фронт — круг: дальше, чем прошло шагов, волна ещё не дошла.
              if (d > n - pn + 1e-6) {
                waits = true;
                continue;
              }
              best = s;
              sx = px;
              sy = py;
              sn = pn;
              sk = qk[j];
            }
            if (waits) later[i] = 1;
            if (sx < 0 || best < cut) {
              if (had) {
                qx[i] = -1;
                touch(i);
              }
              continue;
            }
            if (!had || sx !== qx[i] || sy !== qy[i] || sn !== qn[i]) {
              qx[i] = sx;
              qy[i] = sy;
              qn[i] = sn;
              qk[i] = sk;
              qs[i] = best;
              touch(i);
            }
            if (x < nx0) nx0 = x;
            if (x > nx1) nx1 = x;
            if (y < ny0) ny0 = y;
            if (y > ny1) ny1 = y;
          }
        }
      }
      // Мазок — отрезок; клетки под ним прибавляют и сами становятся источниками.
      if (r > 0.5) {
        const sx = bx - ax;
        const sy = by - ay;
        const l2 = sx * sx + sy * sy;
        const cx0 = Math.max(1, Math.floor((Math.min(ax, bx) - r) / texel) + 1);
        const cx1 = Math.min(gw - 2, Math.ceil((Math.max(ax, bx) + r) / texel) + 1);
        const cy0 = Math.max(1, Math.floor((Math.min(ay, by) - r) / texel) + 1);
        const cy1 = Math.min(gh - 2, Math.ceil((Math.max(ay, by) + r) / texel) + 1);
        for (let y = cy0; y <= cy1; y++) {
          for (let x = cx0; x <= cx1; x++) {
            const px = (x - 0.5) * texel - ax;
            const py = (y - 0.5) * texel - ay;
            const t = l2 > 0 ? Math.max(0, Math.min(1, (px * sx + py * sy) / l2)) : 0;
            const s = 1 - Math.hypot(px - sx * t, py - sy * t) / r;
            if (s <= 0) continue;
            const i = y * gw + x;
            const v = Math.min(1, value(i) + s * s * s);
            const lk = Math.log(v) - LN_DECAY * n;
            if (lk < cut) continue;
            qx[i] = x;
            qy[i] = y;
            qn[i] = n;
            qk[i] = qs[i] = lk;
            touch(i);
            if (x < nx0) nx0 = x;
            if (x > nx1) nx1 = x;
            if (y < ny0) ny0 = y;
            if (y > ny1) ny1 = y;
          }
        }
      }
      x0 = nx0;
      x1 = nx1;
      y0 = ny0;
      y1 = ny1;
      if (x1 < x0) reset();
    },
  };
}
