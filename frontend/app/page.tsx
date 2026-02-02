/*
* Root-side (/)
* Dette er landingspunktet når brukeren går til domenet uten path.
* Fungerer litt som app.js i eldre Next.js versjoner eller rene react-applikasjoner.
*/

import { redirect } from "next/navigation";

export default function Root() {
  // Sender brukeren umiddelbart til /hjem
  redirect("/hjem");
}
