/**
 * Server-side proxy for Canvas-filnedlasting.
 *
 * Bakgrunn: Backend-endepunktet `/api/canvas/filer/:id/download` krever
 * `Authorization: Bearer <clerk-token>`. Top-level navigasjon (`<a href>`,
 * `<img src>`, `window.open`) kan ikke sende egendefinerte headere — kun
 * cookies. Denne route handleren kjører server-side, henter Clerk-tokenet
 * via cookie-basert sesjon, og videresender til backend med Bearer-headeren.
 *
 * Resultat: alle eksisterende `<a href>` og `<img src>` mot
 * `/api/canvas/filer/.../download` fungerer uten endringer i komponentene.
 *
 * Filbaserte App Router-ruter har presedens over `next.config.js` rewrites,
 * så denne overstyrer den direkte proxyen til backend kun for dette
 * endepunktet.
 */
import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const API_BASE =
  process.env.INTERNAL_API_URL?.trim() ||
  (process.env.NODE_ENV !== "production" ? "http://localhost:4000" : null);

// Headere som ikke skal videresendes fra backend til klient
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
]);

export async function GET(
  req: Request,
  { params }: { params: Promise<{ fileId: string }> },
): Promise<Response> {
  const { fileId } = await params;

  // Streng validering: kun numeriske ID-er for å unngå path traversal
  if (!/^\d+$/.test(fileId)) {
    return NextResponse.json(
      { feil: "Ugyldig fileId", kode: "invalid_file_id" },
      { status: 400 },
    );
  }

  if (!API_BASE) {
    return NextResponse.json(
      { feil: "API-base ikke konfigurert", kode: "config_error" },
      { status: 500 },
    );
  }

  const { userId, getToken } = await auth();
  if (!userId) {
    return NextResponse.json(
      {
        feil: "Ikke autentisert",
        melding: "Mangler autentiseringstoken",
        kode: "auth_error",
      },
      { status: 401 },
    );
  }

  const token = await getToken();
  if (!token) {
    return NextResponse.json(
      {
        feil: "Ikke autentisert",
        melding: "Kunne ikke hente sesjonstoken",
        kode: "auth_error",
      },
      { status: 401 },
    );
  }

  const upstreamUrl = `${API_BASE}/api/canvas/filer/${fileId}/download`;

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        // Videresend originals Accept slik at backend kan respektere innholdstype
        Accept: req.headers.get("accept") ?? "*/*",
      },
      cache: "no-store",
      redirect: "manual",
    });
  } catch (err) {
    return NextResponse.json(
      {
        feil: "Backend uten respons",
        melding: err instanceof Error ? err.message : "ukjent feil",
        kode: "upstream_error",
      },
      { status: 502 },
    );
  }

  // Bygg respons-headere uten hop-by-hop felter
  const headers = new Headers();
  upstream.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) {
      headers.set(key, value);
    }
  });

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}
