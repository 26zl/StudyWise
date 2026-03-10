/*
* Håndterer parsing og sanitizing av Canvas HTML-innhold for sikker visning
* Inkluderer tilpasning av lenker og mulighet for custom bilde-rendering
*/
"use client";

import type { ReactNode } from "react";
import DOMPurify, { type Config as DOMPurifyConfig } from "isomorphic-dompurify";
import parse, { Element, type HTMLReactParserOptions } from "html-react-parser";
import { ExternalLink } from "lucide-react";

// DOMPurify konfigurasjon - streng XSS-beskyttelse
const DOMPURIFY_CONFIG: DOMPurifyConfig = {
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
        "width", "height", "style",
        "target", "rel",
        "colspan", "rowspan", "scope",
    ],
    ALLOW_DATA_ATTR: false,  // Blokkerer data-* attributter
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "input", "button"],
    FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover"],
};

/**
 * Validerer og saniterer URL-er for sikker bruk i href-attributter.
 * Tillater kun http/https protokoller for å forhindre javascript: og data: XSS.
 */
export const sikkerHref = (u?: string | null): string => {
    if (!u || typeof u !== "string") return "#";
    
    // Trim og normaliser
    const trimmed = u.trim().toLowerCase();
    
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
    
    // Kun tillat http:// og https://
    try {
        const url = new URL(u, "https://placeholder.com");
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

// Lager parser-opsjoner. Kan utvides med custom bilde-rendering fra konsument
export const createCanvasHtmlParser = (renderImage?: (el: Element) => ReactNode): HTMLReactParserOptions => {
    const replace: HTMLReactParserOptions["replace"] = (domNode) => {
        if (domNode instanceof Element) {
            if (domNode.tagName === "a") {
                const href = domNode.attribs?.href;
                // html-react-parser ChildNode typings mangler data-felt; begrens til tekstnoder
                const firstChild = domNode.children?.[0] as { data?: unknown } | undefined;
                const text =
                    firstChild && typeof firstChild.data === "string"
                        ? firstChild.data
                        : "";
                return (
                    <a
                        href={sikkerHref(href)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
                    >
                        {text}
                        <ExternalLink size={12} className="opacity-50" />
                    </a>
                ) as unknown as Element;
            }
            if (renderImage && domNode.tagName === "img") {
                const rendered = renderImage(domNode);
                if (rendered) {
                    return rendered as unknown as Element;
                }
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
