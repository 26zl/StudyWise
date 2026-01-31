/**
 * Utility functions for the frontend
 */
import { clsx, type ClassValue } from "clsx";

/**
 * Merge class names with clsx
 * Forenklet versjon uten tailwind-merge (ikke installert)
 */
export function cn(...inputs: ClassValue[]) {
    return clsx(inputs);
}
