"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, BookOpen, Code, FileText, Brain, Rocket, ChevronDown, ChevronUp } from "lucide-react";
import { showToast } from "../components/Toaster";
import { AITaskBreakdown } from "../components/AITaskBreakdown";
import { Sidebar, type VisningType } from "../components/Sidebar";
import { useMeg } from "../auth/auth-api";
import { useCanvasUser } from "../canvas/canvas-api";

// Eksempeloppgaver for AI task breakdown
const mockAssignments = [
  {
    id: "1",
    title: "Database 2 - Eksamensoppgave",
    description: "Lag en komplett database-applikasjon med MongoDB. Inkluder CRUD-operasjoner, brukerautentisering med JWT, og deployment til produksjon. Oppgaven skal demonstrere forståelse av NoSQL-databaser, API-design, og sikkerhetsprinsipper.",
    dueDate: new Date("2026-03-15"),
    points: 50,
    icon: BookOpen,
    color: "blue",
    expanded: true,
  },
  {
    id: "2",
    title: "Webutvikling - Prosjekt 2",
    description: "Lag en responsiv nettside med React og TypeScript. Implementer moderne UI-komponenter, state management med hooks, og integrasjon med eksterne APIer. Fokus på brukeropplevelse og tilgjengelighet.",
    dueDate: new Date("2026-04-01"),
    points: 30,
    icon: Code,
    color: "purple",
    expanded: false,
  },
  {
    id: "3",
    title: "Algoritmer og Datastrukturer - Obligatorisk 3",
    description: "Implementer og analyser kompleksiteten til ulike sorteringsalgoritmer. Sammenlign QuickSort, MergeSort og HeapSort med både teoretisk analyse og praktiske målinger. Inkluder visualiseringer og rapport.",
    dueDate: new Date("2026-04-15"),
    points: 40,
    icon: Brain,
    color: "green",
    expanded: false,
  },
  {
    id: "4",
    title: "Programvareutvikling - Semesteroppgave",
    description: "Utvikle en fullstack applikasjon ved bruk av agile metoder. Prosjektet skal inkludere kravspesifikasjon, design, implementasjon, testing og dokumentasjon. Bruk Git for versjonskontroll og CI/CD for deployment.",
    dueDate: new Date("2026-05-20"),
    points: 60,
    icon: Rocket,
    color: "orange",
    expanded: false,
  },
  {
    id: "5",
    title: "Objektorientert Programmering - Sluttprosjekt",
    description: "Design og implementer et objektorientert system med fokus på SOLID-prinsipper. Prosjektet skal demonstrere forståelse av arv, polymorfisme, innkapsling og design patterns. Inkluder UML-diagrammer og enhetstester.",
    dueDate: new Date("2026-05-01"),
    points: 45,
    icon: FileText,
    color: "red",
    expanded: false,
  },
];

export default function TestPage() {
  const router = useRouter();
  const [expandedAssignments, setExpandedAssignments] = useState<Set<string>>(
    new Set(mockAssignments.filter(a => a.expanded).map(a => a.id))
  );

  const megQuery = useMeg();
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
    [router]
  );

  const toggleExpanded = (id: string) => {
    setExpandedAssignments(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  const expandAll = () => {
    setExpandedAssignments(new Set(mockAssignments.map(a => a.id)));
  };

  const collapseAll = () => {
    setExpandedAssignments(new Set());
  };

  const colorClasses = {
    blue: {
      bg: "bg-blue-100 dark:bg-blue-900/20",
      text: "text-blue-700 dark:text-blue-300",
      border: "border-blue-200 dark:border-blue-800",
      icon: "text-blue-600 dark:text-blue-400",
    },
    purple: {
      bg: "bg-purple-100 dark:bg-purple-900/20",
      text: "text-purple-700 dark:text-purple-300",
      border: "border-purple-200 dark:border-purple-800",
      icon: "text-purple-600 dark:text-purple-400",
    },
    green: {
      bg: "bg-green-100 dark:bg-green-900/20",
      text: "text-green-700 dark:text-green-300",
      border: "border-green-200 dark:border-green-800",
      icon: "text-green-600 dark:text-green-400",
    },
    orange: {
      bg: "bg-orange-100 dark:bg-orange-900/20",
      text: "text-orange-700 dark:text-orange-300",
      border: "border-orange-200 dark:border-orange-800",
      icon: "text-orange-600 dark:text-orange-400",
    },
    red: {
      bg: "bg-red-100 dark:bg-red-900/20",
      text: "text-red-700 dark:text-red-300",
      border: "border-red-200 dark:border-red-800",
      icon: "text-red-600 dark:text-red-400",
    },
  };

  return (
    <div className="h-full flex flex-col md:flex-row bg-slate-50 dark:bg-slate-950 min-h-screen">
      <Sidebar aktivVisning="chat" byttVisning={byttVisning} brukernavn={brukernavn} />
      <main className="flex-1 min-h-0 overflow-y-auto bg-white dark:bg-slate-900">
        <div className="min-h-full bg-slate-50 dark:bg-slate-950">
          {/* Header */}
          <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 sticky top-0 z-10">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-linear-to-br from-purple-500 to-blue-500 flex items-center justify-center">
                    <Sparkles className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white">
                      AI Task Breakdown
                    </h1>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                      Bryt ned oppgaver i konkrete deloppgaver med lagret fremdrift
                    </p>
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={expandAll}
                    className="px-3 py-2 text-sm rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors"
                  >
                    Utvid alle
                  </button>
                  <button
                    onClick={collapseAll}
                    className="px-3 py-2 text-sm rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors"
                  >
                    Lukk alle
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Content */}
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            {/* Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
              <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-slate-500 dark:text-slate-400">Totalt oppgaver</p>
                    <p className="text-3xl font-bold text-slate-900 dark:text-white mt-1">
                      {mockAssignments.length}
                    </p>
                  </div>
                  <div className="w-12 h-12 rounded-xl bg-blue-100 dark:bg-blue-900/20 flex items-center justify-center">
                    <BookOpen className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                  </div>
                </div>
              </div>

              <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-slate-500 dark:text-slate-400">Totalt poeng</p>
                    <p className="text-3xl font-bold text-slate-900 dark:text-white mt-1">
                      {mockAssignments.reduce((sum, a) => sum + a.points, 0)}
                    </p>
                  </div>
                  <div className="w-12 h-12 rounded-xl bg-green-100 dark:bg-green-900/20 flex items-center justify-center">
                    <Sparkles className="w-6 h-6 text-green-600 dark:text-green-400" />
                  </div>
                </div>
              </div>

              <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-slate-500 dark:text-slate-400">Åpne kort</p>
                    <p className="text-3xl font-bold text-slate-900 dark:text-white mt-1">
                      {expandedAssignments.size}
                    </p>
                  </div>
                  <div className="w-12 h-12 rounded-xl bg-purple-100 dark:bg-purple-900/20 flex items-center justify-center">
                    <ChevronDown className="w-6 h-6 text-purple-600 dark:text-purple-400" />
                  </div>
                </div>
              </div>
            </div>

            {/* Assignments */}
            <div className="space-y-6">
              {mockAssignments.map((assignment) => {
                const isExpanded = expandedAssignments.has(assignment.id);
                const Icon = assignment.icon;
                const colors = colorClasses[assignment.color as keyof typeof colorClasses];

                return (
                  <div
                    key={assignment.id}
                    className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden transition-all"
                  >
                    {/* Header */}
                    <button
                      onClick={() => toggleExpanded(assignment.id)}
                      className="w-full p-6 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                    >
                      <div className="flex items-center gap-4 flex-1 min-w-0">
                        <div className={`w-12 h-12 rounded-xl ${colors.bg} flex items-center justify-center shrink-0`}>
                          <Icon className={`w-6 h-6 ${colors.icon}`} />
                        </div>
                        <div className="flex-1 min-w-0 text-left">
                          <h2 className="text-lg font-semibold text-slate-900 dark:text-white truncate">
                            {assignment.title}
                          </h2>
                          <div className="flex flex-wrap items-center gap-3 mt-1 text-sm text-slate-500 dark:text-slate-400">
                            <span>📅 {assignment.dueDate.toLocaleDateString("nb-NO", { day: "numeric", month: "long", year: "numeric" })}</span>
                            <span>•</span>
                            <span>📊 {assignment.points} poeng</span>
                          </div>
                        </div>
                      </div>
                      <div className="shrink-0 ml-4">
                        {isExpanded ? (
                          <ChevronUp className="w-5 h-5 text-slate-400" />
                        ) : (
                          <ChevronDown className="w-5 h-5 text-slate-400" />
                        )}
                      </div>
                    </button>

                    {/* Content */}
                    {isExpanded && (
                      <div className="px-6 pb-6 space-y-4 border-t border-slate-100 dark:border-slate-800 pt-4">
                        <div className={`p-4 rounded-lg ${colors.bg} border ${colors.border}`}>
                          <p className={`text-sm leading-relaxed ${colors.text}`}>
                            <strong>Beskrivelse:</strong> {assignment.description}
                          </p>
                        </div>

                        <AITaskBreakdown
                          assignmentId={assignment.id}
                          assignmentTitle={assignment.title}
                          assignmentDescription={assignment.description}
                          dueDate={assignment.dueDate}
                          onSave={(subtasks) => {
                            showToast.success(`Lagret ${subtasks.length} deloppgaver for ${assignment.title}!`);
                          }}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Footer */}
            <div className="mt-12 p-6 rounded-xl bg-linear-to-br from-purple-50 to-blue-50 dark:from-purple-950/20 dark:to-blue-950/20 border border-purple-200 dark:border-purple-800">
              <div className="flex items-start gap-4">
                <Sparkles className="w-6 h-6 text-purple-600 dark:text-purple-400 shrink-0 mt-1" />
                <div>
                  <h3 className="font-semibold text-purple-900 dark:text-purple-100 mb-2">
                    Om AI Task Breakdown
                  </h3>
                  <p className="text-sm text-purple-700 dark:text-purple-300 leading-relaxed">
                    Denne funksjonen bruker kunstig intelligens til å bryte ned store oppgaver i mindre, 
                    håndterbare deloppgaver. Du kan godkjenne, avvise eller redigere forslagene, 
                    og deretter legge dem til i din personlige arbeidsplan. Perfekt for å strukturere 
                    komplekse prosjekter og eksamensoppgaver!
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
} 
