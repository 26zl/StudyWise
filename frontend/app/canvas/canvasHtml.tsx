/*
* Håndterer parsing og sanitizing av Canvas HTML-innhold for sikker visning
* Inkluderer tilpasning av lenker og mulighet for custom bilde-rendering
*/
"use client";

import type { ReactNode } from "react";
import DOMPurify from "isomorphic-dompurify";
import parse, { Element, domToReact, type DOMNode, type HTMLReactParserOptions } from "html-react-parser";
import { ExternalLink } from "lucide-react";
import { downloadAuthedFile } from "../lib/apiClient";

// DOMPurify konfigurasjon - streng XSS-beskyttelse
const DOMPURIFY_CONFIG: Parameters<typeof DOMPurify.sanitize>[1] = {
    ALLOWED_TAGS: [
        "p", "br", "strong", "b", "em", "i", "u", "s", "strike",
        "h1", "h2", "h3", "h4", "h5", "h6",
        "ul", "ol", "li", "dl", "dt", "dd",
        "a", "img", "figure", "figcaption",
        "table", "thead", "tbody", "tfoot", "tr", "th", "td",
        "blockquote", "pre", "code", "span", "div",
        "hr", "sub", "sup",
    ],
    ALLOWED_ATTR: [
        "href", "src", "alt", "title", "class", "id",
        "width", "height",
        "target", "rel",
        "colspan", "rowspan", "scope",
    ],
    ALLOW_DATA_ATTR: false,  // Blokkerer data-* attributter
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "input", "button"],
    FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover"],
};

function erTillattRelativUrl(value: string): boolean {
    const trimmed = value.trim();
    if (!trimmed || trimmed.startsWith("//")) {
        return false;
    }

    return (
        trimmed.startsWith("/") ||
        trimmed.startsWith("./") ||
        trimmed.startsWith("../") ||
        trimmed.startsWith("#") ||
        !/^[A-Za-z][A-Za-z\d+.-]*:/.test(trimmed)
    );
}

/**
 * Validerer og saniterer URL-er for sikker bruk i href-attributter.
 * Tillater kun http/https protokoller for å forhindre javascript: og data: XSS.
 */
export const sikkerHref = (u?: string | null): string => {
    if (!u || typeof u !== "string") return "#";

    const trimmedOriginal = u.trim();
    if (!trimmedOriginal) return "#";

    // Trim og normaliser
    const trimmed = trimmedOriginal.toLowerCase();

    // Blokker farlige protokoller eksplisitt
    const farligeProtokoll = [
        "javascript:",
        "data:",
        "vbscript:",
        "file:",
    ];

    if (farligeProtokoll.some(p => trimmed.startsWith(p))) {
        return "#";
    }

    // Blokker protokoll-relative URL-er (//evil.example.com)
    if (trimmed.startsWith("//")) {
        return "#";
    }

    // Relative app/proxy-URL-er er trygge å beholde som relative paths.
    if (erTillattRelativUrl(trimmedOriginal)) {
        return trimmedOriginal;
    }

    // Kun tillat absolutte http:// og https://
    try {
        const url = new URL(trimmedOriginal);
        if (url.protocol === "http:" || url.protocol === "https:") {
            return url.href; // Returner normalisert URL (forhindrer casing-basert omgåelse)
        }
    } catch {
        // Ugyldig URL
    }
    
    return "#";
};

/**
 * Validerer og konstruerer en sikker nedlastings-URL for Canvas-filer.
 * Sikrer at content_id kun inneholder tall for å forhindre path traversal.
 */
export const sikkerFilNedlastingUrl = (contentId: number | string | undefined): string | undefined => {
    if (contentId === undefined || contentId === null) return undefined;
    
    // Konverter til string og valider at det kun er tall
    const idString = String(contentId);
    if (!/^\d+$/.test(idString)) {
        return undefined; // Ugyldig ID - ikke tall
    }
    
    // Konstruer sikker URL med validert ID
    return `/api/canvas/filer/${encodeURIComponent(idString)}/download`;
};

const extractCanvasFileId = (value: string): string | undefined => {
    const pathOnly = value.split("#", 1)[0]?.split("?", 1)[0] ?? value;
    const segments = pathOnly.split("/").filter(Boolean);
    const filesIndex = segments.findIndex((segment) => segment.toLowerCase() === "files");
    const maybeId = filesIndex >= 0 ? segments[filesIndex + 1] : undefined;
    if (!maybeId || !/^\d+$/.test(maybeId)) {
        return undefined;
    }
    return maybeId;
};

/**
 * Hvis src ser ut som en Canvas fil-URL (path med /files/NUMBER/), returnerer proxy-URL
 * slik at bildet lastes via backend med brukerens token. Fungerer for både instructure.com
 * og egendefinerte Canvas-domener (f.eks. canvas.ntnu.no).
 */
export const canvasBildeProxyUrl = (src: string | undefined): string | undefined => {
    if (!src || typeof src !== "string") return undefined;
    const trimmed = src.trim();
    if (!trimmed) return undefined;

    const lower = trimmed.toLowerCase();
    if (
        lower.startsWith("javascript:") ||
        lower.startsWith("data:") ||
        lower.startsWith("vbscript:") ||
        lower.startsWith("file:")
    ) {
        return undefined;
    }

    const directFileId = extractCanvasFileId(trimmed);
    if (directFileId) {
        const fileId = directFileId;
        return sikkerFilNedlastingUrl(fileId);
    }

    if (erTillattRelativUrl(trimmed)) {
        return trimmed;
    }

    try {
        const url = new URL(trimmed);
        if (url.protocol !== "http:" && url.protocol !== "https:") {
            return undefined;
        }
        const fileId = extractCanvasFileId(`${url.pathname}${url.search}${url.hash}`);
        if (fileId) {
            return sikkerFilNedlastingUrl(fileId) ?? trimmed;
        }
        return url.href;
    } catch {
        // Ugyldig URL
    }
    return undefined;
};

/**
 * html-react-parser sin replace-funksjon forventer DOMNode-retur, men JSX gir JSX.Element.
 * Denne hjelperen utfører den nødvendige type-broen én gang.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asReplacement = (jsx: ReactNode): any => jsx;

/**
 * Canvas-relative stier som skal omdirigeres til brukerens Canvas-instans
 * i stedet for å peke til StudyWise-domenet (som gir 404).
 */
const CANVAS_RELATIVE_PATH_PREFIXES = [
    "/courses/", "/files/", "/users/", "/groups/",
    "/assignments/", "/modules/", "/pages/", "/announcements/",
    "/discussion_topics/", "/quizzes/", "/grades/", "/calendar",
];

function resolveCanvasRelativeHref(href: string, canvasBaseUrl?: string): string {
    if (!canvasBaseUrl || !href) return sikkerHref(href);
    const trimmed = href.trim();
    if (!trimmed.startsWith("/")) return sikkerHref(href);
    if (CANVAS_RELATIVE_PATH_PREFIXES.some((prefix) => trimmed.startsWith(prefix))) {
        const base = canvasBaseUrl.replace(/\/+$/, "");
        return `${base}${trimmed}`;
    }
    return sikkerHref(href);
}

// Lager parser-opsjoner. Kan utvides med custom bilde-rendering fra konsument
export const createCanvasHtmlParser = (
    renderImage?: (el: Element) => ReactNode,
    canvasBaseUrl?: string,
    onDownloadError?: (err: unknown) => void,
): HTMLReactParserOptions => {
    const replace: HTMLReactParserOptions["replace"] = (domNode) => {
        if (domNode instanceof Element) {
            if (domNode.tagName === "a") {
                const href = domNode.attribs?.href;
                const resolvedHref = canvasBildeProxyUrl(href) ?? resolveCanvasRelativeHref(href ?? "", canvasBaseUrl);
                const children = domToReact(domNode.children as DOMNode[], { replace });
                // Hvis lenken peker til en StudyWise-proxiet Canvas-fil, intercept klikket
                // og last ned via autentisert blob slik at brukeren forblir på StudyWise.
                const erFilNedlasting = typeof resolvedHref === "string"
                    && /^\/api\/canvas\/filer\/\d+\/download$/.test(resolvedHref);
                return asReplacement(
                    <a
                        href={resolvedHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={erFilNedlasting ? (e) => {
                            e.preventDefault();
                            void downloadAuthedFile(resolvedHref).catch((err) => {
                                // Ikke la feilen være stille — gi beskjed til bruker
                                // (ved utløpt auth, nettverksfeil eller 404 gir
                                // en "død klikk" ellers ingen forklaring).
                                onDownloadError?.(err);
                            });
                        } : undefined}
                        className="text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
                    >
                        {children}
                        <ExternalLink size={12} className="opacity-50" />
                    </a>
                );
            }
            if (domNode.tagName === "img") {
                const rawSrc = domNode.attribs?.src;
                const proxiedSrc = canvasBildeProxyUrl(rawSrc);
                const attribs = { ...domNode.attribs, src: proxiedSrc };
                if (renderImage) {
                    const cloned = { ...domNode, attribs } as unknown as Element;
                    const rendered = renderImage(cloned);
                    if (rendered) return asReplacement(rendered);
                }
                return asReplacement(
                    <img
                        src={proxiedSrc ?? ""}
                        alt={domNode.attribs?.alt ?? ""}
                        title={domNode.attribs?.title}
                        width={domNode.attribs?.width}
                        height={domNode.attribs?.height}
                        className={domNode.attribs?.class}
                        loading="lazy"
                    />
                );
            }
        }
        return null;
    };
    return { replace };
};

// Sanitiser + parse helper med streng konfigurasjon
export const parseCanvasHtml = (
    html: string | null | undefined,
    parserOps: ReturnType<typeof createCanvasHtmlParser>
) => parse(DOMPurify.sanitize(html || "", DOMPURIFY_CONFIG) as string, parserOps);
