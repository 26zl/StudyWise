/*
 * FAQ - Ofte stilte spørsmål om StudyWise
 */
"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  ChevronDown,
  Shield,
  Sparkles,
  UserCircle2,
} from "lucide-react";
import { useLanguage } from "@/app/i18n";
import { Footer } from "@/app/components/layout/footer";
import { INFO_PAGE_INLINE_LINK_CLASSNAME } from "@/app/components/layout/InfoPageLayout";

type FaqCategoryId = "canvas" | "security" | "account" | "features" | "limitations";

interface FaqItem {
  q: string;
  a: ReactNode;
  searchText: string;
}

interface FaqCategory {
  id: FaqCategoryId;
  kategori: string;
  icon: typeof BookOpen;
  iconClassName: string;
  items: FaqItem[];
}

export default function FaqPage() {
  const { t } = useLanguage();
  const [activeCategory, setActiveCategory] = useState<"all" | FaqCategoryId>("all");
  const [openItems, setOpenItems] = useState<Record<string, boolean>>({});

  const backLabel = t("infoPageLayout.backToHome").replace(/^←\s*/, "");

  const sporsmal: FaqCategory[] = [
    {
      id: "canvas",
      kategori: t("faq.categoryCanvas"),
      icon: BookOpen,
      iconClassName: "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300",
      items: [
        {
          q: t("faq.canvasTokenQ"),
          a: (
            <>
              {t("faq.canvasTokenA")}
            </>
          ),
          searchText: [
            t("faq.canvasTokenQ"),
            t("faq.canvasTokenA"),
          ].join(" "),
        },
        {
          q: t("faq.canvasInstitutionsQ"),
          a: (
            <>
              {t("faq.canvasInstitutionsA1")}{" "}
              <Link href="/kontakt" prefetch={false} className={INFO_PAGE_INLINE_LINK_CLASSNAME}>
                {t("faq.canvasInstitutionsLink")}
              </Link>{" "}
              {t("faq.canvasInstitutionsA2")}
            </>
          ),
          searchText: [
            t("faq.canvasInstitutionsQ"),
            t("faq.canvasInstitutionsA1"),
            t("faq.canvasInstitutionsLink"),
            t("faq.canvasInstitutionsA2"),
          ].join(" "),
        },
        {
          q: t("faq.vsCanvasQ"),
          a: t("faq.vsCanvasA"),
          searchText: [
            t("faq.vsCanvasQ"),
            t("faq.vsCanvasA"),
          ].join(" "),
        },
        {
          q: t("faq.supplementQ"),
          a: t("faq.supplementA"),
          searchText: [
            t("faq.supplementQ"),
            t("faq.supplementA"),
          ].join(" "),
        },
      ],
    },
    {
      id: "security",
      kategori: t("faq.categorySecurityPrivacy"),
      icon: Shield,
      iconClassName: "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300",
      items: [
        {
          q: t("faq.dataSecureQ"),
          a: (
            <>
              {t("faq.dataSecureA")}{" "}
              <Link href="/sikkerhet" prefetch={false} className={INFO_PAGE_INLINE_LINK_CLASSNAME}>
                {t("faq.dataSecureLink")}
              </Link>
              .
            </>
          ),
          searchText: [
            t("faq.dataSecureQ"),
            t("faq.dataSecureA"),
            t("faq.dataSecureLink"),
          ].join(" "),
        },
        {
          q: t("faq.twoFactorQ"),
          a: t("faq.twoFactorA"),
          searchText: [
            t("faq.twoFactorQ"),
            t("faq.twoFactorA"),
          ].join(" "),
        },
        {
          q: t("faq.thirdPartyQ"),
          a: (
            <>
              {t("faq.thirdPartyA1")}{" "}
              <Link href="/personvern" prefetch={false} className={INFO_PAGE_INLINE_LINK_CLASSNAME}>
                {t("faq.thirdPartyLink")}
              </Link>{" "}
              {t("faq.thirdPartyA2")}
            </>
          ),
          searchText: [
            t("faq.thirdPartyQ"),
            t("faq.thirdPartyA1"),
            t("faq.thirdPartyA2"),
            t("faq.thirdPartyLink"),
          ].join(" "),
        },
        {
          q: t("faq.termsUpdateQ"),
          a: t("faq.termsUpdateA"),
          searchText: [
            t("faq.termsUpdateQ"),
            t("faq.termsUpdateA"),
          ].join(" "),
        },
        {
          q: t("faq.statusQ"),
          a: (
            <>
              {t("faq.statusA")}{" "}
              <Link href="/status" prefetch={false} className={INFO_PAGE_INLINE_LINK_CLASSNAME}>
                {t("faq.statusLink")}
              </Link>{" "}
              {t("faq.statusASuffix")}
            </>
          ),
          searchText: [
            t("faq.statusQ"),
            t("faq.statusA"),
            t("faq.statusLink"),
            t("faq.statusASuffix"),
          ].join(" "),
        },
      ],
    },
    {
      id: "account",
      kategori: t("faq.categoryAccount"),
      icon: UserCircle2,
      iconClassName: "bg-violet-100 text-violet-600 dark:bg-violet-900/30 dark:text-violet-300",
      items: [
        {
          q: t("faq.deleteAccountQ"),
          a: (
            <>
              {t("faq.deleteAccountA1")}{" "}
              <Link href="/kontakt" prefetch={false} className={INFO_PAGE_INLINE_LINK_CLASSNAME}>
                {t("faq.deleteAccountLink")}
              </Link>{" "}
              {t("faq.deleteAccountA2")}
            </>
          ),
          searchText: [
            t("faq.deleteAccountQ"),
            t("faq.deleteAccountA1"),
            t("faq.deleteAccountA2"),
            t("faq.deleteAccountLink"),
          ].join(" "),
        },
        {
          q: t("faq.withoutCanvasQ"),
          a: t("faq.withoutCanvasA"),
          searchText: [
            t("faq.withoutCanvasQ"),
            t("faq.withoutCanvasA"),
          ].join(" "),
        },
      ],
    },
    {
      id: "features",
      kategori: t("faq.categoryFeatures"),
      icon: Sparkles,
      iconClassName: "bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-300",
      items: [
        {
          q: t("faq.responseTimeQ"),
          a: t("faq.responseTimeA"),
          searchText: [t("faq.responseTimeQ"), t("faq.responseTimeA")].join(" "),
        },
        {
          q: t("faq.fileTypesQ"),
          a: t("faq.fileTypesA"),
          searchText: [t("faq.fileTypesQ"), t("faq.fileTypesA")].join(" "),
        },
        {
          q: t("faq.knowledgeBaseQ"),
          a: t("faq.knowledgeBaseA"),
          searchText: [t("faq.knowledgeBaseQ"), t("faq.knowledgeBaseA")].join(" "),
        },
        {
          q: t("faq.quizQ"),
          a: t("faq.quizA"),
          searchText: [t("faq.quizQ"), t("faq.quizA")].join(" "),
        },
        {
          q: t("faq.studyPlanQ"),
          a: t("faq.studyPlanA"),
          searchText: [t("faq.studyPlanQ"), t("faq.studyPlanA")].join(" "),
        },
        {
          q: t("faq.taskBreakdownQ"),
          a: t("faq.taskBreakdownA"),
          searchText: [t("faq.taskBreakdownQ"), t("faq.taskBreakdownA")].join(" "),
        },
        {
          q: t("faq.exportQ"),
          a: t("faq.exportA"),
          searchText: [t("faq.exportQ"), t("faq.exportA")].join(" "),
        },
        {
          q: t("faq.notionQ"),
          a: t("faq.notionA"),
          searchText: [t("faq.notionQ"), t("faq.notionA")].join(" "),
        },
        {
          q: t("faq.pushQ"),
          a: t("faq.pushA"),
          searchText: [t("faq.pushQ"), t("faq.pushA")].join(" "),
        },
        {
          q: t("faq.sharedChatsQ"),
          a: t("faq.sharedChatsA"),
          searchText: [t("faq.sharedChatsQ"), t("faq.sharedChatsA")].join(" "),
        },
      ],
    },
    {
      id: "limitations",
      kategori: t("faq.categoryKnownLimitations"),
      icon: AlertTriangle,
      iconClassName: "bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-300",
      items: [
        {
          q: t("faq.parallelChatsQ"),
          a: t("faq.parallelChatsA"),
          searchText: [t("faq.parallelChatsQ"), t("faq.parallelChatsA")].join(" "),
        },
        {
          q: t("faq.imageHeavyPptxQ"),
          a: t("faq.imageHeavyPptxA"),
          searchText: [t("faq.imageHeavyPptxQ"), t("faq.imageHeavyPptxA")].join(" "),
        },
        {
          q: t("faq.largeFilesQ"),
          a: t("faq.largeFilesA"),
          searchText: [t("faq.largeFilesQ"), t("faq.largeFilesA")].join(" "),
        },
        {
          q: t("faq.canvasPermissionsQ"),
          a: t("faq.canvasPermissionsA"),
          searchText: [t("faq.canvasPermissionsQ"), t("faq.canvasPermissionsA")].join(" "),
        },
        {
          q: t("faq.cacheBehaviourQ"),
          a: t("faq.cacheBehaviourA"),
          searchText: [t("faq.cacheBehaviourQ"), t("faq.cacheBehaviourA")].join(" "),
        },
        {
          q: t("faq.coldStartQ"),
          a: t("faq.coldStartA"),
          searchText: [t("faq.coldStartQ"), t("faq.coldStartA")].join(" "),
        },
        {
          q: t("faq.sourcePanelQ"),
          a: t("faq.sourcePanelA"),
          searchText: [t("faq.sourcePanelQ"), t("faq.sourcePanelA")].join(" "),
        },
        {
          q: t("faq.moduleHintQ"),
          a: t("faq.moduleHintA"),
          searchText: [t("faq.moduleHintQ"), t("faq.moduleHintA")].join(" "),
        },
      ],
    },
  ];

  const filteredGroups = sporsmal
    .filter((group) => activeCategory === "all" || group.id === activeCategory)
    .filter((group) => group.items.length > 0);

  const totalMatches = filteredGroups.reduce((sum, group) => sum + group.items.length, 0);

  const toggleItem = (id: string) => {
    setOpenItems((current) => ({
      ...current,
      [id]: !current[id],
    }));
  };

  return (
    <div className="min-h-full flex flex-col">
      <main className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6 sm:py-14">
        <Link
          href="/"
          prefetch={false}
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          {backLabel}
        </Link>

        <section className="mt-8 text-center">
          <h1 className="mt-4 text-4xl sm:text-5xl font-bold tracking-tight text-slate-900 dark:text-white text-balance">
            {t("faq.titlePrefix")}{" "}
            <span className="bg-linear-to-r from-blue-500 to-indigo-500 bg-clip-text text-transparent">
              {t("faq.titleAccent")}
            </span>
          </h1>
          <p className="mt-3 text-sm sm:text-base text-slate-600 dark:text-slate-300 max-w-2xl mx-auto text-balance">
            {t("faq.description")}
          </p>

          <div className="mt-8 space-y-4">
            <div className="flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => setActiveCategory("all")}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                  activeCategory === "all"
                    ? "border-blue-500 bg-blue-500 text-white"
                    : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-600"
                }`}
              >
                {t("faq.filterAll")}
              </button>
              {sporsmal.map((group) => (
                <button
                  key={group.id}
                  type="button"
                  onClick={() => setActiveCategory(group.id)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                    activeCategory === group.id
                      ? "border-blue-500 bg-blue-500 text-white"
                      : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-600"
                  }`}
                >
                  {group.kategori}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="mt-8 space-y-4">
          {filteredGroups.map((gruppe) => {
            const Icon = gruppe.icon;

            return (
              <article
                key={gruppe.id}
                className="rounded-2xl border border-slate-200 bg-white/85 dark:bg-slate-900/45 dark:border-slate-700 overflow-hidden backdrop-blur-sm"
              >
                <header className="flex items-center justify-between gap-4 px-4 py-3 border-b border-slate-200 dark:border-slate-700">
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex h-6 w-6 items-center justify-center rounded-md ${gruppe.iconClassName}`}>
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    <h2 className="text-sm font-semibold text-slate-900 dark:text-white">{gruppe.kategori}</h2>
                  </div>
                  <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{gruppe.items.length}</span>
                </header>

                <div>
                  {gruppe.items.map((item, index) => {
                    const itemId = `${gruppe.id}-${index}-${item.q}`;
                    const isOpen = Boolean(openItems[itemId]);

                    return (
                      <div key={itemId} className="border-t first:border-t-0 border-slate-200 dark:border-slate-700">
                        <button
                          type="button"
                          onClick={() => toggleItem(itemId)}
                          className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                        >
                          <span className="flex items-start gap-2 text-sm font-medium text-slate-800 dark:text-slate-100">
                            <span className="text-blue-400 leading-5">•</span>
                            <span>{item.q}</span>
                          </span>
                          <ChevronDown
                            className={`h-4 w-4 shrink-0 text-slate-500 transition-transform ${
                              isOpen ? "rotate-180" : ""
                            }`}
                          />
                        </button>

                        {isOpen ? (
                          <div className="px-9 pb-4 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                            {item.a}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </article>
            );
          })}

          {totalMatches === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white/80 px-5 py-6 text-center text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
              {t("faq.noMatches")}
            </div>
          ) : null}
        </section>

        <section className="mt-10 text-center">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {t("faq.notFound")}{" "}
            <Link href="/kontakt" prefetch={false} className={INFO_PAGE_INLINE_LINK_CLASSNAME}>
              {t("faq.contactUs")}
            </Link>
            .
          </p>
        </section>
      </main>

      <Footer />
    </div>
  );
}
