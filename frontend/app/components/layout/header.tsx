/*
 * Header: Clerk-only auth UI. Signed-in brukere får profil-lenke og felles logout-flyt.
 */
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { Menu, Moon, Sun, X, MoreVertical, LogOut } from "lucide-react";
import { SignInButton, SignUpButton, useAuth } from "@clerk/nextjs";
import { useUIStore } from "@/app/store/uiStore";
import { useTheme } from "next-themes";
import { useEffect, useId, useRef, useState } from "react";
import { useLoggUtWithRedirect } from "@/app/auth/auth-api";
import { useLanguage } from "@/app/i18n";
import type { Language } from "@/app/i18n";
import { useDialogAccessibility } from "@/app/hooks/useDialogAccessibility";
import { useMediaQuery } from "@/app/hooks/useMediaQuery";

type NavigationItem = {
  href: string;
  label: string;
  icon?: LucideIcon;
};

type AuthAction = {
  kind: "sign-in" | "sign-up";
  label: string;
};

function getHeaderLabels(language: Language) {
  if (language === "en") {
    return {
      commonNavigation: [{ href: "/", label: "Home" }] satisfies NavigationItem[],
      signedInNavigation: [
        { href: "/dashboard", label: "Dashboard" },
      ] satisfies NavigationItem[],
      authActions: [
        { kind: "sign-in", label: "Sign in" },
        { kind: "sign-up", label: "Register" },
      ] satisfies AuthAction[],
      toggleTheme: "Toggle theme",
      lightTheme: "Light theme",
      darkTheme: "Dark theme",
      closeSidebar: "Close left sidebar",
      openSidebar: "Open left sidebar",
      closeMenu: "Close menu",
      openMenu: "Menu",
      signOut: "Sign out",
    };
  }

  return {
    commonNavigation: [{ href: "/", label: "Hjem" }] satisfies NavigationItem[],
    signedInNavigation: [
      { href: "/dashboard", label: "Dashboard" },
    ] satisfies NavigationItem[],
    authActions: [
      { kind: "sign-in", label: "Logg inn" },
      { kind: "sign-up", label: "Registrer" },
    ] satisfies AuthAction[],
    toggleTheme: "Bytt tema",
    lightTheme: "Lyst tema",
    darkTheme: "Mørkt tema",
    closeSidebar: "Lukk venstremeny",
    openSidebar: "Åpne venstremeny",
    closeMenu: "Lukk meny",
    openMenu: "Meny",
    signOut: "Logg ut",
  };
}

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
    ? "inline-flex items-center gap-2 hover:text-blue-600 dark:hover:text-blue-400 transition-colors py-3 min-h-11 touch-manipulation focus:outline-none focus:ring-2 focus:ring-blue-500 rounded"
    : "inline-flex items-center gap-1.5 hover:text-blue-600 dark:hover:text-blue-400 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 rounded";

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
    ? "text-left hover:text-blue-600 dark:hover:text-blue-400 transition-colors py-3 min-h-11 touch-manipulation w-full focus:outline-none focus:ring-2 focus:ring-blue-500 rounded"
    : "hover:text-blue-600 dark:hover:text-blue-400 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 rounded";
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
  labels,
}: {
  mobile?: boolean;
  mounted: boolean;
  isDarkMode: boolean;
  onToggle: () => void;
  labels: ReturnType<typeof getHeaderLabels>;
}) {
  if (mobile) {
    return (
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-2 text-left hover:text-blue-600 dark:hover:text-blue-400 transition-colors py-3 min-h-11 w-full touch-manipulation"
        aria-label={labels.toggleTheme}
      >
        <Sun className="h-5 w-5 dark:hidden" />
        <Moon className="h-5 w-5 hidden dark:block" />
        <span>{isDarkMode ? labels.lightTheme : labels.darkTheme}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      className="min-w-11 min-h-11 flex items-center justify-center text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors touch-manipulation"
      aria-label={labels.toggleTheme}
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
  const harSidebar =
    pathname.startsWith("/dashboard") || pathname === "/oversikt" || pathname === "/ai-breakdown" || pathname.startsWith("/account");
  const [mobilMenyOpen, setMobilMenyOpen] = useState(false);
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const isDarkMode = mounted && resolvedTheme === "dark";
  const handleLoggUt = useLoggUtWithRedirect();
  const { isLoaded: authLoaded, isSignedIn } = useAuth();
  const { language } = useLanguage();
  const labels = getHeaderLabels(language);
  const erMobil = useMediaQuery("(max-width: 767px)");
  const mobilDialogRef = useRef<HTMLDivElement | null>(null);
  const mobilCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const mobilMenuId = useId();
  const mobilMenuHeadingId = useId();
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    setMobilMenyOpen(false);
  }, [pathname]);

  useDialogAccessibility({
    open: mobilMenyOpen,
    enabled: erMobil,
    containerRef: mobilDialogRef,
    initialFocusRef: mobilCloseButtonRef,
    onClose: () => setMobilMenyOpen(false),
  });

  const handleMobilNavigation = () => {
    setMobilMenyOpen(false);
  };

  const handleMobilLogout = async () => {
    setMobilMenyOpen(false);
    await handleLoggUt();
  };

  return (
    <header className="shrink-0 px-4 md:px-6 pt-[env(safe-area-inset-top)] border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 sticky top-0 z-30">
      <div className="h-14 flex justify-between items-center">
      <div className="flex items-center gap-3">
        {harSidebar && (
          <button
            type="button"
            onClick={toggleVenstreMeny}
            className="min-w-11 min-h-11 -ml-1 flex items-center justify-center text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg touch-manipulation"
            aria-label={isVenstreMenyOpen ? labels.closeSidebar : labels.openSidebar}
            aria-expanded={erMobil ? isVenstreMenyOpen : undefined}
            aria-controls={erMobil ? "dashboard-sidebar" : undefined}
          >
            {isVenstreMenyOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        )}
        <div className="font-semibold text-lg text-slate-900 dark:text-white min-h-11 flex items-center">
          <Link href="/" prefetch={false} className="py-2">StudyWise</Link>
        </div>
      </div>

      <nav className="hidden md:flex items-center gap-6 text-sm text-slate-600 dark:text-slate-400">
        {labels.commonNavigation.map((item) => (
          <NavigationLink key={item.href} {...item} />
        ))}
        {!authLoaded ? (
          <AuthStatusPlaceholder />
        ) : isSignedIn ? (
          <>
            {labels.signedInNavigation.map((item) => (
              <NavigationLink key={item.href} {...item} />
            ))}
            <button
              type="button"
              onClick={handleLoggUt}
              className="inline-flex items-center gap-1.5 hover:text-red-600 dark:hover:text-red-400 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 rounded"
            >
              <LogOut className="h-4 w-4" />
              <span>{labels.signOut}</span>
            </button>
          </>
        ) : (
          labels.authActions.map((action) => (
            <AuthActionButton key={action.kind} action={action} />
          ))
        )}
        <ThemeToggleButton
          mounted={mounted}
          isDarkMode={isDarkMode}
          onToggle={() => setTheme(isDarkMode ? "light" : "dark")}
          labels={labels}
        />
      </nav>

      <button
        type="button"
        onClick={() => setMobilMenyOpen(!mobilMenyOpen)}
        className="md:hidden min-w-11 min-h-11 flex items-center justify-center text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg touch-manipulation"
        aria-label={mobilMenyOpen ? labels.closeMenu : labels.openMenu}
        aria-expanded={mobilMenyOpen}
        aria-controls={mobilMenuId}
        aria-haspopup="dialog"
      >
        {mobilMenyOpen ? <X size={24} /> : <MoreVertical size={24} />}
      </button>
      </div>
      {mobilMenyOpen && (
        <>
          <button
            type="button"
            aria-label={labels.closeMenu}
            className="md:hidden fixed inset-0 top-14 bg-black/30 z-30"
            onClick={() => setMobilMenyOpen(false)}
            tabIndex={-1}
          />
          <div
            ref={mobilDialogRef}
            id={mobilMenuId}
            role="dialog"
            aria-modal="true"
            aria-labelledby={mobilMenuHeadingId}
            tabIndex={-1}
            className="md:hidden absolute top-full left-0 right-0 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 shadow-lg z-40"
          >
          <div className="flex flex-col p-4 gap-2 text-sm text-slate-600 dark:text-slate-400">
            <div className="mb-1 flex items-center justify-between gap-3 border-b border-slate-200 pb-3 dark:border-slate-800">
              <h2 id={mobilMenuHeadingId} className="text-sm font-semibold text-slate-900 dark:text-white">
                {labels.openMenu}
              </h2>
              <button
                ref={mobilCloseButtonRef}
                type="button"
                onClick={() => setMobilMenyOpen(false)}
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
                aria-label={labels.closeMenu}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            {labels.commonNavigation.map((item) => (
              <NavigationLink
                key={item.href}
                {...item}
                mobile
                onClick={handleMobilNavigation}
              />
            ))}
            {!authLoaded ? (
              <AuthStatusPlaceholder mobile />
            ) : isSignedIn ? (
              <>
                {labels.signedInNavigation.map((item) => (
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
                  <span>{labels.signOut}</span>
                </button>
              </>
            ) : (
              labels.authActions.map((action) => (
                <AuthActionButton key={action.kind} action={action} mobile />
              ))
            )}
            <ThemeToggleButton
              mobile
              mounted={mounted}
              isDarkMode={isDarkMode}
              onToggle={() => setTheme(isDarkMode ? "light" : "dark")}
              labels={labels}
            />
          </div>
          </div>
        </>
      )}
    </header>
  );
}

function AuthStatusPlaceholder({ mobile = false }: { mobile?: boolean }) {
  if (mobile) {
    return (
      <div className="space-y-2 py-2" aria-hidden="true">
        <div className="h-11 rounded-lg bg-slate-100 animate-pulse dark:bg-slate-800" />
        <div className="h-11 rounded-lg bg-slate-100 animate-pulse dark:bg-slate-800" />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3" aria-hidden="true">
      <div className="h-11 w-24 rounded-lg bg-slate-100 animate-pulse dark:bg-slate-800" />
      <div className="h-11 w-24 rounded-lg bg-slate-100 animate-pulse dark:bg-slate-800" />
    </div>
  );
}
