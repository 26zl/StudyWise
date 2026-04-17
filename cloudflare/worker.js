/**
 * Timing-safe sammenligning av to strenger i Workers-runtime.
 * Bruker Web Crypto for å unngå kort-circuit som lekker lengdeinformasjon og
 * tegn-for-tegn-tidsmålinger som kan avsløre secretet.
 */
function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const encoder = new TextEncoder();
  const bufA = encoder.encode(a);
  const bufB = encoder.encode(b);
  if (bufA.byteLength !== bufB.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < bufA.byteLength; i++) {
    diff |= bufA[i] ^ bufB[i];
  }
  return diff === 0;
}

export default {
  async fetch(request, env) {
    // 1. Sjekk at det er et POST-kall fra backend-en vår
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    // 2. Sjekk passordet (sikkerhet mot spamming) — timing-safe compare
    const secret = request.headers.get("X-Contact-Secret");
    const expected = env.CONTACT_WORKER_SECRET;
    if (!secret || !expected || !timingSafeEqual(secret, expected)) {
      return new Response("Unauthorized", { status: 401 });
    }

    try {
      // 3. Hent ut dataen
      const payload = await request.json();

      // 4. Bygg e-post avhengig av type
      let emailPayload;

      if (payload.type === "reply") {
        // Admin svarer på en kontaktmelding — sendes til brukeren
        emailPayload = {
          from: payload.fromEmail || "StudyWise <noreply@studwize.page>",
          to: payload.toEmail,
          subject: payload.subject,
          text: payload.body,
        };
      } else {
        // Innkommende kontaktskjema → admin-inbox
        emailPayload = {
          from: payload.fromEmail || "StudyWise <noreply@studwize.page>",
          to: payload.toEmail,
          subject: `Kontaktskjema: ${payload.emne}`,
          text: `Navn: ${payload.navn}\nE-post: ${payload.epost}\nSendt: ${payload.timestamp || new Date().toISOString()}\n\nMelding:\n${payload.melding}`,
        };

        // Vedlegg: backend sender { filnavn, mimeType, størrelse, innholdBase64 }
        // Resend forventer { filename, content } (base64-streng)
        if (Array.isArray(payload.attachments) && payload.attachments.length > 0) {
          emailPayload.attachments = payload.attachments.map((a) => ({
            filename: a.filnavn,
            content: a.innholdBase64,
          }));
        }
      }

      // 5. Send e-posten via Resend
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(emailPayload),
      });

      if (!res.ok) {
        const errorText = await res.text();
        // Logg detaljer til worker-konsoll (Cloudflare dashboard) for feilsøking,
        // men returner generisk melding slik at Resend-feilformat ikke lekker videre.
        console.error("Resend API feilet", { status: res.status, errorText });
        return new Response(
          JSON.stringify({ error: "email_provider_failed" }),
          {
            status: 502,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      // 6. Returner suksess tilbake til StudyWise-backend
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (e) {
      // Ikke returner rå exception-message (kan inneholde stack/URL/miljødetaljer).
      console.error("Contact-worker unntak", { err: e });
      return new Response(
        JSON.stringify({ error: "internal_error" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  },
};
