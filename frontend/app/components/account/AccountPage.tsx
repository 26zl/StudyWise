/*
 * Clerk UserProfile – redigering av brukernavn/profil, 2FA og tilkoblede kontoer (Google, Microsoft).
 * Krever innlogging; Clerk håndterer redirect til sign-in ved behov.
 * Kontrast og farger følger globals.css (--clerk-*) for lys/dark; layout er mobilvennlig.
 * Integrert i SidebarAppShell slik at sidebar alltid er synlig.
 *
 * Route-wrapper: app/account/[[...user-profile]]/page.tsx re-eksporterer denne som default.
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { UserProfile, useAuth, useClerk, useUser } from "@clerk/nextjs";
import { useQueryClient } from "@tanstack/react-query";
import { ShieldAlert, Trash2 } from "lucide-react";
import {
  useMeg,
  useOppdaterProfil,
  useSlettKonto,
  type ProfileUpdateWithUsername,
} from "@/app/auth/auth-api";
import { useAuthRedirect } from "@/app/auth/authUtils";
import { showToast } from "@/app/components/ui/Toaster";
import { UsernameConflictError } from "@/app/lib/errors";
import { useLanguage } from "@/app/i18n";
import { broadcastLogout, clearClientAuthState } from "@/app/hooks/use-auth-sync";
import { useUIStore } from "@/app/store/uiStore";

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

      // Sett utloggingsflagg og naviger umiddelbart for å unngå at
      // React Query refetcher og viser feilgrense ("something went wrong").
      // cancelQueries() avbryter in-flight requests kontrollert.
      useUIStore.getState().setIsLoggingOut(true);
      broadcastLogout();
      queryClient.cancelQueries();
      clearClientAuthState(queryClient);
      window.location.assign("/");

      // Logg ut fra Clerk i bakgrunnen — kontoen er allerede slettet,
      // og navigering er startet så dette er ikke synlig for brukeren.
      // Feil her er ikke-kritisk (Clerk-cookien peker til en slettet bruker
      // og vil ryddes ved neste auth-sjekk), men logges for feilsøking.
      void clerk.signOut().catch((err) => {
        const code = (err as { code?: string } | null)?.code ?? "unknown";
        console.warn("Clerk signOut etter kontosletting feilet:", code);
      });
    } catch (error) {
      setKontoSlettes(false);
      const msg = error instanceof Error ? error.message : "";
      // Backend krever nylig innlogging for kontosletting (step-up)
      if (msg.includes("logge inn på nytt") || msg.includes("session_too_old")) {
        showToast.error(
          t("settings.deleteAccount.deleteErrorTitle"),
          t("settings.deleteAccount.sessionTooOld"),
        );
        return;
      }
      const fallback =
        language === "en"
          ? "Could not delete the account. Please try again."
          : "Kunne ikke slette kontoen. Prøv igjen.";
      const message = msg || fallback;
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

export function AccountPage() {
  const { language, t } = useLanguage();
  const { isLoaded: authLoaded, userId } = useAuth();
  const { isLoaded: clerkUserLoaded, user: clerkUser } = useUser();
  const megQuery = useMeg({ enabled: authLoaded && !!userId });
  const meData = megQuery.data;
  const { mutateAsync: oppdaterProfil, isPending: isProfilOppdateringPending } = useOppdaterProfil();
  const sisteSyncForsokRef = useRef<string | null>(null);

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

    void oppdaterProfil(profileUpdate).catch(
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
    clerkUser,
    clerkUser?.firstName,
    clerkUser?.lastName,
    clerkUser?.username,
    clerkUserLoaded,
    isProfilOppdateringPending,
    language,
    meData?.user,
    oppdaterProfil,
  ]);

  return (
      <div className="min-h-full px-4 py-6 text-slate-900 dark:text-slate-100 md:px-8">
        <div className="mx-auto w-full min-w-0 max-w-5xl">
          <h1 className="text-2xl font-semibold">
            {t("settings.accountSecurity.title")}
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {t("settings.accountSecurity.connectionHint")}
          </p>
          <div className="mt-3 w-full max-w-full overflow-x-hidden [touch-action:pan-y]">
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
                  cardBox: { boxShadow: "none", borderRadius: "0.75rem", border: "1px solid var(--clerk-color-border)" },
                  card: "w-full max-w-full border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800/95",
                  navbar: "max-sm:w-full",
                  scrollBox: "max-w-full",
                  // Skjul Clerk sin innebygde "Delete account" — vi har vår egen
                  // som håndterer sletting av både Clerk-konto og all StudyWise-data.
                  profileSection__deleteAccount: { display: "none" },
                  profileSection__danger: { display: "none" },
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
  );
}
