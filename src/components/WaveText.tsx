/**
 * Текст комнаты по буквам — для волны под рукой (`wave.ts`). Пробелы остаются
 * текстом: строка переносится по словам, как и без разбивки.
 */
export function WaveText({ text }: { text: string }) {
  return (
    <>
      {Array.from(text).map((c, i) =>
        /\s/.test(c) ? (
          c
        ) : (
          <span key={i} data-c>
            {c}
          </span>
        )
      )}
    </>
  );
}
