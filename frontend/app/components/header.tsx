import Link from "next/link";

export function Header() {
    return (
        <header className="py-4 px-6 border-b dark:border-gray-800 flex justify-between items-center bg-white dark:bg-gray-900">
            <div className="font-bold text-lg">
                <Link href="/hjem">StudyWise</Link>
            </div>
            <nav className="flex gap-4 text-sm text-gray-600 dark:text-gray-400">
                <Link href="/hjem" className="hover:text-black dark:hover:text-white">Hjem</Link>
                <Link href="/dashboard" className="hover:text-black dark:hover:text-white">Dashboard</Link>
                <Link href="/auth" className="hover:text-black dark:hover:text-white">Logg inn</Link>
            </nav>
        </header>
    );
}
