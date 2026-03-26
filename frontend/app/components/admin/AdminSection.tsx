/**
 * AdminSection — Admin-panel med faner for statistikk, brukere og revisjonslogg.
 * Kun synlig for brukere med admin-rolle.
 */
"use client";

import { useState } from "react";
import {
  Users,
  BarChart3,
  ScrollText,
  Shield,
  ShieldCheck,
  Trash2,
  Check,
  X,
  Search,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useLanguage } from "@/app/i18n";
import { useMeg } from "@/app/auth/auth-api";
import { LoadingSpinner } from "@/app/components/ui/Loading";
import { FeilMelding } from "@/app/components/ui/FeilMelding";
import { showToast } from "@/app/components/ui/Toaster";
import { formaterDatoLong, formaterDatoOgTid } from "@/app/lib/dato";
import {
  useAdminStats,
  useAdminBrukere,
  useAdminAudit,
  useEndreRolle,
  useSlettBruker,
} from "@/app/admin/admin-api";
import type { AdminBruker } from "@/app/admin/admin-api";

type AdminFane = "stats" | "users" | "audit";

// ── Statistikk-fane ─────────────────────────────────────────────────────────

function StatKort({ label, verdi, ikon: Ikon }: { label: string; verdi: number; ikon: React.ElementType }) {
  return (
    <div className="flex items-center gap-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5">
      <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-700">
        <Ikon size={20} className="text-slate-600 dark:text-slate-300" />
      </div>
      <div>
        <p className="text-2xl font-semibold text-slate-900 dark:text-white">{verdi}</p>
        <p className="text-sm text-slate-500 dark:text-slate-400">{label}</p>
      </div>
    </div>
  );
}

function StatistikkFane() {
  const { t } = useLanguage();
  const { data, isLoading, error } = useAdminStats();

  if (isLoading) return <LoadingSpinner />;
  if (error || !data) return <FeilMelding melding={t("admin.errors.statsFailed")} />;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      <StatKort label={t("admin.stats.totalUsers")} verdi={data.brukere.totalt} ikon={Users} />
      <StatKort label={t("admin.stats.adminUsers")} verdi={data.brukere.admin} ikon={ShieldCheck} />
      <StatKort label={t("admin.stats.regularUsers")} verdi={data.brukere.vanlige} ikon={Users} />
      <StatKort label={t("admin.stats.canvasUsers")} verdi={data.brukere.medCanvas} ikon={Users} />
      <StatKort label={t("admin.stats.totalChats")} verdi={data.samtaler} ikon={ScrollText} />
      <StatKort label={t("admin.stats.totalTasks")} verdi={data.oppgaveoppdelinger} ikon={BarChart3} />
      <StatKort label={t("admin.stats.totalEmbeddings")} verdi={data.embeddings} ikon={ScrollText} />
    </div>
  );
}

// ── Brukere-fane ────────────────────────────────────────────────────────────

function BrukereFane() {
  const { language, t } = useLanguage();
  const megQuery = useMeg();
  const minId = megQuery.data?.user?.id;

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const limit = 20;

  // Enkel debounce
  const [timer, setTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  const handleSearch = (value: string) => {
    setSearch(value);
    if (timer) clearTimeout(timer);
    const t2 = setTimeout(() => {
      setDebouncedSearch(value);
      setOffset(0);
    }, 400);
    setTimer(t2);
  };

  const { data, isLoading, error } = useAdminBrukere({ limit, offset, search: debouncedSearch || undefined });
  const endreRolle = useEndreRolle();
  const slettBruker = useSlettBruker();

  const [bekreftSlett, setBekreftSlett] = useState<string | null>(null);

  const handleEndreRolle = (bruker: AdminBruker) => {
    if (bruker.id === minId) {
      showToast.error(t("admin.users.cannotChangeSelf"));
      return;
    }
    const nyRolle = bruker.rolle === "admin" ? "user" : "admin";
    endreRolle.mutate(
      { brukerId: bruker.id, rolle: nyRolle },
      {
        onSuccess: () => showToast.success(t("admin.users.roleChanged")),
        onError: (err) => showToast.error(err instanceof Error ? err.message : "Feil"),
      },
    );
  };

  const handleSlett = (brukerId: string) => {
    if (brukerId === minId) {
      showToast.error(t("admin.users.cannotDeleteSelf"));
      return;
    }
    slettBruker.mutate(brukerId, {
      onSuccess: () => {
        showToast.success(t("admin.users.userDeleted"));
        setBekreftSlett(null);
      },
      onError: (err) => showToast.error(err instanceof Error ? err.message : "Feil"),
    });
  };

  const total = data?.total ?? 0;
  const harNeste = offset + limit < total;
  const harForrige = offset > 0;

  return (
    <div className="space-y-4">
      {/* Søk */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder={t("admin.users.searchPlaceholder")}
          aria-label={t("admin.users.searchPlaceholder")}
          className="w-full pl-9 pr-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {isLoading && <LoadingSpinner />}
      {error && <FeilMelding melding={t("admin.errors.usersFailed")} />}

      {data && (
        <>
          {/* Tabell */}
          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800 text-left text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  <th className="px-4 py-3">{t("admin.users.email")}</th>
                  <th className="px-4 py-3">{t("admin.users.name")}</th>
                  <th className="px-4 py-3">{t("admin.users.role")}</th>
                  <th className="px-4 py-3">{t("admin.users.canvas")}</th>
                  <th className="px-4 py-3">{t("admin.users.provider")}</th>
                  <th className="px-4 py-3">{t("admin.users.created")}</th>
                  <th className="px-4 py-3">{t("admin.users.actions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {data.brukere.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-slate-500 dark:text-slate-400">
                      {t("admin.users.noUsers")}
                    </td>
                  </tr>
                ) : (
                  data.brukere.map((bruker) => {
                    const erDeg = bruker.id === minId;
                    return (
                      <tr key={bruker.id} className="bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                        <td className="px-4 py-3 text-slate-900 dark:text-white">
                          {bruker.email}
                          {erDeg && (
                            <span className="ml-1.5 text-xs text-sky-600 dark:text-sky-400 font-medium">
                              {t("admin.users.you")}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                          {[bruker.fornavn, bruker.etternavn].filter(Boolean).join(" ") || bruker.brukernavn || "–"}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                              bruker.rolle === "admin"
                                ? "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400"
                                : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
                            }`}
                          >
                            {bruker.rolle === "admin" && <Shield size={12} />}
                            {bruker.rolle}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {bruker.harCanvasToken ? (
                            <Check size={16} className="text-green-500" />
                          ) : (
                            <X size={16} className="text-slate-300 dark:text-slate-600" />
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center rounded-full bg-slate-100 dark:bg-slate-700 px-2.5 py-0.5 text-xs text-slate-600 dark:text-slate-300 capitalize">
                            {bruker.authProvider ?? "–"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-500 dark:text-slate-400 whitespace-nowrap">
                          {formaterDatoLong(bruker.opprettet, language)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {!erDeg && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleEndreRolle(bruker)}
                                  disabled={endreRolle.isPending}
                                  title={t("admin.users.changeRole")}
                                  className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-sky-600 dark:hover:text-sky-400 transition-colors disabled:opacity-50"
                                >
                                  <ShieldCheck size={16} />
                                </button>
                                {bekreftSlett === bruker.id ? (
                                  <div className="flex items-center gap-1">
                                    <button
                                      type="button"
                                      onClick={() => handleSlett(bruker.id)}
                                      disabled={slettBruker.isPending}
                                      className="rounded-lg p-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50"
                                    >
                                      <Check size={16} />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setBekreftSlett(null)}
                                      className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                                    >
                                      <X size={16} />
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => setBekreftSlett(bruker.id)}
                                    title={t("admin.users.deleteUser")}
                                    className="rounded-lg p-1.5 text-slate-500 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                                  >
                                    <Trash2 size={16} />
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Paginering */}
          {total > limit && (
            <div className="flex items-center justify-between text-sm text-slate-500 dark:text-slate-400">
              <span>
                {offset + 1}–{Math.min(offset + limit, total)} / {total}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setOffset((o) => Math.max(0, o - limit))}
                  disabled={!harForrige}
                  className="rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 transition-colors"
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => setOffset((o) => o + limit)}
                  disabled={!harNeste}
                  className="rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 transition-colors"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Revisjonslogg-fane ──────────────────────────────────────────────────────

function RevisjonsloggFane() {
  const { language, t } = useLanguage();
  const [offset, setOffset] = useState(0);
  const limit = 50;

  const { data, isLoading, error } = useAdminAudit({ limit, offset });

  const total = data?.total ?? 0;
  const harNeste = offset + limit < total;
  const harForrige = offset > 0;

  if (isLoading) return <LoadingSpinner />;
  if (error) return <FeilMelding melding={t("admin.errors.auditFailed")} />;

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 dark:bg-slate-800 text-left text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
              <th className="px-4 py-3">{t("admin.audit.action")}</th>
              <th className="px-4 py-3">{t("admin.audit.category")}</th>
              <th className="px-4 py-3">{t("admin.audit.outcome")}</th>
              <th className="px-4 py-3">{t("admin.audit.actor")}</th>
              <th className="px-4 py-3">{t("admin.audit.time")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
            {(!data || data.items.length === 0) ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-500 dark:text-slate-400">
                  {t("admin.audit.noEntries")}
                </td>
              </tr>
            ) : (
              data.items.map((item) => (
                <tr key={item.id} className="bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                  <td className="px-4 py-3 text-slate-900 dark:text-white font-mono text-xs">
                    {item.action}
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-slate-100 dark:bg-slate-700 px-2.5 py-0.5 text-xs text-slate-600 dark:text-slate-300">
                      {item.category}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`text-xs font-medium ${
                        item.outcome === "success"
                          ? "text-green-600 dark:text-green-400"
                          : "text-red-600 dark:text-red-400"
                      }`}
                    >
                      {item.outcome}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-500 dark:text-slate-400 font-mono text-xs truncate max-w-30">
                    {item.actorUserId}
                  </td>
                  <td className="px-4 py-3 text-slate-500 dark:text-slate-400 whitespace-nowrap">
                    {formaterDatoOgTid(item.createdAt, language)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {total > limit && (
        <div className="flex items-center justify-between text-sm text-slate-500 dark:text-slate-400">
          <span>
            {offset + 1}–{Math.min(offset + limit, total)} / {total}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setOffset((o) => Math.max(0, o - limit))}
              disabled={!harForrige}
              className="rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 transition-colors"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              type="button"
              onClick={() => setOffset((o) => o + limit)}
              disabled={!harNeste}
              className="rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 transition-colors"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Hovedkomponent ──────────────────────────────────────────────────────────

const FANER: { id: AdminFane; ikon: React.ElementType; labelKey: "admin.tabs.stats" | "admin.tabs.users" | "admin.tabs.audit" }[] = [
  { id: "stats", ikon: BarChart3, labelKey: "admin.tabs.stats" },
  { id: "users", ikon: Users, labelKey: "admin.tabs.users" },
  { id: "audit", ikon: ScrollText, labelKey: "admin.tabs.audit" },
];

export function AdminSection() {
  const { t } = useLanguage();
  const [aktivFane, setAktivFane] = useState<AdminFane>("stats");

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/30">
          <Shield size={20} className="text-amber-600 dark:text-amber-400" />
        </div>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-white">
          {t("admin.title")}
        </h1>
      </div>

      {/* Faner */}
      <div role="tablist" aria-label={t("admin.title")} className="flex gap-1 rounded-xl bg-slate-100 dark:bg-slate-800 p-1">
        {FANER.map(({ id, ikon: Ikon, labelKey }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={aktivFane === id}
            aria-controls={`admin-tabpanel-${id}`}
            id={`admin-tab-${id}`}
            onClick={() => setAktivFane(id)}
            className={`flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${
              aktivFane === id
                ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm"
                : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
            }`}
          >
            <Ikon size={16} />
            {t(labelKey)}
          </button>
        ))}
      </div>

      {/* Innhold */}
      <div role="tabpanel" id={`admin-tabpanel-${aktivFane}`} aria-labelledby={`admin-tab-${aktivFane}`}>
        {aktivFane === "stats" && <StatistikkFane />}
        {aktivFane === "users" && <BrukereFane />}
        {aktivFane === "audit" && <RevisjonsloggFane />}
      </div>
    </div>
  );
}
