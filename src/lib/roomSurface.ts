import * as THREE from "three";
import { GLOW_FRAG, SHADE_FRAG, SURFACE_FRAG, SURFACE_VERT } from "@/lib/shaders";

/**
 * Комната проекта в сцене (Илья, 2026-10-21, по образцу Active Theory): экран
 * проекта рисуется не вёрсткой поверх канваса, а плоскостью в самой сцене —
 * по нему идёт след руки (преломление и зерно), комнату освещает его свет. Вёрстка остаётся на месте и задаёт раскладку: она меряет, где лежит
 * экран (`RoomLayout`), а сама прячется (`:root[data-gl]` в CSS). Без WebGL
 * экран показывает вёрстка, как раньше.
 *
 * Координаты сцены — пиксели: при камере на `baseZ` плоскость z = 0 видна
 * один к одному, начало в центре окна, Y вверх.
 */

type Box = { x: number; y: number; w: number; h: number };

/** Где лежит экран комнаты: CSS-пиксели от левого верхнего угла окна, без наклона. */
export type RoomLayout = { frame: Box };

/** Кадры проекта — те же текстуры, что у его сферы. */
export type MediaUniforms = {
  uTex0: { value: THREE.Texture | null };
  uTex1: { value: THREE.Texture | null };
  uTexMix: { value: number };
  uTexAspect: { value: number };
};

type WaterUniforms = { uWaterTex: { value: THREE.Texture }; uWaterMap: { value: THREE.Vector4 } };

/** Насколько вода сдвигает экран — в долях её сдвига у фона: капля преломляет сильнее. */
const RIPPLE = 2;
/** Глубина комнаты — тёмная синева темнее фона аллеи (#0b1633), без примесей:
    числа sRGB, шейдер пишет их на экран как есть. */
const DEEP = new THREE.Color().setRGB(0.02, 0.043, 0.125);
/** Скругление углов экрана, CSS-пиксели. */
export const RADIUS = 18;
/** Наклон экрана к руке, градусы: у Active Theory он заметный. */
const TILT_Y = 4.5;
const TILT_X = 3;

const DEG = Math.PI / 180;

export class RoomSurfaces {
  private screenMesh: THREE.Mesh;
  private shade: THREE.Mesh;
  private px = { value: new THREE.Vector2(1, 1) };
  private u;
  private shadeU;
  private layouts = new Map<number, RoomLayout>();

  constructor(scene: THREE.Scene, water: WaterUniforms) {
    this.u = {
      uTex0: { value: null as THREE.Texture | null },
      uTex1: { value: null as THREE.Texture | null },
      uTexMix: { value: 0 },
      uScale: { value: new THREE.Vector2(1, 1) },
      uSize: { value: new THREE.Vector2(1, 1) },
      uRipple: { value: RIPPLE },
      uAlpha: { value: 0 },
      uRadius: { value: RADIUS },
      uScreen: this.px,
      ...water,
    };
    this.shadeU = {
      uColor: { value: DEEP },
      uAmt: { value: 0 },
      uTex0: { value: null as THREE.Texture | null },
      uLit: { value: 0 },
      uFrame: { value: new THREE.Vector4(0.3, 0.3, 0.7, 0.7) },
      uScreen: this.px,
      ...water,
    };
    const mat = (fragmentShader: string, uniforms: Record<string, THREE.IUniform>, premultipliedAlpha = false) =>
      new THREE.ShaderMaterial({
        vertexShader: SURFACE_VERT,
        fragmentShader,
        uniforms,
        transparent: true,
        premultipliedAlpha,
        depthTest: false,
        depthWrite: false,
      });
    // Над фоном и под точками: фон уходит в глубину, стенка сферы светится на нём.
    this.shade = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat(SHADE_FRAG, this.shadeU, true));
    this.shade.renderOrder = -0.8;
    this.screenMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat(SURFACE_FRAG, this.u));
    this.screenMesh.renderOrder = 6;
    for (const m of [this.shade, this.screenMesh]) {
      m.frustumCulled = false;
      m.visible = false;
      scene.add(m);
    }
  }

  resize(w: number, h: number, dpr: number) {
    this.px.value.set(w * dpr, h * dpr);
    this.shade.scale.set(w, h, 1);
  }

  /** Вёрстка комнаты измерилась (открыли, сменился размер). */
  layout(k: number, l: RoomLayout | null) {
    if (l) this.layouts.set(k, l);
    else this.layouts.delete(k);
  }

  /**
   * Каждый кадр. `k` — чья комната видна (null — ничья), `alpha` — насколько
   * она проявилась, как и её вёрстка; `tx`, `ty` — рука, −1..1 от центра окна.
   */
  update(
    k: number | null,
    alpha: number,
    tx: number,
    ty: number,
    media: MediaUniforms | null,
    w: number,
    h: number
  ) {
    const l = k === null ? undefined : this.layouts.get(k);
    const on = !!l && alpha > 0.002;
    const tex = media?.uTex0.value ?? null;
    this.shade.visible = on;
    this.screenMesh.visible = on && !!tex;
    if (!on || !l) return;

    // Экран: на месте вёрстки, наклонён к руке.
    const f = l.frame;
    this.screenMesh.position.set(f.x + f.w / 2 - w / 2, h / 2 - (f.y + f.h / 2), 0);
    this.screenMesh.scale.set(f.w, f.h, 1);
    // Лицом к руке, как у Active Theory: ближе к зрителю тот край, где курсор.
    this.screenMesh.rotation.set(-ty * TILT_X * DEG, -tx * TILT_Y * DEG, 0);
    const u = this.u;
    u.uSize.value.set(f.w, f.h);
    u.uAlpha.value = alpha;
    if (media) {
      u.uTex0.value = media.uTex0.value;
      u.uTex1.value = media.uTex1.value;
      u.uTexMix.value = media.uTexMix.value;
      // Как object-fit: cover — лишнее по длинной стороне срезается.
      const ta = media.uTexAspect.value;
      const pa = f.w / Math.max(f.h, 1);
      u.uScale.value.set(Math.min(1, pa / ta), Math.min(1, ta / pa));
    }

    // Комната: глубина и свет экрана на стенах.
    const s = this.shadeU;
    s.uAmt.value = alpha;
    s.uTex0.value = tex;
    s.uLit.value = tex ? 1 : 0;
    s.uFrame.value.set(f.x / w, 1 - (f.y + f.h) / h, (f.x + f.w) / w, 1 - f.y / h);
  }

  dispose() {
    for (const o of [this.shade, this.screenMesh]) {
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
  }
}

/** Кадр проекта внутри сферы. Текстуры — те же объекты, что у её точек:
    скриншоты сменяются и видео идёт синхронно с ними. */
export const sphereGlow = (scene: THREE.Scene, media: MediaUniforms) => {
  const u = {
    uTex0: media.uTex0,
    uTex1: media.uTex1,
    uTexMix: media.uTexMix,
    uScale: { value: new THREE.Vector2(1, 1) },
    uAmt: { value: 0 },
  };
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.ShaderMaterial({
      vertexShader: SURFACE_VERT,
      fragmentShader: GLOW_FRAG,
      uniforms: u,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    })
  );
  mesh.frustumCulled = false;
  mesh.visible = false;
  // Под сеткой: сетка рисуется поверх свечения.
  mesh.renderOrder = -0.5;
  scene.add(mesh);
  return { mesh, u };
};
