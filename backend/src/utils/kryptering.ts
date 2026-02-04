import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;

// Henter krypteringsnøkkelen fra miljøvariabler
const getKey = (): Buffer => {
    const keyHex = process.env.ENCRYPTION_KEY;
    if (!keyHex) {
        throw new Error('ENCRYPTION_KEY mangler i miljøvariabler.');
    }
    if (keyHex.length !== 64) {
        throw new Error('ENCRYPTION_KEY må være 64 hex-tegn (32 bytes) for AES-256-GCM.');
    }
    // Sjekk at nøkkelen ikke er et svakt mønster (f.eks. repeating bytes)
    // En sterk nøkkel bør ha høy entropi - sjekk at den har minst 16 unike bytes
    const uniqueBytes = new Set(keyHex.match(/.{2}/g) || []);
    if (uniqueBytes.size < 16) {
        throw new Error(
            'ENCRYPTION_KEY er for svak (for lite entropi). ' +
            'Generer en sikker nøkkel med: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
        );
    }
    const key = Buffer.from(keyHex, 'hex');
    if (key.length !== 32) {
        throw new Error('ENCRYPTION_KEY må være 32 bytes etter hex-dekoding.');
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

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
};

/**
 * Dekrypterer en streng.
 * Forventer format: iv:authTag:encryptedContent (hex-kodet)
 */
export const decrypt = (encryptedText: string): string => {
    const key = getKey();
    const parts = encryptedText.split(':');

    if (parts.length !== 3) {
        throw new Error('Ugyldig format på kryptert data.');
    }

    const [ivHex, authTagHex, encryptedHex] = parts;

    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
};