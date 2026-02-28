"use client";

import { AITaskBreakdown } from "../components/AITaskBreakdown";

export default function TestPage() {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-8">
          🧪 Test: AI Task Breakdown
        </h1>
        
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg p-6 mb-6">
          <div className="mb-4">
            <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-2">
              Database 2 - Eksamensoppgave
            </h2>
            <div className="flex items-center gap-4 text-sm text-slate-600 dark:text-slate-400">
              <span>📅 Frist: 15. mars 2024</span>
              <span>📊 50 poeng</span>
            </div>
          </div>

          <div className="mb-4 p-4 rounded-lg bg-slate-50 dark:bg-slate-900/50">
            <p className="text-sm text-slate-700 dark:text-slate-300">
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
              console.log("✅ Saved subtasks:", subtasks);
              alert(`🎉 Lagret ${subtasks.length} deloppgaver!`);
            }}
          />
        </div> {/* Eksempel 2 */}
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg p-6">
          <div className="mb-4">
            <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-2">
              Webutvikling - Prosjekt 2
            </h2>
            <div className="flex items-center gap-4 text-sm text-slate-600 dark:text-slate-400">
              <span>📅 Frist: 1. april 2024</span>
              <span>📊 30 poeng</span>
            </div>
          </div>
          
          <AITaskBreakdown
            assignmentTitle="Webutvikling - Prosjekt 2"
            assignmentDescription="Lag en responsiv nettside med React og TypeScript"
            dueDate={new Date("2024-04-01")}
            onSave={(subtasks) => {
              console.log("✅ Saved subtasks:", subtasks);
              alert(`🎉 Lagret ${subtasks.length} deloppgaver!`);
            }}
          />
        </div>
      </div>
    </div>
  );
}
 