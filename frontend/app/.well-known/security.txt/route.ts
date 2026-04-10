/**
 * /.well-known/security.txt — RFC 9116
 * Gir sikkerhetsforskere kontaktinformasjon for ansvarlig rapportering.
 */
export function GET() {
  const body = [
    "Contact: https://www.studwize.page/kontakt",
    "Preferred-Languages: no, en",
    "Canonical: https://www.studwize.page/.well-known/security.txt",
    // RFC 9116 krever Expires — sett til ~1 år frem
    "Expires: 2027-04-10T00:00:00.000Z",
  ].join("\n");

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
