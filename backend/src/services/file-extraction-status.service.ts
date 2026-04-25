/**
 * Tynt service-lag over FileExtractionStatus-modellen.
 *
 * Brukes av:
 * - canvas-sync: markerer en fil som mislykket/suksess per sync-runde.
 * - context-loader: slår opp kjente tomme filer for å injisere et strukturert
 *   notat i KI-konteksten når brukeren spør om en fil vi ikke kan lese.
 * - admin: lister alle feilede ekstraksjoner for diagnostikk.
 */
import {
  FileExtractionStatus,
  type FileExtractionStatusCode,
  type IFileExtractionStatus,
} from "../database/models/FileExtractionStatus.js";
import { ContentEmbedding } from "../database/models/ContentEmbedding.js";
import { logger } from "../utils/logger.js";

/**
 * Absolutt tegn-terskel for retroaktiv sparse-deteksjon.
 * Filer med totalt mindre enn dette antall tegn på tvers av alle chunks
 * flagges som sparse.
 */
const RETROACTIVE_SPARSE_CHAR_THRESHOLD = 1500;

/**
 * Filtendelser som skal vurderes for retroaktiv sparse-deteksjon.
 *
 * VIKTIG: Ekskluderer `.page`, `.assignment` og ExternalUrl-entries (uten
 * filendelse) — disse er metadata-referanser i Canvas, ikke innholdsfiler.
 * En kort .page-beskrivelse eller .assignment-tittel er ofte helt legitim
 * og skal IKKE flagges. Vi fokuserer på "ekte dokumentfiler" hvor sparse
 * ekstraksjon indikerer et reelt problem (typisk bilde-tung PowerPoint).
 */
const RETROACTIVE_SPARSE_FILE_EXTENSIONS = [
  ".pptx",
  ".ppt",
  ".pdf",
  ".docx",
  ".doc",
  ".xlsx",
  ".xls",
  ".odt",
  ".odp",
  ".ods",
];

/** Regex som matcher ekte-dokument-filendelser på slutten av et filnavn. */
// eslint-disable-next-line security/detect-non-literal-regexp -- input er hardkodet konstant-array av filendelser
const REAL_DOC_EXT_REGEX = new RegExp(
  `\\.(?:${RETROACTIVE_SPARSE_FILE_EXTENSIONS.map((e) => e.slice(1)).join("|")})$`,
  "i",
);

/** Prefiks i reason-feltet som identifiserer retroaktivt-skannede rader. */
const RETROACTIVE_REASON_PREFIX = "Retroaktiv skann:";

export interface MarkExtractionInput {
  userId: string;
  courseId: string;
  courseName: string;
  moduleId?: number;
  moduleTitle?: string;
  fileName: string;
  fileId: number;
  status: FileExtractionStatusCode;
  reason?: string;
}

/**
 * Upsert status for en fil som ikke kunne ekstraheres. Øker attemptCount
 * hvis raden finnes fra før.
 */
export async function markExtractionFailure(
  input: MarkExtractionInput,
): Promise<void> {
  try {
    await FileExtractionStatus.findOneAndUpdate(
      {
        userId: input.userId,
        courseId: input.courseId,
        fileId: input.fileId,
      },
      {
        $set: {
          courseName: input.courseName,
          moduleId: input.moduleId,
          moduleTitle: input.moduleTitle,
          fileName: input.fileName,
          status: input.status,
          reason: input.reason,
          lastAttempt: new Date(),
        },
        $inc: { attemptCount: 1 },
      },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
    );
  } catch (err) {
    logger.warn(
      { err, userId: input.userId, fileId: input.fileId, fileName: input.fileName },
      "Klarte ikke å lagre FileExtractionStatus — ignorerer (ikke kritisk)",
    );
  }
}

/**
 * Fjern status-raden for en fil som nå er lest inn med suksess.
 * No-op hvis ingen rad eksisterer.
 */
export async function clearExtractionFailure(
  userId: string,
  courseId: string,
  fileId: number,
): Promise<void> {
  try {
    await FileExtractionStatus.deleteOne({ userId, courseId, fileId });
  } catch (err) {
    logger.warn(
      { err, userId, courseId, fileId },
      "Klarte ikke å slette FileExtractionStatus — ignorerer (ikke kritisk)",
    );
  }
}

/**
 * Hent alle kjente ekstraksjonsfeil for en bruker i ett eller flere kurs.
 * Brukes av context-loader for å krysse av mot fileHint/moduleHint.
 */
export async function getExtractionFailuresForCourses(
  userId: string,
  courseIds: string[],
): Promise<IFileExtractionStatus[]> {
  if (courseIds.length === 0) return [];
  try {
    return await FileExtractionStatus.find({
      userId,
      courseId: { $in: courseIds },
    }).lean<IFileExtractionStatus[]>();
  } catch (err) {
    logger.warn(
      { err, userId, courseIds },
      "Klarte ikke å hente FileExtractionStatus — returnerer tom liste",
    );
    return [];
  }
}

/**
 * Sletter alle status-rader for et kurs — brukes når bruker mister et kurs
 * (unsubscribe) eller ved deleteStoredCourseContent.
 */
export async function clearAllExtractionFailuresForCourse(
  userId: string,
  courseId: string,
): Promise<void> {
  try {
    await FileExtractionStatus.deleteMany({ userId, courseId });
  } catch (err) {
    logger.warn(
      { err, userId, courseId },
      "Klarte ikke å slette FileExtractionStatus for kurs",
    );
  }
}

/**
 * Sletter status-rader for alle filer i et kurs som IKKE er i keepFileIds.
 * Speiler deleteMissingFilesForCourse — når Canvas har fjernet en fil, skal
 * også extraction-status-raden ryddes bort.
 */
export async function clearExtractionFailuresForMissingFiles(
  userId: string,
  courseId: string,
  keepFileIds: number[],
): Promise<void> {
  if (keepFileIds.length === 0) return;
  try {
    await FileExtractionStatus.deleteMany({
      userId,
      courseId,
      fileId: { $nin: keepFileIds },
    });
  } catch (err) {
    logger.warn(
      { err, userId, courseId },
      "Klarte ikke å rydde FileExtractionStatus for manglende filer",
    );
  }
}

export interface RescanResult {
  /** Antall unike (userId, courseId, fileId)-kombinasjoner funnet under terskelen og med ekte-dokument-filendelse. */
  sparseCandidatesFound: number;
  /** Antall nye sparse-rader opprettet. */
  newlyFlagged: number;
  /** Antall kandidater som allerede hadde sterkere status (empty/failed/too_large) og ble hoppet over. */
  skippedExistingStronger: number;
  /** Antall tidligere retroaktivt-genererte sparse-rader som ble slettet før skannet (idempotens). */
  previousRetroactiveCleared: number;
  /** Tegn-terskel brukt i skannet. */
  threshold: number;
}

/**
 * Skanner eksisterende ContentEmbedding-rader og flagger ekte dokumentfiler
 * hvor total ekstrahert tekst er under RETROACTIVE_SPARSE_CHAR_THRESHOLD.
 *
 * Semantikk:
 * - Kjører på tvers av alle brukere (admin-omfang).
 * - Filtrerer til kun "ekte dokumentfiler" (.pptx/.pdf/.docx osv.) —
 *   IKKE Canvas-sider (.page), assignments (.assignment), eller
 *   ExternalUrl-lenker, som naturlig har lite tekst og ikke er mangelvare.
 * - Idempotent: rydder først bort alle tidligere retroaktivt-opprettede
 *   sparse-rader (identifisert via reason-prefiks) før skannet. Admin kan
 *   derfor kjøre operasjonen trygt flere ganger etter justeringer.
 * - Rører ALDRI rader med sterkere status (empty/failed/too_large/
 *   unsupported). Disse er mer autoritative.
 * - Rører ALDRI sparse-rader opprettet av canvas-sync under fersk
 *   ekstraksjon — de har annen reason-tekst og bevares.
 * - Triggerer ingen re-ekstraksjon eller sync.
 */
export async function rescanForSparseExtractions(): Promise<RescanResult> {
  const result: RescanResult = {
    sparseCandidatesFound: 0,
    newlyFlagged: 0,
    skippedExistingStronger: 0,
    previousRetroactiveCleared: 0,
    threshold: RETROACTIVE_SPARSE_CHAR_THRESHOLD,
  };

  try {
    // Idempotens: slett eksisterende rader fra tidligere retroaktive skann.
    // Identifiseres via reason-prefix. Sparse-rader fra canvas-sync (fersk
    // ekstraksjon) har annen reason og rammes ikke.
    const deletedPrev = await FileExtractionStatus.deleteMany({
      status: "sparse",
      reason: { $regex: `^${RETROACTIVE_REASON_PREFIX}` },
    });
    result.previousRetroactiveCleared = deletedPrev.deletedCount;

    // Aggregér total tekstlengde per (userId, courseId, fileId) på MongoDB-siden
    // og filtrer både på terskel og filendelse direkte i pipelinen.
    // Viktig: filtrer til kun full-text-parter (chunkIndex < 0). ContentEmbedding
    // lagrer BÅDE chunks (chunkIndex >= 0) OG den komplette filteksten splittet
    // i parter (chunkIndex: -1, -2, ... — se embedding.service.ts:724). Uten
    // filteret summeres tekst fra begge lagrings-metodene og en fil med faktisk
    // 900 tegn kan telles som ~1800 → passerer 1500-terskelen og feilaktig
    // overses som sparse. Full-text-partene gir ikke-overlappende sum.
    const candidates = await ContentEmbedding.aggregate<{
      _id: { userId: string; courseId: string; fileId: number };
      totalChars: number;
      fileName: string;
      courseName: string;
      moduleId?: number;
      moduleTitle?: string;
    }>([
      {
        $match: {
          chunkIndex: { $lt: 0 },
        },
      },
      {
        $project: {
          userId: 1,
          courseId: 1,
          courseName: 1,
          fileId: 1,
          fileName: 1,
          moduleId: 1,
          moduleTitle: 1,
          textLen: { $strLenCP: { $ifNull: ["$text", ""] } },
        },
      },
      {
        $group: {
          _id: {
            userId: "$userId",
            courseId: "$courseId",
            fileId: "$fileId",
          },
          totalChars: { $sum: "$textLen" },
          fileName: { $first: "$fileName" },
          courseName: { $first: "$courseName" },
          moduleId: { $first: "$moduleId" },
          moduleTitle: { $first: "$moduleTitle" },
        },
      },
      {
        $match: {
          totalChars: { $lt: RETROACTIVE_SPARSE_CHAR_THRESHOLD },
          // Kun ekte dokumentfiler — ekskluderer .page, .assignment, og
          // ExternalUrl-crawlede entries (som ofte mangler filendelse).
          fileName: { $regex: REAL_DOC_EXT_REGEX },
        },
      },
    ]);

    result.sparseCandidatesFound = candidates.length;

    for (const c of candidates) {
      const { userId, courseId, fileId } = c._id;

      // Sjekk eksisterende status — hopp over hvis sterkere status finnes.
      // Merk: etter delete-steget over vil eventuelle retroaktive sparse-
      // rader allerede være borte, så her ser vi kun sterkere markører
      // (empty/failed/too_large/unsupported) eller sparse fra canvas-sync.
      const existing = await FileExtractionStatus.findOne({
        userId,
        courseId,
        fileId,
      }).lean();

      if (existing) {
        result.skippedExistingStronger++;
        continue;
      }

      // Opprett ny sparse-rad
      try {
        await FileExtractionStatus.create({
          userId,
          courseId,
          courseName: c.courseName,
          moduleId: c.moduleId,
          moduleTitle: c.moduleTitle,
          fileName: c.fileName,
          fileId,
          status: "sparse" as FileExtractionStatusCode,
          reason: `${RETROACTIVE_REASON_PREFIX} kun ${c.totalChars} tegn indeksert totalt på tvers av alle chunks (terskel ${RETROACTIVE_SPARSE_CHAR_THRESHOLD}) — typisk bilde-tung PowerPoint eller tynt dokument`,
          attemptCount: 1,
          lastAttempt: new Date(),
        });
        result.newlyFlagged++;
      } catch (err) {
        // Duplikat-feil (race med sync) er OK å ignorere
        logger.warn(
          { err, userId, courseId, fileId },
          "Retroaktiv skann: kunne ikke opprette sparse-rad (kan være race-betingelse)",
        );
      }
    }

    logger.info(
      {
        sparseCandidatesFound: result.sparseCandidatesFound,
        newlyFlagged: result.newlyFlagged,
        skippedExistingStronger: result.skippedExistingStronger,
        previousRetroactiveCleared: result.previousRetroactiveCleared,
        threshold: RETROACTIVE_SPARSE_CHAR_THRESHOLD,
      },
      "Retroaktiv sparse-skann fullført",
    );

    return result;
  } catch (err) {
    logger.error({ err }, "Retroaktiv sparse-skann feilet");
    return result;
  }
}

export interface AdminFailureListParams {
  courseId?: string;
  status?: FileExtractionStatusCode;
  limit?: number;
  skip?: number;
}

/**
 * Admin-oppslag på tvers av alle brukere — brukes av admin-side.
 */
export async function listExtractionFailuresForAdmin(
  params: AdminFailureListParams = {},
): Promise<{ items: IFileExtractionStatus[]; total: number }> {
  const filter: Record<string, unknown> = {};
  if (params.courseId) filter.courseId = params.courseId;
  if (params.status) filter.status = params.status;

  const limit = Math.max(1, Math.min(params.limit ?? 100, 500));
  const skip = Math.max(0, params.skip ?? 0);

  try {
    const [items, total] = await Promise.all([
      FileExtractionStatus.find(filter)
        .sort({ lastAttempt: -1 })
        .skip(skip)
        .limit(limit)
        .lean<IFileExtractionStatus[]>(),
      FileExtractionStatus.countDocuments(filter),
    ]);
    return { items, total };
  } catch (err) {
    logger.warn({ err }, "Admin FileExtractionStatus-listing feilet");
    return { items: [], total: 0 };
  }
}
