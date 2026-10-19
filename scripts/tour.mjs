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

    const wheel = async (clicks) => {
      for (let i = 0; i < Math.abs(clicks); i++) {
        await page.mouse.wheel(0, Math.sign(clicks) * 90);
        await page.waitForTimeout(55);
      }
    };

    // 4. Нажатие на имя — комната «обо мне»: имя раскрывается облаком.
    //    Выход — прокруткой вверх, как у igloo.
    await glide(page, [W * 0.2, H * 0.87], [W * 0.5, H * 0.48], 35);
    await page.waitForTimeout(400);
    await page.mouse.click(W * 0.5, H * 0.48);
    await page.waitForTimeout(3000);
    await wheel(-3);
    await page.waitForTimeout(2400);

    // 5. Звук: линия в переключателе справа сверху оживает волной.
    const toggle = page.getByRole("button", { name: /sound|звук/i });
    if (await toggle.count()) {
      const tb = await toggle.boundingBox();
      if (tb) {
        await glide(page, [W * 0.5, H * 0.48], [tb.x + tb.width / 2, tb.y + tb.height / 2], 35);
        await toggle.click();
        await page.waitForTimeout(1800);
      }
    }

    /* 6. Аллея. Одна точка — 900 пикселей колеса (`pxPerStop` в journey.ts),
          десять щелчков по 90. Нарочно недокручиваем: шесть щелчков —
          и рука замирает; через секунду доводка плавно довозит до точки. */
    await page.mouse.move(W * 0.55, H * 0.5);
    await wheel(6);
    await page.waitForTimeout(3400);

    // 7. Сфера проекта: зажал и повёл — вертится в любую сторону, как
    //    планета, и докручивается по инерции. Нажатие — раскрывается
    //    одним движением, и ты внутри сетки, в комнате проекта.
    await page.mouse.move(W * 0.42, H * 0.42);
    await page.mouse.down();
    await glide(page, [W * 0.42, H * 0.42], [W * 0.62, H * 0.6], 30, 16);
    await glide(page, [W * 0.62, H * 0.6], [W * 0.5, H * 0.35], 25, 16);
    await page.mouse.up();
    await page.waitForTimeout(2200);
    await page.mouse.click(W * 0.5, H * 0.5);
    await page.waitForTimeout(3000);
    await glide(page, [W * 0.5, H * 0.5], [W * 0.83, H * 0.36], 35);
    await page.waitForTimeout(2200);
    // Изнутри сетку тоже вертят рукой, а под рукой точки разлетаются.
    await page.mouse.move(W * 0.62, H * 0.7);
    await page.mouse.down();
    await glide(page, [W * 0.62, H * 0.7], [W * 0.3, H * 0.55], 35, 16);
    await page.mouse.up();
    await page.waitForTimeout(1600);
    await glide(page, [W * 0.3, H * 0.55], [W * 0.5, H * 0.5], 25);
    await wheel(-3);
    await page.waitForTimeout(2400);

    // 8. Следующий проект: сфера не улетает, а пересобирается на месте.
    await wheel(10);
    await page.waitForTimeout(3400);

    // 9. Контакты и дальше по кольцу — снова имя.
    await wheel(10);
    await page.waitForTimeout(3000);
    await wheel(10);
    await page.waitForTimeout(3200);
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
