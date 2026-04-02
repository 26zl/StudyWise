/**
 * Hjelpefunksjoner for frontend
 */
import { clsx, type ClassValue } from "clsx";

/**
 * Slå sammen klassenavn med clsx
 * Forenklet versjon uten tailwind-merge (ikke installert)
 */
export function cn(...inputs: ClassValue[]) {
    return clsx(inputs);
}

/** Enkel string-hash for å identifisere KI-jobber per tekst-innhold. */
export function simpleHash(str: string): string {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
        h = ((h << 5) - h + str.charCodeAt(i)) | 0;
    }
    return h.toString(36);
}
