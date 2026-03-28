/**
 * Admin plattformstatistikk.
 * Monteres under /api/admin (allerede beskyttet med requireAuth + requireRole("admin")).
 *
 * Endepunkt:
 *   GET /statistikk – Aggregerte nøkkeltall for plattformen
 */
import { Router } from "express";
import { AdminStatsResponseSchema } from "common/admin";
import { User } from "../../../database/models/User.js";
import { ChatHistory } from "../../../database/models/ChatHistory.js";
import { SharedChat } from "../../../database/models/SharedChat.js";
import { TaskBreakdown } from "../../../database/models/TaskBreakdown.js";
import { Arbeidsplan } from "../../../database/models/arbeidsplan.js";
import { CanvasStructureModel } from "../../../database/models/CanvasStructure.js";
import { CanvasUser } from "../../../database/models/CanvasUser.js";
import { ContentEmbedding } from "../../../database/models/ContentEmbedding.js";
import { AuditLog } from "../../../database/models/AuditLog.js";
import { apiError, requireUserId } from "../../../utils/apiError.js";
import { audit, AUDIT_ACTIONS } from "../../../utils/auditLog.js";
import { logger } from "../../../utils/logger.js";

const router = Router();

const ACTIVE_FILTER = { deletedAt: { $exists: false } };
const DAY_MS = 24 * 60 * 60 * 1000;

function avrundEnDesimal(verdi: number): number {
  return Math.round(verdi * 10) / 10;
}

router.get("/statistikk", async (req, res) => {
  const actorUserId = requireUserId(req, res);
  if (!actorUserId) return;

  try {
    const [aktiveBrukere, alleBrukere] = await Promise.all([
      User.find(ACTIVE_FILTER, { _id: 1, role: 1, canvasBaseUrl: 1, authProvider: 1 }).lean(),
      User.find({}, { _id: 1 }).lean(),
    ]);

    const aktiveBrukerObjectIds = aktiveBrukere.map((bruker) => bruker._id);
    const aktiveBrukerIds = aktiveBrukerObjectIds.map((id) => id.toString());
    const alleBrukerObjectIds = alleBrukere.map((bruker) => bruker._id);
    const alleBrukerIds = alleBrukerObjectIds.map((id) => id.toString());
    const totalBrukere = aktiveBrukere.length;
    const antallAdmin = aktiveBrukere.filter((bruker) => bruker.role === "admin").length;
    const antallMedCanvas = aktiveBrukere.filter((bruker) => Boolean(bruker.canvasBaseUrl)).length;
    const antallUtenCanvas = totalBrukere - antallMedCanvas;
    const antallSlettede = Math.max(alleBrukere.length - totalBrukere, 0);
    const antallGoogle = aktiveBrukere.filter((bruker) => bruker.authProvider === "google").length;
    const antallMicrosoft = aktiveBrukere.filter((bruker) => bruker.authProvider === "microsoft").length;
    const antallEmail = aktiveBrukere.filter((bruker) => bruker.authProvider === "email").length;
    const antallUkjentProvider = Math.max(
      totalBrukere - antallGoogle - antallMicrosoft - antallEmail,
      0,
    );
    const canvasBrukerIds = aktiveBrukere
      .filter((bruker) => Boolean(bruker.canvasBaseUrl))
      .map((bruker) => bruker._id.toString());
    const now = new Date();
    const siste24TimerSiden = new Date(now.getTime() - DAY_MS);
    const siste7DagerSiden = new Date(now.getTime() - 7 * DAY_MS);

    const [
      totalSamtaler,
      bokmerkedeSamtaler,
      aktiveDelingslenker,
      inaktiveDelingslenker,
      utlopteDelingslenker,
      delingslenkerMedVisninger,
      delingsvisningerAgg,
      totalOppgaveoppdelinger,
      deloppgaverAgg,
      arbeidsplanAgg,
      totalEmbeddings,
      dokumentfilerAgg,
      dokumentemnerAgg,
      brukereMedInnholdAgg,
      tokenAgg,
      kursstrukturer,
      canvasStrukturAgg,
      syncAgg,
      auditTotalt,
      auditFeilTotalt,
      audit24t,
      auditFeil24t,
      auditKategori24tAgg,
      orphanedSamtaler,
      orphanedOppgaveoppdelinger,
      orphanedDokumentfragmenter,
      orphanedArbeidsplaner,
      orphanedCanvasStrukturer,
      orphanedCanvasBrukere,
      delingerUtenEier,
    ] = await Promise.all([
      ChatHistory.countDocuments({ user: { $in: aktiveBrukerObjectIds } }),
      ChatHistory.countDocuments({ user: { $in: aktiveBrukerObjectIds }, pinned: true }),
      SharedChat.countDocuments({ ownerId: { $in: aktiveBrukerObjectIds }, isActive: true }),
      SharedChat.countDocuments({ ownerId: { $in: aktiveBrukerObjectIds }, isActive: false }),
      SharedChat.countDocuments({
        ownerId: { $in: aktiveBrukerObjectIds },
        expiresAt: { $ne: null, $lt: now },
      }),
      SharedChat.countDocuments({ ownerId: { $in: aktiveBrukerObjectIds }, viewCount: { $gt: 0 } }),
      SharedChat.aggregate<{ total: number }>([
        { $match: { ownerId: { $in: aktiveBrukerObjectIds } } },
        { $group: { _id: null, total: { $sum: "$viewCount" } } },
      ]),
      TaskBreakdown.countDocuments({ userId: { $in: aktiveBrukerObjectIds } }),
      TaskBreakdown.aggregate<{
        deloppgaverTotalt: number;
        fullforteDeloppgaver: number;
        godkjenteDeloppgaver: number;
      }>([
        { $match: { userId: { $in: aktiveBrukerObjectIds } } },
        {
          $project: {
            antall: { $size: { $ifNull: ["$subtasks", []] } },
            fullforte: {
              $size: {
                $filter: {
                  input: { $ifNull: ["$subtasks", []] },
                  as: "subtask",
                  cond: { $eq: ["$$subtask.completed", true] },
                },
              },
            },
            godkjente: {
              $size: {
                $filter: {
                  input: { $ifNull: ["$subtasks", []] },
                  as: "subtask",
                  cond: { $eq: ["$$subtask.approved", true] },
                },
              },
            },
          },
        },
        {
          $group: {
            _id: null,
            deloppgaverTotalt: { $sum: "$antall" },
            fullforteDeloppgaver: { $sum: "$fullforte" },
            godkjenteDeloppgaver: { $sum: "$godkjente" },
          },
        },
      ]),
      Arbeidsplan.aggregate<{
        planer: number;
        blokkerTotalt: number;
        fullforteBlokker: number;
        brukereMedPlan: string[];
      }>([
        { $match: { userId: { $in: aktiveBrukerIds } } },
        {
          $project: {
            userId: 1,
            antallBlokker: { $size: { $ifNull: ["$blocks", []] } },
            fullforteBlokker: {
              $size: {
                $filter: {
                  input: { $ifNull: ["$blocks", []] },
                  as: "block",
                  cond: { $eq: ["$$block.completed", true] },
                },
              },
            },
          },
        },
        {
          $group: {
            _id: null,
            planer: { $sum: 1 },
            blokkerTotalt: { $sum: "$antallBlokker" },
            fullforteBlokker: { $sum: "$fullforteBlokker" },
            brukereMedPlan: { $addToSet: "$userId" },
          },
        },
      ]),
      ContentEmbedding.countDocuments({ userId: { $in: aktiveBrukerIds } }),
      ContentEmbedding.aggregate<{ total: number }>([
        { $match: { userId: { $in: aktiveBrukerIds } } },
        { $group: { _id: { userId: "$userId", courseId: "$courseId", fileId: "$fileId" } } },
        { $count: "total" },
      ]),
      ContentEmbedding.aggregate<{ total: number }>([
        { $match: { userId: { $in: aktiveBrukerIds } } },
        { $group: { _id: { userId: "$userId", courseId: "$courseId" } } },
        { $count: "total" },
      ]),
      ContentEmbedding.aggregate<{ total: number }>([
        { $match: { userId: { $in: aktiveBrukerIds } } },
        { $group: { _id: "$userId" } },
        { $count: "total" },
      ]),
      ContentEmbedding.aggregate<{ total: number }>([
        { $match: { userId: { $in: aktiveBrukerIds } } },
        { $group: { _id: null, total: { $sum: "$tokenCount" } } },
      ]),
      CanvasStructureModel.countDocuments({ userId: { $in: aktiveBrukerIds } }),
      CanvasStructureModel.aggregate<{
        canvasOppgaver: number;
        canvasKunngjoringer: number;
        canvasModuler: number;
        canvasModulElementer: number;
      }>([
        { $match: { userId: { $in: aktiveBrukerIds } } },
        {
          $project: {
            oppgaverCount: { $size: { $ifNull: ["$oppgaver", []] } },
            kunngjoringerCount: { $size: { $ifNull: ["$kunngjøringer", []] } },
            modulerCount: { $size: { $ifNull: ["$moduler", []] } },
            modulElementerCount: {
              $sum: {
                $map: {
                  input: { $ifNull: ["$moduler", []] },
                  as: "modul",
                  in: { $size: { $ifNull: ["$$modul.items", []] } },
                },
              },
            },
          },
        },
        {
          $group: {
            _id: null,
            canvasOppgaver: { $sum: "$oppgaverCount" },
            canvasKunngjoringer: { $sum: "$kunngjoringerCount" },
            canvasModuler: { $sum: "$modulerCount" },
            canvasModulElementer: { $sum: "$modulElementerCount" },
          },
        },
      ]),
      CanvasStructureModel.aggregate<{ _id: string; sistSyncedAt: Date }>([
        { $match: { userId: { $in: canvasBrukerIds } } },
        { $group: { _id: "$userId", sistSyncedAt: { $max: "$syncedAt" } } },
      ]),
      AuditLog.countDocuments(),
      AuditLog.countDocuments({ outcome: "failure" }),
      AuditLog.countDocuments({ createdAt: { $gte: siste24TimerSiden } }),
      AuditLog.countDocuments({ outcome: "failure", createdAt: { $gte: siste24TimerSiden } }),
      AuditLog.aggregate<{ _id: string; total: number }>([
        { $match: { createdAt: { $gte: siste24TimerSiden } } },
        { $group: { _id: "$category", total: { $sum: 1 } } },
      ]),
      ChatHistory.countDocuments({ user: { $nin: alleBrukerObjectIds } }),
      TaskBreakdown.countDocuments({ userId: { $nin: alleBrukerObjectIds } }),
      ContentEmbedding.countDocuments({ userId: { $nin: alleBrukerIds } }),
      Arbeidsplan.countDocuments({ userId: { $nin: alleBrukerIds } }),
      CanvasStructureModel.countDocuments({ userId: { $nin: alleBrukerIds } }),
      CanvasUser.countDocuments({ localUser: { $nin: alleBrukerObjectIds } }),
      SharedChat.countDocuments({ ownerId: { $nin: alleBrukerObjectIds } }),
    ]);

    const totalDeloppgaver = deloppgaverAgg[0]?.deloppgaverTotalt ?? 0;
    const fullforteDeloppgaver = deloppgaverAgg[0]?.fullforteDeloppgaver ?? 0;
    const godkjenteDeloppgaver = deloppgaverAgg[0]?.godkjenteDeloppgaver ?? 0;
    const arbeidsplanerTotalt = arbeidsplanAgg[0]?.planer ?? 0;
    const blokkerTotalt = arbeidsplanAgg[0]?.blokkerTotalt ?? 0;
    const fullforteBlokker = arbeidsplanAgg[0]?.fullforteBlokker ?? 0;
    const brukereMedPlan = arbeidsplanAgg[0]?.brukereMedPlan?.length ?? 0;
    const totalDelingsvisninger = delingsvisningerAgg[0]?.total ?? 0;
    const totalDokumentfiler = dokumentfilerAgg[0]?.total ?? 0;
    const totalDokumentemner = dokumentemnerAgg[0]?.total ?? 0;
    const antallBrukereMedInnhold = brukereMedInnholdAgg[0]?.total ?? 0;
    const totalTokens = tokenAgg[0]?.total ?? 0;
    const canvasOppgaver = canvasStrukturAgg[0]?.canvasOppgaver ?? 0;
    const canvasKunngjoringer = canvasStrukturAgg[0]?.canvasKunngjoringer ?? 0;
    const canvasModuler = canvasStrukturAgg[0]?.canvasModuler ?? 0;
    const canvasModulElementer = canvasStrukturAgg[0]?.canvasModulElementer ?? 0;
    const brukereMedSyncData = syncAgg.length;
    const brukereMedFerskSync24t = syncAgg.filter((entry) => new Date(entry.sistSyncedAt) >= siste24TimerSiden).length;
    const brukereMedGammelSync7d = syncAgg.filter((entry) => new Date(entry.sistSyncedAt) < siste7DagerSiden).length;
    const canvasBrukereUtenSyncData = Math.max(canvasBrukerIds.length - brukereMedSyncData, 0);
    const auditKategori24t = Object.fromEntries(auditKategori24tAgg.map((entry) => [entry._id, entry.total]));
    const snittSamtalerPerBruker = totalBrukere > 0 ? avrundEnDesimal(totalSamtaler / totalBrukere) : 0;
    const snittDeloppgaverPerOppdeling =
      totalOppgaveoppdelinger > 0 ? avrundEnDesimal(totalDeloppgaver / totalOppgaveoppdelinger) : 0;
    const snittChunksPerFil =
      totalDokumentfiler > 0 ? avrundEnDesimal(totalEmbeddings / totalDokumentfiler) : 0;
    const arbeidsplanFullforingsgrad =
      blokkerTotalt > 0 ? avrundEnDesimal((fullforteBlokker / blokkerTotalt) * 100) : 0;

    await audit({
      actorUserId,
      action: AUDIT_ACTIONS.ADMIN_ACTION,
      category: "admin",
      outcome: "success",
      role: req.actorRole,
      metadata: { subAction: "statistikk.hent" },
      req,
    });

    return res.json(
      AdminStatsResponseSchema.parse({
        brukere: {
          totalt: totalBrukere,
          admin: antallAdmin,
          vanlige: totalBrukere - antallAdmin,
          medCanvas: antallMedCanvas,
          utenCanvas: antallUtenCanvas,
          slettede: antallSlettede,
          google: antallGoogle,
          microsoft: antallMicrosoft,
          email: antallEmail,
          ukjentProvider: antallUkjentProvider,
        },
        samtaler: {
          totalt: totalSamtaler,
          bokmerket: bokmerkedeSamtaler,
          snittPerBruker: snittSamtalerPerBruker,
        },
        deling: {
          aktiveLenker: aktiveDelingslenker,
          inaktiveLenker: inaktiveDelingslenker,
          utlopteLenker: utlopteDelingslenker,
          lenkerMedVisninger: delingslenkerMedVisninger,
          visningerTotalt: totalDelingsvisninger,
        },
        oppgaver: {
          oppgaveoppdelinger: totalOppgaveoppdelinger,
          deloppgaverTotalt: totalDeloppgaver,
          fullforteDeloppgaver,
          godkjenteDeloppgaver,
          snittDeloppgaverPerOppdeling,
        },
        arbeidsplan: {
          planer: arbeidsplanerTotalt,
          blokkerTotalt,
          fullforteBlokker,
          brukereMedPlan,
          fullforingsgrad: arbeidsplanFullforingsgrad,
        },
        innhold: {
          dokumentfragmenter: totalEmbeddings,
          dokumentfiler: totalDokumentfiler,
          dokumentemner: totalDokumentemner,
          brukereMedInnhold: antallBrukereMedInnhold,
          tokensTotalt: totalTokens,
          snittChunksPerFil,
          kursstrukturer,
          canvasOppgaver,
          canvasKunngjoringer,
          canvasModuler,
          canvasModulElementer,
        },
        sync: {
          brukereMedSyncData,
          brukereMedFerskSync24t,
          brukereMedGammelSync7d,
          canvasBrukereUtenSyncData,
        },
        revisjon: {
          hendelserTotalt: auditTotalt,
          feilTotalt: auditFeilTotalt,
          hendelser24t: audit24t,
          feil24t: auditFeil24t,
          admin24t: auditKategori24t.admin ?? 0,
          auth24t: auditKategori24t.auth ?? 0,
          integration24t: auditKategori24t.integration ?? 0,
          ki24t: auditKategori24t.ki ?? 0,
          privacy24t: auditKategori24t.privacy ?? 0,
          profile24t: auditKategori24t.profile ?? 0,
          security24t: auditKategori24t.security ?? 0,
        },
        kvalitet: {
          orphanedSamtaler,
          orphanedOppgaveoppdelinger,
          orphanedDokumentfragmenter,
          orphanedArbeidsplaner,
          orphanedCanvasStrukturer,
          orphanedCanvasBrukere,
          delingerUtenEier,
        },
      }),
    );
  } catch (err) {
    logger.error({ err }, "Admin statistikk feilet");
    return apiError.serverError(res);
  }
});

export default router;
