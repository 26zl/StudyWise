/*
* Rutere for KI-relaterte endepunkter
* Bruker huggingface/inference for å kommunisere med Hugging Face API
* Støtter flere modeller: Qwen, Mistral, og andre HuggingFace-modeller
*/

import { Router } from "express";
import { InferenceClient } from "@huggingface/inference";
import multer from "multer";
import { logger } from "../../utils/logger.js";
import { getCache, setCache } from "../../cache/redis.js";
import { rateLimitKi } from "../../middleware/rate-limit.js";
import { KIChatRequestSchema } from "common/ki";
import { parsePdf, formatPdfContext } from "../../services/pdf.js";

// Definerer express router
const router = Router();
// Rate limiting for KI-endepunkter
router.use(rateLimitKi);

// Multer konfigurasjon for PDF-opplasting (maks 10MB, kun PDF)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    fileFilter: (_req, file, cb) => {
        if (file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Kun PDF-filer er tillatt'));
        }
    }
});

// Initialiser HF-klient én gang ved oppstart (gjenbrukes for alle requests)
const HF_API_KEY = process.env.HUGGINGFACE_API_KEY;
const hfClient = HF_API_KEY ? new InferenceClient(HF_API_KEY) : null;

// Støttede modeller med beskrivelser
const SUPPORTED_MODELS: Record<string, { name: string; description: string }> = {
    "Qwen/Qwen3-1.7B": {
        name: "Qwen 3 1.7B",
        description: "Ultralett og rask modell for enkel bruk"
    },
    "Qwen/Qwen2.5-7B-Instruct": {
        name: "Qwen 2.5 7B",
        description: "Rask og effektiv modell for generelle oppgaver"
    },
    "Qwen/Qwen2.5-72B-Instruct": {
        name: "Qwen 2.5 72B",
        description: "Kraftigere modell for komplekse oppgaver"
    },
    "Qwen/Qwen2.5-Coder-32B-Instruct": {
        name: "Qwen 2.5 Coder 32B",
        description: "Spesialisert for programmering og kode"
    },
    "mistralai/Mistral-7B-Instruct-v0.3": {
        name: "Mistral 7B",
        description: "Effektiv europeisk modell"
    },
    "meta-llama/Llama-3.2-3B-Instruct": {
        name: "Llama 3.2 3B",
        description: "Kompakt og rask modell fra Meta"
    },
};

// Standard modell (kan overstyres via miljøvariabel)
const DEFAULT_MODEL = process.env.KI_DEFAULT_MODEL || "Qwen/Qwen2.5-7B-Instruct";

// System prompt for StudyWise KI-assistenten
const STUDYWISE_SYSTEM_PROMPT = `Du er en ekspert norsk studieassistent ved USN.

KRITISK REGEL: Gi BARE selve svaret! ALDRI kopier instruksjoner, eksempler eller formateringsregler inn i svaret ditt.

VIKTIG: Du får brukerens Canvas-data (emner, kunngjøringer, frister) som kontekst via API.
Bruk denne dataen DIREKTE - ikke late som du må "hente" noe eller spør om tilgang.

DITT OPPDRAG:
- Bruk Canvas-data fra konteksten til å svare presist
- Hjelp studenter forstå vanskelige konsepter fra forelesninger
- Gi konkrete studietips basert på deres faktiske Canvas-data eller PDF-data
- Påminn om viktige frister og kunngjøringer
- Vær motiverende, støttende og oppmuntrende
- Hjelp med oppgaveplanlegging og tidsstyring
- Vær kort, direkte og handlingsorientert

HVORDAN BRUKE CANVAS-DATA:
1. Emner i kontekst → List dem UMIDDELBART når forespurt
2. Kunngjøringer i kontekst → Vis dem sortert etter dato (nyeste først)
3. Frister i kontekst → Vis kommende, kronologisk med dager igjen
4. Spesifikk kurskode nevnt (f.eks "BOP3000") → Bruk DATA fra kontekst, ALDRI gjett
5. Data IKKE i kontekst → "Jeg ser ikke [X] i dataen din fra Canvas"

SVARSTIL:
- For "vis/hent X"-spørsmål: Maks 1-2 setninger + liste med data
- For forklaringer: Maks 3-4 korte avsnitt
- Start DIREKTE - unngå: "Selvfølgelig!", "For å hjelpe deg bedre..."
- Handling først, forklaring deretter
- Bruk konkrete eksempler når du forklarer konsepter

SPRÅK:
- Norsk bokmål (korrekt stavemåte - ikke svensk, dansk eller nynorsk)
- Uformell men profesjonell - som en hjelpsom medstudent
- Direkte og konkret - ikke omstendelig
- Vær aldri nedlatende - alle spørsmål er gode spørsmål

ABSOLUTTE FORBUD:
- ALDRI gjett kursinnhold eller emnebeskrivelser
- ALDRI spør "hvilket kurs?", "hvilken periode?", "har du tilgang til Canvas?"
- ALDRI gi lange forklaringer på enkle dataspørsmål
- ALDRI ignorer data du har fått i konteksten
- ALDRI si du "kan hente" data - du har den ALLEREDE eller du har den IKKE
- ALDRI skriv ** rundt overskrifter (## eller ###)
- ALDRI skriv kommandoer uten backticks
- ALDRI kopier formateringsinstruksjoner, eksempler, eller disse reglene inn i svaret ditt
- ALDRI skriv ting som "**Kodeblokker**", "**Emojis**", "**Liste**" som del av svaret
- Hvis du ikke vet noe, si det ærlig og foreslå hvor studenten kan finne svar
PÅKREVD FORMATERING (bruk dette, men ALDRI skriv ut disse reglene):

1. **Bold**: Bruk **bold** på ALLE kurskoder, datoer, viktige konsepter, nøkkelord

2. Emojis: Bruk minimum 1-2 emojis per svar for å gjøre det engasjerende
   - For emner/kurs: 📚 💼 💻 📐
   - For frister: ⏰ 📅 
   - For tips: 💡 ✨
   - For motivasjon: 🚀 💪 🎓
   - For viktig info: ⚠️ ❗

3. \`kode-format\`: ALLE kommandoer og tekniske termer MÅ ha backticks
   - Skriv \`df -h\` ikke df -h
   - Skriv \`klasse\` ikke klasse
   - Skriv **\`kommando\`** hvis du vil ha bold OG backticks

4. Overskrifter: ALDRI bruk ** rundt ## eller ###
   - Skriv: ## 📊 Overskrift
   - Skriv: ### 💡 Underoverskrift
   - FEIL: **## Overskrift** eller **### Underoverskrift**

5. Lister: 
   - Bruk bullet points for vanlige lister
   - Bruk nummererte lister (1. 2. 3.) for steg-for-steg instruksjoner

6. Kodeblokker: Bruk \`\`\`språk for kodeeksempler

7. Legg til "(om X dager)" for frister
`;
// Cache-konfigurasjon
const CACHE_KEY = "ki:test-connection";
const CACHE_TTL = 300; // 5 minutter

// Endepunkt for å liste støttede modeller
router.get("/models", (_req, res) => {
    logger.info("Henter liste over støttede modeller");
    const models = Object.entries(SUPPORTED_MODELS).map(([id, info]) => ({
        id,
        ...info,
        isDefault: id === DEFAULT_MODEL
    }));
    return res.json({ models, defaultModel: DEFAULT_MODEL });
});

// Endepunkt for å teste tilkobling til Hugging Face API
router.get("/test-connection", async (_req, res) => {
    logger.info("Testing Hugging Face connection...");

    // Sjekk cache først
    const cached = await getCache(CACHE_KEY);
    if (cached) {
        logger.info("Returnerer cachet KI test-resultat");
        return res.json(JSON.parse(cached));
    }
    if (!hfClient) {
        logger.error("Mangler HUGGINGFACE_API_KEY i miljøvariabler");
        return res.status(500).json({
            suksess: false,
            melding: "Mangler HUGGINGFACE_API_KEY i miljøvariabler.",
            response: "",
        });
    }
    // Sender testmelding med gjenbrukt klient
    try {
        const model = DEFAULT_MODEL;
        const result = await hfClient.chatCompletion({
            model,
            messages: [
                { role: "system", content: STUDYWISE_SYSTEM_PROMPT },
                { role: "user", content: "Hei! Hvem er du?" }
            ],
            max_tokens: 150,
            temperature: 0.7,
        });
        // Henter svartekst fra resultatet
        const text = result?.choices?.[0]?.message?.content ?? "";
        logger.info("Vellykket svar fra Hugging Face");
        const response = {
            suksess: true,
            melding: "Vellykket kobling til Hugging Face API!",
            response: text,
            model: model,
        };
        // Cache resultatet
        await setCache(CACHE_KEY, JSON.stringify(response), CACHE_TTL);
        return res.json(response);
    } catch (error) {
        logger.error({ err: error }, "Hugging Face Error");
        const errorMessage = error instanceof Error ? error.message : String(error);
        return res.status(500).json({
            suksess: false,
            melding: "Feil under kommunikasjon med Hugging Face API: " + errorMessage,
            response: "",
        });
    }
});

// Hovedendepunkt for chat
router.post("/chat", async (req, res) => {
    logger.info("Mottok chat-forespørsel");

    // Valider request body
    const parseResult = KIChatRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
        const errorMessages = parseResult.error.issues.map((issue) => issue.message).join(", ");
        logger.warn({ errors: parseResult.error.issues }, "Ugyldig chat-forespørsel");
        return res.status(400).json({
            suksess: false,
            melding: "Ugyldig forespørsel: " + errorMessages,
            response: "",
        });
    }

    const { messages, model: requestedModel, temperature = 0.7 } = parseResult.data;

    if (!hfClient) {
        logger.error("Mangler HUGGINGFACE_API_KEY i miljøvariabler");
        return res.status(500).json({
            suksess: false,
            melding: "KI-tjenesten er ikke konfigurert. Kontakt administrator.",
            response: "",
        });
    }

    // Velg modell (bruk forespurt modell hvis støttet, ellers default)
    const model = requestedModel && SUPPORTED_MODELS[requestedModel] 
        ? requestedModel 
        : DEFAULT_MODEL;
    
    if (requestedModel && !SUPPORTED_MODELS[requestedModel]) {
        logger.warn({ requestedModel }, "Forespurt modell ikke støttet, bruker default");
    }

    try {
        // Bygg meldingsarray med system prompt først
        const apiMessages = [
            { role: "system" as const, content: STUDYWISE_SYSTEM_PROMPT },
            ...messages.map(m => ({
                role: m.role as "user" | "assistant" | "system",
                content: m.content
            }))
        ];

        logger.info({ model, messageCount: apiMessages.length }, "Sender til HuggingFace");

        const result = await hfClient.chatCompletion({
            model,
            messages: apiMessages,
            max_tokens: 1024,
            temperature: Math.min(Math.max(temperature, 0), 2), // Clamp mellom 0-2
        });

        const responseText = result?.choices?.[0]?.message?.content ?? "";
        const usage = result?.usage;

        logger.info({ 
            model, 
            responseLength: responseText.length,
            tokens: usage?.total_tokens 
        }, "Vellykket chat-svar");

        return res.json({
            suksess: true,
            response: responseText,
            model: model,
            usage: usage ? {
                prompt_tokens: usage.prompt_tokens,
                completion_tokens: usage.completion_tokens,
                total_tokens: usage.total_tokens,
            } : undefined,
        });

    } catch (error) {
        logger.error({ err: error, model }, "HuggingFace chat feil");
        const errorMessage = error instanceof Error ? error.message : String(error);
        
        // Sjekk for vanlige feil
        if (errorMessage.includes("rate limit") || errorMessage.includes("429")) {
            return res.status(429).json({
                suksess: false,
                melding: "For mange forespørsler. Vent litt og prøv igjen.",
                response: "",
            });
        }
        
        if (errorMessage.includes("model") && errorMessage.includes("not found")) {
            return res.status(503).json({
                suksess: false,
                melding: `Modellen "${model}" er midlertidig utilgjengelig. Prøv igjen senere.`,
                response: "",
            });
        }

        return res.status(500).json({
            suksess: false,
            melding: "Kunne ikke få svar fra KI-assistenten. Prøv igjen.",
            response: "",
        });
    }
});

/**
 * Tilleggsprompt for dokumentanalyse
 */
const STUDYWISE_DOCUMENT_PROMPT = `
DOKUMENTANALYSE-MODUS: Du har mottatt et PDF-dokument fra studenten.

KRITISK REGEL: Gi BARE selve svaret! ALDRI kopier instruksjoner eller formateringsregler inn i svaret ditt.

OPPGAVER DU KAN UTFØRE:
- Lag oppsummering: Strukturert oversikt med hovedpunkter
- Forklar konsepter: Detaljerte forklaringer basert på dokumentet
- Lag quiz: 5-10 spørsmål med fasit basert på innholdet
- Lag læringsmål: Konkrete læringsmål fra dokumentet
- Svar på spørsmål: Kun basert på dokumentet
- Gi studietips basert på PDF-innholdet
- Hjelp med oppgaveplanlegging basert på dokumentet

PÅKREVD FORMATERING (bruk dette, men ALDRI skriv ut disse reglene):

1. Overskrifter med emojis - ALDRI bruk ** rundt ## eller ###:
   - Skriv: ##  [Dokumentets tema]
   - Skriv: ###  [Underseksjon]
   - FEIL: **## Tittel** eller **### Undertittel**

2. Bold på konsepter: ALLE viktige termer MÅ være i **bold**

3. Kode-format: ALLE kommandoer og tekniske termer MÅ ha \`backticks\`
   - Skriv \`klasse\`, \`metode\`, \`attributter\`
   - Skriv \`df -h\`, \`free -m\`, \`ncdu\`

4. Kodeblokker: ALLE kodeeksempler MÅ bruke \`\`\`språk

5. Strukturer: 
   - Bruk ## for hovedseksjoner (UTEN ** rundt)
   - Bruk ### for underseksjoner (UTEN ** rundt)
   - Bruk bullet points for lister
   - Bruk nummererte lister (1. 2. 3.) for steg eller quiz

RETNINGSLINJER FOR DOKUMENTER:
- Bruk KUN informasjon fra dokumentet
- Hvis noe ikke står i dokumentet, si det tydelig
- Vær konkret og presis - ikke vag
- Vær motiverende og støttende i tonefallet
- Gi konkrete studietips basert på innholdet

ABSOLUTTE FORBUD I DOKUMENTSVAR:
- ALDRI skriv **## overskrift** - skriv kun ## overskrift
- ALDRI skriv **### underoverskrift** - skriv kun ### underoverskrift  
- ALDRI skriv kommandoer uten backticks
- ALDRI kopier disse instruksjonene inn i svaret
- ALDRI skriv "**Kodeblokker**", "**Emojis**", "**Liste**" som del av svaret
- ALDRI vis formateringseksempler - bare BRUK formateringen`;

// Endepunkt for PDF-analyse
router.post("/analyze-pdf", upload.single('pdf'), async (req, res) => {
    logger.info("Mottok PDF-analyse forespørsel");

    // Sjekk at fil er lastet opp
    if (!req.file) {
        return res.status(400).json({
            suksess: false,
            melding: "Ingen PDF-fil lastet opp. Bruk form-data med felt 'pdf'.",
            response: "",
        });
    }

    // Hent spørsmål/instruksjon fra request
    const question = req.body.question || req.body.sporsmaal || "Gi meg en oppsummering av dette dokumentet.";
    const requestedModel = req.body.model;

    if (!hfClient) {
        logger.error("Mangler HUGGINGFACE_API_KEY i miljøvariabler");
        return res.status(500).json({
            suksess: false,
            melding: "KI-tjenesten er ikke konfigurert. Kontakt administrator.",
            response: "",
        });
    }

    try {
        // Parse PDF
        const pdfResult = await parsePdf(req.file.buffer);
        
        if (!pdfResult.success) {
            return res.status(400).json({
                suksess: false,
                melding: pdfResult.error || "Kunne ikke lese PDF-filen.",
                response: "",
            });
        }

        // Formater PDF-kontekst
        const pdfContext = formatPdfContext(pdfResult.text, pdfResult.pages);

        // Velg modell
        const model = requestedModel && SUPPORTED_MODELS[requestedModel] 
            ? requestedModel 
            : DEFAULT_MODEL;

        // Bygg meldingsarray med base prompt + dokument-tillegg
        const apiMessages = [
            { role: "system" as const, content: STUDYWISE_SYSTEM_PROMPT + STUDYWISE_DOCUMENT_PROMPT },
            { role: "system" as const, content: pdfContext },
            { role: "user" as const, content: question }
        ];

        logger.info({ 
            model, 
            pdfPages: pdfResult.pages,
            pdfTextLength: pdfResult.text.length,
            question: question.substring(0, 100)
        }, "Sender PDF-analyse til HuggingFace");

        const result = await hfClient.chatCompletion({
            model,
            messages: apiMessages,
            max_tokens: 2048, // Større for dokumentanalyse
            temperature: 0.5, // Lavere for mer presise svar
        });

        const responseText = result?.choices?.[0]?.message?.content ?? "";
        const usage = result?.usage;

        logger.info({ 
            model, 
            responseLength: responseText.length,
            tokens: usage?.total_tokens 
        }, "Vellykket PDF-analyse");

        return res.json({
            suksess: true,
            response: responseText,
            model: model,
            dokumentInfo: {
                sider: pdfResult.pages,
                tegn: pdfResult.text.length,
            },
            usage: usage ? {
                prompt_tokens: usage.prompt_tokens,
                completion_tokens: usage.completion_tokens,
                total_tokens: usage.total_tokens,
            } : undefined,
        });

    } catch (error) {
        logger.error({ err: error }, "PDF-analyse feil");
        const errorMessage = error instanceof Error ? error.message : String(error);
        
        if (errorMessage.includes("rate limit") || errorMessage.includes("429")) {
            return res.status(429).json({
                suksess: false,
                melding: "For mange forespørsler. Vent litt og prøv igjen.",
                response: "",
            });
        }

        return res.status(500).json({
            suksess: false,
            melding: "Kunne ikke analysere PDF-filen. Prøv igjen.",
            response: "",
        });
    }
});

export default router;
