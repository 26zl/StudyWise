"use client";

import { useEffect, useState, type CSSProperties, type ImgHTMLAttributes, type JSX } from "react";
import { createCanvasHtmlParser, parseCanvasHtml } from "@/app/canvas/canvasHtml";
import { fetchApi } from "@/app/lib/apiClient";

function normalizeStyle(style?: string | CSSProperties): CSSProperties | undefined {
    if (!style) return undefined;
    if (typeof style !== "string") return style;

    return style.split(";").reduce((acc, decl) => {
        const [rawProp, rawValue] = decl.split(":");
        if (!rawProp || !rawValue) return acc;

        const prop = rawProp.trim().replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        const value = rawValue.trim();
        if (!prop || !value) return acc;

        (acc as Record<string, string>)[prop] = value;
        return acc;
    }, {} as CSSProperties);
}

function erBeskyttetCanvasBildeUrl(src?: string): boolean {
    if (!src || typeof src !== "string") return false;

    try {
        const url = new URL(src, "https://www.studwize.page");
        return url.pathname.startsWith("/api/canvas/");
    } catch {
        return src.startsWith("/api/canvas/");
    }
}

function TilpassetBilde({
    src,
    alt,
    style,
    className: _className,
    class: _class,
    ...props
}: ImgHTMLAttributes<HTMLImageElement> & { class?: string }): JSX.Element {
    const originalSrc = typeof src === "string" ? src : undefined;
    const [laster, settLaster] = useState(true);
    const [bildeFeilet, settBildeFeilet] = useState(false);
    const [resolvedSrc, setResolvedSrc] = useState<string | undefined>(() =>
        erBeskyttetCanvasBildeUrl(originalSrc) ? undefined : originalSrc,
    );
    const safeStyle = normalizeStyle(style);

    useEffect(() => {
        let isCancelled = false;
        let objectUrl: string | null = null;

        settLaster(true);
        settBildeFeilet(false);
        setResolvedSrc(erBeskyttetCanvasBildeUrl(originalSrc) ? undefined : originalSrc);

        if (!originalSrc || !erBeskyttetCanvasBildeUrl(originalSrc)) {
            return () => {
                if (objectUrl) {
                    URL.revokeObjectURL(objectUrl);
                }
            };
        }

        const hentBeskyttetBilde = async () => {
            try {
                const res = await fetchApi(originalSrc);
                if (!res.ok) {
                    throw new Error(`Kunne ikke hente Canvas-bilde (${res.status})`);
                }

                const blob = await res.blob();
                objectUrl = URL.createObjectURL(blob);

                if (!isCancelled) {
                    setResolvedSrc(objectUrl);
                }
            } catch {
                if (!isCancelled) {
                    setResolvedSrc(undefined);
                    settBildeFeilet(true);
                    settLaster(false);
                }
            }
        };

        void hentBeskyttetBilde();

        return () => {
            isCancelled = true;
            if (objectUrl) {
                URL.revokeObjectURL(objectUrl);
            }
        };
    }, [originalSrc]);

    return (
        <span className="relative my-3 inline-block overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800">
            {laster && (
                <span className="absolute inset-0 animate-pulse bg-slate-200 dark:bg-slate-700" />
            )}
            {resolvedSrc ? (
                <img
                    src={resolvedSrc}
                    alt={alt}
                    {...props}
                    className={`transition-opacity duration-500 ${laster ? "opacity-0" : "opacity-100"} max-w-full max-h-75 w-auto h-auto object-contain`}
                    style={safeStyle}
                    onLoad={() => settLaster(false)}
                    onError={() => settLaster(false)}
                    loading="lazy"
                />
            ) : (
                <span className={`inline-flex min-h-24 min-w-32 items-center justify-center px-4 py-3 text-sm ${bildeFeilet ? "text-red-500 dark:text-red-400" : "text-slate-500 dark:text-slate-400"}`}>
                    {bildeFeilet ? "Kunne ikke laste bilde" : (alt || "Canvas bilde")}
                </span>
            )}
        </span>
    );
}

const htmlParser = createCanvasHtmlParser((domNode) => (
    <TilpassetBilde
        src={domNode.attribs?.src ?? ""}
        alt={domNode.attribs?.alt || "Canvas bilde"}
        {...domNode.attribs}
    />
));

interface CanvasHtmlContentProps {
    html: string | null | undefined;
    className?: string;
}

export function CanvasHtmlContent({ html, className }: CanvasHtmlContentProps): JSX.Element {
    return (
        <div className={className}>
            {parseCanvasHtml(html, htmlParser)}
        </div>
    );
}
