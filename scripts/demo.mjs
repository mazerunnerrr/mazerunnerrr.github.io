#!/usr/bin/env node
/**
 * Длинная демонстрация сцены на полной частоте кадров.
 *
 * Чем отличается от `npm run tour`: тур пишет видео средствами playwright,
 * а те дают 25 кадров в секунду и рисуют программно, без GPU. По такому
 * ролику нельзя судить ни о плавности, ни о времени кадра. Здесь браузер
 * запускается с настоящим GPU (ANGLE/Metal), а видео снимается прямо
 * с канваса через captureStream + MediaRecorder — поток идёт с той
 * частотой, с какой сцена реально рисуется. Выходит около 55 к/с.
 *
 * Плата: в кадре только канвас. Текст, кнопки и шапка лежат поверх него
 * отдельными слоями и в запись не попадают. Для разбора движения это
 * даже чище, для показа вёрстки — бесполезно, там нужен тур.
 *
 *   npm run dev            # в одном окне
 *   npm run demo           # в другом
 *
 * Флаги:
 *   --url=   что открыть          (http://localhost:3210)
 *   --out=   куда положить mp4    (shots/demo.mp4)
 */

import { chromium } from "playwright";
import { writeFile, rm, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const url = arg("url", "http://localhost:3210");
const out = resolve(arg("out", "shots/demo.mp4"));
const raw = `${out}.webm`;
const W = 1440;
const H = 900;

const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=metal", "--enable-gpu", "--disable-frame-rate-limit"],
});
const ctx = await browser.newContext({
  viewport: { width: W, height: H },
  deviceScaleFactor: 1,
  reducedMotion: "no-preference",
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(url, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);

await page.evaluate(() => {
  const canvas = document.querySelector("canvas");
  const rec = new MediaRecorder(canvas.captureStream(60), {
    mimeType: "video/webm;codecs=vp9",
    videoBitsPerSecond: 9_000_000,
  });
  window.__chunks = [];
  rec.ondataavailable = (e) => e.data.size && window.__chunks.push(e.data);
  rec.start(1000);
  window.__rec = rec;
});

/** Плавный проход мыши с мягким входом и выходом. */
const glide = async (from, to, steps, pause) => {
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    await page.mouse.move(from[0] + (to[0] - from[0]) * e, from[1] + (to[1] - from[1]) * e);
    await page.waitForTimeout(pause);
  }
};
const поперёк = (y) => [[W * 0.12, y], [W * 0.88, y]];

// 1. Медленная проводка: мягкий след.
await page.mouse.move(W * 0.12, H * 0.42);
await page.waitForTimeout(900);
await glide(...поперёк(H * 0.42), 80, 28);
await page.waitForTimeout(1600);

// 2. Резкий рывок обратно: разлёт и смаз по скорости.
await glide(...поперёк(H * 0.45).reverse(), 14, 7);
await page.waitForTimeout(1800);

// 3. Три прохода подряд: удары складываются.
for (let k = 0; k < 3; k++) {
  const y = H * (0.4 + k * 0.03);
  await glide(...(k % 2 ? поперёк(y).reverse() : поперёк(y)), 16, 8);
}
await page.waitForTimeout(2600);

// 4. Круги вокруг слова.
for (let i = 0; i <= 140; i++) {
  const a = (i / 140) * Math.PI * 4;
  await page.mouse.move(W * 0.5 + Math.cos(a) * 320, H * 0.44 + Math.sin(a) * 140);
  await page.waitForTimeout(11);
}
await page.waitForTimeout(1800);

// 5. Зажали: медленная раскрутка вправо, удержание без движения, раскрутка влево.
await page.mouse.move(W * 0.35, H * 0.5);
await page.mouse.down();
await glide([W * 0.35, H * 0.5], [W * 0.82, H * 0.5], 64, 22);
await page.waitForTimeout(1800);
await glide([W * 0.82, H * 0.5], [W * 0.14, H * 0.52], 74, 18);
await page.waitForTimeout(1000);
await page.mouse.up();
await page.waitForTimeout(4500);

// 6. Резкая раскрутка с мгновенным отпусканием: хлёсткая отдача.
await page.mouse.move(W * 0.3, H * 0.48);
await page.mouse.down();
await glide([W * 0.3, H * 0.48], [W * 0.88, H * 0.48], 20, 7);
await page.mouse.up();
await page.waitForTimeout(4200);

// 7. Маршрут: две точки вперёд и возврат к заголовку.
await page.mouse.move(W * 0.55, H * 0.5);
for (let i = 0; i < 16; i++) { await page.mouse.wheel(0, 80); await page.waitForTimeout(50); }
await page.waitForTimeout(2200);
for (let i = 0; i < 16; i++) { await page.mouse.wheel(0, 80); await page.waitForTimeout(50); }
await page.waitForTimeout(2000);
for (let i = 0; i < 32; i++) { await page.mouse.wheel(0, -80); await page.waitForTimeout(40); }
await page.waitForTimeout(2600);

const b64 = await page.evaluate(async () => {
  await new Promise((ok) => {
    window.__rec.onstop = ok;
    window.__rec.stop();
  });
  const blob = new Blob(window.__chunks, { type: "video/webm" });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
});

await ctx.close();
await browser.close();

await mkdir(dirname(out), { recursive: true });
await writeFile(raw, Buffer.from(b64, "base64"));

// yuv420p и чётные размеры обязательны: без них видео не откроется
// в галерее телефона, хотя ffmpeg отработает без ошибок.
await new Promise((ok, fail) => {
  const ff = spawn("ffmpeg", [
    "-y", "-i", raw,
    "-c:v", "libx264", "-preset", "medium", "-crf", "24",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart",
    out,
  ], { stdio: "ignore" });
  ff.on("error", fail);
  ff.on("close", (code) => (code === 0 ? ok() : fail(new Error(`ffmpeg вышел с кодом ${code}`))));
});
await rm(raw, { force: true });

console.log(`видео: ${out}  (${W}×${H}, с канваса)`);
console.log(errors.length ? `ОШИБКИ СТРАНИЦЫ: ${errors.join(" | ")}` : "ошибок страницы нет");
