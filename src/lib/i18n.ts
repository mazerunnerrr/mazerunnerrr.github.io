import type { ProjectStatus } from "@/content";

/**
 * Два языка: английский по умолчанию — сайт работает на весь мир, а не только
 * на СНГ, — и русский по переключателю (Илья, 2026-10-19).
 *
 * Здесь — мелкие надписи интерфейса: приборы, кнопки, подсказки. Большие
 * тексты (обо мне, проекты, контакты) живут в JSON и правятся в админке:
 * русский — в корне файла, английский — в ключе `en`. Пустое английское
 * поле показывает русское, поэтому сайт не пустеет, пока перевода нет.
 *
 * Выбор посетителя хранит `useLang.ts` — отдельно, потому что словарь читают
 * и серверные страницы, а хук там недоступен.
 */
export type Lang = "en" | "ru";
export const LANGS: Lang[] = ["en", "ru"];

export const UI = {
  en: {
    stopName: "name",
    stopProject: "project",
    stopContacts: "contacts",
    inside: "inside",
    scrollBack: "↑ scroll up — back",
    close: "close · esc",
    openProject: "open project ↵",
    aboutEnter: "about me ↵",
    about: "About me",
    whatIDo: "What I do",
    whatIDid: "What I did",
    screen: "screen",
    chTask: "Task",
    chSolution: "Solution",
    chResult: "Result",
    chBuild: "How it's built",
    chScreens: "Screens",
    fullCase: "full case",
    projects: "projects",
    work: "work",
    contact: "contact",
    contacts: "Contacts",
    nav: "Navigation and sound",
    soundOn: "Turn sound on",
    soundOff: "Turn sound off",
    language: "Language",
    backToRoute: "back to the route",
    formName: "Name",
    formReach: "How to reach you",
    formReachHint: "@handle or email",
    formTask: "What needs doing",
    formSend: "Send",
    formSending: "Sending",
    formSent: "Sent. I'll reply the same way you reached me.",
    formFailed: "Didn't go through",
    formFallback: "You can also write on Telegram or by email.",
  },
  ru: {
    stopName: "имя",
    stopProject: "проект",
    stopContacts: "контакты",
    inside: "внутри",
    scrollBack: "↑ прокрути вверх — назад",
    close: "закрыть · esc",
    openProject: "открыть проект ↵",
    aboutEnter: "обо мне ↵",
    about: "Обо мне",
    whatIDo: "Что делаю",
    whatIDid: "Что сделал",
    screen: "экран",
    chTask: "Задача",
    chSolution: "Решение",
    chResult: "Итог",
    chBuild: "Как устроено",
    chScreens: "Экраны",
    fullCase: "полный кейс",
    projects: "проекты",
    work: "работы",
    contact: "контакт",
    contacts: "Контакты",
    nav: "Переходы и звук",
    soundOn: "Включить звук",
    soundOff: "Выключить звук",
    language: "Язык",
    backToRoute: "к маршруту",
    formName: "Имя",
    formReach: "Как ответить",
    formReachHint: "@ник или почта",
    formTask: "Что нужно сделать",
    formSend: "Отправить",
    formSending: "Отправляю",
    formSent: "Отправлено. Отвечу тем же способом, что вы оставили.",
    formFailed: "Не отправилось",
    formFallback: "Можно написать в Telegram или на почту.",
  },
} satisfies Record<Lang, Record<string, string>>;

/** Статус в админке выбирается по-русски, на сайте показывается на языке посетителя. */
export const STATUS_LABEL: Record<Lang, Record<ProjectStatus, string>> = {
  en: {
    "в работе": "in progress",
    "личный проект": "personal project",
    "разбор и архитектура": "analysis & architecture",
    запущен: "live",
  },
  ru: {
    "в работе": "в работе",
    "личный проект": "личный проект",
    "разбор и архитектура": "разбор и архитектура",
    запущен: "запущен",
  },
};
