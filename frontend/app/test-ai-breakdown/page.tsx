"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { showToast } from "../components/Toaster";
import { AITaskBreakdown } from "../components/AITaskBreakdown";
import { Sidebar, type VisningType } from "../components/Sidebar";
import { useMeg } from "../auth/auth-api";
import { useCanvasUser } from "../canvas/canvas-api";


// Denne siden er kun for testing av AITaskBreakdown-komponenten og har ingen reell funksjonalitet utover det.
export default function TestPage() {
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

  return (
    <div className="h-full flex flex-col md:flex-row bg-slate-50 dark:bg-slate-950 min-h-screen">
      <Sidebar aktivVisning="chat" byttVisning={byttVisning} brukernavn={brukernavn} />
      <main className="flex-1 min-h-0 overflow-y-auto bg-white dark:bg-slate-900">
        <div className="min-h-full bg-slate-50 dark:bg-slate-900 px-4 py-6 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white mb-4 sm:mb-6">
          🧪 Test: AI Task Breakdown
        </h1>
        
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg p-4 sm:p-6 space-y-4">
          <div className="space-y-2">
            <h2 className="text-lg sm:text-xl font-semibold text-slate-900 dark:text-white">
              Database 2 - Eksamensoppgave
            </h2>
            <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm text-slate-600 dark:text-slate-400">
              <span>📅 Frist: 15. mars 2026</span>
              <span className="hidden sm:inline">•</span>
              <span>📊 50 poeng</span>
            </div>
          </div>

          <div className="p-3 sm:p-4 rounded-lg bg-slate-50 dark:bg-slate-900/50">
            <p className="text-xs sm:text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
              <strong>Beskrivelse:</strong> Lag en komplett database-applikasjon med MongoDB. 
              Inkluder CRUD-operasjoner, brukerautentisering med JWT, og deployment til produksjon. 
              Oppgaven skal demonstrere forståelse av NoSQL-databaser, API-design, og sikkerhetsprinsipper.
            </p>
          </div>
          
          <AITaskBreakdown
            assignmentTitle="Database 2 - Eksamensoppgave"
            assignmentDescription="Lag en komplett database-applikasjon med MongoDB, inkludert CRUD-operasjoner, autentisering og deployment."
            dueDate={new Date("2024-03-15")}
            onSave={(subtasks) => {
              showToast.success(`Lagret ${subtasks.length} deloppgaver!`);
            }}
          />
        </div>

        {/* Eksempel 2 */}
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg p-4 sm:p-6 space-y-4">
          <div className="space-y-2">
            <h2 className="text-lg sm:text-xl font-semibold text-slate-900 dark:text-white">
              Webutvikling - Prosjekt 2
            </h2>
            <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm text-slate-600 dark:text-slate-400">
              <span>📅 Frist: 1. april 2024</span>
              <span className="hidden sm:inline">•</span>
              <span>📊 30 poeng</span>
            </div>
          </div>
          
          <AITaskBreakdown
            assignmentTitle="Webutvikling - Prosjekt 2"
            assignmentDescription="Lag en responsiv nettside med React og TypeScript"
            dueDate={new Date("2024-04-01")}
            onSave={(subtasks) => {
              showToast.success(`Lagret ${subtasks.length} deloppgaver!`);
            }}
          />
        </div>
      </div>
        </div>
      </main>
    </div>
  );
}
