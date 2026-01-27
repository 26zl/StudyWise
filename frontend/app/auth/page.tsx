/*
 * Login-side for Canvas LMS autentisering
 * Placeholder til autentiseringssystem er implementert
 * UI/UX må endres etterhvert
 */

import Link from "next/link";
import { Footer } from "../components/footer";

export default function AuthPage() {
  return (
    <div className="min-h-screen flex flex-col bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 transition-colors">
      <div className="flex-1 flex items-center justify-center p-4">
        <main className="flex flex-col gap-6 p-8 max-w-md w-full bg-white dark:bg-gray-900 rounded-lg shadow-lg border dark:border-gray-800">
          <div className="text-center">
            <h1 className="text-3xl font-bold text-black dark:text-white mb-2">
              Innlogging
            </h1>
            <p className="text-zinc-600 dark:text-gray-400">
              Canvas LMS integrasjon er under utvikling.<br />
              Du vil bli logget inn med en <strong>lokal demo-bruker</strong>.
            </p>
          </div>

          <div className="border-t border-zinc-200 dark:border-gray-800 pt-6">
            <Link
              href="/dashboard"
              className="block w-full text-center px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition-colors"
            >
              Logg inn (Demo)
            </Link>
            <p className="text-sm text-zinc-500 dark:text-gray-500 text-center mt-4">
              Ingen passord kreves
            </p>
          </div>
        </main>
      </div>
      <Footer />
    </div>
  );
}