/*
 * Tester for kryptering/dekryptering (AES-256-GCM)
 * Verifiserer roundtrip, format, feilhåndtering og kanttilfeller
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "crypto";

// Genererer en gyldig 64-tegns hex-nøkkel med tilstrekkelig entropi (>= 24 unike byte-par)
const genererTestnokkel = (): string => crypto.randomBytes(32).toString("hex");

describe("kryptering", () => {
  let testKey: string;

  beforeEach(() => {
    testKey = genererTestnokkel();
    vi.stubEnv("ENCRYPTION_KEY", testKey);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    // Fjern modulcache slik at getKey() leser ny env-verdi
    vi.resetModules();
  });

  // Hjelpefunksjon: importerer modulen på nytt for å få oppdatert env
  const importModule = async () => {
    return await import("../../utils/kryptering.js");
  };

  // --- Roundtrip-tester ---

  it("dekrypterer kryptert tekst tilbake til original", async () => {
    const { encrypt, decrypt } = await importModule();
    const original = "Hei, dette er en test!";
    const kryptert = encrypt(original);
    expect(decrypt(kryptert)).toBe(original);
  });

  it("håndterer tom streng i roundtrip", async () => {
    const { encrypt, decrypt } = await importModule();
    const kryptert = encrypt("");
    expect(decrypt(kryptert)).toBe("");
  });

  it("håndterer Unicode-tekst i roundtrip", async () => {
    const { encrypt, decrypt } = await importModule();
    const unicode = "Norsk: Blåbærpai med fløte 🇳🇴 日本語テスト";
    const kryptert = encrypt(unicode);
    expect(decrypt(kryptert)).toBe(unicode);
  });

  it("håndterer lang tekst i roundtrip", async () => {
    const { encrypt, decrypt } = await importModule();
    const langTekst = "A".repeat(100_000);
    const kryptert = encrypt(langTekst);
    expect(decrypt(kryptert)).toBe(langTekst);
  });

  // --- Kryptert format ---

  it("returnerer format v1:iv:authTag:data med 4 kolon-separerte deler", async () => {
    const { encrypt } = await importModule();
    const kryptert = encrypt("test");
    const deler = kryptert.split(":");
    expect(deler).toHaveLength(4);
    expect(deler[0]).toBe("v1");
  });

  it("IV er 32 hex-tegn (16 bytes)", async () => {
    const { encrypt } = await importModule();
    const kryptert = encrypt("test");
    const [, iv] = kryptert.split(":");
    expect(iv).toMatch(/^[0-9a-f]{32}$/);
  });

  it("authTag er 32 hex-tegn (16 bytes)", async () => {
    const { encrypt } = await importModule();
    const kryptert = encrypt("test");
    const [, , authTag] = kryptert.split(":");
    expect(authTag).toMatch(/^[0-9a-f]{32}$/);
  });

  // --- Tilfeldighet (random IV) ---

  it("produserer forskjellig ciphertext for forskjellige inputs", async () => {
    const { encrypt } = await importModule();
    const kryptert1 = encrypt("tekst en");
    const kryptert2 = encrypt("tekst to");
    expect(kryptert1).not.toBe(kryptert2);
  });

  it("produserer forskjellig ciphertext for samme input (tilfeldig IV)", async () => {
    const { encrypt } = await importModule();
    const kryptert1 = encrypt("samme tekst");
    const kryptert2 = encrypt("samme tekst");
    expect(kryptert1).not.toBe(kryptert2);
  });

  // --- Feilhåndtering ved dekryptering ---

  it("kaster feil ved ugyldig format (mangler deler)", async () => {
    const { decrypt } = await importModule();
    expect(() => decrypt("ugyldig")).toThrow("Ugyldig format");
  });

  it("kaster feil ved for mange kolon-separerte deler", async () => {
    const { decrypt } = await importModule();
    expect(() => decrypt("a:b:c:d:e")).toThrow("Ugyldig format");
  });

  it("kaster feil ved ugyldig hex i IV", async () => {
    const { decrypt } = await importModule();
    expect(() => decrypt("v1:gggg:aabbccdd:eeff")).toThrow();
  });

  it("kaster feil ved manipulert ciphertext (endret data)", async () => {
    const { encrypt, decrypt } = await importModule();
    const kryptert = encrypt("sensitiv data");
    const deler = kryptert.split(":");
    // Endre siste tegn i den krypterte dataen (index 3 = encrypted data)
    const sisteHexTegn = deler[3].slice(-1);
    const endretTegn = sisteHexTegn === "0" ? "1" : "0";
    deler[3] = deler[3].slice(0, -1) + endretTegn;
    expect(() => decrypt(deler.join(":"))).toThrow();
  });

  it("kaster feil ved manipulert authTag", async () => {
    const { encrypt, decrypt } = await importModule();
    const kryptert = encrypt("data");
    const deler = kryptert.split(":");
    // Endre authTag (index 2)
    deler[2] = "0".repeat(32);
    expect(() => decrypt(deler.join(":"))).toThrow();
  });

  // --- Legacy-format (bakoverkompatibilitet) ---

  it("dekrypterer legacy-format (iv:authTag:data uten versjonsprefiks)", async () => {
    const { decrypt } = await importModule();
    // Krypter manuelt i legacy-format (uten v1-prefiks)
    const keyBuf = Buffer.from(testKey, "hex");
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv("aes-256-gcm", keyBuf, iv);
    let enc = cipher.update("legacy-test", "utf8", "hex");
    enc += cipher.final("hex");
    const tag = cipher.getAuthTag();
    const legacyFormat = `${iv.toString("hex")}:${tag.toString("hex")}:${enc}`;
    expect(decrypt(legacyFormat)).toBe("legacy-test");
  });

  // --- Nøkkelrotasjon ---

  it("dekrypterer med forrige nøkkel via ENCRYPTION_KEY_PREVIOUS", async () => {
    const gammelNokkel = testKey;
    const nyNokkel = genererTestnokkel();

    // Krypter med gammel nøkkel
    const { encrypt: encryptGammel } = await importModule();
    const kryptert = encryptGammel("rotasjonstest");

    // Roter nøkkel
    vi.stubEnv("ENCRYPTION_KEY", nyNokkel);
    vi.stubEnv("ENCRYPTION_KEY_PREVIOUS", gammelNokkel);
    vi.resetModules();
    const { decrypt: decryptNy } = await importModule();

    expect(decryptNy(kryptert)).toBe("rotasjonstest");
  });

  // --- Miljøvariabel-validering ---

  it("kaster feil når ENCRYPTION_KEY mangler", async () => {
    vi.stubEnv("ENCRYPTION_KEY", "");
    const { encrypt } = await importModule();
    expect(() => encrypt("test")).toThrow("ENCRYPTION_KEY mangler");
  });

  it("kaster feil når ENCRYPTION_KEY er for kort", async () => {
    vi.stubEnv("ENCRYPTION_KEY", "aabb");
    const { encrypt } = await importModule();
    expect(() => encrypt("test")).toThrow("64 hex-tegn");
  });

  it("kaster feil når ENCRYPTION_KEY har for lite entropi", async () => {
    // Lag en nøkkel med kun 1 unik byte-verdi (64 tegn, alle "aa")
    vi.stubEnv("ENCRYPTION_KEY", "aa".repeat(32));
    const { encrypt } = await importModule();
    expect(() => encrypt("test")).toThrow("for svak");
  });
});
