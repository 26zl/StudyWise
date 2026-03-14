/*
 * Dashboard loading UI – vises med én gang ved navigering til /dashboard.
 * Reduserer opplevd ventetid (LCP) og unngår blank skjerm mens RSC/data lastes.
 */
import { LoadingView } from "@/app/components/ui/Loading";

export default function DashboardLoading() {
  return <LoadingView text="Laster dashboard..." />;
}
