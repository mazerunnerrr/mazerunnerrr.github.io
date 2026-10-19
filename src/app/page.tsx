import { Home } from "@/components/Home";
import { getContacts, getProjects, getSite, getSkills } from "@/content";
import { LANGS } from "@/lib/i18n";

/* Контент читается с диска при сборке и уходит в страницу готовыми данными:
   сама сцена живёт в браузере и диска не видит. Оба языка сразу — смена
   языка на месте, без перезагрузки мира. */
export default function Page() {
  const content = Object.fromEntries(
    LANGS.map((lang) => [
      lang,
      { site: getSite(lang), skills: getSkills(lang), projects: getProjects(lang), contacts: getContacts(lang) },
    ])
  ) as React.ComponentProps<typeof Home>["content"];
  return <Home content={content} />;
}
