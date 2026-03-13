/*
 * Redirect fra gammel /hjem til / for bakoverkompatibilitet
 * Ikke bruk denne filen til noe annet!
 */
import { redirect } from "next/navigation";
// Denne komponenten brukes kun for å håndtere redirect fra /hjem til /
export default function HjemRedirect() {
  redirect("/");
}
