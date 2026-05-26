"use client";

/**
 * React-hook for browser push: håndterer permission, abonnement og preferanser.
 * Synkroniserer subscription mot backend og leser/skriver pref via /api/user.
 */

import { useEffect, useState } from "react";
import { useOppdaterBrowserPushPreferanser } from "@/app/auth/auth-api";
import { showToast } from "@/app/components/ui/Toaster";
import { useLanguage } from "@/app/i18n";
import {
  deleteBrowserPushSubscription,
  getBrowserPushClientConfig,
  getBrowserPushRegistration,
  saveBrowserPushSubscription,
  sendBrowserPushTest,
  subscribeToBrowserPush,
  supportsBrowserPush,
} from "@/app/notifications/browserPush-api";
import type { BrowserPushPreferences, WebPushClientConfigResponse } from "common/notifications";

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
      Pick<BrowserPushPreferences, "announcements" | "deadlines" | "events" | "aiResponses">
    >,
  ) => Promise<void>;
  sendTest: () => Promise<boolean>;
}

const DEFAULT_PREFERENCES: BrowserPushPreferences = {
  enabled: false,
  announcements: true,
  deadlines: true,
  earlyDeadlines: true,
  events: true,
  aiResponses: true,
};

let cachedClientConfig: WebPushClientConfigResponse | null = null;
let clientConfigInFlight: Promise<WebPushClientConfigResponse> | null = null;

/** Nullstill cached config ved utlogging for å hindre at neste bruker arver feil VAPID-nøkkel */
export function clearBrowserPushClientConfigCache(): void {
  cachedClientConfig = null;
  clientConfigInFlight = null;
}

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
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(
    support ? Notification.permission : "unsupported",
  );
  const [configured, setConfigured] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [vapidPublicKey, setVapidPublicKey] = useState("");
  const [preferences, setPreferences] = useState<BrowserPushPreferences>(
    initialPreferences ?? DEFAULT_PREFERENCES,
  );
  const { mutateAsync: savePreferences } = useOppdaterBrowserPushPreferanser();
  const { t } = useLanguage();

  useEffect(() => {
    setPreferences(initialPreferences ?? DEFAULT_PREFERENCES);
  }, [initialPreferences]);

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
        throw new Error("Du må godkjenne nettleservarsler for å aktivere funksjonen.");
      }

      const { subscription, replacedEndpoint } = await subscribeToBrowserPush(vapidPublicKey);
      if (replacedEndpoint) {
        await deleteBrowserPushSubscription(replacedEndpoint).catch(() => {
          // Gammelt abonnement kan allerede være fjernet server-side
        });
      }
      try {
        await saveBrowserPushSubscription(subscription);
      } catch {
        // Rull tilbake nettleser-abonnementet hvis lagring på server feilet
        await subscription.unsubscribe().catch(() => {});
        throw new Error("Kunne ikke lagre push-abonnement på serveren. Prøv igjen.");
      }
      const nextPreferences = {
        ...preferences,
        enabled: true,
      };
      setPreferences(nextPreferences);
      try {
        const updated = await savePreferences(nextPreferences);
        setPreferences(updated.browserPushPreferences ?? nextPreferences);
      } catch {
        // Rull tilbake abonnement ved preferanse-feil
        await deleteBrowserPushSubscription(subscription.endpoint).catch(() => {});
        await subscription.unsubscribe().catch(() => {});
        setPreferences(preferences);
        throw new Error("Kunne ikke lagre varselinnstillinger. Prøv igjen.");
      }
      setSubscribed(true);
    } finally {
      setIsPending(false);
    }
  };

  const disable = async () => {
    setIsPending(true);
    try {
      const registration = support && configured ? await getBrowserPushRegistration() : null;
      const subscription = registration ? await registration.pushManager.getSubscription() : null;

      const nextPreferences = {
        ...preferences,
        enabled: false,
      };
      setPreferences(nextPreferences);
      try {
        const updated = await savePreferences(nextPreferences);
        setPreferences(updated.browserPushPreferences ?? nextPreferences);
      } catch {
        // Rull tilbake ved preferanse-feil
        setPreferences(preferences);
        throw new Error("Kunne ikke lagre varselinnstillinger. Prøv igjen.");
      }

      // Fjern abonnement etter preferanser er lagret — feil her er ikke kritisk
      // siden preferansene allerede er satt til disabled
      if (subscription) {
        await deleteBrowserPushSubscription(subscription.endpoint).catch(() => {
          // Foreldreløst abonnement på server — ryddes opp ved neste enable eller utløper
        });
        await subscription.unsubscribe().catch(() => {
          // Nettleser-abonnementet kan allerede være fjernet
        });
      }
      setSubscribed(false);
    } finally {
      setIsPending(false);
    }
  };

  const updatePreferences = async (
    next: Partial<
      Pick<
        BrowserPushPreferences,
        "announcements" | "deadlines" | "earlyDeadlines" | "events" | "aiResponses"
      >
    >,
  ) => {
    const previousPreferences = preferences;
    setIsPending(true);
    try {
      const nextPreferences = {
        ...preferences,
        ...next,
      };
      // Optimistisk oppdatering — rulles tilbake ved feil
      setPreferences(nextPreferences);
      const updated = await savePreferences(nextPreferences);
      setPreferences(updated.browserPushPreferences ?? nextPreferences);
    } catch {
      // Rull tilbake til forrige state og vis feilmelding
      setPreferences(previousPreferences);
      showToast.error(t("settings.browserPush.preferenceSaveError"));
    } finally {
      setIsPending(false);
    }
  };

  const ensureSubscriptionSyncedForTest = async (): Promise<void> => {
    if (!support) {
      throw new Error("Nettleservarsler støttes ikke i denne nettleseren.");
    }
    if (!configured || !vapidPublicKey) {
      throw new Error("Nettleservarsler er ikke konfigurert på serveren.");
    }

    const currentPermission = Notification.permission;
    setPermission(currentPermission);
    if (currentPermission !== "granted") {
      throw new Error("Du må aktivere nettleservarsler før du kan sende testvarsel.");
    }

    const registration = await getBrowserPushRegistration();
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      const created = await subscribeToBrowserPush(vapidPublicKey);
      subscription = created.subscription;
    }

    await saveBrowserPushSubscription(subscription);
    setSubscribed(true);
  };

  const sendTest = async () => {
    setIsPending(true);
    try {
      await ensureSubscriptionSyncedForTest();
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
