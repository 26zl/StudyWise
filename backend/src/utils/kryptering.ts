/**
 * Kryptering/dekryptering (AES-256-GCM) for sensitivt innhold i backend.
 *
 * Brukes bl.a. for Canvas-token og chat-historikk. Nøkkel hentes fra `ENCRYPTION_KEY` (32 bytes hex).
 *
 * Format: `v<versjon>:iv:authTag:encrypted` (hex-kodet). Data uten versjonsprefiks
 * behandles som v1 (bakoverkompatibel med eksisterende data fra før versjons-prefikset
 * ble innført).
 */
import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const CURRENT_KEY_VERSION = 1;

/** Validerer og returnerer en 32-byte nøkkel fra hex-streng. */
function parseKeyHex(keyHex: string, label: string): Buffer {
    if (keyHex.length !== 64) {
        throw new Error(`${label} må være 64 hex-tegn (32 bytes) for AES-256-GCM.`);
    }
    const byteValues = (keyHex.match(/.{2}/g) || []).map((h) => parseInt(h, 16));
    const freq = new Map<number, number>();
    for (const b of byteValues) {
        freq.set(b, (freq.get(b) ?? 0) + 1);
    }
    let entropy = 0;
    for (const count of freq.values()) {
        const p = count / byteValues.length;
        entropy -= p * Math.log2(p);
    }
    if (entropy < 3.0) {
        throw new Error(
            `${label} er for svak (for lite entropi). ` +
            "Generer en sikker nøkkel med: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
        );
    }
    const key = Buffer.from(keyHex, "hex");
    if (key.length !== 32) {
        throw new Error(`${label} må være 32 bytes etter hex-dekoding.`);
    }
    return key;
}

// Henter krypteringsnøkkelen fra miljøvariabler
const getKey = (): Buffer => {
    const keyHex = process.env.ENCRYPTION_KEY;
    if (!keyHex) {
        throw new Error("ENCRYPTION_KEY mangler i miljøvariabler.");
    }
    return parseKeyHex(keyHex, "ENCRYPTION_KEY");
};

/**
 * Krypterer en streng.
 * Returnerer format: v<versjon>:iv:authTag:encryptedContent (hex-kodet)
 */
export const encrypt = (text: string): string => {
    const key = getKey();
    const iv = crypto.randomBytes(IV_LENGTH);

    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(text, "utf8", "hex");
    encrypted += cipher.final("hex");

    const authTag = cipher.getAuthTag();

    return `v${CURRENT_KEY_VERSION}:${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
};

/** Dekrypterer med en spesifikk nøkkel. Kaster ved feil. */
function decryptWithKey(key: Buffer, ivHex: string, authTagHex: string, encryptedHex: string): string {
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
}

/**
 * Dekrypterer en streng.
 * Støtter både nytt format (v<versjon>:iv:authTag:encrypted) og
 * legacy-format (iv:authTag:encrypted) for bakoverkompatibilitet.
 */
export const decrypt = (encryptedText: string): string => {
    const parts = encryptedText.split(":");

    let ivHex: string;
    let authTagHex: string;
    let encryptedHex: string;

    // Nytt versjonert format: v1:iv:authTag:encrypted
    if (parts.length === 4 && /^v\d+$/.test(parts[0])) {
        [, ivHex, authTagHex, encryptedHex] = parts;
    }
    // Legacy-format (bakoverkompatibelt): iv:authTag:encrypted
    else if (parts.length === 3) {
        [ivHex, authTagHex, encryptedHex] = parts;
    } else {
        throw new Error("Ugyldig format på kryptert data.");
    }

    try {
        return decryptWithKey(getKey(), ivHex, authTagHex, encryptedHex);
    } catch {
        // Generisk feilmelding uavhengig av årsak (forhindrer oracle-angrep)
        throw new Error("Dekryptering feilet.");
    }
};

/** Sjekker om en kryptert streng er gyldig (dekrypterbar) uten å returnere klarteksten. */
export function erGyldigKryptert(kryptertVerdi: string | undefined): boolean {
    if (!kryptertVerdi) return false;
    try {
        decrypt(kryptertVerdi);
        return true;
    } catch {
        return false;
    }
}