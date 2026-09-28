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
  await page.waitForTimeout(2000);
};

const state = () =>
  page.evaluate(() => {
    const layer = (sel) => {
      const el = document.querySelector(sel)?.closest("main > div");
      if (!el) return "нет";
      return `${(+getComputedStyle(el).opacity).toFixed(2)}${el.hasAttribute("data-faded") ? " погас" : ""}`;
    };
    return {
      имя: layer("a[href='#projects']"),
      "что делаю": layer("#skills"),
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
await page.click("text=Смотреть проекты", { timeout: 3000 });
await settle();
console.log("клик «Смотреть»  ", JSON.stringify(await state()), "фокус:", await focused());

await fresh();
await page.click("text=Написать", { timeout: 3000 });
await settle();
console.log("клик «Написать»  ", JSON.stringify(await state()), "фокус:", await focused());

/* Под погасшей «Смотреть проекты» на контактах не должна ловиться она сама.
   Кликать туда вслепую нельзя: в том же углу стоит живая ссылка Telegram,
   и клик честно открыл бы вкладку. Спрашиваем, кто под курсором. */
const hit = await page.evaluate(() => {
  const ghost = [...document.querySelectorAll("main a")].find((x) => x.textContent.includes("Смотреть проекты"));
  const r = ghost.getBoundingClientRect();
  const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
  const a = el?.closest("a");
  if (!a) return "пусто — нажатие уходит в сцену";
  if (a === ghost) return "ПОГАСШАЯ «Смотреть проекты» — перехват!";
  return `живая ссылка «${a.textContent.trim().slice(0, 24)}» своей точки`;
});
console.log("под погасшей «Смотреть» на 3:", hit);

// Кольцо: с контактов вниз — снова имя.
await page.keyboard.press("PageDown");
await settle();
console.log("PageDown с контактов", JSON.stringify(await state()));
console.log("вкладок открылось:", popups, "| ошибки:", errors.length ? errors.join(" | ") : "нет");
await browser.close();
