/*
 * ProfileCompletionModal - Modal for completing profile when firstName/lastName is incomplete
 * Shows when OAuth providers return incomplete profile data (e.g., single initial for first name)
 */
"use client";

import { useState, useRef, useId, useCallback, useEffect } from "react";
import { User, Save, Loader2 } from "lucide-react";
import { useOppdaterProfil } from "@/app/auth/auth-api";
import { showToast } from "@/app/components/ui/Toaster";
import { useLanguage } from "@/app/i18n";
import { useDialogAccessibility } from "@/app/hooks/useDialogAccessibility";
import { MIN_FIRST_NAME_LENGTH, isValidFirstName, isValidLastName } from "common/auth";

interface ProfileCompletionModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentFirstName?: string;
  currentLastName?: string;
}

export function ProfileCompletionModal({
  isOpen,
  onClose,
  currentFirstName,
  currentLastName,
}: ProfileCompletionModalProps) {
  const { t } = useLanguage();
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstNameRef = useRef<HTMLInputElement>(null);
  const titleId = useId();

  // Initialize with current values, but show as empty if they're invalid (like single initials)
  const [firstName, setFirstName] = useState(() =>
    isValidFirstName(currentFirstName) ? currentFirstName ?? "" : ""
  );
  const [lastName, setLastName] = useState(() =>
    isValidLastName(currentLastName) ? currentLastName ?? "" : ""
  );
  const [errors, setErrors] = useState<{ firstName?: string; lastName?: string }>({});

  const { mutate: updateProfile, isPending } = useOppdaterProfil();

  // Reset form when modal opens with new values
  useEffect(() => {
    if (isOpen) {
      setFirstName(isValidFirstName(currentFirstName) ? currentFirstName ?? "" : "");
      setLastName(isValidLastName(currentLastName) ? currentLastName ?? "" : "");
      setErrors({});
    }
  }, [isOpen, currentFirstName, currentLastName]);

  const handleClose = useCallback(() => {
    // Don't allow closing while saving, or if profile is still incomplete
    if (isPending) return;
    
    // Only allow close if both fields are now valid
    if (isValidFirstName(firstName) && isValidLastName(lastName)) {
      onClose();
    }
  }, [isPending, firstName, lastName, onClose]);

  useDialogAccessibility({
    open: isOpen,
    containerRef: dialogRef,
    initialFocusRef: firstNameRef,
    onClose: handleClose,
  });

  const validate = (): boolean => {
    const newErrors: { firstName?: string; lastName?: string } = {};

    if (!firstName.trim()) {
      newErrors.firstName = t("settings.profileCompletion.validation.firstNameRequired");
    } else if (firstName.trim().length < MIN_FIRST_NAME_LENGTH) {
      newErrors.firstName = t("settings.profileCompletion.validation.firstNameMinLength");
    }

    if (!lastName.trim()) {
      newErrors.lastName = t("settings.profileCompletion.validation.lastNameRequired");
    } else if (lastName.trim().length < MIN_FIRST_NAME_LENGTH) {
      newErrors.lastName = t("settings.profileCompletion.validation.lastNameMinLength");
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();

    if (!validate()) return;

    updateProfile(
      { firstName: firstName.trim(), lastName: lastName.trim() },
      {
        onSuccess: () => {
          showToast.success(t("settings.profileCompletion.success"));
          onClose();
        },
        onError: () => {
          showToast.error(
            t("settings.profileCompletion.error"),
            t("common.actions.retry")
          );
        },
      }
    );
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 dark:bg-black/70"
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="flex w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl outline-none dark:bg-slate-900"
      >
        {/* Header */}
        <div className="border-b border-slate-200 px-6 py-5 dark:border-slate-700">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-100 dark:bg-blue-900/30">
              <User className="h-6 w-6 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h2
                id={titleId}
                className="text-xl font-bold text-slate-900 dark:text-white"
              >
                {t("settings.profileCompletion.title")}
              </h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {t("settings.profileCompletion.subtitle")}
              </p>
            </div>
          </div>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="flex-1 px-6 py-6">
          <p className="mb-6 text-sm text-slate-600 dark:text-slate-400">
            {t("settings.profileCompletion.description")}
          </p>

          <div className="space-y-4">
            {/* First Name */}
            <div>
              <label
                htmlFor="firstName"
                className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300"
              >
                {t("settings.profileCompletion.firstName")}
              </label>
              <input
                ref={firstNameRef}
                id="firstName"
                type="text"
                value={firstName}
                onChange={(e) => {
                  setFirstName(e.target.value);
                  if (errors.firstName) {
                    setErrors((prev) => ({ ...prev, firstName: undefined }));
                  }
                }}
                placeholder={t("settings.profileCompletion.firstNamePlaceholder")}
                className={`w-full rounded-lg border px-4 py-2.5 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-500 ${
                  errors.firstName
                    ? "border-red-300 focus:border-red-500 focus:ring-red-500/20 dark:border-red-600"
                    : "border-slate-300 focus:border-blue-500 focus:ring-blue-500/20 dark:border-slate-600"
                }`}
                disabled={isPending}
                autoComplete="given-name"
              />
              {errors.firstName && (
                <p className="mt-1.5 text-sm text-red-600 dark:text-red-400">
                  {errors.firstName}
                </p>
              )}
            </div>

            {/* Last Name */}
            <div>
              <label
                htmlFor="lastName"
                className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300"
              >
                {t("settings.profileCompletion.lastName")}
              </label>
              <input
                id="lastName"
                type="text"
                value={lastName}
                onChange={(e) => {
                  setLastName(e.target.value);
                  if (errors.lastName) {
                    setErrors((prev) => ({ ...prev, lastName: undefined }));
                  }
                }}
                placeholder={t("settings.profileCompletion.lastNamePlaceholder")}
                className={`w-full rounded-lg border px-4 py-2.5 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-500 ${
                  errors.lastName
                    ? "border-red-300 focus:border-red-500 focus:ring-red-500/20 dark:border-red-600"
                    : "border-slate-300 focus:border-blue-500 focus:ring-blue-500/20 dark:border-slate-600"
                }`}
                disabled={isPending}
                autoComplete="family-name"
              />
              {errors.lastName && (
                <p className="mt-1.5 text-sm text-red-600 dark:text-red-400">
                  {errors.lastName}
                </p>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="mt-6 flex justify-end">
            <button
              type="submit"
              disabled={isPending}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 font-medium text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-blue-400 dark:focus:ring-offset-slate-900"
            >
              {isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t("settings.profileCompletion.saving")}
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  {t("settings.profileCompletion.submit")}
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
