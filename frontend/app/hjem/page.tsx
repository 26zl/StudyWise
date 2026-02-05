/*
 * Redirect fra gammel /hjem til / for bakoverkompatibilitet
 * Ikke bruk denne filen til noe annet!
 */
import { redirect } from "next/navigation";

export default function HjemRedirect() {
  redirect("/");
}
