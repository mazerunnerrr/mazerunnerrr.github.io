/**
 * Экранное поле скорости — упрощённая жидкость, по образцу igloo.inc
 * (пингвин из частиц, разобран 2026-10-19). Мазок кладётся отрезком от
 * прошлого положения курсора до нового, поле переносит само себя, гасит
 * расхождение и медленно затухает — у него есть память и вихри.
 *
 * Работает вода фона (`Water` ниже). Точки объектов его не слушают: пробовали
 * вести их полем, как у igloo, — пропали мгновенный удар, закрутка и разлёт
 * по глубине прежней кисти, Илья вернул её (2026-10-19).
 *
 * Координаты — пиксели сцены: начало в центре экрана, Y вверх. Скорость —
 * пиксели за кадр при 60 к/с. Радиус мазка задаёт тот, кто мешает.
 */

/** Сколько скорости мазок добавляет на пиксель хода руки. */
const SPLAT_FORCE = 0.4;
/** Затухание скорости и давления за кадр (igloo: 0.98 и 0.86). */
const VEL_KEEP = 0.98;
const PRESSURE_KEEP = 0.86;
/** Итераций давления: немного, поле лишь частично бездивергентное — как у igloo. */
const JACOBI = 3;

export class Fluid {
  nx: number;
  ny: number;
  cell: number;
  /** Левый нижний угол сетки в координатах сцены. */
  x0: number;
  y0: number;
  u: Float32Array;
  v: Float32Array;
  /** Самая быстрая клетка после шага — по ней видно, живо ли поле. */
  peak = 0;
  /** Затухание скорости за кадр: в комнате вода быстрее (Water.quick). */
  velKeep = VEL_KEEP;
  private u2: Float32Array;
  private v2: Float32Array;
  private p: Float32Array;
  private p2: Float32Array;
  private div: Float32Array;

  /** @param rows клеток по высоте экрана. */
  constructor(w: number, h: number, rows = 72) {
    this.cell = Math.max(6, h / rows);
    this.nx = Math.ceil(w / this.cell) + 1;
    this.ny = Math.ceil(h / this.cell) + 1;
    this.x0 = -w / 2;
    this.y0 = -h / 2;
    const n = this.nx * this.ny;
    this.u = new Float32Array(n);
    this.v = new Float32Array(n);
    this.u2 = new Float32Array(n);
    this.v2 = new Float32Array(n);
    this.p = new Float32Array(n);
    this.p2 = new Float32Array(n);
    this.div = new Float32Array(n);
  }

  /** Мазок руки: отрезок (ax, ay) → (bx, by) радиусом R; сила — ход руки за кадр. */
  splat(ax: number, ay: number, bx: number, by: number, R: number) {
    const fx = (bx - ax) * SPLAT_FORCE;
    const fy = (by - ay) * SPLAT_FORCE;
    if (!fx && !fy) return;
    const { nx, ny, cell, x0, y0 } = this;
    const ex = bx - ax;
    const ey = by - ay;
    const len2 = ex * ex + ey * ey || 1;
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - R - x0) / cell));
    const i1 = Math.min(nx - 1, Math.ceil((Math.max(ax, bx) + R - x0) / cell));
    const j0 = Math.max(0, Math.floor((Math.min(ay, by) - R - y0) / cell));
    const j1 = Math.min(ny - 1, Math.ceil((Math.max(ay, by) + R - y0) / cell));
    for (let j = j0; j <= j1; j++) {
      const y = y0 + j * cell;
      for (let i = i0; i <= i1; i++) {
        const x = x0 + i * cell;
        // Расстояние до отрезка, а не до точки: быстрый мах не рвётся пунктиром.
        const t = Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / len2));
        const d = Math.hypot(x - ax - ex * t, y - ay - ey * t);
        if (d >= R) continue;
        const f = 1 - d / R;
        this.deposit(j * nx + i, f * f * f, fx, fy);
      }
    }
  }

  /** Что мазок кладёт в клетку c с весом w. */
  protected deposit(c: number, w: number, fx: number, fy: number) {
    this.u[c] += fx * w;
    this.v[c] += fy * w;
  }

  /** Шаг поля; k — длина кадра в кадрах по 60 к/с. */
  step(k: number) {
    const { nx, ny, cell } = this;
    let { u, v, u2, v2 } = this;

    // Перенос самим собой: значение приходит из точки, откуда его принесло.
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const c = j * nx + i;
        const sx = i - (u[c] * k) / cell;
        const sy = j - (v[c] * k) / cell;
        u2[c] = this.at(u, sx, sy);
        v2[c] = this.at(v, sx, sy);
      }
    }
    [u, u2] = [u2, u];
    [v, v2] = [v2, v];

    // Давление: гасим расхождение, и поток обтекает, а не сжимается в точку.
    const { p, div } = this;
    let dst = this.p2;
    const ix = (i: number) => (i < 0 ? 0 : i >= nx ? nx - 1 : i);
    const jy = (j: number) => (j < 0 ? 0 : j >= ny ? ny - 1 : j);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const c = j * nx + i;
        div[c] = 0.5 * (u[j * nx + ix(i + 1)] - u[j * nx + ix(i - 1)] + v[jy(j + 1) * nx + i] - v[jy(j - 1) * nx + i]);
      }
    }
    const pk = Math.pow(PRESSURE_KEEP, k);
    for (let c = 0; c < p.length; c++) p[c] *= pk;
    let src = p;
    for (let it = 0; it < JACOBI; it++) {
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const c = j * nx + i;
          dst[c] =
            (src[j * nx + ix(i - 1)] + src[j * nx + ix(i + 1)] + src[jy(j - 1) * nx + i] + src[jy(j + 1) * nx + i] - div[c]) *
            0.25;
        }
      }
      [src, dst] = [dst, src];
    }
    if (src !== p) p.set(src);

    const keep = Math.pow(this.velKeep, k);
    let peak = 0;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const c = j * nx + i;
        const a = (u[c] - 0.5 * (p[j * nx + ix(i + 1)] - p[j * nx + ix(i - 1)])) * keep;
        const b = (v[c] - 0.5 * (p[jy(j + 1) * nx + i] - p[jy(j - 1) * nx + i])) * keep;
        u[c] = a;
        v[c] = b;
        const s = a * a + b * b;
        if (s > peak) peak = s;
      }
    }
    this.u = u;
    this.v = v;
    this.u2 = u2;
    this.v2 = v2;
    this.peak = Math.sqrt(peak);
  }

  /** Скорость поля в точке сцены — в `out` (x, y). */
  sample(x: number, y: number, out: { x: number; y: number }) {
    const sx = (x - this.x0) / this.cell;
    const sy = (y - this.y0) / this.cell;
    out.x = this.at(this.u, sx, sy);
    out.y = this.at(this.v, sx, sy);
  }

  /** Билинейная выборка; за краем сетки поле нулевое. */
  protected at(f: Float32Array, sx: number, sy: number) {
    const { nx, ny } = this;
    if (sx < 0 || sy < 0 || sx > nx - 1 || sy > ny - 1) return 0;
    const i = Math.min(nx - 2, Math.floor(sx));
    const j = Math.min(ny - 2, Math.floor(sy));
    const fx = sx - i;
    const fy = sy - j;
    const c = j * nx + i;
    return (f[c] * (1 - fx) + f[c + 1] * fx) * (1 - fy) + (f[c + nx] * (1 - fx) + f[c + nx + 1] * fx) * fy;
  }
}

/** Муть: сколько её поднимает пиксель хода руки и как долго она висит. */
const SILT = 0.012;
const SILT_KEEP = 0.99;
/** Вода, сдвинутая рукой, возвращается на место за ~2 с. */
const DRIFT_KEEP = 0.992;
/** Какая доля течения копится в сдвиг. Поле от наложенных мазков быстрее
    самой руки, и сдвиг целиком набегал до тысячи пикселей; так — ~100. */
const DRIFT_GAIN = 0.1;

/**
 * Вода фона (Илья, 2026-10-19: «как будто мы в глубине океана, и кистью
 * проводим внутри воды»). То же поле, только шире и грубее, и несёт ещё
 * две вещи: муть, которую поднимает рука, и смещение самой воды — насколько
 * её здесь сдвинуло. Смещение двигает пыль и гнёт свет в фоне, а потом
 * медленно сходит на нет: вода успокаивается.
 */
export class Water extends Fluid {
  silt: Float32Array;
  dx: Float32Array;
  dy: Float32Array;
  private driftKeep = DRIFT_KEEP;
  private driftGain = DRIFT_GAIN;
  /** Осталось ли что-то от руки: течение, муть или сдвиг. */
  stirred = false;
  private t1: Float32Array;
  private t2: Float32Array;
  private t3: Float32Array;

  constructor(w: number, h: number) {
    super(w, h, 48);
    const n = this.nx * this.ny;
    this.silt = new Float32Array(n);
    this.dx = new Float32Array(n);
    this.dy = new Float32Array(n);
    this.t1 = new Float32Array(n);
    this.t2 = new Float32Array(n);
    this.t3 = new Float32Array(n);
  }

  protected deposit(c: number, w: number, fx: number, fy: number) {
    super.deposit(c, w, fx, fy);
    this.silt[c] = Math.min(1.5, this.silt[c] + Math.hypot(fx, fy) * w * SILT);
    this.stirred = true;
  }

  step(k: number) {
    super.step(k);
    const { nx, ny, cell, u, v } = this;
    const sk = Math.pow(SILT_KEEP, k);
    const dk = Math.pow(this.driftKeep, k);
    let rest = 0;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const c = j * nx + i;
        const sx = i - (u[c] * k) / cell;
        const sy = j - (v[c] * k) / cell;
        const m = this.at(this.silt, sx, sy) * sk;
        const a = (this.at(this.dx, sx, sy) + u[c] * k * this.driftGain) * dk;
        const b = (this.at(this.dy, sx, sy) + v[c] * k * this.driftGain) * dk;
        this.t1[c] = m;
        this.t2[c] = a;
        this.t3[c] = b;
        rest = Math.max(rest, m * 40, Math.abs(a), Math.abs(b));
      }
    }
    [this.silt, this.t1] = [this.t1, this.silt];
    [this.dx, this.t2] = [this.t2, this.dx];
    [this.dy, this.t3] = [this.t3, this.dy];
    this.stirred = rest > 0.05 || this.peak > 0.02;
  }

  /**
   * Быстрая вода — в комнате проекта, `q` от 0 (аллея) до 1 (комната открыта).
   * По экрану она расходится и стекается за ~0,3 с, а не за две (Илья,
   * 2026-10-21: «медленно растекается, медленно стекается — быстрее
   * и плавнее»). Набирается сдвиг сильнее, чтобы след был так же заметен.
   * На аллее вода прежняя, тягучая.
   */
  quick(q: number) {
    this.velKeep = VEL_KEEP + (0.955 - VEL_KEEP) * q;
    this.driftKeep = DRIFT_KEEP + (0.95 - DRIFT_KEEP) * q;
    this.driftGain = DRIFT_GAIN + (0.3 - DRIFT_GAIN) * q;
  }

  /** В текстуру для шейдеров: сдвиг воды (px), муть, скорость течения. */
  fill(out: Float32Array) {
    const { u, v } = this;
    for (let c = 0, o = 0; c < this.silt.length; c++, o += 4) {
      out[o] = this.dx[c];
      out[o + 1] = this.dy[c];
      out[o + 2] = this.silt[c];
      out[o + 3] = Math.hypot(u[c], v[c]);
    }
  }
}
