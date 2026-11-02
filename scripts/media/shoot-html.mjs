#!/usr/bin/env node
/**
 * Снимок HTML-страницы в кадр комнаты проекта (1600×1000 по умолчанию).
 *
 *   node scripts/media/shoot-html.mjs <file.html?query> <out.png> [w] [h]
 *
 * Ждёт шрифты и флаг window.__ready, если страница его ставит.
 */
import { chromium } from "playwright";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [src, out, w = "1600", h = "1000"] = process.argv.slice(2);
const [file, query = ""] = src.split("?");
const url = pathToFileURL(resolve(file)).href + (query ? `?${query}` : "");

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
await page.goto(url, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
await page.waitForFunction(() => window.__ready !== false, null, { timeout: 10000 });
await page.screenshot({ path: out });
await browser.close();
console.log(out);
