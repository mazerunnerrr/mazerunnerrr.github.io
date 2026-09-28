/**
 * Объекты-герои маршрута.
 *
 * Мир один: те же точки, что складываются в имя, на каждой следующей точке
 * маршрута пересобираются в новый объект. Поэтому у всех форм обязано быть
 * одинаковое число точек — первая форма задаёт его, остальные подгоняются
 * под него пересэмплированием.
 *
 * Координаты — пиксели от центра экрана, Y вверх, как у sampleText.
 */

import { sampleText } from "@/lib/textParticles";

export type ShapeSpec =
  | { kind: "text"; text: string }
  /** Узлы-кольца, по одному на направление: объект точки «Что делаю». */
  | { kind: "rings"; count: number };

export type Shape = {
  points: Float32Array;
  /** Полуширина формы: по ней шейдер ведёт очередь на оборот слева направо. */
  halfW: number;
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
 * Раскладка колец-узлов. Общая для частиц и для выносок на странице: подписи
 * должны стоять ровно у своих колец, поэтому геометрия считается в одном месте.
 * Для четырёх — сетка 2×2, иначе ряд. Координаты — от центра экрана, Y вверх.
 */
export function ringLayout(count: number, w: number, h: number) {
  const c = Math.max(1, count);
  const cols = c === 4 ? 2 : c;
  const rows = Math.ceil(c / cols);
  const R = Math.min(w, h) * 0.075;
  const gx = Math.min(w * 0.2, R * 4.4);
  const gy = Math.min(h * 0.22, R * 3.8);
  const centers = Array.from({ length: c }, (_, i): [number, number] => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    return [(col - (cols - 1) / 2) * gx, ((rows - 1) / 2 - row) * gy];
  });
  return { R, gx, cols, centers };
}

/**
 * Кольца-узлы. Большая часть точек лежит на окружности, остальные — редкой
 * пылью внутри: пустое кольцо читается чертежом, сплошной диск — пятном.
 */
export function ringsShape(count: number, w: number, h: number, n: number): Shape {
  const { R, gx, cols, centers } = ringLayout(count, w, h);
  const c = centers.length;
  const out = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const [cx, cy] = centers[i % c];
    const a = Math.random() * Math.PI * 2;
    // Гауссов разброс толщины: край кольца мягкий, но линия читается.
    const g = Math.sqrt(-2 * Math.log(Math.random() + 1e-6)) * Math.cos(Math.random() * Math.PI * 2);
    const r = Math.random() < 0.84 ? R * (1 + g * 0.05) : R * Math.sqrt(Math.random()) * 0.92;
    out[i * 2] = cx + Math.cos(a) * r;
    out[i * 2 + 1] = cy + Math.sin(a) * r;
  }
  return { points: out, halfW: ((cols - 1) * gx) / 2 + R };
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

/** Любая форма, кроме первой, — уже подогнанная под n точек. */
export async function buildShape(spec: ShapeSpec, w: number, h: number, n: number): Promise<Shape> {
  if (spec.kind === "rings") return ringsShape(spec.count, w, h, n);
  const s = await textShape(spec.text, w, h, false);
  return { points: resample(s.points, n), halfW: s.width / 2 };
}
