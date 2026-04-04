import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { subscribeToBrowserPush } from "@/app/notifications/browserPush-api";

const VAPID_PUBLIC_KEY = "AQIDBA";

function createSubscription(input?: {
  endpoint?: string;
  applicationServerKey?: Uint8Array;
  unsubscribe?: ReturnType<typeof vi.fn>;
}): PushSubscription {
  return {
    endpoint: input?.endpoint ?? "https://push.example/subscription",
    options: {
      applicationServerKey:
        input?.applicationServerKey ?? new Uint8Array([1, 2, 3, 4]),
      userVisibleOnly: true,
    },
    unsubscribe: input?.unsubscribe ?? vi.fn().mockResolvedValue(true),
    expirationTime: null,
    getKey: vi.fn(),
    toJSON: vi.fn(),
  } as unknown as PushSubscription;
}

describe("subscribeToBrowserPush", () => {
  const originalServiceWorker = navigator.serviceWorker;
  const originalNotification = window.Notification;
  const originalPushManager = window.PushManager;

  beforeEach(() => {
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: { permission: "default" },
    });
    Object.defineProperty(window, "PushManager", {
      configurable: true,
      value: class PushManager {},
    });
  });

  afterEach(() => {
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: originalServiceWorker,
    });
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: originalNotification,
    });
    Object.defineProperty(window, "PushManager", {
      configurable: true,
      value: originalPushManager,
    });
    vi.restoreAllMocks();
  });

  it("gjenbruker eksisterende abonnement når VAPID-nøkkelen matcher", async () => {
    const existingSubscription = createSubscription();
    const subscribe = vi.fn();
    const registration = {
      pushManager: {
        getSubscription: vi.fn().mockResolvedValue(existingSubscription),
        subscribe,
      },
    } as unknown as ServiceWorkerRegistration;

    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        getRegistration: vi.fn().mockResolvedValue(registration),
        ready: Promise.resolve(registration),
      },
    });

    const result = await subscribeToBrowserPush(VAPID_PUBLIC_KEY);

    expect(result.subscription).toBe(existingSubscription);
    expect(result.replacedEndpoint).toBeUndefined();
    expect(existingSubscription.unsubscribe).not.toHaveBeenCalled();
    expect(subscribe).not.toHaveBeenCalled();
  });

  it("erstatter eksisterende abonnement når VAPID-nøkkelen har endret seg", async () => {
    const unsubscribe = vi.fn().mockResolvedValue(true);
    const existingSubscription = createSubscription({
      endpoint: "https://push.example/gammel",
      applicationServerKey: new Uint8Array([9, 9, 9, 9]),
      unsubscribe,
    });
    const nextSubscription = createSubscription({
      endpoint: "https://push.example/ny",
    });
    const subscribe = vi.fn().mockResolvedValue(nextSubscription);
    const registration = {
      pushManager: {
        getSubscription: vi.fn().mockResolvedValue(existingSubscription),
        subscribe,
      },
    } as unknown as ServiceWorkerRegistration;

    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        getRegistration: vi.fn().mockResolvedValue(registration),
        ready: Promise.resolve(registration),
      },
    });

    const result = await subscribeToBrowserPush(VAPID_PUBLIC_KEY);

    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: new Uint8Array([1, 2, 3, 4]),
    });
    expect(result.subscription).toBe(nextSubscription);
    expect(result.replacedEndpoint).toBe("https://push.example/gammel");
  });
});
