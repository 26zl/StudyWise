/**
 * Kryptering/dekryptering (AES-256-GCM) for sensitivt innhold i backend.
 *
 * Brukes bl.a. for Canvas-token og chat-historikk. Nøkkel hentes fra `ENCRYPTION_KEY` (32 bytes hex).
 */
import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;

// Henter krypteringsnøkkelen fra miljøvariabler
const getKey = (): Buffer => {
    const keyHex = process.env.ENCRYPTION_KEY;
    if (!keyHex) {
        throw new Error("ENCRYPTION_KEY mangler i miljøvariabler.");
    }
    if (keyHex.length !== 64) {
        throw new Error("ENCRYPTION_KEY må være 64 hex-tegn (32 bytes) for AES-256-GCM.");
    }
    // Sjekk at nøkkelen ikke er et svakt mønster (f.eks. repeating bytes)
    // En 32-byte tilfeldig nøkkel har i snitt ~27 unike byte-verdier (fødselsdagsparadokset).
    // Terskel 24 fanger de fleste svake nøkler mens den tillater naturlig variasjon.
    const uniqueBytes = new Set(keyHex.match(/.{2}/g) || []);
    if (uniqueBytes.size < 24) {
        throw new Error(
            "ENCRYPTION_KEY er for svak (for lite entropi). " +
            "Generer en sikker nøkkel med: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
        );
    }
    const key = Buffer.from(keyHex, "hex");
    if (key.length !== 32) {
        throw new Error("ENCRYPTION_KEY må være 32 bytes etter hex-dekoding.");
    }
    return key;
};

/**
 * Krypterer en streng.
 * Returnerer format: iv:authTag:encryptedContent (hex-kodet)
 */
export const encrypt = (text: string): string => {
    const key = getKey();
    const iv = crypto.randomBytes(IV_LENGTH);

    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(text, "utf8", "hex");
    encrypted += cipher.final("hex");

    const authTag = cipher.getAuthTag();

    return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
};

/**
 * Dekrypterer en streng.
 * Forventer format: iv:authTag:encryptedContent (hex-kodet)
 */
export const decrypt = (encryptedText: string): string => {
    const key = getKey();
    const parts = encryptedText.split(":");

    if (parts.length !== 3) {
        throw new Error("Ugyldig format på kryptert data.");
    }

    const [ivHex, authTagHex, encryptedHex] = parts;

    if (!/^[0-9a-f]+$/i.test(ivHex) || !/^[0-9a-f]+$/i.test(authTagHex) || !/^[0-9a-f]*$/i.test(encryptedHex)) {
        throw new Error("Ugyldig hex i kryptert data.");
    }

    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");

    if (iv.length !== IV_LENGTH) {
        throw new Error(`Ugyldig IV-lengde: forventet ${IV_LENGTH}, fikk ${iv.length}.`);
    }
    if (authTag.length !== 16) {
        throw new Error(`Ugyldig authTag-lengde: forventet 16, fikk ${authTag.length}.`);
    }

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedHex, "hex", "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
};