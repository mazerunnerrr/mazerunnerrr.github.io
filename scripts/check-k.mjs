#!/usr/bin/env node
/**
 * Прогон категории К: фокус, клики, «уменьшить движение», без WebGL.
 *
 *   npm run dev              # в одном окне
 *   npm run check:k          # обычный режим
 *   npm run check:k -- reduce | nowebgl
 *
 * Роликом это не ловится: тур не проверяет, куда ушёл фокус и какой слой
 * перехватил нажатие. Здесь — числами: прозрачность слоёв, метка «погас»,
 * где стоит фокус после Tab и Enter.
 */
import { chromium } from "playwright";

const URL = "http://localhost:3210";
const mode = process.argv[2] ?? "normal";
const browser = await chromium.launch({
  args: mode === "nowebgl" ? ["--disable-webgl", "--disable-3d-apis"] : [],
});
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  reducedMotion: mode === "reduce" ? "reduce" : "no-preference",
});
const page = await ctx.newPage();
let popups = 0;
ctx.on("page", () => popups++);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  // three сам пишет в консоль, что контекст не создался, — это ожидаемо без WebGL.
  if (m.type() === "error" && !m.text().includes("WebGL")) errors.push("console: " + m.text());
});

const settle = () => page.waitForTimeout(mode === "reduce" ? 400 : 3200);
const fresh = async () => {
  await page.goto(URL, { waitUntil: "networkidle" });
  // Заставка (Loader.tsx) держит экран около трёх секунд.
  await page.waitForTimeout(3800);
};

const state = () =>
  page.evaluate(() => {
    const layer = (sel) => {
      const el = document.querySelector(sel)?.closest("main > div");
      if (!el) return "нет";
      return `${(+getComputedStyle(el).opacity).toFixed(2)}${el.hasAttribute("data-faded") ? " погас" : ""}`;
    };
    const about = [...document.querySelectorAll("main button")].find((b) => /about me|обо мне/i.test(b.textContent));
    const aboutLayer = about?.closest("main > div");
    return {
      имя: aboutLayer
        ? `${(+getComputedStyle(aboutLayer).opacity).toFixed(2)}${aboutLayer.hasAttribute("data-faded") ? " погас" : ""}`
        : "нет",
      проекты: layer("#projects"),
      контакты: layer("#contacts"),
      h1: document.querySelectorAll("h1").length,
      canvas: document.querySelectorAll("canvas").length,
    };
  });

const focused = () =>
  page.evaluate(() => {
    const a = document.activeElement;
    if (!a || a === document.body) return "—";
    let op = 1;
    for (let el = a; el; el = el.parentElement) op *= +getComputedStyle(el).opacity;
    return `<${a.tagName.toLowerCase()}> ${a.id || a.textContent.trim().slice(0, 20)} [видно ${op.toFixed(2)}]`;
  });

const tabWalk = async (n) => {
  const seen = [];
  for (let i = 0; i < n; i++) {
    await page.keyboard.press("Tab");
    await settle();
    seen.push(await focused());
  }
  return seen.join(" → ");
};

console.log(`\n== ${mode}`);
await fresh();
console.log("старт            ", JSON.stringify(await state()));
console.log("Tab ×4 с нуля    ", await tabWalk(4));

await fresh();
await page.mouse.move(720, 450);
await page.mouse.wheel(0, 900);
await settle();
console.log("колесо → 1       ", JSON.stringify(await state()));

await fresh();
// По адресу ссылки, а не по слову: надписи двуязычные и перещёлкиваются.
await page.click("nav a[href='#projects']", { timeout: 3000 });
await settle();
console.log("клик «работы»    ", JSON.stringify(await state()), "фокус:", await focused());

await fresh();
await page.click("nav a[href='#contacts']", { timeout: 3000 });
await settle();
console.log("клик «контакт»   ", JSON.stringify(await state()), "фокус:", await focused());

/* Под погасшей «обо мне» на контактах не должна ловиться она сама.
   Спрашиваем, кто под курсором, а не кликаем вслепую. */
const hit = await page.evaluate(() => {
  const ghost = [...document.querySelectorAll("main button")].find((x) => /about me|обо мне/i.test(x.textContent));
  const r = ghost.getBoundingClientRect();
  const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
  const b = el?.closest("a, button");
  if (!b) return "пусто — нажатие уходит в сцену";
  if (b === ghost) return "ПОГАСШАЯ «обо мне» — перехват!";
  return `живая «${b.textContent.trim().slice(0, 24)}» своей точки`;
});
console.log("под погасшей «обо мне» на контактах:", hit);

// Кольцо: с контактов вниз — снова имя.
await page.keyboard.press("PageDown");
await settle();
console.log("PageDown с контактов", JSON.stringify(await state()));

/* Комнаты. Вход с клавиатуры: фокус встаёт на «закрыть», аллея за спиной
   инертна, колесо маршрут не двигает; Esc возвращает фокус ко входу. */
const room = () =>
  page.evaluate(() => {
    const open = [...document.querySelectorAll("[role=dialog]")].find((d) => !d.inert);
    const route = document.querySelector("main > div:last-child span:nth-child(3)")?.textContent;
    return open ? `открыта «${open.getAttribute("aria-label")}» видно ${(+getComputedStyle(open).opacity).toFixed(2)} | ${route}` : `закрыто | ${route}`;
  });
await fresh();
await page.keyboard.press("Tab");
await settle();
console.log("Tab → вход       ", await focused());
await page.keyboard.press("Enter");
await settle();
console.log("Enter            ", await room(), "фокус:", await focused());
await page.mouse.move(720, 450);
await page.mouse.wheel(0, 900);
await settle();
console.log("колесо в комнате ", await room());
await page.keyboard.press("Tab");
console.log("Tab в комнате    ", await focused());
await page.keyboard.press("Escape");
await settle();
console.log("Esc              ", await room(), "фокус:", await focused());

// Вход кликом по самому объекту: имя стоит в центре.
await page.mouse.click(720, 440);
await settle();
console.log("клик по объекту  ", await room());
await page.keyboard.press("Escape");
await settle();
console.log("вкладок открылось:", popups, "| ошибки:", errors.length ? errors.join(" | ") : "нет");
await browser.close();
