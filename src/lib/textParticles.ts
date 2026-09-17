/**
 * Текст → облако точек.
 *
 * Ход не такой, как у Three.js TextGeometry: там буквы превращают
 * в меш и сэмплируют лучами, из-за чего нужен шрифт, заранее
 * сконвертированный в typeface.json — а в готовых (helvetiker,
 * optimer, montserrat) кириллицы нет ни одного глифа.
 *
 * Здесь текст рисуется обычным шрифтом на невидимом 2D-канвасе,
 * после чего частицы ставятся по непрозрачным пикселям. Работает
 * с любым шрифтом и любым алфавитом, конвертация не нужна.
 */

export type SampleOptions = {
  lines: string[];
  /** Размер шрифта в пикселях итогового канваса. */
  fontSize: number;
  /** CSS-описание шрифта после размера, например '300 «Cormorant», serif'. */
  fontFamily: string;
  fontWeight?: string;
  lineHeight?: number;
  /** Шаг сетки в пикселях: меньше — плотнее облако и тяжелее кадр. */
  step?: number;
  /** Доля случайного смещения внутри клетки, 0..1. Без него видна сетка. */
  jitter?: number;
};

export type Sampled = {
  /** Позиции в пикселях, начало координат — центр текста, Y вверх. */
  points: Float32Array;
  count: number;
  width: number;
  height: number;
};

/**
 * Разворачивает CSS-переменную в настоящее имя семейства.
 *
 * Canvas НЕ понимает var(): строка `300 89px var(--font-cormorant)`
 * для него невалидна целиком, и он молча оставляет дефолт — 10px
 * sans-serif. Облако собиралось из текста в десять пикселей.
 * getComputedStyle делает эту работу за нас.
 */
export function resolveFamily(cssFamily: string): string {
  if (typeof document === "undefined") return cssFamily;
  const probe = document.createElement("span");
  probe.style.cssText = "position:absolute;visibility:hidden;pointer-events:none";
  probe.style.fontFamily = cssFamily;
  document.body.appendChild(probe);
  const resolved = getComputedStyle(probe).fontFamily;
  probe.remove();
  return resolved || cssFamily;
}

/** Шрифт должен быть готов до замера: иначе рисуется фолбэк и метрики врут. */
export async function ensureFont(font: string): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return;
  try {
    await document.fonts.load(font);
    await document.fonts.ready;
  } catch {
    /* Фолбэк — не повод падать: облако просто соберётся по системному шрифту. */
  }
}

export async function sampleText(o: SampleOptions): Promise<Sampled> {
  const {
    lines,
    fontSize,
    fontFamily,
    fontWeight = "300",
    lineHeight = 1.06,
    step = 4,
    jitter = 0.5,
  } = o;

  const font = `${fontWeight} ${fontSize}px ${resolveFamily(fontFamily)}`;
  await ensureFont(font);

  const measure = document.createElement("canvas").getContext("2d");
  if (!measure) return { points: new Float32Array(0), count: 0, width: 0, height: 0 };
  measure.font = font;

  const widths = lines.map((l) => measure.measureText(l).width);
  const lh = Math.round(fontSize * lineHeight);
  const pad = Math.ceil(fontSize * 0.35);
  const w = Math.ceil(Math.max(...widths)) + pad * 2;
  const h = lh * lines.length + pad * 2;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { points: new Float32Array(0), count: 0, width: 0, height: 0 };

  ctx.font = font;
  ctx.fillStyle = "#fff";
  ctx.textBaseline = "middle";
  lines.forEach((line, i) => {
    ctx.fillText(line, pad, pad + lh * i + lh / 2);
  });

  const data = ctx.getImageData(0, 0, w, h).data;
  const out: number[] = [];
  const cx = w / 2;
  const cy = h / 2;

  // Шаг обязан быть целым. При дробном индекс в data[] тоже дробный,
  // чтение даёт undefined, а `undefined < 128` — это false: проверка
  // молча выключается, и облако заливает весь прямоугольник целиком.
  const s = Math.max(1, Math.round(step));

  for (let y = 0; y < h; y += s) {
    for (let x = 0; x < w; x += s) {
      // Порог по альфе, а не по яркости: сглаженные края букв дают
      // полупрозрачные пиксели, и по ним облако выглядит обтрёпанным.
      if (data[(y * w + x) * 4 + 3] < 128) continue;
      const jx = (Math.random() - 0.5) * s * jitter;
      const jy = (Math.random() - 0.5) * s * jitter;
      out.push(x - cx + jx, cy - y + jy);
    }
  }

  const points = new Float32Array(out);
  return { points, count: out.length / 2, width: w, height: h };
}
