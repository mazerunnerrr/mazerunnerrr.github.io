/**
 * Объекты-герои маршрута.
 *
 * У каждой точки маршрута свой объект из той же материи и той же плотности:
 * число частиц задаёт имя, плоские формы подгоняются под него
 * пересэмплированием. Сфере проекта точек нужно больше — по ней проступает
 * кадр проекта, и на редкой сетке его не разобрать. Форма на аллее и форма
 * в комнате у объекта всегда с одним числом точек.
 *
 * Координаты — пиксели от центра экрана, Y вверх, как у sampleText.
 */

import { sampleText } from "@/lib/textParticles";

export type ShapeSpec =
  | { kind: "text"; text: string }
  /** Сфера-сетка — объект проекта. На аллее r — радиус в долях высоты
      экрана; в комнате та же сетка раскрыта вокруг камеры: r больше экрана,
      а центр сдвинут к зрителю на cz (тоже в долях высоты). */
  | { kind: "sphere"; r: number; cz?: number };

export type Shape = {
  points: Float32Array;
  /** Глубина каждой точки от центра формы. Есть только у объёмных форм —
      у сферы; надписи и кольца плоские. */
  z?: Float32Array;
  /** Где по глубине центр формы: у раздутой сферы он сдвинут к зрителю. */
  cz?: number;
  /** 1 — точка видна и внутри раскрытой сферы, 0.5 — внутри гаснет. */
  keep?: Float32Array;
  /** Полуширина формы: по ней шейдер ведёт очередь на оборот слева направо. */
  halfW: number;
  /** Полувысота — для попадания кликом по объекту на аллее. */
  halfH: number;
};

const FAMILY = "var(--font-cormorant), Georgia, serif";

/**
 * Текст из частиц. Кегль подбирается под ширину: название проекта длиннее
 * имени, и на кегле имени оно вылезало бы за края.
 */
export async function textShape(text: string, w: number, h: number, first: boolean) {
  const narrow = w < 720;
  // Первая форма держит прежний кегль имени — его физику Илья уже принял.
  let size = first
    ? narrow
      ? Math.max(56, Math.min(110, w * 0.24))
      : Math.max(90, Math.min(230, w * 0.14))
    : text.length <= 2
      ? // Одиночный знак — сам по себе герой: ему не нужен предел ширины,
        // рассчитанный на длинные названия, иначе «@» выходил в спичечный коробок.
        Math.min(h * 0.62, 460)
      : Math.min(h * 0.5, w * 0.14, 230);
  const maxW = w * 0.62;
  let s = await sampleText({ lines: [text], fontSize: size, fontFamily: FAMILY, lineHeight: 1.12, fontWeight: "400", step: 1 });
  if (!first && s.width > maxW) {
    size *= maxW / s.width;
    s = await sampleText({ lines: [text], fontSize: size, fontFamily: FAMILY, lineHeight: 1.12, fontWeight: "400", step: 1 });
  }
  return s;
}

/**
 * Подгонка формы под число точек мира. Пока точек хватает — подмножество
 * без повторов; если форма беднее, недостающие берутся повторами с дрожью
 * в пиксель, чтобы дубли не ложились точка в точку.
 */
export function resample(src: Float32Array, n: number): Float32Array {
  const m = src.length / 2;
  const out = new Float32Array(n * 2);
  if (!m) return out;
  const idx = new Uint32Array(m);
  for (let i = 0; i < m; i++) idx[i] = i;
  for (let i = m - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    const t = idx[i];
    idx[i] = idx[j];
    idx[j] = t;
  }
  for (let i = 0; i < n; i++) {
    const k = idx[i % m];
    const dup = i >= m ? 1.2 : 0;
    out[i * 2] = src[k * 2] + (Math.random() - 0.5) * dup;
    out[i * 2 + 1] = src[k * 2 + 1] + (Math.random() - 0.5) * dup;
  }
  return out;
}

/** Детерминированный шум по номеру точки: облако вспышки выходит одним
    и тем же при каждой сборке, а не новым на каждый ресайз. */
const hash = (i: number) => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** Сколько раз делится каждое ребро икосаэдра. 8 (три деления пополам)
    было крупно, 16 (четыре) — снаружи сливалось в шум, а изнутри на ребре
    оставалось три-четыре точки; 12 — треугольники видны и на аллее,
    и изнутри (Илья, 2026-10-18). */
const FREQ = 12;

/** Узлы и рёбра геодезической сферы: каждая грань икосаэдра поделена на
    FREQ² треугольников и спроецирована на шар — 1442 узла, 4320 рёбер,
    2880 треугольников; вокруг узла шесть треугольников складываются
    в шестиугольник. Считается однажды. */
let geodesic: { v: number[][]; e: [number, number][] } | null = null;
function geodesicSphere() {
  if (geodesic) return geodesic;
  const t = (1 + Math.sqrt(5)) / 2;
  const norm = (p: number[]) => {
    const l = Math.hypot(p[0], p[1], p[2]);
    return [p[0] / l, p[1] / l, p[2] / l];
  };
  const ico = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ];
  const faces = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  const v: number[][] = [];
  const index = new Map<string, number>();
  // Узлы на общих рёбрах граней совпадают — склеиваем по координатам.
  const node = (p: number[]) => {
    const q = norm(p);
    const key = q.map((x) => Math.round(x * 1e5)).join(",");
    const hit = index.get(key);
    if (hit !== undefined) return hit;
    v.push(q);
    index.set(key, v.length - 1);
    return v.length - 1;
  };
  const edges = new Map<string, [number, number]>();
  const link = (a: number, b: number) => {
    const key = a < b ? `${a}_${b}` : `${b}_${a}`;
    if (!edges.has(key)) edges.set(key, [a, b]);
  };
  for (const [ia, ib, ic] of faces) {
    const A = ico[ia];
    const B = ico[ib];
    const C = ico[ic];
    const at = (i: number, j: number) => {
      const k = FREQ - i - j;
      return node([
        (A[0] * k + B[0] * i + C[0] * j) / FREQ,
        (A[1] * k + B[1] * i + C[1] * j) / FREQ,
        (A[2] * k + B[2] * i + C[2] * j) / FREQ,
      ]);
    };
    for (let i = 0; i < FREQ; i++) {
      for (let j = 0; j < FREQ - i; j++) {
        const p = at(i, j);
        const pi = at(i + 1, j);
        const pj = at(i, j + 1);
        link(p, pi);
        link(p, pj);
        link(pi, pj);
      }
    }
  }
  geodesic = { v, e: [...edges.values()] };
  return geodesic;
}

/**
 * Сфера-сетка: узлы и рёбра геодезической сферы, выложенные точками.
 * Точек на ребре — по его длине, ровно по дуге: шаг одинаковый по всей
 * сфере, а не «как с блюдца просыпалось». На этих же точках проступает
 * кадр проекта. Раскрываясь, сетка остаётся той же, только расходится —
 * точки раздвигают пространство между собой (Илья, 2026-10-18). Изнутри
 * остаются узлы и каждая вторая точка рёбер, по порядку.
 * Порядок точек от размера не зависит: i-я точка малой сферы и раскрытой —
 * одна и та же, поэтому раскрытие — чистое растяжение.
 */
export function sphereShape(r: number, cz: number, h: number, n: number): Shape {
  const R = r * h;
  const { v, e } = geodesicSphere();
  const out = new Float32Array(n * 2);
  const z = new Float32Array(n);
  const keep = new Float32Array(n);
  const put = (i: number, p: number[], k: number) => {
    out[i * 2] = p[0] * R;
    out[i * 2 + 1] = p[1] * R;
    z[i] = p[2] * R;
    keep[i] = k;
  };
  let i = 0;
  for (const p of v) {
    if (i >= n) break;
    put(i++, p, 1);
  }
  // Шаг по дуге — из бюджета точек на все рёбра разом.
  const arcs = e.map(([a, b]) => Math.acos(Math.min(1, v[a][0] * v[b][0] + v[a][1] * v[b][1] + v[a][2] * v[b][2])));
  const total = arcs.reduce((s, x) => s + x, 0);
  const step = total / Math.max(1, n - i + e.length);
  e.forEach(([a, b], j) => {
    const th = arcs[j];
    const m = Math.max(1, Math.round(th / step)) - 1;
    const sn = Math.sin(th) || 1;
    for (let k = 1; k <= m && i < n; k++) {
      const t = k / (m + 1);
      const wa = Math.sin((1 - t) * th) / sn;
      const wb = Math.sin(t * th) / sn;
      const A = v[a];
      const B = v[b];
      put(i++, [A[0] * wa + B[0] * wb, A[1] * wa + B[1] * wb, A[2] * wa + B[2] * wb], k % 2 === 0 ? 1 : 0.5);
    }
  });
  // Остаток бюджета — по узлам, чтобы число точек сошлось.
  for (let k = 0; i < n; k++) put(i++, v[k % v.length], 1);
  return { points: out, z, keep, cz: cz * h, halfW: R, halfH: R };
}

/**
 * Вспышка: та же надпись, раздутая в облако — каждая точка ушла в свою
 * сторону в объёме. Так имя раскрывается в комнату «обо мне»: облако
 * остаётся позади текста, а не исчезает.
 */
export function burstShape(a: Shape): Shape {
  const n = a.points.length / 2;
  const out = new Float32Array(n * 2);
  const z = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const th = hash(i * 3 + 1) * Math.PI * 2;
    const ph = Math.acos(2 * hash(i * 3 + 2) - 1);
    const far = 220 + hash(i * 3 + 3) * 900;
    out[i * 2] = a.points[i * 2] + Math.sin(ph) * Math.cos(th) * far;
    out[i * 2 + 1] = a.points[i * 2 + 1] + Math.sin(ph) * Math.sin(th) * far * 0.6;
    z[i] = Math.cos(ph) * far;
  }
  return { points: out, z, halfW: a.halfW, halfH: a.halfH };
}

/** Любая форма, кроме первой, — уже подогнанная под n точек. */
export async function buildShape(spec: ShapeSpec, w: number, h: number, n: number): Promise<Shape> {
  if (spec.kind === "sphere") return sphereShape(spec.r, spec.cz ?? 0, h, n);
  const s = await textShape(spec.text, w, h, false);
  return { points: resample(s.points, n), halfW: s.width / 2, halfH: s.height / 2 };
}
