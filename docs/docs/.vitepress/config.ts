import { defineConfig } from "vitepress";

export default defineConfig({
  title: "StudyWise Dokumentasjon",
  description: "Dokumentasjon for StudyWise - En KI-basert studieassistent",
  lang: "no-NO",
  base: "/StudyWise/",
  themeConfig: {
    nav: [{ text: "Hjem", link: "/" }],

    sidebar: [
      {
        text: "Oversikt",
        items: [{ text: "Introduksjon", link: "/" }],
      },
    ],

    socialLinks: [{ icon: "github", link: "https://github.com/26zl/StudyWise" }],

    footer: {
      message: "Utviklet som en del av Bacheloroppgave i IT 2026.",
      copyright: "Copyright © 2026 StudyWise",
    },
  },
});
