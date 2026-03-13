/*
 * API Ruter for Arbeidsplan
 * CRUD operasjoner for å lagre, hente, oppdatere og slette arbeidsplaner
 */    

import { Router, Request, Response } from "express";
import mongoose from "mongoose";
import { Arbeidsplan, type IArbeidsplan, type IStudyBlock } from "../../database/models/arbeidsplan.js";
import { requireUserId, sendZodError, sendUnknownError, apiError } from "../../utils/apiError.js";
import { getWeekNumber, parseTimerStreng } from "common/dateUtils";
import { CreateArbeidsplanSchema, UpdateBlockSchema } from "common/arbeidsplan";

const router = Router();

function serializeStudyBlock(block: IStudyBlock) {
  return {
    day: block.day,
    timeSlot: block.timeSlot,
    task: block.task,
    duration: block.duration,
    priority: block.priority,
    courseName: block.courseName,
    assignmentId: block.assignmentId,
    completed: block.completed,
    completedAt: block.completedAt?.toISOString(),
  };
}

function serializeArbeidsplan(plan: IArbeidsplan | null) {
  if (!plan) return null;

  return {
    _id: String(plan._id),
    userId: plan.userId,
    week: plan.week,
    weekNumber: plan.weekNumber,
    year: plan.year,
    blocks: plan.blocks.map((block) => serializeStudyBlock(block)),
    totalHours: plan.totalHours,
    createdAt: plan.createdAt.toISOString(),
    updatedAt: plan.updatedAt.toISOString(),
  };
}

/**
 * POST /api/arbeidsplan
 * Opprett eller erstatt arbeidsplan for en uke
 */
router.post("/", async (req: Request, res: Response) => {
  try {
    const userId = requireUserId(req, res);
    if (!userId) return;

    const parsed = CreateArbeidsplanSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendZodError(res, parsed.error, "arbeidsplan opprettelse");
    }
    const data = parsed.data;

    const existing = await Arbeidsplan.findOne({
      userId,
      year: data.year,
      weekNumber: data.weekNumber,
    }); 

    let plan;
    if (existing) {
      existing.week = data.week;
      existing.blocks = data.blocks as IStudyBlock[];
      existing.totalHours = data.totalHours;
      plan = await existing.save();
    } else {
      plan = await Arbeidsplan.create({
        userId,
        ...data,
      });
    }

    return res.json({
      suksess: true,
      data: serializeArbeidsplan(plan),
      melding: existing ? "Arbeidsplan oppdatert" : "Arbeidsplan opprettet",
    });
  } catch (error) {
    sendUnknownError(res, error, { kontekst: "arbeidsplan opprettelse" });
  }
});

/**
 * GET /api/arbeidsplan/current
 * Hent arbeidsplan for gjeldende uke
 */
router.get("/current", async (req: Request, res: Response) => {
  try {
    const userId = requireUserId(req, res);
    if (!userId) return;

    const now = new Date();
    const year = now.getFullYear();
    const weekNumber = getWeekNumber(now);

    const plan = await Arbeidsplan.findOne({
      userId,
      year,
      weekNumber,
    });

    return res.json({
      suksess: true,
      data: serializeArbeidsplan(plan),
    });
  } catch (error) {
    sendUnknownError(res, error, { kontekst: "arbeidsplan henting" });
  }
});

/**
 * GET /api/arbeidsplan/stats/progress
 * Hent fremdriftsstatistikk for gjeldende uke
 * VIKTIG: Må stå FØR /:year/:weekNumber for å unngå route conflict
 */
router.get("/stats/progress", async (req: Request, res: Response) => {
  try {
    const userId = requireUserId(req, res);
    if (!userId) return;

    const now = new Date();
    const year = now.getFullYear();
    const weekNumber = getWeekNumber(now);

    const plan = await Arbeidsplan.findOne({
      userId,
      year,
      weekNumber,
    });

    if (!plan) {
      return res.json({
        suksess: true,
        data: {
          totalBlocks: 0,
          completedBlocks: 0,
          percentage: 0,
          totalHours: 0,
          completedHours: 0,
        },
      });
    }

    const totalBlocks = plan.blocks.length;
    const completedBlocks = plan.blocks.filter((b) => b.completed).length;
    const percentage = totalBlocks > 0
      ? Math.round((completedBlocks / totalBlocks) * 100)
      : 0;

    const completedHours = Math.round(
      plan.blocks
        .filter((b) => b.completed)
        .reduce((sum, b) => sum + parseTimerStreng(b.duration), 0) * 10
    ) / 10;

    return res.json({
      suksess: true,
      data: {
        totalBlocks,
        completedBlocks,
        percentage,
        totalHours: plan.totalHours,
        completedHours,
      },
    });
  } catch (error) {
    sendUnknownError(res, error, { kontekst: "arbeidsplan fremdrift" });
  }
});

/**
 * GET /api/arbeidsplan/:year/:weekNumber
 * Hent arbeidsplan for spesifikk uke
 */
router.get("/:year/:weekNumber", async (req: Request, res: Response) => {
  try {
    const userId = requireUserId(req, res);
    if (!userId) return;

    const year = parseInt(String(req.params.year), 10);
    const weekNumber = parseInt(String(req.params.weekNumber), 10);

    if (isNaN(year) || isNaN(weekNumber)) {
      return apiError.badRequest(res, "Ugyldig år eller ukenummer");
    }

    const plan = await Arbeidsplan.findOne({
      userId,
      year,
      weekNumber,
    });

    return res.json({
      suksess: true,
      data: serializeArbeidsplan(plan),
    });
  } catch (error) {
    sendUnknownError(res, error, { kontekst: "arbeidsplan henting" });
  }
});

/**
 * PATCH /api/arbeidsplan/:id/block
 * Oppdater en enkelt studieblokk (f.eks. marker som fullført)
 */
router.patch("/:id/block", async (req: Request, res: Response) => {
  try {
    const userId = requireUserId(req, res);
    if (!userId) return;

    const parsed = UpdateBlockSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendZodError(res, parsed.error, "studieblokk oppdatering");
    }
    const { blockIndex, completed } = parsed.data;
    const planId = String(req.params.id);
    if (!mongoose.Types.ObjectId.isValid(planId)) {
      return apiError.badRequest(res, "Ugyldig arbeidsplan-ID");
    }

    const plan = await Arbeidsplan.findOne({
      _id: planId,
      userId,
    });

    if (!plan) {
      return apiError.notFound(res, "Arbeidsplan");
    }

    if (blockIndex >= plan.blocks.length) {
      return apiError.badRequest(res, "Ugyldig blokk-index");
    }

    plan.blocks[blockIndex].completed = completed;
    plan.blocks[blockIndex].completedAt = completed ? new Date() : undefined;

    await plan.save();

    return res.json({
      suksess: true,
      data: serializeArbeidsplan(plan),
      melding: "Studieblokk oppdatert",
    });
  } catch (error) {
    sendUnknownError(res, error, { kontekst: "studieblokk oppdatering" });
  }
});

/**
 * DELETE /api/arbeidsplan/:id
 * Slett en arbeidsplan
 */
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const userId = requireUserId(req, res);
    if (!userId) return;
    const planId = String(req.params.id);
    if (!mongoose.Types.ObjectId.isValid(planId)) {
      return apiError.badRequest(res, "Ugyldig arbeidsplan-ID");
    }

    const result = await Arbeidsplan.deleteOne({
      _id: planId,
      userId,
    });

    if (result.deletedCount === 0) {
      return apiError.notFound(res, "Arbeidsplan");
    }

    return res.json({
      suksess: true,
      melding: "Arbeidsplan slettet",
    });
  } catch (error) {
    sendUnknownError(res, error, { kontekst: "arbeidsplan sletting" });
  }
});

export default router;
