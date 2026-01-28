/*
 * Hooks og funksjoner for å kommunisere med auth-backend APIet

import { useMutation } from "@tanstack/react-query";
import { CanvasTokenResponseSchema, type CanvasTokenResponse } from "common";

async function lagreCanvasToken(token: string): Promise<CanvasTokenResponse> {
  const res = await fetch("/api/user/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });

  const data = CanvasTokenResponseSchema.parse(await res.json());
  if (!res.ok) {
    throw new Error(data.melding || data.feil || "Kunne ikke lagre token");
  }
  return data;
}

export function useLagreCanvasToken() {
  return useMutation({
    mutationFn: lagreCanvasToken,
  });
}
*/