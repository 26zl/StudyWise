/*
* Håndterer parsing og sanitizing av Canvas HTML-innhold for sikker visning
* Inkluderer tilpasning av lenker og mulighet for custom bilde-rendering
*/
"use client";

import type { ReactNode } from "react";
import DOMPurify from "isomorphic-dompurify"; 
import parse, { Element, type HTMLReactParserOptions } from "html-react-parser";
import { ExternalLink } from "lucide-react";

// Validering mot DOM-basert XSS - tillater kun http/https for href
export const sikkerHref = (u?: string | null) => (u && u.startsWith("http") ? u : "#");

// Lager parser-opsjoner. Kan utvides med custom bilde-rendering fra konsument
export const createCanvasHtmlParser = (renderImage?: (el: Element) => ReactNode): HTMLReactParserOptions => {
    const replace: HTMLReactParserOptions["replace"] = (domNode) => {
        if (domNode instanceof Element) {
            if (domNode.tagName === "a") {
                const href = domNode.attribs?.href;
                // html-react-parser ChildNode typings mangler data-felt; begrens til tekstnoder
                const firstChild = domNode.children?.[0];
                const text =
                    typeof (firstChild as { data?: unknown } | undefined)?.data === "string"
                        ? (firstChild as { data: string }).data
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

// Sanitiser + parse helper
export const parseCanvasHtml = (
    html: string | null | undefined,
    parserOps: ReturnType<typeof createCanvasHtmlParser>
) => parse(DOMPurify.sanitize(html || ""), parserOps);
