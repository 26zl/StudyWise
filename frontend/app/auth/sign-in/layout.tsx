/*
 * Layout for sign-in – tvinger statisk rendering der mulig for å redusere 503 ved prefetch i prod.
 */
export const dynamic = "force-static";

export default function SignInLayout({
  children,
}: { children: React.ReactNode }) {
  return children;
}
