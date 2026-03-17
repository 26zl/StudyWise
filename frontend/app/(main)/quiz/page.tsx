/**
 * Quiz-side — KI-generert quiz basert på Canvas-kursinnhold.
 * Vises som en egen side med sidebar via SidebarAppShell.
 */
"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { useMeg } from "@/app/auth/auth-api";
import { useCanvasUser } from "@/app/canvas/canvas-api";
import { skalRedirecteTilAuth, useAuthRedirect } from "@/app/auth/authUtils";
import { getBrukerdataFeilmelding } from "@/app/lib/errorUtils";
import { type VisningType } from "@/app/components/dashboard/Sidebar";
import {
  SidebarAppErrorState,
  SidebarAppLoadingState,
  SidebarAppShell,
} from "@/app/components/layout/SidebarAppShell";
import { QuizView } from "@/app/components/ki/QuizView";

const SIDEBAR_VISNING: VisningType = "chat";

export default function QuizPage() {
  const router = useRouter();
  const { isLoaded: clerkLoaded } = useAuth();
  const megQuery = useMeg({ enabled: clerkLoaded });
  const harCanvasToken = megQuery.data?.user?.hasCanvasToken ?? false;
  const userQuery = useCanvasUser(megQuery.isSuccess && harCanvasToken);

  const brukernavn =
    userQuery.data?.name?.split(" ")[0] ||
    megQuery.data?.user?.firstName ||
    megQuery.data?.user?.email?.split("@")?.[0];

  const byttVisning = useCallback(
    (visning: VisningType) => {
      router.push(visning === "chat" ? "/dashboard" : `/dashboard?view=${visning}`);
    },
    [router],
  );

  useAuthRedirect(megQuery);

  if (megQuery.isLoading) {
    return (
      <SidebarAppLoadingState
        aktivVisning={SIDEBAR_VISNING}
        byttVisning={byttVisning}
        brukernavn={brukernavn}
        label="Laster quiz..."
      />
    );
  }

  if (skalRedirecteTilAuth(megQuery)) {
    return (
      <SidebarAppLoadingState
        aktivVisning={SIDEBAR_VISNING}
        byttVisning={byttVisning}
        label="Sender deg til innlogging..."
      />
    );
  }

  if (megQuery.isError && !megQuery.data?.user) {
    const feilmelding = getBrukerdataFeilmelding(megQuery.error);
    return (
      <SidebarAppErrorState
        aktivVisning={SIDEBAR_VISNING}
        byttVisning={byttVisning}
        message={feilmelding}
        onRetry={() => {
          void megQuery.refetch();
        }}
      />
    );
  }

  return (
    <SidebarAppShell
      aktivVisning={SIDEBAR_VISNING}
      byttVisning={byttVisning}
      brukernavn={brukernavn}
    >
      <QuizView />
    </SidebarAppShell>
  );
}