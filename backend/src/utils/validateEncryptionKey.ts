/**
 * Oppstart-validering av ENCRYPTION_KEY.
 *
 * Sampler én eksisterende kryptert verdi (User.canvasApiToken eller ChatHistory.encryptedMessages)
 * og forsøker dekryptering. Logger en sterk WARN hvis dekryptering feiler — typisk når
 * `ENCRYPTION_KEY` er endret uten at `ENCRYPTION_KEY_PREVIOUS` er satt.
 *
 * Stopper ALDRI oppstart — dette er kun en advarsel.
 */
import { User } from "../database/models/User.js";
import { ChatHistory } from "../database/models/ChatHistory.js";
import { erGyldigKryptert } from "./kryptering.js";
import { logger } from "./logger.js";

export async function validateEncryptionKeyAtStartup(): Promise<void> {
  try {
    const sampleUser = await User.findOne({
      canvasApiToken: { $exists: true, $ne: null },
      deletedAt: { $exists: false },
    })
      .select("+canvasApiToken")
      .lean();

    const sampleChat = await ChatHistory.findOne({})
      .select({ encryptedMessages: 1 })
      .lean();

    const samples: Array<{ label: string; value: string | undefined }> = [
      { label: "User.canvasApiToken", value: sampleUser?.canvasApiToken },
      { label: "ChatHistory.encryptedMessages", value: sampleChat?.encryptedMessages },
    ].filter((s) => !!s.value) as Array<{ label: string; value: string }>;

    if (samples.length === 0) {
      logger.info("ENCRYPTION_KEY-validering: ingen krypterte sampler å verifisere mot");
      return;
    }

    const failures: string[] = [];
    for (const sample of samples) {
      if (!erGyldigKryptert(sample.value)) {
        failures.push(sample.label);
      }
    }

    if (failures.length === 0) {
      logger.info(
        { sampled: samples.length },
        "ENCRYPTION_KEY-validering: OK (eksisterende krypterte data kan dekrypteres)",
      );
      return;
    }

    const harPreviousKey = !!process.env.ENCRYPTION_KEY_PREVIOUS;
    logger.warn(
      {
        failedSamples: failures,
        encryptionKeyPreviousSet: harPreviousKey,
      },
      "ENCRYPTION_KEY-validering FEILET: eksisterende krypterte data kan ikke dekrypteres med gjeldende nøkkel. " +
        (harPreviousKey
          ? "ENCRYPTION_KEY_PREVIOUS er satt men matchet heller ikke — sjekk at riktig nøkkel er konfigurert."
          : "Sett ENCRYPTION_KEY_PREVIOUS til den gamle nøkkelen for sømløs rotasjon, eller bekreft at gjeldende ENCRYPTION_KEY er korrekt for dette miljøet."),
    );
  } catch (err) {
    logger.warn({ err }, "ENCRYPTION_KEY-validering avbrutt på grunn av feil — fortsetter oppstart");
  }
}
