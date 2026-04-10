export default {
  async fetch(request, env) {
    // 1. Sjekk at det er et POST-kall fra backend-en vår
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    // 2. Sjekk passordet (sikkerhet mot spamming)
    const secret = request.headers.get("X-Contact-Secret");
    if (secret !== env.CONTACT_WORKER_SECRET) {
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
        return new Response(`Email provider failed: ${errorText}`, {
          status: res.status,
        });
      }

      // 6. Returner suksess tilbake til StudyWise-backend
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (e) {
      return new Response(e.message, { status: 500 });
    }
  },
};
