/*
 * Header: Clerk-only auth UI. Signed-in brukere får profil-lenke og felles logout-flyt.
 */
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { Menu, Moon, Sun, X, MoreVertical, LogOut, UserCircle2 } from "lucide-react";
import { SignInButton, SignUpButton, useAuth } from "@clerk/nextjs";
import { useUIStore } from "@/app/store/uiStore";
import { useTheme } from "next-themes";
import { useState, useEffect } from "react";
import { useLoggUtWithRedirect } from "@/app/auth/auth-api";

type NavigationItem = {
  href: string;
  label: string;
  icon?: LucideIcon;
};

type AuthAction = {
  kind: "sign-in" | "sign-up";
  label: string;
};

const FELLES_NAVIGASJON: NavigationItem[] = [{ href: "/", label: "Hjem" }];
const INNLOGGET_NAVIGASJON: NavigationItem[] = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/profil", label: "Profil", icon: UserCircle2 },
];
const AUTH_ACTIONS: AuthAction[] = [
  { kind: "sign-in", label: "Logg inn" },
  { kind: "sign-up", label: "Registrer" },
];

function NavigationLink({
  href,
  label,
  icon: Icon,
  mobile = false,
  onClick,
}: NavigationItem & {
  mobile?: boolean;
  onClick?: () => void;
}) {
  const className = mobile
    ? "inline-flex items-center gap-2 hover:text-blue-600 dark:hover:text-blue-400 transition-colors py-3 min-h-11 touch-manipulation"
    : "inline-flex items-center gap-1.5 hover:text-blue-600 dark:hover:text-blue-400 transition-colors";

  return (
    <Link href={href} prefetch={false} onClick={onClick} className={className}>
      {Icon ? <Icon className={mobile ? "h-5 w-5" : "h-4 w-4"} /> : null}
      <span>{label}</span>
    </Link>
  );
}

function AuthActionButton({
  action,
  mobile = false,
}: {
  action: AuthAction;
  mobile?: boolean;
}) {
  const className = mobile
    ? "text-left hover:text-blue-600 dark:hover:text-blue-400 transition-colors py-3 min-h-11 touch-manipulation w-full"
    : "hover:text-blue-600 dark:hover:text-blue-400 transition-colors";
  const button = (
    <button type="button" className={className}>
      {action.label}
    </button>
  );

  if (action.kind === "sign-in") {
    return (
      <SignInButton mode="redirect" forceRedirectUrl="/dashboard">
        {button}
      </SignInButton>
    );
  }

  return (
    <SignUpButton mode="redirect" forceRedirectUrl="/dashboard">
      {button}
    </SignUpButton>
  );
}

function ThemeToggleButton({
  mobile = false,
  mounted,
  isDarkMode,
  onToggle,
}: {
  mobile?: boolean;
  mounted: boolean;
  isDarkMode: boolean;
  onToggle: () => void;
}) {
  if (mobile) {
    return (
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-2 text-left hover:text-blue-600 dark:hover:text-blue-400 transition-colors py-3 min-h-11 w-full touch-manipulation"
        aria-label="Bytt tema"
      >
        <Sun className="h-5 w-5 dark:hidden" />
        <Moon className="h-5 w-5 hidden dark:block" />
        <span>{isDarkMode ? "Lyst tema" : "Mørkt tema"}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      className="min-w-11 min-h-11 flex items-center justify-center text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors touch-manipulation"
      aria-label="Bytt tema"
    >
      {mounted ? (
        <>
          <Sun className="h-5 w-5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" suppressHydrationWarning />
          <Moon className="absolute h-5 w-5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" suppressHydrationWarning />
        </>
      ) : (
        <span className="h-5 w-5 rounded bg-slate-200 dark:bg-slate-700 animate-pulse" aria-hidden />
      )}
    </button>
  );
}

export function Header() {
  const pathname = usePathname();
  const { toggleVenstreMeny, isVenstreMenyOpen } = useUIStore();
  const harSidebar = ["/dashboard", "/oversikt", "/ai-breakdown"].includes(pathname);
  const [mobilMenyOpen, setMobilMenyOpen] = useState(false);
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const isDarkMode = mounted && resolvedTheme === "dark";
  const handleLoggUt = useLoggUtWithRedirect();
  const { isLoaded: authLoaded, isSignedIn } = useAuth();
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    setMobilMenyOpen(false);
  }, [pathname]);

  const handleMobilNavigation = () => {
    setMobilMenyOpen(false);
  };

  const handleMobilLogout = async () => {
    setMobilMenyOpen(false);
    await handleLoggUt();
  };

  return (
    <header className="shrink-0 h-14 px-4 md:px-6 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center bg-white dark:bg-slate-900 sticky top-0 z-30">
      <div className="flex items-center gap-3">
        {harSidebar && (
          <button
            type="button"
            onClick={toggleVenstreMeny}
            className="min-w-11 min-h-11 -ml-1 flex items-center justify-center text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg touch-manipulation"
            aria-label={isVenstreMenyOpen ? "Lukk venstremeny" : "Åpne venstremeny"}
          >
            {isVenstreMenyOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        )}
        <div className="font-semibold text-lg text-slate-900 dark:text-white min-h-11 flex items-center">
          <Link href="/" prefetch={false} className="py-2">StudyWise</Link>
        </div>
      </div>

      <nav className="hidden md:flex items-center gap-6 text-sm text-slate-600 dark:text-slate-400">
        {FELLES_NAVIGASJON.map((item) => (
          <NavigationLink key={item.href} {...item} />
        ))}
        {authLoaded && isSignedIn ? (
          <>
            {INNLOGGET_NAVIGASJON.map((item) => (
              <NavigationLink key={item.href} {...item} />
            ))}
            <button
              type="button"
              onClick={handleLoggUt}
              className="inline-flex items-center gap-1.5 hover:text-red-600 dark:hover:text-red-400 transition-colors"
            >
              <LogOut className="h-4 w-4" />
              <span>Logg ut</span>
            </button>
          </>
        ) : (
          AUTH_ACTIONS.map((action) => (
            <AuthActionButton key={action.kind} action={action} />
          ))
        )}
        <ThemeToggleButton
          mounted={mounted}
          isDarkMode={isDarkMode}
          onToggle={() => setTheme(isDarkMode ? "light" : "dark")}
        />
      </nav>

      <button
        type="button"
        onClick={() => setMobilMenyOpen(!mobilMenyOpen)}
        className="md:hidden min-w-11 min-h-11 flex items-center justify-center text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg touch-manipulation"
        aria-label={mobilMenyOpen ? "Lukk meny" : "Meny"}
      >
        {mobilMenyOpen ? <X size={24} /> : <MoreVertical size={24} />}
      </button>
      {mobilMenyOpen && (
        <nav className="md:hidden absolute top-14 left-0 right-0 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 shadow-lg z-40">
          <div className="flex flex-col p-4 gap-2 text-sm text-slate-600 dark:text-slate-400">
            {FELLES_NAVIGASJON.map((item) => (
              <NavigationLink
                key={item.href}
                {...item}
                mobile
                onClick={handleMobilNavigation}
              />
            ))}
            {authLoaded && isSignedIn ? (
              <>
                {INNLOGGET_NAVIGASJON.map((item) => (
                  <NavigationLink
                    key={item.href}
                    {...item}
                    mobile
                    onClick={handleMobilNavigation}
                  />
                ))}
                <button
                  type="button"
                  onClick={handleMobilLogout}
                  className="inline-flex items-center gap-2 text-left hover:text-red-600 dark:hover:text-red-400 transition-colors py-3 min-h-11 w-full touch-manipulation"
                >
                  <LogOut className="h-5 w-5" />
                  <span>Logg ut</span>
                </button>
              </>
            ) : (
              AUTH_ACTIONS.map((action) => (
                <AuthActionButton key={action.kind} action={action} mobile />
              ))
            )}
            <ThemeToggleButton
              mobile
              mounted={mounted}
              isDarkMode={isDarkMode}
              onToggle={() => setTheme(isDarkMode ? "light" : "dark")}
            />
          </div>
        </nav>
      )}
    </header>
  );
}
