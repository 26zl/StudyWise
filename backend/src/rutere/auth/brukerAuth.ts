/*
 * Bruker Autentisering & Lokal Bruker Logikk
 * Dette filen ('brukerAuth.ts') håndterer den LOKALE brukeren i vårt system.
 *
 * Forskjell på "Lokal Bruker" (User) og "Canvas Bruker" (CanvasUser):
 * - User (her): Din identitet i StudyWise systemet. Inneholder passord (hash), epost, og hemmeligheter som Canvas API Token.
 * - CanvasUser (i canvas.ts): En kopi av din offentlige profil fra Canvas. Brukes bare for å vise navn/bilde.
 *
 * Fremtidig Plan (JWT):
 * 1. Denne filen vil håndtere innlogging (sjekke passord).
 * 2. Den vil utstede en JWT (Json Web Token) som inneholder brukerens ID (`_id`).
 * 3. Middleware (`middleware/auth.ts`) vil sjekke denne tokenen på alle beskyttede ruter.
 */
import { Router } from "express";
import { User } from "../../database/models/User.js";
import { encrypt } from "../../utils/kryptering.js";
import { logger } from "../../utils/logger.js";
import { ZodError } from "zod";
import crypto from "crypto";
import { CanvasTokenRequestSchema } from "common";

const router = Router();

// POST /api/user/token
// Formål: Lagre brukerens personlige Canvas API Token sikkert.
// Kobling: Dette tokenet blir brukt av `canvasFetch` (i canvasUtils.ts) til å snakke med Canvas PÅ VEGNE AV brukeren.
router.post("/token", async (req, res) => {
    try {
        const { token } = CanvasTokenRequestSchema.parse(req.body);

        /*
         * --- MIDLERTIDIG LOGIKK FOR UTVIKLING ---
         * I fremtiden vil vi hente brukerens ID fra JWT-tokenet i request headeren.
         * Kode: const userId = req.user.id;
         *
         * Akkurat nå (før vi har full innlogging) gjør vi følgende:
         * 1. Vi finner den første brukeren i databasen (User.findOne()).
         * 2. Vi antar at det er deg seiden du kjører lokalt.
         *
         * Når Auth er på plass:
         * - Bytt ut `User.findOne()` med `User.findById(req.user.id)`
         * - Denne ruten vil da være beskyttet av `authenticateToken` middleware.
         */

        let bruker = await User.findOne();

        if (!bruker) {
            // Midlertidig: Opprett en lokal demo-bruker hvis ingen finnes
            bruker = await User.create({
                email: "demo@studywise.local",
                passwordHash: crypto.randomBytes(32).toString("hex"),
                firstName: "Demo",
                lastName: "Bruker",
            });
        }

        // Krypter token
        const kryptertToken = encrypt(token);

        // Lagre til database
        bruker.canvasApiToken = kryptertToken;
        await bruker.save();

        return res.json({
            melding: "Token lagret og kryptert",
            success: true
        });

    } catch (error) {
        if (error instanceof ZodError) {
            const feilmelding = error.issues[0]?.message || "Ugyldig input";
            return res.status(400).json({ feil: feilmelding });
        }
        logger.error({ err: error }, "Feil ved lagring av token");
        return res.status(500).json({ feil: "Kunne ikke lagre token" });
    }
});

export default router;
