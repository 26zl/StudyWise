/**
 * CourseKnowledgePanel – viser hvilke filer KI har indeksert for et gitt kurs.
 *
 * Bygger tillit ved at brukeren ser eksakt hva KI kan svare basert på.
 */
"use client";

import { Brain, ChevronDown, ChevronUp, FileText } from "lucide-react";
import { useEffect, useState } from "react";
import { useCourseKnowledge } from "../../ki/ki-api";
import { useLanguage } from "../../i18n";
import { LoadingSpinner } from "../ui/Loading";
import { downloadAuthedFile } from "../../lib/apiClient";
import { showToast } from "../ui/Toaster";

interface Props {
  courseId: number | string | null | undefined;
}

const STORAGE_KEY = "studwise.courseKnowledge.collapsed";

export function CourseKnowledgePanel({ courseId }: Props) {
  const { t } = useLanguage();
  const { data, isLoading, isError } = useCourseKnowledge(courseId ?? null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setCollapsed(window.localStorage.getItem(STORAGE_KEY) === "1");
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      }
      return next;
    });
  };

  if (!courseId) return null;

  return (
    <div className="rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-900/10 p-4">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <Brain className="w-4 h-4 shrink-0 text-blue-600 dark:text-blue-400" />
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white truncate">
            {t("chat.knowledge.title")}
          </h3>
        </div>
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-expanded={!collapsed}
          aria-label={collapsed ? t("common.actions.show") : t("common.actions.hide")}
          title={collapsed ? t("common.actions.show") : t("common.actions.hide")}
          className="shrink-0 inline-flex h-6 w-6 items-center justify-center rounded-md text-slate-500 hover:text-slate-900 hover:bg-blue-100 dark:text-slate-400 dark:hover:text-white dark:hover:bg-blue-900/30 transition-colors"
        >
          {collapsed ? (
            <ChevronDown className="w-4 h-4" />
          ) : (
            <ChevronUp className="w-4 h-4" />
          )}
        </button>
      </div>

      {!collapsed && isLoading && (
        <div className="py-2"><LoadingSpinner /></div>
      )}

      {!collapsed && isError && (
        <p className="text-xs text-red-600 dark:text-red-400">
          {t("chat.knowledge.error")}
        </p>
      )}

      {!collapsed && data && (
        <>
          <p className="text-xs text-slate-600 dark:text-slate-400 mb-2">
            {t("chat.knowledge.summary")
              .replace("{files}", String(data.fileCount))
              .replace("{chunks}", String(data.totalChunks))}
          </p>

          {data.files.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400 italic">
              {t("chat.knowledge.empty")}
            </p>
          ) : (
            <ul className="space-y-1 max-h-64 overflow-y-auto">
              {data.files.map((f) => (
                <li
                  key={f.fileId}
                  className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300"
                >
                  <FileText className="w-3 h-3 shrink-0 text-blue-600 dark:text-blue-400" />
                  <button
                    type="button"
                    onClick={() => {
                      // Tving fileId til heltall for å bryte Snyks taint-sporing —
                      // downloadAuthedFile krever uansett en /api/-prefiks-URL.
                      const trygFileId = Number.parseInt(String(f.fileId), 10);
                      if (!Number.isFinite(trygFileId) || trygFileId <= 0) {
                        showToast.error(t("errors.generic.download"));
                        return;
                      }
                      // deepcode ignore DOMXSS: trygFileId er heltall-validert; downloadAuthedFile kontrollerer at URL starter med /api/.
                      void downloadAuthedFile(
                        `/api/canvas/filer/${trygFileId}/download`,
                        f.fileName,
                      ).catch(() => {
                        showToast.error(t("errors.generic.download"));
                      });
                    }}
                    className="truncate hover:underline text-left"
                    title={f.fileName}
                  >
                    {f.fileName}
                  </button>
                  <span className="text-slate-400 dark:text-slate-500 shrink-0">
                    · {f.chunkCount}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
