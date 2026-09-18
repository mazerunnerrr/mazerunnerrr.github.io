"use client";

import { useState } from "react";

type State = "idle" | "sending" | "sent" | "error";

/* Поля формы. Имя необязательно: заставлять представляться, чтобы задать
   вопрос, — лишний порог. Связь и сообщение нужны, иначе ответить некуда. */
const FIELD =
  "mt-2 w-full bg-transparent px-3 py-2.5 text-[14px] font-light text-[var(--color-sand)] shadow-[inset_0_0_0_1px_var(--line)] outline-none transition-shadow duration-500 ease-[var(--ease-out-deep)] placeholder:text-[var(--sand-faint)] focus:shadow-[inset_0_0_0_1px_var(--color-azure)]";

export function ContactForm({ url }: { url: string }) {
  const [state, setState] = useState<State>("idle");
  const [error, setError] = useState("");

  const send = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    setState("sending");
    setError("");
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Не отправилось");
      form.reset();
      setState("sent");
    } catch (err) {
      // Человеку нужен второй путь, а не извинения: ссылки рядом никуда не делись.
      setError(err instanceof Error ? err.message : "Не отправилось");
      setState("error");
    }
  };

  return (
    <form onSubmit={send} className="pointer-events-auto w-full max-w-[640px]">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="eyebrow text-[var(--sand-faint)]">Имя</span>
          <input name="name" className={FIELD} autoComplete="name" maxLength={80} />
        </label>
        <label className="block">
          <span className="eyebrow text-[var(--sand-faint)]">Как ответить</span>
          <input
            name="contact"
            required
            maxLength={120}
            placeholder="@ник или почта"
            className={FIELD}
          />
        </label>
      </div>

      <label className="mt-4 block">
        <span className="eyebrow text-[var(--sand-faint)]">Что нужно сделать</span>
        <textarea name="message" required rows={3} maxLength={4000} className={`${FIELD} resize-y`} />
      </label>

      {/* Ловушка для роботов: человек её не видит и табом не достаёт. */}
      <input name="trap" tabIndex={-1} autoComplete="off" aria-hidden className="sr-only" />

      <div className="mt-5 flex flex-wrap items-center gap-4">
        <button
          type="submit"
          disabled={state === "sending"}
          className="rounded-[3px] bg-[var(--color-sand)] px-7 py-3 text-[13px] font-medium text-[var(--color-void)] transition-opacity duration-500 hover:opacity-80 disabled:opacity-50"
        >
          {state === "sending" ? "Отправляю" : "Отправить"}
        </button>

        {/* Ответ формы читается вслух: без этого для скринридера ничего не произошло. */}
        <p aria-live="polite" className="text-[13px] font-light text-[var(--sand-dim)]">
          {state === "sent" ? "Отправлено. Отвечу тем же способом, что вы оставили." : null}
          {state === "error" ? `${error}. Можно написать в Telegram или на почту.` : null}
        </p>
      </div>
    </form>
  );
}
