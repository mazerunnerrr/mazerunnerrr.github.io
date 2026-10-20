import { flipIn } from "@/components/Flip";

/* Помощники слоёв поверх сцены: аллеи и комнат. Всё пишется прямо в style
   из кадрового обработчика, минуя состояние React. */

export const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
/** Проявление с разгоном и торможением: по прямой оно обрывается на полной
    яркости, и конец читается скачком. */
export const ease = (x: number) => x * x * (3 - 2 * x);

/* Прозрачность слоя плюс метка «погас» для CSS: кнопки погасшего слоя
   перестают ловить клики. Метка пишется только при смене, не каждый кадр.

   Метка зависит не только от прозрачности, но и от того, чья сейчас точка.
   Камера, застывшая между точками, оставляла соседний слой почти невидимым,
   но кликабельным: невидимые контакты перехватывали нажатие на соседа.
   Теперь нажатия принимает только ближайшая к камере точка. */
export const fade = (el: HTMLElement, opacity: number, own: boolean) => {
  el.style.opacity = String(opacity);
  const off = !own || opacity < 0.05;
  if (el.hasAttribute("data-faded") !== off) el.toggleAttribute("data-faded", off);
  lightUp(el, opacity);
};

/** Слой проявился — его мелкие надписи перещёлкиваются, как табло. */
export const lightUp = (el: HTMLElement, opacity: number) => {
  const lit = opacity >= 0.05;
  if (el.hasAttribute("data-lit") === lit) return;
  el.toggleAttribute("data-lit", lit);
  if (lit) flipIn(el);
};
