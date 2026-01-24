/*
 * Login-side for Canvas LMS autentisering
 * Placeholder til autentiseringssystem er implementert
 * Må endres totalt
 */

export default function AuthPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 p-4">
      <main className="flex flex-col gap-6 p-8 max-w-md w-full bg-white rounded-lg shadow-lg">
        <div className="text-center">
          <div className="text-5xl mb-4"></div>
          <h1 className="text-3xl font-bold text-black mb-2">
            Autentisering
          </h1>
          <p className="text-zinc-600">
            Canvas LMS integrasjon kommer snart
          </p>
        </div>

        <div className="border-t border-zinc-200 pt-6">
          <button
            disabled
            className="w-full px-6 py-3 bg-zinc-200 text-zinc-400 rounded-lg cursor-not-allowed font-semibold"
          >
            Koble til Canvas
          </button>
          <p className="text-sm text-zinc-500 text-center mt-4">
            Under utvikling
          </p>
        </div>
      </main>
    </div>
  );
}