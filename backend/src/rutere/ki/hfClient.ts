/*
 * Delt HuggingFace InferenceClient singleton
 * Initialiseres én gang ved oppstart og gjenbrukes av alle KI-ruter
 */

import { InferenceClient } from "@huggingface/inference";

const HF_API_KEY = process.env.HUGGINGFACE_API_KEY;

/** Singleton HuggingFace-klient — null dersom API-nøkkel mangler */
export const hfClient = HF_API_KEY ? new InferenceClient(HF_API_KEY) : null;
