/**
 * Приёмник формы обратной связи: сайт присылает сюда, воркер — в Telegram.
 *
 * Токен бота лежит секретом воркера и в сайт не попадает никогда. Это главная
 * причина, по которой форма ходит через воркер, а не стучит в Telegram напрямую:
 * всё, что уходит в браузер, читается любым желающим.
 *
 * Развёртывание и секреты — в worker/README.md.
 */

/** Откуда принимаем. Чужой сайт не сможет слать письма от твоего имени. */
const ALLOWED = ["https://mazerunnerrr.github.io", "http://localhost:3210"];

const LIMITS = { name: 80, contact: 120, message: 4000 };

const cors = (origin) => ({
  "Access-Control-Allow-Origin": ALLOWED.includes(origin) ? origin : ALLOWED[0],
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
});

const reply = (status, body, origin) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...cors(origin) },
  });

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") ?? "";

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
    if (request.method !== "POST") return reply(405, { error: "Только POST" }, origin);
    if (!ALLOWED.includes(origin)) return reply(403, { error: "Чужой источник" }, origin);

    let data;
    try {
      data = await request.json();
    } catch {
      return reply(400, { error: "Ожидался JSON" }, origin);
    }

    // Ловушка для ботов: поле спрятано от человека, и заполняет его только робот.
    // Отвечаем как на успех — чтобы робот не подбирал обход.
    if (data.trap) return reply(200, { ok: true }, origin);

    const name = String(data.name ?? "").trim().slice(0, LIMITS.name);
    const contact = String(data.contact ?? "").trim().slice(0, LIMITS.contact);
    const message = String(data.message ?? "").trim().slice(0, LIMITS.message);

    if (!message || !contact) return reply(400, { error: "Нужны сообщение и способ связи" }, origin);

    const text = [
      "Заявка с сайта",
      name ? `Имя: ${name}` : null,
      `Связь: ${contact}`,
      "",
      message,
    ]
      .filter(Boolean)
      .join("\n");

    const tg = await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: env.TG_CHAT_ID, text, disable_web_page_preview: true }),
    });

    if (!tg.ok) {
      // Текст ошибки Telegram наружу не отдаём: в нём бывает часть токена.
      console.error("telegram", tg.status, await tg.text());
      return reply(502, { error: "Не доставлено" }, origin);
    }

    return reply(200, { ok: true }, origin);
  },
};
