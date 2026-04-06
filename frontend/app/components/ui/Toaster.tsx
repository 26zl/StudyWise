/*
 * Toast-system for brukervarsler
 * Bruker sonner for enkle, pene notifications
 */
"use client";

import { Toaster as SonnerToaster, toast, type ExternalToast } from "sonner";

type ToastOptions = Pick<ExternalToast, "action" | "duration">;

// Toaster-komponent for å vise toast-meldinger
export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-right"
      expand={false}
      richColors
      closeButton
      duration={4000}
      swipeDirections={[]}
      toastOptions={{
        classNames: {
          toast: "group toast",
          title: "text-sm font-medium",
          description: "text-sm text-slate-500 dark:text-slate-400",
          actionButton: "bg-blue-600 text-white",
          cancelButton: "bg-slate-100 dark:bg-slate-800",
          closeButton: "bg-white dark:bg-slate-900",
        },
      }}
    />
  );
}

// Hjelpefunksjoner for å vise toasts
export const showToast = {
  // Suksess-melding
  success: (melding: string, beskrivelse?: string, options?: ToastOptions) => {
    toast.success(melding, { description: beskrivelse, ...options });
  },

  // Feil-melding
  error: (melding: string, beskrivelse?: string, options?: ToastOptions) => {
    toast.error(melding, { description: beskrivelse, ...options });
  },

  // Informasjons-melding
  info: (melding: string, beskrivelse?: string, options?: ToastOptions) => {
    toast.info(melding, { description: beskrivelse, ...options });
  },

  // Advarsel-melding
  warning: (melding: string, beskrivelse?: string, options?: ToastOptions) => {
    toast.warning(melding, { description: beskrivelse, ...options });
  },

  // Suksess med angre-knapp (undo ved sletting)
  undoable: (melding: string, onUndo: () => void, label: string, varighet = 5000) => {
    toast.success(melding, {
      duration: varighet,
      action: {
        label,
        onClick: onUndo,
      },
    });
  },

  // Lasting-melding med promise
  promise: <T,>(
    promise: Promise<T>,
    meldinger: {
      loading: string;
      success: string | ((data: T) => string);
      error: string | ((error: Error) => string);
    }
  ) => {
    return toast.promise(promise, meldinger);
  },

  // Dismiss alle toasts
  dismiss: () => {
    toast.dismiss();
  },
};

// Re-eksporter toast for direkte bruk
export { toast };  
