#!/usr/bin/env node
/**
 * Видеотур по странице — чтобы работу было видно с телефона.
 *
 * Скриншот не показывает главного: как материал тянется за рукой
 * и как частицы расходятся под курсором. Здесь браузер водит мышью
 * сам, пишет видео и отдаёт mp4, который открывается где угодно.
 *
 *   npm run dev            # в одном окне
 *   npm run tour           # в другом
 *   npm run tour -- --mobile --out=shots/mobile.mp4
 *
 * Флаги:
 *   --url=      что открыть            (http://localhost:3210)
 *   --out=      куда положить mp4      (shots/tour.mp4)
 *   --w= --h=   размер окна            (1440×900)
 *   --mobile    390×844, тач
 *   --keep-webm оставить исходник playwright рядом с mp4
 */

import { chromium, devices } from "playwright";
import { mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const flag = (name) => process.argv.includes(`--${name}`);

const url = arg("url", "http://localhost:3210");
const mobile = flag("mobile");
const out = resolve(arg("out", mobile ? "shots/tour-mobile.mp4" : "shots/tour.mp4"));
const W = mobile ? 390 : Number(arg("w", 1440));
const H = mobile ? 844 : Number(arg("h", 900));

const tmp = join(dirname(out), ".video-tmp");

/** Плавный проход мыши: playwright ставит точки, между ними интерполирует. */
async function glide(page, from, to, steps = 45, pause = 12) {
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    // Мягкий вход и выход, иначе движение выглядит машинным.
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    await page.mouse.move(from[0] + (to[0] - from[0]) * e, from[1] + (to[1] - from[1]) * e);
    await page.waitForTimeout(pause);
  }
}

async function circle(page, cx, cy, r, turns = 1.25, steps = 90) {
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2 * turns;
    await page.mouse.move(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.55);
    await page.waitForTimeout(12);
  }
}

const toMp4 = (src, dst) =>
  new Promise((ok, fail) => {
    // yuv420p и чётные размеры обязательны: без них видео не откроется
    // в галерее телефона, хотя ffmpeg отработает без ошибок.
    const ff = spawn("ffmpeg", [
      "-y", "-i", src,
      "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "26",
      "-pix_fmt", "yuv420p", "-movflags", "+faststart",
      dst,
    ], { stdio: "ignore" });
    ff.on("error", fail);
    ff.on("close", (code) => (code === 0 ? ok() : fail(new Error(`ffmpeg вышел с кодом ${code}`))));
  });

const run = async () => {
  await mkdir(tmp, { recursive: true });
  await mkdir(dirname(out), { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    ...(mobile ? devices["iPhone 13"] : { viewport: { width: W, height: H } }),
    recordVideo: { dir: tmp, size: { width: W, height: H } },
    deviceScaleFactor: 1,
    reducedMotion: "no-preference",
  });

  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto(url, { waitUntil: "networkidle" });

  // Сбор облака — это часть показа, поэтому просто ждём и смотрим.
  await page.waitForTimeout(2600);

  if (mobile) {
    // На тач-устройстве мыши нет: показываем касанием и прокруткой.
    await page.touchscreen.tap(W / 2, H * 0.45);
    await page.waitForTimeout(1200);
    for (let i = 0; i < 12; i++) {
      await page.mouse.wheel(0, 110);
      await page.waitForTimeout(60);
    }
    await page.waitForTimeout(2600);
    for (let i = 0; i < 12; i++) {
      await page.mouse.wheel(0, -110);
      await page.waitForTimeout(60);
    }
    await page.waitForTimeout(1800);
  } else {
    // 1. Просто водим: рой догоняет руку и промахивается.
    await glide(page, [W * 0.04, H * 0.75], [W * 0.3, H * 0.45], 40);
    await glide(page, [W * 0.3, H * 0.45], [W * 0.78, H * 0.44], 55, 13);
    await circle(page, W * 0.5, H * 0.45, W * 0.2);
    await page.waitForTimeout(500);

    // 2. Зажали и тянем: рой разгоняется, штрихи вытягиваются,
    //    сцена кренится, слово расходится.
    await page.mouse.move(W * 0.5, H * 0.5);
    await page.mouse.down();
    await glide(page, [W * 0.5, H * 0.5], [W * 0.22, H * 0.3], 40, 15);
    await glide(page, [W * 0.22, H * 0.3], [W * 0.8, H * 0.62], 55, 14);
    await glide(page, [W * 0.8, H * 0.62], [W * 0.45, H * 0.42], 35, 15);
    await page.mouse.up();
    // 3. Отпустили — инерция и возврат.
    await page.waitForTimeout(1600);

    await glide(page, [W * 0.45, H * 0.42], [W * 0.09, H * 0.87], 45);
    await page.waitForTimeout(500);
    await glide(page, [W * 0.09, H * 0.87], [W * 0.2, H * 0.87], 25, 20);
    await page.waitForTimeout(700);

    /* 4. Маршрут: летим ко второй точке. Колесо здесь двигает камеру,
          а не прокручивает документ.

          Ровно одна точка — это 900 пикселей колеса (`pxPerStop` в journey.ts),
          то есть десять щелчков по 90. Прежние четырнадцать проскакивали
          дальше: пока точек было три, лишнее съедал предел маршрута, а с
          появлением контактов камера стала зависать между точками, и
          невидимый слой контактов перехватывал нажатие на плитку. */
    await page.mouse.move(W * 0.55, H * 0.5);
    for (let i = 0; i < 10; i++) {
      await page.mouse.wheel(0, 90);
      await page.waitForTimeout(55);
    }
    await page.waitForTimeout(2200);
    await glide(page, [W * 0.55, H * 0.5], [W * 0.3, H * 0.62], 35);
    await page.waitForTimeout(900);

    // 5. Третья точка: проекты.
    for (let i = 0; i < 10; i++) {
      await page.mouse.wheel(0, 90);
      await page.waitForTimeout(55);
    }
    await page.waitForTimeout(2600);
    await glide(page, [W * 0.3, H * 0.62], [W * 0.6, H * 0.45], 40);
    await page.waitForTimeout(1200);

    // 6. Плитка проекта: под рукой обложка оживает, по нажатию открывается
    //    страница проекта. Кнопки в туре нажимаются с 2026-09-16 — без этого
    //    мёртвую ссылку на ролике было не отличить от живой.
    const tile = page.locator("main a[href^='/work/']").first();
    const box = (await tile.count()) ? await tile.boundingBox() : null;
    if (box) {
      await glide(page, [W * 0.6, H * 0.45], [box.x + box.width / 2, box.y + box.height * 0.45], 35);
      // Пауза длиннее смены кадра обложки: иначе слайд-шоу не видно.
      await page.waitForTimeout(3000);
      await tile.click();
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(1400);

      // На странице проекта прокрутка обычная: маршрут её не перехватывает.
      for (let i = 0; i < 26; i++) {
        await page.mouse.wheel(0, 150);
        await page.waitForTimeout(60);
      }
      await page.waitForTimeout(1200);

      // 7. Назад к маршруту — облако собирается заново, с нуля.
      await page.goBack({ waitUntil: "networkidle" });
      await page.waitForTimeout(3000);

      // 8. Клавиатурой до контактов: маршрут слушает PageDown, и после
      //    возврата это самый короткий путь к последней точке.
      for (let i = 0; i < 3; i++) {
        await page.keyboard.press("PageDown");
        await page.waitForTimeout(2300);
      }
      await page.waitForTimeout(1600);
    } else {
      // Плитки нет — возвращаемся к заголовку колесом, как раньше.
      for (let i = 0; i < 28; i++) {
        await page.mouse.wheel(0, -90);
        await page.waitForTimeout(45);
      }
      await page.waitForTimeout(2200);
    }
  }

  await page.waitForTimeout(600);
  const video = page.video();
  await context.close();
  await browser.close();

  const raw = video ? await video.path() : null;
  if (!raw || !existsSync(raw)) throw new Error("playwright не отдал видеофайл");

  await toMp4(raw, out);
  if (!flag("keep-webm")) await rm(tmp, { recursive: true, force: true });

  console.log(`видео: ${out}  (${W}×${H}${mobile ? ", мобильный" : ""})`);
  console.log(errors.length ? `ОШИБКИ СТРАНИЦЫ: ${errors.join(" | ")}` : "ошибок страницы нет");
};

run().catch((e) => {
  console.error("тур не снялся:", e.message);
  process.exit(1);
});
