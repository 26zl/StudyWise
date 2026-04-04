"use client";

import { fetchApi } from "@/app/lib/apiClient";
import { parseApiJson, createApiError } from "@/app/lib/errorUtils";
import {
  SendTestWebPushResponseSchema,
  WebPushClientConfigResponseSchema,
  WebPushSubscriptionResponseSchema,
  type WebPushClientConfigResponse,
  type WebPushSubscription,
} from "common/notifications";

export interface BrowserPushSubscribeResult {
  subscription: PushSubscription;
  replacedEndpoint?: string;
}

function base64UrlToUint8Array(base64UrlString: string): Uint8Array {
  const padding = "=".repeat((4 - (base64UrlString.length % 4)) % 4);
  const base64 = (base64UrlString + padding)
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const rawData = window.atob(base64);
  const buffer = new ArrayBuffer(rawData.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; i += 1) {
    bytes[i] = rawData.charCodeAt(i);
  }
  return bytes;
}

function asUint8Array(
  value: ArrayBuffer | ArrayBufferView | null | undefined,
): Uint8Array | null {
  if (!value) {
    return null;
  }

  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }

  return new Uint8Array(value);
}

function matchesApplicationServerKey(
  subscription: PushSubscription,
  vapidPublicKey: string,
): boolean {
  const expectedKey = base64UrlToUint8Array(vapidPublicKey);
  const actualKey = asUint8Array(subscription.options?.applicationServerKey);

  if (!actualKey || actualKey.length !== expectedKey.length) {
    return false;
  }

  for (let i = 0; i < expectedKey.length; i += 1) {
    if (actualKey[i] !== expectedKey[i]) {
      return false;
    }
  }

  return true;
}

export function supportsBrowserPush(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export async function getBrowserPushClientConfig(): Promise<WebPushClientConfigResponse> {
  const res = await fetchApi("/api/user/push-client-config", {
    method: "GET",
  });
  const json = await parseApiJson(res);
  if (!res.ok) {
    throw createApiError(json, "Kunne ikke hente push-konfigurasjon");
  }
  return WebPushClientConfigResponseSchema.parse(json);
}

export function serializePushSubscription(
  subscription: PushSubscription,
): WebPushSubscription {
  const json = subscription.toJSON();

  if (!json.endpoint || !json.keys?.auth || !json.keys.p256dh) {
    throw new Error("Push-abonnementet er ufullstendig.");
  }

  return {
    endpoint: json.endpoint,
    expirationTime: json.expirationTime ?? null,
    keys: {
      auth: json.keys.auth,
      p256dh: json.keys.p256dh,
    },
  };
}

export async function getBrowserPushRegistration(): Promise<ServiceWorkerRegistration> {
  if (!supportsBrowserPush()) {
    throw new Error("Nettleservarsler støttes ikke i denne nettleseren.");
  }

  const existing = await navigator.serviceWorker.getRegistration("/");
  if (existing) {
    // Sikrer at vi returnerer en aktiv registration før subscribe()
    return navigator.serviceWorker.ready;
  }

  await navigator.serviceWorker.register("/sw.js");
  return navigator.serviceWorker.ready;
}

export async function subscribeToBrowserPush(
  vapidPublicKey: string,
): Promise<BrowserPushSubscribeResult> {
  const trimmedPublicKey = vapidPublicKey.trim();
  if (!trimmedPublicKey) {
    throw new Error("Nettleservarsler er ikke konfigurert.");
  }

  const registration = await getBrowserPushRegistration();
  const existing = await registration.pushManager.getSubscription();
  if (existing) {
    if (matchesApplicationServerKey(existing, trimmedPublicKey)) {
      return { subscription: existing };
    }

    const replacedEndpoint = existing.endpoint;
    await existing.unsubscribe();
    return {
      subscription: await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey:
          base64UrlToUint8Array(trimmedPublicKey) as BufferSource,
      }),
      replacedEndpoint,
    };
  }

  return {
    subscription: await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey:
        base64UrlToUint8Array(trimmedPublicKey) as BufferSource,
    }),
  };
}

export async function saveBrowserPushSubscription(
  subscription: PushSubscription,
): Promise<void> {
  const res = await fetchApi("/api/user/push-subscriptions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      subscription: serializePushSubscription(subscription),
    }),
  });
  const json = await parseApiJson(res);
  if (!res.ok) {
    throw createApiError(json, "Kunne ikke aktivere nettleservarsler");
  }

  WebPushSubscriptionResponseSchema.parse(json);
}

export async function deleteBrowserPushSubscription(
  endpoint: string,
): Promise<void> {
  const res = await fetchApi("/api/user/push-subscriptions", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint }),
  });
  const json = await parseApiJson(res);
  if (!res.ok) {
    throw createApiError(json, "Kunne ikke deaktivere nettleservarsler");
  }

  WebPushSubscriptionResponseSchema.parse(json);
}

export async function sendBrowserPushTest(): Promise<boolean> {
  const res = await fetchApi("/api/user/push-subscriptions/test", {
    method: "POST",
  });
  const json = await parseApiJson(res);
  if (!res.ok) {
    throw createApiError(json, "Kunne ikke sende testvarsel");
  }

  const parsed = SendTestWebPushResponseSchema.parse(json);
  return parsed.delivered;
}
