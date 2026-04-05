/*
 * Clerk UserProfile – redigering av brukernavn/profil, 2FA og tilkoblede kontoer (Google, Microsoft).
 * Krever innlogging; Clerk håndterer redirect til sign-in ved behov.
 * Kontrast og farger følger globals.css (--clerk-*) for lys/dark; layout er mobilvennlig.
 * Integrert i SidebarAppShell slik at sidebar alltid er synlig.
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { UserProfile, useAuth, useClerk, useUser } from "@clerk/nextjs";
import { useQueryClient } from "@tanstack/react-query";
import { ShieldAlert, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useMeg,
  useOppdaterProfil,
  useSlettKonto,
  type ProfileUpdateWithUsername,
} from "@/app/auth/auth-api";
import { useAuthRedirect } from "@/app/auth/authUtils";
import { useCanvasUser } from "@/app/canvas/canvas-api";
import type { VisningType } from "@/app/components/dashboard/Sidebar";
import { SidebarAppShell } from "@/app/components/layout/SidebarAppShell";
import { showToast } from "@/app/components/ui/Toaster";
import { UsernameConflictError } from "@/app/lib/errors";
import { useLanguage } from "@/app/i18n";
import { broadcastLogout, clearClientAuthState } from "@/app/hooks/use-auth-sync";
import { useUIStore } from "@/app/store/uiStore";
import { LoadingView } from "@/app/components/ui/Loading";

const SIDEBAR_VISNING: VisningType = "settings";

function normalizeName(value: string | null | undefined): string {
  return (value ?? "").trim();
}

/**
 * Separat komponent for kontosletting — isolerer lokal state
 * slik at tastetrykk i bekreftelsesfeltet ikke utløser re-render av Clerk UserProfile.
 */
function SlettKontoSeksjon() {
  const { language, t } = useLanguage();
  const clerk = useClerk();
  const queryClient = useQueryClient();
  const { mutateAsync: slettKonto, isPending: isSlettingKonto } = useSlettKonto();
  const [visKontoSletting, setVisKontoSletting] = useState(false);
  const [kontoSlettBekreftelse, setKontoSlettBekreftelse] = useState("");
  const [kontoSlettes, setKontoSlettes] = useState(false);
  const slettBekreftelsesord = t("settings.deleteAccount.confirmKeyword");

  async function handleSlettKonto() {
    if (kontoSlettes) return;
    setKontoSlettes(true);

    try {
      const result = await slettKonto();
      const harFullstendigEksternOpprydding =
        result.providerAccountDeleted && result.vectorCleanupSucceeded;

      if (harFullstendigEksternOpprydding) {
        showToast.success(
          t("settings.deleteAccount.deleteSuccessTitle"),
          t("settings.deleteAccount.deleteSuccessDescription"),
        );
      } else {
        showToast.warning(
          t("settings.deleteAccount.deletePartialTitle"),
          t("settings.deleteAccount.deletePartialDescription"),
        );
      }

      // Sett utloggingsflagg og naviger umiddelbart for å unngå flash av feilmeldinger
      useUIStore.getState().setIsLoggingOut(true);
      broadcastLogout();
      clearClientAuthState(queryClient);
      window.location.assign("/");

      // Logg ut fra Clerk i bakgrunnen — kontoen er allerede slettet
      void clerk.signOut().catch(() => {});
    } catch (error) {
      setKontoSlettes(false);
      const fallback =
        language === "en"
          ? "Could not delete the account. Please try again."
          : "Kunne ikke slette kontoen. Prøv igjen.";
      const message = error instanceof Error && error.message ? error.message : fallback;
      showToast.error(t("settings.deleteAccount.deleteErrorTitle"), message);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-red-100 p-2 dark:bg-red-900/40">
          <ShieldAlert className="h-5 w-5 text-red-600 dark:text-red-300" />
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">
            {t("settings.deleteAccount.title")}
          </h2>
          <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">
            {t("settings.deleteAccount.description")}
          </p>
        </div>
      </div>

      {!visKontoSletting ? (
        <button
          type="button"
          onClick={() => setVisKontoSletting(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-red-700"
        >
          <Trash2 className="h-4 w-4" />
          {t("settings.deleteAccount.start")}
        </button>
      ) : (
        <div className="space-y-3 rounded-xl border border-red-200 bg-red-50/70 p-4 dark:border-red-900 dark:bg-red-950/20">
          <p className="text-sm text-slate-700 dark:text-slate-300">
            {t("settings.deleteAccount.confirmInstruction", {
              keyword: slettBekreftelsesord,
            })}
          </p>
          <input
            type="text"
            value={kontoSlettBekreftelse}
            onChange={(event) => setKontoSlettBekreftelse(event.target.value)}
            onKeyDown={(event) => event.stopPropagation()}
            placeholder={t("settings.deleteAccount.confirmPlaceholder")}
            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-500"
          />
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void handleSlettKonto()}
              disabled={
                kontoSlettBekreftelse.trim().toUpperCase() !==
                  slettBekreftelsesord.toUpperCase() || isSlettingKonto
              }
              className="rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSlettingKonto
                ? t("settings.deleteAccount.deleting")
                : t("settings.deleteAccount.deletePermanent")}
            </button>
            <button
              type="button"
              onClick={() => {
                setVisKontoSletting(false);
                setKontoSlettBekreftelse("");
              }}
              disabled={isSlettingKonto}
              className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              {t("settings.deleteAccount.cancel")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ProfilPage() {
  const { language, t } = useLanguage();
  const router = useRouter();
  const { isLoaded: authLoaded, userId } = useAuth();
  const { isLoaded: clerkUserLoaded, user: clerkUser } = useUser();
  const { data: meData } = useMeg({ enabled: authLoaded && !!userId });
  const megQuery = useMeg({ enabled: authLoaded && !!userId });
  const { mutateAsync: oppdaterProfil, isPending: isProfilOppdateringPending } = useOppdaterProfil();
  const sisteSyncForsokRef = useRef<string | null>(null);

  const harCanvasToken = meData?.user?.hasCanvasToken ?? false;
  const userQuery = useCanvasUser(megQuery.isSuccess && harCanvasToken);
  const brukernavn =
    userQuery.data?.name?.split(" ")[0] ||
    meData?.user?.firstName ||
    meData?.user?.email?.split("@")?.[0];
  const brukerRolle = meData?.user?.role;

  const byttVisning = useCallback(
    (visning: VisningType) => {
      router.push(visning === "chat" ? "/dashboard" : `/dashboard?view=${visning}`);
    },
    [router],
  );

  const isLoggingOut = useUIStore((state) => state.isLoggingOut);
  useAuthRedirect(megQuery);

  useEffect(() => {
    if (!clerkUserLoaded || !meData?.user || isProfilOppdateringPending) return;

    const clerkFirstName = normalizeName(clerkUser?.firstName);
    const clerkLastName = normalizeName(clerkUser?.lastName);
    const clerkUsername = normalizeName(clerkUser?.username);
    const localFirstName = normalizeName(meData.user.firstName);
    const localLastName = normalizeName(meData.user.lastName);
    const localUsername = normalizeName(meData.user.username);

    const profileUpdate: ProfileUpdateWithUsername = {};
    if (clerkFirstName !== localFirstName) profileUpdate.firstName = clerkFirstName;
    if (clerkLastName !== localLastName) profileUpdate.lastName = clerkLastName;
    if (clerkUsername !== localUsername && clerkUsername.length > 0) {
      profileUpdate.username = clerkUsername;
    }

    if (Object.keys(profileUpdate).length === 0) {
      sisteSyncForsokRef.current = null;
      return;
    }

    const syncNokkel = `${localFirstName}|${localLastName}|${localUsername}->${clerkFirstName}|${clerkLastName}|${clerkUsername}`;
    if (sisteSyncForsokRef.current === syncNokkel) return;
    sisteSyncForsokRef.current = syncNokkel;

    void oppdaterProfil({ ...profileUpdate, skipClerkSync: true }).catch(
      async (error: unknown) => {
        if (error instanceof UsernameConflictError) {
          if (clerkUser && localUsername) {
            try {
              await clerkUser.update({ username: localUsername });
            } catch {
              // Ignorer — Clerk kan avvise hvis brukernavnet er uendret
            }
          }
          showToast.warning(
            language === "en"
              ? `Username "${clerkUsername}" is already taken`
              : `Brukernavnet «${clerkUsername}» er allerede tatt`,
            language === "en"
              ? "Choose a different username in your account settings."
              : "Velg et annet brukernavn i kontoinnstillingene.",
          );
        } else {
          showToast.warning(
            language === "en"
              ? "Profile sync failed"
              : "Profilsynk feilet",
            language === "en"
              ? "Profile was updated in account settings, but could not be synced to StudyWise."
              : "Profilen ble oppdatert i kontoinnstillinger, men kunne ikke synkes til StudyWise.",
          );
        }
      },
    );
  }, [
    clerkUser?.firstName,
    clerkUser?.lastName,
    clerkUser?.username,
    clerkUserLoaded,
    isProfilOppdateringPending,
    language,
    meData?.user,
    oppdaterProfil,
  ]);

  if (isLoggingOut) {
    return (
      <SidebarAppShell
        aktivVisning={SIDEBAR_VISNING}
        byttVisning={byttVisning}
        brukernavn={brukernavn}
        brukerRolle={brukerRolle}
      >
        <LoadingView fullPage={false} translationKey="common.loading.generic" />
      </SidebarAppShell>
    );
  }

  return (
    <SidebarAppShell
      aktivVisning={SIDEBAR_VISNING}
      byttVisning={byttVisning}
      brukernavn={brukernavn}
      brukerRolle={brukerRolle}
    >
      <div className="px-3 py-8 pb-12 sm:px-6 sm:py-16">
        <div className="mx-auto w-full max-w-4xl min-w-0">
          <p className="text-sm leading-6 text-slate-500 dark:text-slate-400">
            {t("settings.accountSecurity.connectionHint")}
          </p>
          <div className="mt-3 w-full overflow-x-hidden">
            <UserProfile
              key={language}
              path="/account"
              routing="path"
              appearance={{
                variables: {
                  colorPrimary: "var(--clerk-color-primary)",
                  colorBackground: "var(--clerk-color-background)",
                  colorForeground: "var(--clerk-color-foreground)",
                  colorMutedForeground: "var(--clerk-color-muted-foreground)",
                  colorMuted: "var(--clerk-color-muted)",
                  colorBorder: "var(--clerk-color-border)",
                  colorInput: "var(--clerk-color-input)",
                  colorInputForeground: "var(--clerk-color-input-foreground)",
                  borderRadius: "0.75rem",
                },
                elements: {
                  rootBox: "w-full max-w-full",
                  card: "w-full max-w-full border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800/95",
                  navbar: "max-sm:w-full",
                  scrollBox: "max-w-full",
                  // Skjul e-post- og tilkoblede kontoer-seksjoner i Clerk UI.
                  // E-postendring og provider-kobling/-avkobling styres av lokal backend-policy
                  // og kan ikke utføres trygt via Clerk-managed UI (Clerk godtar endringer
                  // som lokal DB kan avvise, noe som skaper Clerk/lokal-state-divergens).
                  profileSection__emailAddresses: "hidden",
                  profileSection__connectedAccounts: "hidden",
                },
              }}
            >
              <UserProfile.Page
                label={t("settings.deleteAccount.tabLabel")}
                labelIcon={<Trash2 className="h-4 w-4" />}
                url="delete-account"
              >
                <SlettKontoSeksjon />
              </UserProfile.Page>
            </UserProfile>
          </div>
        </div>
      </div>
    </SidebarAppShell>
  );
}
