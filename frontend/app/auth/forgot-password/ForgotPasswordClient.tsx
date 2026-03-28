"use client";

import Link from "next/link";
import { useState, type SubmitEvent } from "react";
import { useSignIn } from "@clerk/nextjs";
import { ArrowRight, KeyRound, Mail, ShieldCheck } from "lucide-react";
import { AuthTurnstileInline } from "@/app/auth/AuthTurnstileInline";
import { LoadingView } from "@/app/components/ui/Loading";
import { showToast } from "@/app/components/ui/Toaster";
import { useLanguage } from "@/app/i18n";

type Gjenopprettingssteg = "identify" | "verify" | "setCredential" | "mfa";

type ForgotPasswordClientProps = {
  initialVerified: boolean;
};

export function ForgotPasswordClient({
  initialVerified,
}: ForgotPasswordClientProps) {
  const { t } = useLanguage();
  const { signIn, errors, fetchStatus } = useSignIn();
  const [isVerified, setIsVerified] = useState(initialVerified);
  const [isRedirectingToDashboard, setIsRedirectingToDashboard] = useState(false);

  const [steg, setSteg] = useState<Gjenopprettingssteg>("identify");
  const [epostadresse, setEpostadresse] = useState("");
  const [kode, setKode] = useState("");
  const [passord, setPassord] = useState("");

  const erLaster = fetchStatus === "fetching";
  const generellFeil = errors.global?.[0]?.message ?? null;
  const identifikatorFeil = errors.fields.identifier?.message ?? null;
  const kodeFeil = errors.fields.code?.message ?? null;
  const passordFeil = errors.fields.password?.message ?? null;

  async function nullstillFlyt() {
    setKode("");
    setPassord("");
    setSteg("identify");
    await signIn.reset();
  }

  async function sendKode(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();

    const identifikator = epostadresse.trim();
    if (!identifikator) {
      return;
    }

    const { error: opprettFeil } = await signIn.create({
      identifier: identifikator,
    });
    if (opprettFeil) {
      return;
    }

    const { error: sendFeil } = await signIn.resetPasswordEmailCode.sendCode();
    if (sendFeil) {
      return;
    }

    setSteg("verify");
    showToast.success(
      t("auth.forgotPassword.sent.emailTitle"),
      t("auth.forgotPassword.sent.emailDescription"),
    );
  }

  async function bekreftKode(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();

    const kodeTrimmet = kode.trim();
    if (!kodeTrimmet) {
      return;
    }

    const { error } = await signIn.resetPasswordEmailCode.verifyCode({ code: kodeTrimmet });
    if (error) {
      return;
    }

    setSteg("setCredential");
  }

  async function lagreNyttPassord(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!passord) {
      return;
    }

    const { error } = await signIn.resetPasswordEmailCode.submitPassword({ password: passord });
    if (error) {
      return;
    }

    if (signIn.status === "needs_second_factor") {
      setSteg("mfa");
      return;
    }

    if (signIn.status === "complete") {
      setIsRedirectingToDashboard(true);
      const { error: finalizeError } = await signIn.finalize();

      if (finalizeError) {
        setIsRedirectingToDashboard(false);
        return;
      }

      showToast.success(
        t("auth.forgotPassword.complete.title"),
        t("auth.forgotPassword.complete.description"),
      );
      window.location.href = "/dashboard";
    }
  }

  const stegStatus = {
    identify:
      steg === "identify"
        ? "active"
        : "completed",
    setCredential:
      steg === "setCredential"
        ? "active"
        : steg === "mfa"
          ? "completed"
          : "upcoming",
    verify:
      steg === "verify"
        ? "active"
        : steg === "setCredential" || steg === "mfa"
          ? "completed"
          : "upcoming",
  } as const;

  if (isRedirectingToDashboard) {
    return (
      <div className="w-full max-w-md">
        <div className="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-[0_30px_70px_-35px_rgba(15,23,42,0.35)] dark:border-slate-800/80 dark:bg-slate-900/95 sm:p-7">
          <LoadingView
            fullPage={false}
            translationKey="common.loading.redirectingToDashboard"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-5xl animate-fade-in space-y-6">
      <AuthTurnstileInline
        initialVerified={initialVerified}
        onVerified={() => {
          setIsVerified(true);
        }}
      />

      {isVerified && (
        <div className="grid gap-6 lg:grid-cols-[1.02fr_0.98fr]">
          <section className="relative overflow-hidden rounded-3xl border border-slate-800/80 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.24),transparent_38%),radial-gradient(circle_at_bottom_right,rgba(56,189,248,0.18),transparent_34%),linear-gradient(160deg,rgba(15,23,42,1)_0%,rgba(15,23,42,0.98)_45%,rgba(30,41,59,1)_100%)] p-6 text-slate-50 shadow-[0_30px_70px_-35px_rgba(15,23,42,0.85)] sm:p-8">
            <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
            <div className="absolute -right-12 top-8 h-40 w-40 rounded-full bg-blue-400/20 blur-3xl" />
            <div className="absolute -left-8 bottom-0 h-32 w-32 rounded-full bg-sky-400/10 blur-2xl" />

            <div className="relative flex h-full flex-col gap-8">
              <div className="space-y-4">
                <span className="inline-flex w-fit items-center rounded-full border border-white/12 bg-white/6 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-sky-100/90">
                  {t("auth.forgotPassword.eyebrow")}
                </span>

                <div className="flex items-start gap-4">
                  <div className="rounded-2xl border border-white/10 bg-white/6 p-3 shadow-lg shadow-blue-950/20 ring-1 ring-inset ring-white/10">
                    <KeyRound className="h-6 w-6 text-sky-100" />
                  </div>

                  <div className="space-y-3">
                    <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                      {t("auth.forgotPassword.title")}
                    </h1>
                    <p className="max-w-xl text-sm leading-6 text-slate-200/85 sm:text-base">
                      {t("auth.forgotPassword.description")}
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid gap-3">
                {(["identify", "verify", "setCredential"] as const).map((stegId, indeks) => {
                  const status = stegStatus[stegId];
                  const aktiv = status === "active";
                  const fullfort = status === "completed";

                  return (
                    <div
                      key={stegId}
                      className={[
                        "rounded-2xl border px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-colors",
                        aktiv
                          ? "border-sky-300/25 bg-white/8"
                          : "border-white/10 bg-white/4",
                      ].join(" ")}
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className={[
                            "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm font-semibold",
                            fullfort
                              ? "border-sky-300/45 bg-sky-400/15 text-sky-50"
                              : aktiv
                                ? "border-white/30 bg-white/10 text-white"
                                : "border-white/10 bg-white/6 text-slate-300",
                          ].join(" ")}
                        >
                          {indeks + 1}
                        </div>

                        <div className="space-y-1">
                          <p className="text-sm font-semibold text-white">
                            {t(`auth.forgotPassword.steps.${stegId}`)}
                          </p>
                          <p className="text-sm leading-6 text-slate-300/90">
                            {stegId === "identify" && t("auth.forgotPassword.identifier.description")}
                            {stegId === "verify" && t("auth.forgotPassword.code.descriptionEmail")}
                            {stegId === "setCredential" &&
                              t("auth.forgotPassword.setCredential.description")}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <p className="max-w-lg text-sm leading-6 text-slate-200/72">
                {t("auth.forgotPassword.support")}
              </p>
            </div>
          </section>

          <section className="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-[0_30px_70px_-35px_rgba(15,23,42,0.35)] dark:border-slate-800/80 dark:bg-slate-900/95 sm:p-7">
            <div className="space-y-6">
              <div className="space-y-3">
                <div className="inline-flex w-fit items-center gap-2 rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  <Mail className="h-3.5 w-3.5" />
                  {t("auth.forgotPassword.emailOnly")}
                </div>

                <div className="flex items-center justify-between gap-3">
                  <div className="space-y-1">
                    <h2 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
                      {t("auth.forgotPassword.title")}
                    </h2>
                    <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">
                      {t("auth.forgotPassword.identifier.description")}
                    </p>
                  </div>

                  <Link
                    href="/auth/sign-in"
                    prefetch={false}
                    className="inline-flex items-center gap-2 text-sm font-medium text-blue-700 transition-colors hover:text-blue-800 dark:text-blue-300 dark:hover:text-blue-200"
                  >
                    {t("common.actions.backToSignIn")}
                  </Link>
                </div>
              </div>

              {generellFeil && (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200">
                  {generellFeil}
                </div>
              )}

              {steg === "identify" && (
                <>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-200">
                    <p className="font-semibold text-slate-900 dark:text-slate-50">
                      {t("auth.forgotPassword.thirdParty.title")}
                    </p>
                    <p className="mt-1 leading-6">
                      {t("auth.forgotPassword.thirdParty.description")}
                    </p>
                    <Link
                      href="/auth/sign-in"
                      prefetch={false}
                      className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-blue-700 transition-colors hover:text-blue-800 dark:text-blue-300 dark:hover:text-blue-200"
                    >
                      {t("common.actions.backToSignIn")}
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </div>

                  <form className="space-y-5" onSubmit={sendKode}>
                    <div className="space-y-2">
                      <label
                        htmlFor="email"
                        className="block text-sm font-medium text-slate-700 dark:text-slate-200"
                      >
                        {t("auth.forgotPassword.identifier.emailLabel")}
                      </label>
                      <input
                        id="email"
                        type="email"
                        autoComplete="email"
                        aria-required="true"
                        aria-invalid={!!identifikatorFeil}
                        aria-describedby={identifikatorFeil ? "email-error" : undefined}
                        value={epostadresse}
                        onChange={(event) => setEpostadresse(event.target.value)}
                        placeholder={t("auth.forgotPassword.identifier.emailPlaceholder")}
                        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 shadow-xs transition-colors placeholder:text-slate-400 focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
                      />
                      {identifikatorFeil && (
                        <p id="email-error" className="text-sm text-rose-600 dark:text-rose-300">
                          {identifikatorFeil}
                        </p>
                      )}
                    </div>

                    <button
                      type="submit"
                      disabled={erLaster}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-950/10 transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-400 dark:bg-blue-500 dark:hover:bg-blue-400"
                    >
                      {t("common.actions.sendCode")}
                      <ArrowRight className="h-4 w-4" />
                    </button>
                  </form>
                </>
              )}

              {steg === "verify" && (
                <form className="space-y-5" onSubmit={bekreftKode}>
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-100">
                    <p className="font-semibold">{t("auth.forgotPassword.sent.emailTitle")}</p>
                    <p className="mt-1">{t("auth.forgotPassword.code.descriptionEmail")}</p>
                  </div>

                  <div className="space-y-2">
                    <label
                      htmlFor="code"
                      className="block text-sm font-medium text-slate-700 dark:text-slate-200"
                    >
                      {t("auth.forgotPassword.code.label")}
                    </label>
                    <input
                      id="code"
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      aria-required="true"
                      aria-invalid={!!kodeFeil}
                      aria-describedby={kodeFeil ? "code-error" : undefined}
                      value={kode}
                      onChange={(event) => setKode(event.target.value)}
                      placeholder={t("auth.forgotPassword.code.placeholder")}
                      className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 shadow-xs transition-colors placeholder:text-slate-400 focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
                    />
                    {kodeFeil && (
                      <p id="code-error" className="text-sm text-rose-600 dark:text-rose-300">
                        {kodeFeil}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-col gap-3 sm:flex-row">
                    <button
                      type="submit"
                      disabled={erLaster}
                      className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-950/10 transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-400 dark:bg-blue-500 dark:hover:bg-blue-400"
                    >
                      {t("common.actions.verifyCode")}
                      <ArrowRight className="h-4 w-4" />
                    </button>

                    <button
                      type="button"
                      disabled={erLaster}
                      onClick={() => {
                        void nullstillFlyt();
                      }}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:text-white"
                    >
                      {t("common.actions.change")}
                    </button>
                  </div>
                </form>
              )}

              {steg === "setCredential" && (
                <form className="space-y-5" onSubmit={lagreNyttPassord}>
                  <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-100">
                    {t("auth.forgotPassword.setCredential.description")}
                  </div>

                  <div className="space-y-2">
                    <label
                      htmlFor="password"
                      className="block text-sm font-medium text-slate-700 dark:text-slate-200"
                    >
                      {t("auth.forgotPassword.setCredential.label")}
                    </label>
                    <input
                      id="password"
                      type="password"
                      autoComplete="new-password"
                      aria-required="true"
                      aria-invalid={!!passordFeil}
                      aria-describedby={passordFeil ? "password-error" : undefined}
                      value={passord}
                      onChange={(event) => setPassord(event.target.value)}
                      placeholder={t("auth.forgotPassword.setCredential.placeholder")}
                      className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 shadow-xs transition-colors placeholder:text-slate-400 focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
                    />
                    {passordFeil && (
                      <p id="password-error" className="text-sm text-rose-600 dark:text-rose-300">
                        {passordFeil}
                      </p>
                    )}
                  </div>

                  <button
                    type="submit"
                    disabled={erLaster}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-950/10 transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-400 dark:bg-blue-500 dark:hover:bg-blue-400"
                  >
                    {t("common.actions.completeReset")}
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </form>
              )}

              {steg === "mfa" && (
                <div className="space-y-5 rounded-2xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-900/60 dark:bg-amber-950/40">
                  <div className="flex items-start gap-3">
                    <div className="rounded-2xl bg-amber-100 p-3 text-amber-700 dark:bg-amber-900/60 dark:text-amber-100">
                      <ShieldCheck className="h-5 w-5" />
                    </div>
                    <div className="space-y-2">
                      <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-50">
                        {t("auth.forgotPassword.mfa.title")}
                      </h3>
                      <p className="text-sm leading-6 text-slate-700 dark:text-slate-200">
                        {t("auth.forgotPassword.mfa.description")}
                      </p>
                    </div>
                  </div>

                  <Link
                    href="/auth/sign-in"
                    prefetch={false}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
                  >
                    {t("common.actions.backToSignIn")}
                  </Link>
                </div>
              )}

              <p className="text-sm leading-6 text-slate-500 dark:text-slate-400">
                {t("auth.forgotPassword.support")}
              </p>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
