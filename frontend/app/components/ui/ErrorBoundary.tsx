/*
 * ErrorBoundary - Fanger uventede JavaScript-feil i React-komponenter
 * Hindrer at hele appen krasjer ved å vise en pen feilside
 */
"use client";

import { Component, type ReactNode } from "react";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";
import { FeilMelding } from "./FeilMelding";

// Props og state for ErrorBoundary
interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

// Hovedkomponent for ErrorBoundary
interface State {
  hasError: boolean;
  error: Error | null;
}

// ErrorBoundary klassekomponent som fanger feil i underliggende komponenter
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  // Oppdater state når en feil fanges
  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  // Feilen vises i fallback-UI i dev (this.state.error.message)
  componentDidCatch(_error: Error, _errorInfo: React.ErrorInfo) {
    // Ingen console – bruk fallback-UI og devtools for debugging
  }
  // Last inn siden på nytt
  handleReload = () => {
    window.location.reload();
  };
  // Gå til dashboardet
  handleGoHome = () => {
    window.location.href = "/dashboard";
  };
  // Render fallback UI hvis det er en feil, ellers render children
  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-full flex items-center justify-center p-6">
          <div className="max-w-md w-full text-center space-y-6">
            <div className="mx-auto w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
              <AlertTriangle className="w-8 h-8 text-red-600 dark:text-red-400" />
            </div>
            
            <div className="space-y-2">
              <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
                En feil oppstod
              </h2>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Noe gikk galt i denne delen av siden. Prøv å laste inn på nytt, eller gå tilbake til dashboardet.
              </p>
            </div>

            {process.env.NODE_ENV === "development" && this.state.error && (
              <div className="p-3 rounded-lg bg-slate-100 dark:bg-slate-800 text-left">
                <p className="text-xs font-mono text-red-600 dark:text-red-400 break-all">
                  {this.state.error.message}
                </p>
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <button
                onClick={this.handleReload}
                className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-blue-600 dark:bg-blue-500 text-white hover:bg-blue-700 dark:hover:bg-blue-600 transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                Last inn på nytt
              </button>
              <button
                onClick={this.handleGoHome}
                className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <Home className="w-4 h-4" />
                Gå til dashboard
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// Enkel wrapper for seksjoner som kan feile
export function SectionErrorBoundary({
  children,
  sectionName,
}: {
  children: ReactNode;
  sectionName: string;
}) {
  return (
    <ErrorBoundary
      fallback={
        <div className="p-6">
          <FeilMelding melding={`Kunne ikke laste ${sectionName}. Prøv å laste siden på nytt.`} />
        </div>
      }
    >
      {children}
    </ErrorBoundary>
  );
}
