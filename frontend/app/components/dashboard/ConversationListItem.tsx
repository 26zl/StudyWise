"use client";

import type { ReactNode } from "react";

type ConversationListItemProps = {
  title: string;
  preview?: string;
  meta?: ReactNode;
  onOpen: () => void;
  leadingControl?: ReactNode;
  titleIcon?: ReactNode;
  titleBadge?: ReactNode;
  footer?: ReactNode;
};

export function ConversationListItem({
  title,
  preview,
  meta,
  onOpen,
  leadingControl,
  titleIcon,
  titleBadge,
  footer,
}: ConversationListItemProps) {
  return (
    <article className="rounded-lg border-b border-slate-200 dark:border-slate-800">
      <div className="flex items-start gap-2 px-1 py-4">
        {leadingControl}
        <button
          type="button"
          onClick={onOpen}
          className="w-full rounded-lg text-left hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 dark:hover:bg-slate-800/50"
        >
          <div className="flex items-center gap-2">
            {titleIcon}
            <p className="truncate text-lg font-semibold">{title}</p>
            {titleBadge}
          </div>
          {preview ? (
            <p className="mt-1.5 line-clamp-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
              {preview}
            </p>
          ) : null}
          {meta ? <div className="mt-1 text-xs text-slate-500">{meta}</div> : null}
        </button>
      </div>
      {footer ? <div className="flex items-center justify-end gap-2 px-1 pb-4 pt-3">{footer}</div> : null}
    </article>
  );
}
