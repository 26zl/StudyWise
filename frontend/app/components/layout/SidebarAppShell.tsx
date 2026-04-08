/**
 * SidebarAppShell – app-skall med sidebar (dashboard-navigasjon), hovedinnhold og valgfri footer.
 */
"use client";

import type { ReactNode } from "react";
import { Sidebar, type VisningType } from "@/app/components/dashboard/Sidebar";
import { Footer } from "@/app/components/layout/footer";
import { cn } from "@/app/lib/utils";
import { useLanguage } from "@/app/i18n";

type SidebarAppShellProps = {
  aktivVisning: VisningType;
  byttVisning: (visning: VisningType) => void;
  brukernavn?: string;
  brukerRolle?: string;
  footer?: boolean;
  contentClassName?: string;
  children: ReactNode;
};

export function SidebarAppShell({
  aktivVisning,
  byttVisning,
  brukernavn,
  brukerRolle,
  footer = true,
  contentClassName,
  children,
}: SidebarAppShellProps) {
  const { t } = useLanguage();
  return (
    <div className="flex h-full min-h-full min-w-0 flex-col text-slate-900 dark:text-slate-100 md:flex-row">
      <Sidebar
        aktivVisning={aktivVisning}
        byttVisning={byttVisning}
        brukernavn={brukernavn}
        brukerRolle={brukerRolle}
      />
      <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label={t("chat.appContentLabel")}>
        <div
          className={cn(
            "flex-1 min-h-0 overflow-y-auto overscroll-y-contain [-webkit-overflow-scrolling:touch]",
            contentClassName,
          )}
        >
          {children}
        </div>
        {footer ? <Footer /> : null}
      </section>
    </div>
  );
}


