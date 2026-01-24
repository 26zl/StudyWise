/*
* Root-side (/)
* Dette er landingspunktet når brukeren går til domenet uten path.
*/

import { redirect } from "next/navigation";

export default function Root() {
  // Sender brukeren umiddelbart til /hjem
  redirect("/hjem");
}
