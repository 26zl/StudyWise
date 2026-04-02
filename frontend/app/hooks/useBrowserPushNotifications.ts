"use client";

import { useEffect, useState } from "react";
import { useOppdaterBrowserPushPreferanser } from "@/app/auth/auth-api";
import {
  deleteBrowserPushSubscription,
  getBrowserPushClientConfig,
  getBrowserPushRegistration,
  saveBrowserPushSubscription,
  sendBrowserPushTest,
  subscribeToBrowserPush,
  supportsBrowserPush,
} from "@/app/notifications/browserPush-api";
import type {
  BrowserPushPreferences,
  WebPushClientConfigResponse,
} from "common/notifications";

export interface UseBrowserPushNotificationsResult {
  supported: boolean;
  configured: boolean;
  permission: NotificationPermission | "unsupported";
  subscribed: boolean;
  isPending: boolean;
  preferences: BrowserPushPreferences;
  enable: () => Promise<void>;
  disable: () => Promise<void>;
  updatePreferences: (
    next: Partial<
      Pick<
        BrowserPushPreferences,
        "announcements" | "deadlines" | "events" | "aiResponses"
      >
    >,
  ) => Promise<void>;
  sendTest: () => Promise<boolean>;
}

const DEFAULT_PREFERENCES: BrowserPushPreferences = {
  enabled: false,
  announcements: true,
  deadlines: true,
  events: true,
  aiResponses: true,
};

let cachedClientConfig: WebPushClientConfigResponse | null = null;
let clientConfigInFlight: Promise<WebPushClientConfigResponse> | null = null;

async function loadBrowserPushClientConfig(): Promise<WebPushClientConfigResponse> {
  if (cachedClientConfig) {
    return cachedClientConfig;
  }

  if (!clientConfigInFlight) {
    clientConfigInFlight = getBrowserPushClientConfig()
      .then((config) => {
        cachedClientConfig = config;
        return config;
      })
      .finally(() => {
        clientConfigInFlight = null;
      });
  }

  return clientConfigInFlight;
}

export function useBrowserPushNotifications(
  initialPreferences?: BrowserPushPreferences,
): UseBrowserPushNotificationsResult {
  const support = supportsBrowserPush();
  const [permission, setPermission] = useState<
    NotificationPermission | "unsupported"
  >(support ? Notification.permission : "unsupported");
  const [configured, setConfigured] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [vapidPublicKey, setVapidPublicKey] = useState("");
  const [preferences, setPreferences] = useState<BrowserPushPreferences>(
    initialPreferences ?? DEFAULT_PREFERENCES,
  );
  const { mutateAsync: savePreferences } = useOppdaterBrowserPushPreferanser();

  useEffect(() => {
    if (!support) return;

    let active = true;
    void loadBrowserPushClientConfig()
      .then((config) => {
        if (!active) return;
        setConfigured(config.configured);
        setVapidPublicKey(config.publicKey);
      })
      .catch(() => {
        if (!active) return;
        setConfigured(false);
        setVapidPublicKey("");
      });

    return () => {
      active = false;
    };
  }, [support]);

  useEffect(() => {
    if (!support || !configured) {
      setSubscribed(false);
      return;
    }

    let active = true;
    void getBrowserPushRegistration()
      .then((registration) => registration.pushManager.getSubscription())
      .then((subscription) => {
        if (!active) return;
        setSubscribed(Boolean(subscription));
        setPermission(Notification.permission);
      })
      .catch(() => {
        if (!active) return;
        setSubscribed(false);
      });

    return () => {
      active = false;
    };
  }, [configured, support]);

  const enable = async () => {
    if (!support) {
      throw new Error("Nettleservarsler støttes ikke i denne nettleseren.");
    }
    if (!configured || !vapidPublicKey) {
      throw new Error("Nettleservarsler er ikke konfigurert på serveren.");
    }

    setIsPending(true);
    try {
      const nextPermission = await Notification.requestPermission();
      setPermission(nextPermission);
      if (nextPermission !== "granted") {
        throw new Error(
          "Du må godkjenne nettleservarsler for å aktivere funksjonen.",
        );
      }

      const subscription = await subscribeToBrowserPush(vapidPublicKey);
      await saveBrowserPushSubscription(subscription);
      const nextPreferences = {
        ...preferences,
        enabled: true,
      };
      // Optimistic: update UI immediately
      setPreferences(nextPreferences);
      const updated = await savePreferences(nextPreferences);
      setPreferences(updated.browserPushPreferences ?? nextPreferences);
      setSubscribed(true);
    } finally {
      setIsPending(false);
    }
  };

  const disable = async () => {
    setIsPending(true);
    try {
      const registration =
        support && configured ? await getBrowserPushRegistration() : null;
      const subscription = registration
        ? await registration.pushManager.getSubscription()
        : null;

      if (subscription) {
        await deleteBrowserPushSubscription(subscription.endpoint);
        await subscription.unsubscribe();
      }

      const nextPreferences = {
        ...preferences,
        enabled: false,
      };
      // Optimistic: update UI immediately
      setPreferences(nextPreferences);
      const updated = await savePreferences(nextPreferences);
      setPreferences(updated.browserPushPreferences ?? nextPreferences);
      setSubscribed(false);
    } finally {
      setIsPending(false);
    }
  };

  const updatePreferences = async (
    next: Partial<
      Pick<
        BrowserPushPreferences,
        "announcements" | "deadlines" | "events" | "aiResponses"
      >
    >,
  ) => {
    setIsPending(true);
    try {
      const nextPreferences = {
        ...preferences,
        ...next,
      };
      // Optimistic: update UI immediately
      setPreferences(nextPreferences);
      const updated = await savePreferences(nextPreferences);
      setPreferences(updated.browserPushPreferences ?? nextPreferences);
    } finally {
      setIsPending(false);
    }
  };

  const sendTest = async () => {
    setIsPending(true);
    try {
      return await sendBrowserPushTest();
    } finally {
      setIsPending(false);
    }
  };

  return {
    supported: support,
    configured,
    permission,
    subscribed,
    isPending,
    preferences,
    enable,
    disable,
    updatePreferences,
    sendTest,
  };
}
