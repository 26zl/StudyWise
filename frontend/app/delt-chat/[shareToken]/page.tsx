/**
 * Side for delt chat – henter og viser en delt samtale via shareToken fra URL.
 * Krever ikke innlogging; brukes når noen deler en KI-samtale med delingslenke.
 */
"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Bot, User } from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { CodeBlock } from "@/app/components/ui/CodeBlock";
import { FeilMelding } from "@/app/components/ui/FeilMelding";
import { LoadingView } from "@/app/components/ui/Loading";
import { Footer } from "@/app/components/layout/footer";
import {
    SharedChatResponseSchema,
    type SharedChatResponse,
} from "common/chat";
import { formaterDatoLong } from "../../lib/dato";

const markdownKomponenter: Components = {
    code: CodeBlock,
    pre: ({ children }) => <>{children}</>,
};

export default function DeltSamtaleSide() {
    const params = useParams<{ shareToken: string }>();
    const [data, setData] = useState<SharedChatResponse | null>(null);
    const [laster, setLaster] = useState(true);
    const [feil, setFeil] = useState<string | null>(null);
    const [retryKey, setRetryKey] = useState(0);

    const token = typeof params?.shareToken === "string" ? params.shareToken : null;

    useEffect(() => {
        if (!token) {
            setLaster(false);
            setFeil("Mangler delingslenke.");
            return;
        }
        const ac = new AbortController();
        let cancelled = false;
        setLaster(true);
        setFeil(null);
        setData(null);
        (async () => {
            try {
                const res = await fetch(`/api/shared/${token}`, {
                    cache: "no-store",
                    signal: ac.signal,
                    credentials: "omit",
                  });
                if (cancelled) return;
                if (!res.ok) {
                    if (res.status === 404) {
                        setFeil("Denne samtalen finnes ikke eller er ikke lenger delt.");
                        return;
                    }
                    setFeil("Kunne ikke hente samtalen. Prøv igjen senere.");
                    return;
                }
                const json = await res.json();
                const parsed = SharedChatResponseSchema.parse(json);
                if (cancelled) return;
                setData(parsed);
            } catch (err) {
                if (cancelled || (err instanceof Error && err.name === "AbortError")) return;
                const isParse = err instanceof Error && (("ZodError" in err) || err.message.includes("parse"));
                setFeil(isParse ? "Ugyldig data fra server. Prøv igjen senere." : "Noe gikk galt ved henting av samtalen.");
            } finally {
                if (!cancelled) setLaster(false);
            }
        })();
        return () => {
            cancelled = true;
            ac.abort();
        };
    }, [token, retryKey]);

    if (laster) {
        return <LoadingView text="Laster delt samtale..." fullPage />;
    }

    if (feil || !data) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 gap-4">
                <div className="w-full max-w-md">
                    <FeilMelding melding={feil ?? "Den delte samtalen finnes ikke."} />
                </div>
                {feil && (
                    <button
                        type="button"
                        onClick={() => setRetryKey((k) => k + 1)}
                        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
                    >
                        Prøv igjen
                    </button>
                )}
            </div>
        );
    }

    return (
        <div className="flex flex-col min-h-screen">
            <div className="flex-1 max-w-3xl mx-auto w-full px-4 py-8">
                <div className="mb-8 pb-4 border-b border-slate-200 dark:border-slate-700">
                    <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
                        {data.title}
                    </h1>
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                        Delt {formaterDatoLong(data.sharedAt)} · Utløper {formaterDatoLong(data.expiresAt)}
                    </p>
                    <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-purple-100 dark:bg-purple-900/40 px-3 py-1 text-xs font-medium text-purple-700 dark:text-purple-300">
                        <User className="w-3.5 h-3.5" />
                        StudyWise delt chat
                    </div>
                    <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">
                        Denne lenken viser hele chatten slik den ble delt, inkludert brukerens egne meldinger og KI-svar.
                    </p>
                </div>

                <div className="space-y-6">
                    {data.messages.map((melding, index) => (
                        <div
                            key={index}
                            className={`flex items-start gap-3 ${melding.rolle === "user" ? "justify-end" : "justify-start"}`}
                        >
                            {melding.rolle === "assistant" && (
                                <div className="shrink-0 w-8 h-8 rounded-full bg-purple-100 dark:bg-purple-900/40 flex items-center justify-center mt-1">
                                    <Bot className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                                </div>
                            )}

                            <div className={melding.rolle === "user" ? "max-w-[80%]" : "w-full min-w-0"}>
                                <div
                                    className={
                                        melding.rolle === "user"
                                            ? "rounded-2xl px-5 py-3.5 bg-stone-100 dark:bg-slate-700 text-slate-900 dark:text-white"
                                            : "text-slate-900 dark:text-white"
                                    }
                                >
                                    {melding.rolle === "assistant" ? (
                                        <div className="prose prose-base dark:prose-invert prose-p:my-2 prose-p:leading-relaxed prose-headings:my-3 prose-ul:my-2 prose-ol:my-2 prose-li:my-1 prose-pre:my-0 prose-code:before:content-none prose-code:after:content-none max-w-none">
                                            <ReactMarkdown
                                                remarkPlugins={[remarkGfm]}
                                                rehypePlugins={[rehypeSanitize]}
                                                components={markdownKomponenter}
                                            >
                                                {melding.innhold}
                                            </ReactMarkdown>
                                        </div>
                                    ) : (
                                        <p className="text-[15px] leading-relaxed whitespace-pre-wrap">
                                            {melding.innhold}
                                        </p>
                                    )}
                                </div>
                            </div>

                            {melding.rolle === "user" && (
                                <div className="shrink-0 w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-600 flex items-center justify-center mt-1">
                                    <User className="w-5 h-5 text-slate-600 dark:text-slate-300" />
                                </div>
                            )}
                        </div>
                    ))}
                </div>

                <div className="mt-12 pt-4 border-t border-slate-200 dark:border-slate-700">
                    <p className="text-xs text-slate-400 dark:text-slate-500 text-center">
                        Denne siden viser et delt snapshot av hele StudyWise-chatten.
                    </p>
                </div>
            </div>
            <Footer />
        </div>
    );
}
