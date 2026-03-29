/*
 * Clerk UserProfile – redigering av brukernavn/profil, 2FA og tilkoblede kontoer (Google, Microsoft).
 * Krever innlogging; Clerk håndterer redirect til sign-in ved behov.
 * Kontrast og farger følger globals.css (--clerk-*) for lys/dark; layout er mobilvennlig.
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { UserProfile, useAuth, useClerk, useUser } from "@clerk/nextjs";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { ShieldAlert, Trash2 } from "lucide-react";
import { Footer } from "@/app/components/layout/footer";
import {
  useMeg,
  useOppdaterProfil,
  useSlettKonto,
  type ProfileUpdateWithUsername,
} from "@/app/auth/auth-api";
import { LoadingView } from "@/app/components/ui/Loading";
import { showToast } from "@/app/components/ui/Toaster";
import { useLanguage } from "@/app/i18n";
import { broadcastLogout, clearClientAuthState } from "@/app/hooks/use-auth-sync";

function normalizeName(value: string | null | undefined): string {
  return (value ?? "").trim();
}

export default function ProfilPage() {
  const { language, t } = useLanguage();
  const clerk = useClerk();
  const queryClient = useQueryClient();
  const { isLoaded: authLoaded, userId } = useAuth();
  const { isLoaded: clerkUserLoaded, user: clerkUser } = useUser();
  const { data: meData } = useMeg({ enabled: authLoaded && !!userId });
  const { mutateAsync: oppdaterProfil, isPending: isProfilOppdateringPending } = useOppdaterProfil();
  const { mutateAsync: slettKonto, isPending: isSlettingKonto } = useSlettKonto();
  const sisteSyncForsokRef = useRef<string | null>(null);
  const [kontoSlettes, setKontoSlettes] = useState(false);
  const [visKontoSletting, setVisKontoSletting] = useState(false);
  const [kontoSlettBekreftelse, setKontoSlettBekreftelse] = useState("");
  const slettBekreftelsesord = t("settings.deleteAccount.confirmKeyword");
  const backLabel = language === "en" ? "Back to dashboard" : "Tilbake til dashboard";

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

    void oppdaterProfil({ ...profileUpdate, skipClerkSync: true }).catch(() => {
      showToast.warning(
        language === "en" ? "Profile sync failed" : "Profilsynk feilet",
        language === "en"
          ? "Profile was updated in account settings, but could not be synced to StudyWise."
          : "Profilen ble oppdatert i kontoinnstillinger, men kunne ikke synkes til StudyWise.",
      );
    });
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

  async function handleSlettKonto() {
    if (kontoSlettes) return;
    setKontoSlettes(true);

    const fullforLokalUtlogging = () => {
      broadcastLogout();
      clearClientAuthState(queryClient);
      window.location.assign("/");
    };

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

      try {
        await clerk.signOut();
      } catch {
        showToast.warning(
          t("settings.deleteAccount.manualSignOutTitle"),
          t("settings.deleteAccount.manualSignOutDescription"),
        );
      }

      fullforLokalUtlogging();
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

  if (kontoSlettes || isSlettingKonto) {
    return (
      <LoadingView
        text={t("settings.deleteAccount.deleting")}
        className="min-h-screen"
      />
    );
  }

  return (
    <div className="min-h-full flex flex-col bg-slate-50 dark:bg-slate-950">
      <div className="flex-1 px-3 py-4 pb-12 sm:px-4 sm:py-6">
        <div className="mx-auto w-full max-w-4xl min-w-0">
          <Link
            href="/dashboard"
            prefetch={false}
            className="inline-flex min-h-11 min-w-11 items-center rounded-lg py-2 text-sm text-slate-700 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:text-slate-300 dark:hover:text-white"
          >
            ← {backLabel}
          </Link>
          <p className="mt-4 text-sm leading-6 text-slate-500 dark:text-slate-400">
            {t("settings.accountSecurity.connectionHint")}
          </p>
          <div className="mt-3 w-full overflow-x-hidden">
            <UserProfile
              key={language}
              path="/profil"
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
                },
              }}
            />
          </div>
          <div className="mt-6 rounded-2xl border border-red-200 bg-red-50/70 p-5 shadow-sm dark:border-red-900 dark:bg-red-950/20">
            <div className="flex items-start gap-3">
              <div className="rounded-xl bg-red-100 p-2 dark:bg-red-900/40">
                <ShieldAlert className="h-5 w-5 text-red-600 dark:text-red-300" />
              </div>
              <div className="min-w-0 flex-1 space-y-4">
                <div className="space-y-1">
                  <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                    {t("settings.deleteAccount.title")}
                  </h2>
                  <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">
                    {t("settings.deleteAccount.description")}
                  </p>
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
                  <div className="space-y-3 rounded-xl border border-red-200 bg-white/80 p-4 dark:border-red-900 dark:bg-slate-900/40">
                    <p className="text-sm text-slate-700 dark:text-slate-300">
                      {t("settings.deleteAccount.confirmInstruction", {
                        keyword: slettBekreftelsesord,
                      })}
                    </p>
                    <input
                      type="text"
                      value={kontoSlettBekreftelse}
                      onChange={(event) => setKontoSlettBekreftelse(event.target.value)}
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
            </div>
          </div>
        </div>
      </div>
      <Footer />
    </div>
  );
}
