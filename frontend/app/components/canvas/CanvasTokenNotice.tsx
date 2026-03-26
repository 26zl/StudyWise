"use client";

import Link from "next/link";
import { FeilMelding, type FeilMeldingType } from "@/app/components/ui/FeilMelding";
import { useLanguage } from "@/app/i18n";
import { cn } from "@/app/lib/utils";

type CanvasTokenNoticeProps = {
  variant?: "missing" | "invalid";
  message?: string;
  className?: string;
};

export function CanvasTokenNotice({
  variant = "missing",
  message,
  className,
}: CanvasTokenNoticeProps) {
  const { t } = useLanguage();

  const resolvedMessage =
    message ??
    t(variant === "invalid" ? "errors.canvas.tokenInvalid" : "errors.canvas.tokenMissing");

  const type: FeilMeldingType = variant === "invalid" ? "warning" : "error";

  return (
    <div className={cn("space-y-3", className)}>
      <FeilMelding melding={resolvedMessage} type={type} />
      <Link
        href="/dashboard?view=settings"
        prefetch={false}
        className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
      >
        {t("common.actions.goToSettings")}
      </Link>
    </div>
  );
}
