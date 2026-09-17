import { Home } from "@/components/Home";
import { getContacts, getProjects, getSite, getSkills } from "@/content";

/* Контент читается с диска при сборке и уходит в страницу готовыми данными:
   сама сцена живёт в браузере и диска не видит. */
export default function Page() {
  return (
    <Home
      site={getSite()}
      skills={getSkills()}
      projects={getProjects()}
      contacts={getContacts()}
    />
  );
}
