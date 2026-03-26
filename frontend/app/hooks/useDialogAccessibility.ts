"use client";

/**
 * Tilgjengelighet for dialog/modals uten ekstra bibliotek.
 *
 * Gjør tre ting når `open`:
 * - Låser body scroll
 * - Setter initial focus
 * - Trap'er Tab/Shift+Tab inne i container og lukker på Escape
 */
import { useEffect, type RefObject } from "react";

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      [
        "a[href]",
        "button:not([disabled])",
        "textarea:not([disabled])",
        "input:not([disabled])",
        "select:not([disabled])",
        "[tabindex]:not([tabindex='-1'])",
      ].join(","),
    ),
  ).filter((element) => {
    if (element.getAttribute("aria-hidden") === "true") {
      return false;
    }

    if (element.hasAttribute("hidden")) {
      return false;
    }

    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
  });
}

type UseDialogAccessibilityOptions<
  TContainer extends HTMLElement = HTMLElement,
  TInitialFocus extends HTMLElement = HTMLElement,
> = {
  open: boolean;
  enabled?: boolean;
  containerRef: RefObject<TContainer | null>;
  initialFocusRef?: RefObject<TInitialFocus | null>;
  onClose: () => void;
};

/**
 * Hook som gir "focus trap" + Escape-close for en dialog.
 */
export function useDialogAccessibility<
  TContainer extends HTMLElement = HTMLElement,
  TInitialFocus extends HTMLElement = HTMLElement,
>({
  open,
  enabled = true,
  containerRef,
  initialFocusRef,
  onClose,
}: UseDialogAccessibilityOptions<TContainer, TInitialFocus>) {
  useEffect(() => {
    if (!open || !enabled || typeof document === "undefined") {
      return;
    }

    const container = containerRef.current;
    if (!container) {
      return;
    }

    const previousActiveElement =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;

    document.body.style.overflow = "hidden";

    const focusTarget =
      initialFocusRef?.current ?? getFocusableElements(container)[0] ?? container;

    const focusTimeoutId = window.setTimeout(() => {
      focusTarget.focus();
    }, 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const focusableElements = getFocusableElements(container);
      if (focusableElements.length === 0) {
        event.preventDefault();
        container.focus();
        return;
      }

      const first = focusableElements[0];
      const last = focusableElements[focusableElements.length - 1];
      const activeElement =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;

      if (event.shiftKey) {
        if (!activeElement || activeElement === first || !container.contains(activeElement)) {
          event.preventDefault();
          last.focus();
        }
        return;
      }

      if (!activeElement || activeElement === last || !container.contains(activeElement)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.clearTimeout(focusTimeoutId);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;

      if (previousActiveElement && document.contains(previousActiveElement)) {
        previousActiveElement.focus();
      }
    };
  }, [containerRef, enabled, initialFocusRef, onClose, open]);
}
