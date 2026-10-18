/**
 * Среда маршрута — то, что даёт сайту повествование, а не слайды на одном
 * неподвижном фоне (просьба Ильи 2026-10-16):
 *
 * - пыль в глубине летит навстречу с прокруткой: чувствуешь, что движешься;
 * - между точками пролетаешь сквозь ориентиры: перед проектами — ворота
 *   с подписью, на остальных переходах — арки;
 * - у каждой точки свой свет главы (он живёт в шейдере фона, здесь только
 *   смешивание по положению на маршруте).
 *
 * В покое ориентиров не видно: стоящий за объектом обод читался бы с ним
 * одним знаком, как кольца рядом с именем («88 Helias»). Они проступают,
 * только пока маршрут в движении.
 */

import * as THREE from "three";
import { DUST_FRAG, DUST_VERT } from "@/lib/shaders";

/** Свет главы: подсветка с одной стороны экрана внутри полночного синего. */
export type ChapterLight = {
  color: string;
  /** Сила, 0..1. Держать малой: свет — настроение, а не пятно. */
  amount: number;
  /** Откуда светит: направление от центра к краю экрана, Y вверх. */
  dir: [number, number];
};

/** Ориентир на переходе: `at` — где он на маршруте, например 1.5 — между
    второй и третьей точкой. */
export type Landmark = { at: number; kind: "gate" | "arcs" };

/** Ориентир на экране: радиус в пикселях и видимость — для подписи у ворот. */
export type MarkFrame = { r: number; vis: number };

type Uniform<T> = { value: T };
type Shared = {
  uTime: Uniform<number>;
  uPixelRatio: Uniform<number>;
  uCamZ: Uniform<number>;
  uBaseZ: Uniform<number>;
  uSand: Uniform<THREE.Color>;
  uAzure: Uniform<THREE.Color>;
};

/** Сколько пылинок. Их видно краем глаза, гуще — и они спорят с объектом. */
const DUST = 2600;
/** Сколько глубины пыли проходит одна точка маршрута, в долях расстояния до экрана. */
const DUST_STEP = 1.6;
/** Глубина ориентира на расстоянии в одну точку маршрута, в тех же долях:
    на полпути к нему он ещё вдали, к середине перехода — проходишь насквозь. */
const MARK_STEP = 5;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Где место `at` на кольце из n точек относительно положения p:
    минус — ещё впереди, плюс — уже позади, в пределах (−n/2, n/2]. */
export const ringOffset = (p: number, at: number, n: number) => {
  let d = (((p - at) % n) + n) % n;
  if (d > n / 2) d -= n;
  return d;
};

/** Кольцо точек в плоскости экрана, с толщиной в пару процентов. */
function ring(out: number[], R: number, count: number, from = 0, span = Math.PI * 2) {
  for (let i = 0; i < count; i++) {
    const a = from + (span * i) / count + (Math.random() - 0.5) * 0.004;
    const r = R * (1 + (Math.random() - 0.5) * 0.02);
    out.push(Math.cos(a) * r, Math.sin(a) * r, (Math.random() - 0.5) * 12);
  }
}

/** Ворота — два кольца с рисками, как шкала прибора. Арки — три дуги:
    видно, что это проход, но не путаешь с воротами раздела. */
function markShape(kind: Landmark["kind"], h: number) {
  const out: number[] = [];
  if (kind === "gate") {
    ring(out, h * 0.42, 1700);
    ring(out, h * 0.47, 1900);
    for (let t = 0; t < 48; t++) {
      const a = (t / 48) * Math.PI * 2;
      const long = t % 4 === 0 ? 0.08 : 0.04;
      for (let i = 0; i < 12; i++) {
        const r = h * (0.47 + (long * i) / 12);
        out.push(Math.cos(a) * r, Math.sin(a) * r, 0);
      }
    }
  } else {
    for (let k = 0; k < 3; k++) ring(out, h * 0.56, 700, (k * Math.PI * 2) / 3 + 0.3, Math.PI * 0.55);
  }
  return new Float32Array(out);
}

type Mark = { points: THREE.Points; u: Record<string, Uniform<number>>; at: number; R: number; bright: number };

export class Environment {
  readonly marksOnScreen: MarkFrame[];
  private dust: THREE.Points | null = null;
  private dustU: Record<string, Uniform<number>> | null = null;
  private marks: Mark[] = [];

  constructor(
    private scene: THREE.Scene,
    private shared: Shared,
    private landmarks: Landmark[],
    private stops: number
  ) {
    this.marksOnScreen = landmarks.map(() => ({ r: 0, vis: 0 }));
  }

  private material(u: Record<string, Uniform<number>>) {
    return new THREE.ShaderMaterial({
      vertexShader: DUST_VERT,
      fragmentShader: DUST_FRAG,
      uniforms: { ...this.shared, ...u },
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
  }

  private add(positions: Float32Array, u: Record<string, Uniform<number>>) {
    const n = positions.length / 3;
    const seed = new Float32Array(n);
    for (let i = 0; i < n; i++) seed[i] = Math.random();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute("aPos", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    const points = new THREE.Points(geo, this.material(u));
    points.frustumCulled = false;
    // Среда — позади объектов точек.
    points.renderOrder = -1;
    this.scene.add(points);
    return points;
  }

  build(w: number, h: number, baseZ: number) {
    this.dispose();
    const len = this.stops * DUST_STEP * baseZ;
    const pos = new Float32Array(DUST * 3);
    const span = Math.max(w, h);
    for (let i = 0; i < DUST; i++) {
      // Пустота у оси: пылинка, летящая прямо в центр, ложится на объект.
      const a = Math.random() * Math.PI * 2;
      const r = span * (0.14 + Math.pow(Math.random(), 0.7) * 1.5);
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = Math.sin(a) * r * 0.7;
      pos[i * 3 + 2] = Math.random() * len;
    }
    this.dustU = {
      uShift: { value: 0 },
      uLen: { value: len },
      uWrap: { value: 1 },
      uZ: { value: 0 },
      uFar: { value: len },
      uAlpha: { value: 0 },
      uSpeed: { value: 0 },
    };
    this.dust = this.add(pos, this.dustU);

    this.marks = this.landmarks.map((m) => {
      const u = {
        uShift: { value: 0 },
        uLen: { value: 1 },
        uWrap: { value: 0 },
        uZ: { value: -1e5 },
        uFar: { value: MARK_STEP * baseZ * 0.55 },
        uAlpha: { value: 0 },
        uSpeed: { value: 0 },
      };
      // Ворота раздела ярче арок: это событие, а не просто проход.
      const gate = m.kind === "gate";
      return { points: this.add(markShape(m.kind, h), u), u, at: m.at, R: h * (gate ? 0.47 : 0.56), bright: gate ? 1.4 : 0.6 };
    });
  }

  /** @param room насколько раскрыта комната: в ней среда притихает. */
  update(progress: number, speed: number, room: number, baseZ: number, camZ: number) {
    if (this.dustU) {
      this.dustU.uShift.value = progress * DUST_STEP * baseZ;
      this.dustU.uSpeed.value = speed * 0.6;
      // В комнате пыль гаснет почти совсем: внутри сферы её случайный
      // разброс мешал увидеть ровную сетку.
      this.dustU.uAlpha.value = 0.55 * (1 - room * 0.95);
    }
    // Ориентиры видны только в движении: в покое на точке их нет.
    const frac = progress - Math.floor(progress);
    const motion = smooth(0.04, 0.18, Math.min(frac, 1 - frac)) * (1 - room);
    this.marks.forEach((m, i) => {
      const z = camZ + ringOffset(progress, m.at, this.stops) * MARK_STEP * baseZ;
      m.u.uZ.value = z;
      m.u.uAlpha.value = motion * m.bright;
      const depth = camZ - z;
      const far = 1 - smooth(m.u.uFar.value * 0.55, m.u.uFar.value, depth);
      const near = smooth(baseZ * 0.06, baseZ * 0.3, depth);
      this.marksOnScreen[i].r = (m.R * baseZ) / Math.max(depth, 1);
      this.marksOnScreen[i].vis = motion * far * near;
    });
  }

  dispose() {
    for (const p of [this.dust, ...this.marks.map((m) => m.points)]) {
      if (!p) continue;
      this.scene.remove(p);
      p.geometry.dispose();
      (p.material as THREE.Material).dispose();
    }
    this.dust = null;
    this.dustU = null;
    this.marks = [];
  }
}

/** Свет главы на положении маршрута: между точками свет переливается
    из одного в другой, на точке — её собственный. */
export function chapterLight(lights: (ChapterLight | undefined)[], progress: number) {
  const n = lights.length;
  const k = ((Math.floor(progress) % n) + n) % n;
  const a = lights[k];
  const b = lights[(k + 1) % n];
  const t = smooth(0.2, 0.8, progress - Math.floor(progress));
  const ca = new THREE.Color(a?.color ?? "#000000");
  const cb = new THREE.Color(b?.color ?? "#000000");
  const amount = (a?.amount ?? 0) * (1 - t) + (b?.amount ?? 0) * t;
  const dx = (a?.dir[0] ?? 0) * (1 - t) + (b?.dir[0] ?? 0) * t;
  const dy = (a?.dir[1] ?? 0) * (1 - t) + (b?.dir[1] ?? 0) * t;
  const len = Math.hypot(dx, dy) || 1;
  return { color: ca.lerp(cb, t), amount, dir: [dx / len, dy / len] as [number, number] };
}
