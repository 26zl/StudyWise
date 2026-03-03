/*
 * Oversikt - Hovedoversiktsside for innlogget bruker
 * Viser KI-ukeplan, Canvas-statistikk og rask tilgang til funksjoner
 */
"use client";

import { useCallback, useEffect } from "react";
import { Sparkles, Calendar, BookOpen, MessageSquare, TrendingUp, Clock, AlertCircle } from "lucide-react";
import { WeeklyPlanSuggestions } from "../components/WeeklyPlanSuggestions";
import { Sidebar, type VisningType } from "../components/Sidebar";
import { useCanvasCourses, useCanvasAllAssignments, useCanvasUser, type AssignmentMedEmne } from "../canvas/canvas-api";
import { useMeg } from "../auth/auth-api";
import Link from "next/link";
import { useRouter } from "next/navigation";

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
        const erIkkeAutentisert = megQuery.isError ||
            (megQuery.isFetched && !megQuery.isLoading && !megQuery.data?.user);
        if (erIkkeAutentisert) {
            router.replace("/auth");
        }
    }, [megQuery.isError, megQuery.isFetched, megQuery.isLoading, megQuery.data?.user, router]);

    const coursesQuery = useCanvasCourses(true);
    const assignmentsQuery = useCanvasAllAssignments({ enabled: true });

    // Beregn statistikk
    const totalCourses = coursesQuery.data?.courses?.length || 0;
    const allAssignments: AssignmentMedEmne[] = assignmentsQuery.data || [];
    const totalAssignments = allAssignments.length;

    // Kommende oppgaver (neste 7 dager)
    const upcomingAssignments = allAssignments.filter((a) => {
        if (!a.due_at) return false;
        const dueDate = new Date(a.due_at);
        const now = new Date();
        const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        return dueDate >= now && dueDate <= weekFromNow;
    });

    // Aktive emner (emner med oppgaver)
    const activeCoursesCount = new Set(
        allAssignments.filter((a) => a.course_id != null).map((a) => a.course_id)
    ).size;

    // Vis lasteskjerm mens brukerdata hentes
    if (megQuery.isLoading) {
        return (
            <div className="h-full flex flex-col md:flex-row bg-slate-50 dark:bg-slate-950 min-h-screen">
                <Sidebar aktivVisning="chat" byttVisning={byttVisning} brukernavn={brukernavn} />
                <main className="flex-1 min-h-0 overflow-y-auto flex items-center justify-center p-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
                </main>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col md:flex-row bg-slate-50 dark:bg-slate-950 min-h-screen">
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
                                {new Date().toLocaleDateString("nb-NO", {
                                    weekday: "long",
                                    year: "numeric",
                                    month: "long",
                                    day: "numeric",
                                })}
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
                        value={activeCoursesCount}
                        color="blue"
                    />
                    <StatCard
                        icon={Clock}
                        label="Kommende oppgaver"
                        value={upcomingAssignments.length}
                        color="yellow"
                    />
                    <StatCard
                        icon={TrendingUp}
                        label="Totalt oppgaver"
                        value={totalAssignments}
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
                    ) : allAssignments.length > 0 ? (
                        <WeeklyPlanSuggestions
                            assignments={allAssignments.map((a) => ({
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
                            title="Mine emner"
                            description="Se alle dine Canvas-emner"
                            icon={BookOpen}
                            href="/dashboard?view=canvas-courses"
                            color="green"
                        />
                    </div>
                </div>

                {/* Kommende oppgaver */}
                {upcomingAssignments.length > 0 && (
                    <div className="space-y-2">
                        <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
                            Kommende frister (neste 7 dager)
                        </h2>
                        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 divide-y divide-slate-200 dark:divide-slate-700">
                            {upcomingAssignments.slice(0, 5).map((assignment) => {
                                const today = new Date();
                                today.setHours(0, 0, 0, 0);
                                const dueDay = new Date(assignment.due_at!);
                                dueDay.setHours(0, 0, 0, 0);
                                const daysUntil = Math.round(
                                    (dueDay.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
                                );
                                const isUrgent = daysUntil <= 2;
                                const erInnlevert =
                                    assignment.submission &&
                                    (assignment.submission.workflow_state === "submitted" ||
                                        assignment.submission.workflow_state === "graded" ||
                                        assignment.submission.workflow_state === "pending_review");

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
                                                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                                                    <span>{assignment.course_name}</span>
                                                    {erInnlevert && (
                                                        <span className="inline-flex items-center rounded-md bg-green-100 dark:bg-green-900/30 px-1.5 py-0.5 text-xs font-medium text-green-800 dark:text-green-300">
                                                            Innlevert
                                                        </span>
                                                    )}
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
                                                    {daysUntil === 0
                                                        ? "I dag"
                                                        : daysUntil === 1
                                                        ? "I morgen"
                                                        : `Om ${daysUntil} dager`}
                                                </div>
                                                <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                                                    {new Date(assignment.due_at!).toLocaleDateString("nb-NO", {
                                                        month: "short",
                                                        day: "numeric",
                                                    })}
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
    value: number;
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
