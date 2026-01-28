import { defineConfig } from 'vitepress'

export default defineConfig({
  title: "StudyWise Dokumentasjon",
  description: "Dokumentasjon for StudyWise - En KI-basert studieassistent",
  lang: 'no-NO',
  themeConfig: {
    nav: [
      { text: 'Hjem', link: '/' },
      { text: 'Endringslogg', link: '/changelog' }
    ],

    sidebar: [
      {
        text: 'Oversikt',
        items: [
          { text: 'Introduksjon', link: '/' },
          { text: 'Endringslogg', link: '/changelog' }
        ]
      }
    ],

    socialLinks: [
      // { icon: 'github', link: 'https://github.com/vuejs/vitepress' }
    ],

    footer: {
      message: 'Utviklet som en del av Bacheloroppgave i IT 2026.',
      copyright: 'Copyright © 2026 StudyWise'
    }
  }
})
