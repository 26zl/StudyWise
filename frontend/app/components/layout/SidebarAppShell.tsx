/**
 * SidebarAppShell – app-skall med sidebar (dashboard-navigasjon), hovedinnhold og valgfri footer.
 * Eksporterer også SidebarAppLoadingState og SidebarAppErrorState for felles last-/feilvisning.
 */
"use client";

import type { ReactNode } from "react";
import { Sidebar, type VisningType } from "@/app/components/dashboard/Sidebar";
import { Footer } from "@/app/components/layout/footer";
import { FeilMelding } from "@/app/components/ui/FeilMelding";
import { LoadingView } from "@/app/components/ui/Loading";
import { cn } from "@/app/lib/utils";
import { useLanguage } from "@/app/i18n";

type SidebarAppShellProps = {
  aktivVisning: VisningType;
  byttVisning: (visning: VisningType) => void;
  brukernavn?: string;
  footer?: boolean;
  contentClassName?: string;
  children: ReactNode;
};

type SidebarAppStateProps = Pick<
  SidebarAppShellProps,
  "aktivVisning" | "byttVisning" | "brukernavn" | "footer"
> & {
  className?: string;
  children: ReactNode;
};

type SidebarAppLoadingStateProps = Pick<
  SidebarAppShellProps,
  "aktivVisning" | "byttVisning" | "brukernavn" | "footer"
> & {
  label?: string;
};

type SidebarAppErrorStateProps = Pick<
  SidebarAppShellProps,
  "aktivVisning" | "byttVisning" | "brukernavn" | "footer"
> & {
  message: string;
  onRetry?: () => void;
};

export function SidebarAppShell({
  aktivVisning,
  byttVisning,
  brukernavn,
  footer = true,
  contentClassName,
  children,
}: SidebarAppShellProps) {
  return (
    <div className="flex h-full min-h-full min-w-0 flex-col bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100 md:flex-row">
      <Sidebar
        aktivVisning={aktivVisning}
        byttVisning={byttVisning}
        brukernavn={brukernavn}
      />
      <main className="flex min-w-0 flex-1 flex-col bg-white dark:bg-slate-900">
        <div className={cn("flex-1 min-h-0 overflow-y-auto", contentClassName)}>{children}</div>
        {footer ? <Footer /> : null}
      </main>
    </div>
  );
}

function SidebarAppState({
  aktivVisning,
  byttVisning,
  brukernavn,
  footer = true,
  className,
  children,
}: SidebarAppStateProps) {
  return (
    <SidebarAppShell
      aktivVisning={aktivVisning}
      byttVisning={byttVisning}
      brukernavn={brukernavn}
      footer={footer}
      contentClassName="bg-slate-50 dark:bg-slate-950"
    >
      <div
        className={cn(
          "flex min-h-full flex-col items-center justify-center gap-4 p-6 text-center",
          className,
        )}
      >
        {children}
      </div>
    </SidebarAppShell>
  );
}

export function SidebarAppLoadingState({
  aktivVisning,
  byttVisning,
  brukernavn,
  footer,
  label,
}: SidebarAppLoadingStateProps) {
  const { t } = useLanguage();
  return (
    <SidebarAppState
      aktivVisning={aktivVisning}
      byttVisning={byttVisning}
      brukernavn={brukernavn}
      footer={footer}
    >
      <LoadingView text={label ?? t("common.loading")} fullPage={false} />
    </SidebarAppState>
  );
}

export function SidebarAppErrorState({
  aktivVisning,
  byttVisning,
  brukernavn,
  footer,
  message,
  onRetry,
}: SidebarAppErrorStateProps) {
  const { t } = useLanguage();
  return (
    <SidebarAppState
      aktivVisning={aktivVisning}
      byttVisning={byttVisning}
      brukernavn={brukernavn}
      footer={footer}
      className="gap-5"
    >
      <div className="w-full max-w-md">
        <FeilMelding melding={message} />
      </div>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
        >
          {t("common.retry")}
        </button>
      ) : null}
    </SidebarAppState>
  );
}
