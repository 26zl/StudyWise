/**
 * API-klient for kunnskapsbase-funksjoner.
 * Bruker fetchApi/fetchAuthedJson for autentisert kommunikasjon med backend.
 */

import { fetchApi, fetchAuthedJson } from "@/app/lib/apiClient";
import {
  KBBaseListResponseSchema,
  KBBaseDetailSchema,
  KBBaseSummarySchema,
  type KBBaseListResponse,
  type KBBaseDetail,
  type KBBaseSummary,
  type KBLink,
  type KBFile,
} from "common/kunnskapsbase";

// ─── Query Keys ──────────────────────────────────────────

export const KB_QUERY_KEYS = {
  bases: ["kb", "bases"] as const,
  base: (id: string) => ["kb", "base", id] as const,
};

// ─── Baser ───────────────────────────────────────────────

/** Hent alle kunnskapsbaser for innlogget bruker */
export async function hentAlleKBBaser(): Promise<KBBaseListResponse> {
  const { data } = await fetchAuthedJson("/api/kb");
  return KBBaseListResponseSchema.parse(data);
}

/** Opprett ny kunnskapsbase */
export async function opprettKBBase(navn: string): Promise<KBBaseSummary> {
  const { data } = await fetchAuthedJson("/api/kb", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ navn }),
  });
  return KBBaseSummarySchema.parse(data);
}

/** Hent enkelt kunnskapsbase med innhold */
export async function hentKBBase(id: string): Promise<KBBaseDetail> {
  const { data } = await fetchAuthedJson(`/api/kb/${id}`);
  return KBBaseDetailSchema.parse(data);
}

/** Oppdater basenavn */
export async function oppdaterKBBase(id: string, navn: string): Promise<void> {
  await fetchAuthedJson(`/api/kb/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ navn }),
  });
}

/** Slett kunnskapsbase */
export async function slettKBBase(id: string): Promise<void> {
  await fetchAuthedJson(`/api/kb/${id}`, {
    method: "DELETE",
  });
}

// ─── Lenker ──────────────────────────────────────────────

/** Legg til lenke i base */
export async function leggTilKBLenke(
  baseId: string,
  url: string,
  tittel?: string,
): Promise<KBLink> {
  const { data } = await fetchAuthedJson(`/api/kb/${baseId}/links`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, tittel }),
  });
  return data as KBLink;
}

/** Slett lenke fra base */
export async function slettKBLenke(baseId: string, linkId: string): Promise<void> {
  await fetchAuthedJson(`/api/kb/${baseId}/links/${linkId}`, {
    method: "DELETE",
  });
}

// ─── Filer ───────────────────────────────────────────────

/** Last opp fil til base */
export async function lastOppKBFil(baseId: string, file: File): Promise<KBFile> {
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetchApi(`/api/kb/${baseId}/files`, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    const { parseApiError } = await import("@/app/lib/errorUtils");
    const melding = await parseApiError(res, "Kunne ikke laste opp fil");
    throw new Error(melding);
  }

  return (await res.json()) as KBFile;
}

/** Slett fil fra base */
export async function slettKBFil(baseId: string, fileId: string): Promise<void> {
  await fetchAuthedJson(`/api/kb/${baseId}/files/${fileId}`, {
    method: "DELETE",
  });
}
