/**
 * Текст комнаты по буквам — для волны под рукой (`wave.ts`). Пробелы остаются
 * текстом: строка переносится по словам, как и без разбивки. `still` — крупный
 * текст: волна его только подсвечивает, знаки не перебирает (Илья, 2026-11-10).
 */
export function WaveText({ text, still = false }: { text: string; still?: boolean }) {
  return (
    <>
      {Array.from(text).map((c, i) =>
        /\s/.test(c) ? (
          c
        ) : (
          <span key={i} data-c={still ? "still" : ""}>
            {c}
          </span>
        )
      )}
    </>
  );
}
