/*
 * Oversikt - Hovedoversiktsside for innlogget bruker
 * Viser KI-ukeplan, Canvas-statistikk og rask tilgang til funksjoner
 */
"use client";

import { useCallback, useEffect } from "react";
import { startOfDay, addDays } from "date-fns";
import { Sparkles, Calendar, BookOpen, MessageSquare, TrendingUp, Clock, AlertCircle } from "lucide-react";
import { FeilMelding } from "../components/FeilMelding";
import { WeeklyPlanSuggestions } from "../components/WeeklyPlanSuggestions";
import { Sidebar, type VisningType } from "../components/Sidebar";
import { useCanvasCourses, useCanvasAllAssignments, useCanvasUser, type AssignmentMedEmne } from "../canvas/canvas-api";
import { erInnlevert } from "../canvas/canvasUtils";
import { useMeg } from "../auth/auth-api";
import { skalRedirecteTilAuth } from "../auth/authUtils";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formaterDatoFull, formaterDatoShort, dagerFraIdag, formaterDagerRelativtFrist } from "../lib/dato";
import { FRIST_VINDU_DAGER } from "../lib/varsler";
import { lagBrukervennligFeilmelding } from "../lib/errorUtils";
import { LoadingSpinner } from "../components/LoadingSpinner";

// Denne siden er hovedoversikten for innloggede brukere, og viser en personlig ukeplan, statistikk og rask tilgang til funksjoner. Den håndterer også redirect til innlogging hvis ikke autentisert.
export default function OversiktPage() {
    const router = useRouter();
    const megQuery = useMeg();
    const harCanvasToken = megQuery.data?.user?.hasCanvasToken ?? false;
    const userQuery = useCanvasUser(megQuery.isSuccess && harCanvasToken);
    const brukernavn =
        userQuery.data?.name?.split(" ")[0] ||
        megQuery.data?.user?.firstName ||
        megQuery.data?.user?.email?.split("@")[0];
    const byttVisning = useCallback(
        (visning: VisningType) => {
            router.push(visning === "chat" ? "/dashboard" : `/dashboard?view=${visning}`);
        },
        [router]
    );

    // Redirect til innlogging hvis ikke autentisert
    useEffect(() => {
        if (skalRedirecteTilAuth(megQuery)) {
            router.replace("/auth");
        }
    }, [megQuery.isError, megQuery.isFetched, megQuery.isLoading, megQuery.data?.user, router]);

    const coursesQuery = useCanvasCourses(harCanvasToken);
    const assignmentsQuery = useCanvasAllAssignments({ enabled: harCanvasToken });

    // Fersk data når bruker åpner oversikt (både emner og oppgaver)
    useEffect(() => {
        if (!harCanvasToken) return;
        void coursesQuery.refetch();
        void assignmentsQuery.refetch();
    }, [harCanvasToken]); 

    // Kun oppgaver som ikke er innlevert (riktig grunnlag for ukeplan og kommende)
    const allAssignments: AssignmentMedEmne[] = assignmentsQuery.isError ? [] : (assignmentsQuery.data || []);
    const ikkeInnleverteAssignments = allAssignments.filter((a) => !erInnlevert(a));

    // Beregn statistikk
    const totalCourses = coursesQuery.data?.courses?.length || 0;
    const totalAssignments = allAssignments.length;

    // Kommende oppgaver: frist innen FRIST_VINDU_DAGER (samme vindu som varslinger)
    const todayStart = startOfDay(new Date());
    const vinduSlutt = addDays(todayStart, FRIST_VINDU_DAGER);
    const upcomingAssignments = ikkeInnleverteAssignments.filter((a) => {
        if (!a.due_at) return false;
        const dueDay = startOfDay(new Date(a.due_at));
        return dueDay >= todayStart && dueDay < vinduSlutt;
    });

    // Aktive emner (emner med oppgaver)
    const activeCoursesCount = new Set(
        allAssignments.filter((a) => a.course_id != null).map((a) => a.course_id)
    ).size;

    // Vis lasteskjerm mens brukerdata hentes
    if (megQuery.isLoading) {
        return (
            <div className="h-full flex flex-col md:flex-row bg-slate-50 dark:bg-slate-950">
                <Sidebar aktivVisning="chat" byttVisning={byttVisning} brukernavn={brukernavn} />
                <main className="flex-1 min-h-0 overflow-y-auto flex items-center justify-center p-8">
                    <LoadingSpinner />
                </main>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col md:flex-row bg-slate-50 dark:bg-slate-950">
            <Sidebar aktivVisning="chat" byttVisning={byttVisning} brukernavn={brukernavn} />
            <main className="flex-1 min-h-0 overflow-y-auto bg-white dark:bg-slate-900">
                <div className="min-h-full bg-slate-50 dark:bg-slate-950">
            {/* Header */}
            <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <h1 className="text-3xl font-bold text-slate-900 dark:text-white">
                                Oversikt
                            </h1>
                            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                                {formaterDatoFull(new Date())}
                            </p>
                        </div>
                        <div className="flex items-center gap-3">
                            <Link
                                href="/dashboard"
                                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                            >
                                <MessageSquare size={18} />
                                <span>KI Chat</span>
                            </Link>
                        </div>
                    </div>
                </div>
            </div>

            {/* Main Content */}
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
                
                {/* Stats Cards */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <StatCard
                        icon={BookOpen}
                        label="Aktive emner"
                        value={assignmentsQuery.isError ? "—" : activeCoursesCount}
                        color="blue"
                    />
                    <StatCard
                        icon={Clock}
                        label="Kommende oppgaver"
                        value={assignmentsQuery.isError ? "—" : upcomingAssignments.length}
                        color="yellow"
                    />
                    <StatCard
                        icon={TrendingUp}
                        label="Totalt oppgaver"
                        value={assignmentsQuery.isError ? "—" : totalAssignments}
                        color="green"
                    />
                    <StatCard
                        icon={Calendar}
                        label="Emner totalt"
                        value={totalCourses}
                        color="purple"
                    />
                </div>

                {/* KI Ukeplan */}
                <div className="space-y-2">
                    <div className="flex items-center gap-2">
                        <Sparkles className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                        <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
                            Din personlige ukeplan
                        </h2>
                    </div>
                    
                    {assignmentsQuery.isLoading ? (
                        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-8 text-center">
                            <div className="animate-pulse space-y-3">
                                <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-3/4 mx-auto"></div>
                                <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-1/2 mx-auto"></div>
                            </div>
                        </div>
                    ) : assignmentsQuery.isError ? (
                        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6">
                            <FeilMelding
                                melding={lagBrukervennligFeilmelding(
                                    assignmentsQuery.error instanceof Error ? assignmentsQuery.error : null,
                                    { canvas: true },
                                    "Kunne ikke hente oppgaver. Prøv igjen.",
                                )}
                            />
                        </div>
                    ) : ikkeInnleverteAssignments.length > 0 ? (
                        <WeeklyPlanSuggestions
                            assignments={ikkeInnleverteAssignments.map((a) => ({
                                id: a.id.toString(),
                                name: a.name,
                                dueAt: a.due_at || undefined,
                                courseName: a.course_name,
                                pointsPossible: a.points_possible || undefined,
                            }))}
                            onAddToCalendar={() => {
                                // TODO: Implementer kalenderfunksjon
                            }}
                        />
                    ) : (
                        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-8">
                            <div className="flex flex-col items-center justify-center text-center space-y-3">
                                <AlertCircle className="w-12 h-12 text-slate-400 dark:text-slate-500" />
                                <div>
                                    <h3 className="font-semibold text-slate-900 dark:text-white mb-1">
                                        Ingen oppgaver funnet
                                    </h3>
                                    <p className="text-sm text-slate-500 dark:text-slate-400">
                                        Koble til Canvas for å se dine oppgaver og få KI-forslag til ukeplan
                                    </p>
                                </div>
                                <Link
                                    href="/dashboard"
                                    className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors text-sm"
                                >
                                    Gå til innstillinger
                                </Link>
                            </div>
                        </div>
                    )}
                </div>

                {/* Quick Actions */}
                <div className="space-y-2">
                    <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
                        Rask tilgang
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <QuickActionCard
                            title="KI Assistent"
                            description="Få hjelp med studier og oppgaver"
                            icon={MessageSquare}
                            href="/dashboard"
                            color="blue"
                        />
                        <QuickActionCard
                            title="AI Task Breakdown"
                            description="Bryt ned oppgaver i mindre deler"
                            icon={Sparkles}
                            href="/test-ai-breakdown"
                            color="purple"
                        />
                        <QuickActionCard
                            title="Emner"
                            description="Se alle dine Canvas-emner"
                            icon={BookOpen}
                            href="/dashboard?view=canvas-courses"
                            color="green"
                        />
                    </div>
                </div>

                {/* Kommende oppgaver (kun ikke-innleverte) */}
                {upcomingAssignments.length > 0 && (
                    <div className="space-y-2">
                        <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
                            Kommende frister (neste {FRIST_VINDU_DAGER} dager)
                        </h2>
                        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 divide-y divide-slate-200 dark:divide-slate-700">
                            {upcomingAssignments.slice(0, 5).map((assignment) => {
                                const daysUntil = dagerFraIdag(assignment.due_at!);
                                const isUrgent = daysUntil <= 2;

                                return (
                                    <div
                                        key={assignment.id}
                                        className="p-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                                    >
                                        <div className="flex items-start justify-between gap-4">
                                            <div className="flex-1 min-w-0">
                                                <h3 className="font-medium text-slate-900 dark:text-white truncate">
                                                    {assignment.name}
                                                </h3>
                                                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                                                    {assignment.course_name}
                                                </p>
                                            </div>
                                            <div className="text-right shrink-0">
                                                <div
                                                    className={`text-sm font-medium ${
                                                        isUrgent
                                                            ? "text-red-600 dark:text-red-400"
                                                            : "text-slate-700 dark:text-slate-300"
                                                    }`}
                                                >
                                                    {formaterDagerRelativtFrist(daysUntil)}
                                                </div>
                                                <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                                                    {formaterDatoShort(assignment.due_at!)}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
                    </div>
                </div>
            </main>
        </div>
    );
}

// Stat Card Component
interface StatCardProps {
    icon: React.ComponentType<{ size?: number; className?: string }>;
    label: string;
    value: number | string;
    color: "blue" | "green" | "yellow" | "purple";
}

function StatCard({ icon: Icon, label, value, color }: StatCardProps) {
    const colorClasses = {
        blue: "bg-blue-100 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400",
        green: "bg-green-100 dark:bg-green-900/20 text-green-600 dark:text-green-400",
        yellow: "bg-yellow-100 dark:bg-yellow-900/20 text-yellow-600 dark:text-yellow-400",
        purple: "bg-purple-100 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400",
    };

    return (
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6">
            <div className="flex items-center justify-between">
                <div>
                    <p className="text-sm text-slate-500 dark:text-slate-400">{label}</p>
                    <p className="text-3xl font-bold text-slate-900 dark:text-white mt-1">
                        {value}
                    </p>
                </div>
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${colorClasses[color]}`}>
                    <Icon size={24} />
                </div>
            </div>
        </div>
    );
}

// Quick Action Card Component
interface QuickActionCardProps {
    title: string;
    description: string;
    icon: React.ComponentType<{ size?: number; className?: string }>;
    href: string;
    color: "blue" | "green" | "purple";
    onClick?: () => void;
}

function QuickActionCard({ title, description, icon: Icon, href, color, onClick }: QuickActionCardProps) {
    const colorClasses = {
        blue: "bg-blue-50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-900/20",
        green: "bg-green-50 dark:bg-green-900/10 border-green-200 dark:border-green-800 hover:bg-green-100 dark:hover:bg-green-900/20",
        purple: "bg-purple-50 dark:bg-purple-900/10 border-purple-200 dark:border-purple-800 hover:bg-purple-100 dark:hover:bg-purple-900/20",
    };

    const iconColorClasses = {
        blue: "text-blue-600 dark:text-blue-400",
        green: "text-green-600 dark:text-green-400",
        purple: "text-purple-600 dark:text-purple-400",
    };

    return (
        <Link
            href={href}
            onClick={onClick}
            className={`block p-6 rounded-lg border transition-colors ${colorClasses[color]}`}
        >
            <Icon size={24} className={`mb-3 ${iconColorClasses[color]}`} />
            <h3 className="font-semibold text-slate-900 dark:text-white mb-1">
                {title}
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-400">
                {description}
            </p>
        </Link>
    );
}
