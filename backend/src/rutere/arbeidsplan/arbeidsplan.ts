/*
 * API Ruter for Arbeidsplan
 * CRUD operasjoner for å lagre, hente, oppdatere og slette arbeidsplaner
 */    

import { Router, Request, Response } from "express";
import { Arbeidsplan, type IStudyBlock } from "../../database/models/arbeidsplan.js";
import { requireUserId, sendZodError, sendUnknownError, apiError } from "../../utils/apiError.js";
import { getWeekNumber } from "common/dateUtils";
import { z } from "zod";

const router = Router();

// Zod schemas for validering
const StudyBlockSchema = z.object({
  day: z.string(),
  timeSlot: z.string(),
  task: z.string(),
  duration: z.string(),
  priority: z.enum(["high", "medium", "low"]),
  courseName: z.string(),
  assignmentId: z.string().optional(),
  completed: z.boolean().default(false),
  completedAt: z.string().optional(),
});

const CreateArbeidsplanSchema = z.object({
  week: z.string(),
  weekNumber: z.number().int().min(1).max(53),
  year: z.number().int().min(2020).max(2100),
  blocks: z.array(StudyBlockSchema),
  totalHours: z.number(),
}); 

const UpdateBlockSchema = z.object({
  blockIndex: z.number().int().min(0),
  completed: z.boolean(),
});

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

    res.json({
      suksess: true,
      data: plan,
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

    res.json({
      suksess: true,
      data: plan,
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

    const hoursPerBlock = totalBlocks > 0 ? plan.totalHours / totalBlocks : 0;
    const completedHours = Math.round(completedBlocks * hoursPerBlock * 10) / 10;

    res.json({
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

    res.json({
      suksess: true,
      data: plan,
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

    const plan = await Arbeidsplan.findOne({
      _id: req.params.id,
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

    res.json({
      suksess: true,
      data: plan,
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

    const result = await Arbeidsplan.deleteOne({
      _id: req.params.id,
      userId,
    });

    if (result.deletedCount === 0) {
      return apiError.notFound(res, "Arbeidsplan");
    }

    res.json({
      suksess: true,
      melding: "Arbeidsplan slettet",
    });
  } catch (error) {
    sendUnknownError(res, error, { kontekst: "arbeidsplan sletting" });
  }
});

export default router;
