/*
 * Login-side for Canvas LMS autentisering
 * Placeholder til autentiseringssystem er implementert
 * UI/UX må endres etterhvert
 */

export default function AuthPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-black p-4 transition-colors">
      <main className="flex flex-col gap-6 p-8 max-w-md w-full bg-white dark:bg-gray-900 rounded-lg shadow-lg border dark:border-gray-800">
        <div className="text-center">
          <div className="text-5xl mb-4"></div>
          <h1 className="text-3xl font-bold text-black dark:text-white mb-2">
            Autentisering
          </h1>
          <p className="text-zinc-600 dark:text-gray-400">
            Canvas LMS integrasjon kommer snart
          </p>
        </div>

        <div className="border-t border-zinc-200 dark:border-gray-800 pt-6">
          <button
            disabled
            className="w-full px-6 py-3 bg-zinc-200 dark:bg-gray-800 text-zinc-400 dark:text-gray-500 rounded-lg cursor-not-allowed font-semibold border dark:border-gray-700"
          >
            Koble til Canvas
          </button>
          <p className="text-sm text-zinc-500 dark:text-gray-500 text-center mt-4">
            Under utvikling
          </p>
        </div>
      </main>
    </div>
  );
}