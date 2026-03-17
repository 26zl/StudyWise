/*
 * PWA Web App Manifest — gjør StudyWise installerbar som app på mobil og desktop.
 *
 * Android: Chrome viser automatisk "Installer app"-prompt.
 * iOS: Safari → Del-knapp → "Legg til på Hjem-skjerm".
 *
 * Appen kjører i standalone-modus (fullskjerm uten adresselinje).
 * Ingen service worker / offline-støtte — appen krever backend-tilkobling.
 *
 * Ikoner: Placeholder for nå, bør oppdateres med ekte design senere.
 * Størrelser: 192x192 (Android), 512x512 (splash), apple-touch-icon 180x180 (iOS).
 */
import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "StudyWise",
    short_name: "StudyWise",
    description: "KI-drevet studieassistent med Canvas LMS-integrasjon",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#020617",
    theme_color: "#2563eb",
    orientation: "portrait-primary",
    icons: [
      {
        src: "/icons/icon-192x192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icons/icon-512x512.png",
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: "/icons/icon-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
