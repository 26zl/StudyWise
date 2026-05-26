/*
 * API Ruter for Arbeidsplan
 * CRUD operasjoner for å lagre, hente, oppdatere og slette arbeidsplaner
 */

import { Router, Request, Response } from "express";
import mongoose from "mongoose";
import {
  Arbeidsplan,
  type IArbeidsplan,
  type IStudyBlock,
} from "../../database/models/arbeidsplan.js";
import { requireUserId, sendZodError, sendUnknownError, apiError } from "../../utils/apiError.js";
import { getIsoWeekInfo, parseTimerStreng } from "common/dateUtils";
import {
  ArbeidsplanDeleteResponseSchema,
  ArbeidsplanProgressResponseSchema,
  ArbeidsplanResponseSchema,
  CreateArbeidsplanSchema,
  UpdateBlockSchema,
} from "common/arbeidsplan";
import { rateLimitMe } from "../../middleware/rate-limit.js";

const router = Router();
router.use(rateLimitMe);

/** Maksimalt antall blokker per arbeidsplan for å hindre ubegrenset vekst */
const MAX_BLOCKS_PER_PLAN = 200;

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
      // Slå sammen nye blokker med eksisterende i stedet for å erstatte
      const mergedBlocks = [...existing.blocks, ...(data.blocks as IStudyBlock[])];
      if (mergedBlocks.length > MAX_BLOCKS_PER_PLAN) {
        return apiError.badRequest(res, `Arbeidsplanen kan ha maks ${MAX_BLOCKS_PER_PLAN} blokker`);
      }
      existing.week = data.week;
      existing.blocks = mergedBlocks;
      existing.totalHours =
        Math.round(mergedBlocks.reduce((sum, b) => sum + parseTimerStreng(b.duration), 0) * 10) /
        10;
      plan = await existing.save();
    } else {
      plan = await Arbeidsplan.create({
        userId,
        ...data,
      });
    }

    return res.json(
      ArbeidsplanResponseSchema.parse({
        suksess: true,
        data: serializeArbeidsplan(plan),
        melding: existing ? "Arbeidsplan oppdatert" : "Arbeidsplan opprettet",
      }),
    );
  } catch (error) {
    return sendUnknownError(res, error, { kontekst: "arbeidsplan opprettelse" });
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

    const { weekNumber, weekYear } = getIsoWeekInfo(new Date());

    const plan = await Arbeidsplan.findOne({
      userId,
      year: weekYear,
      weekNumber,
    });

    return res.json(
      ArbeidsplanResponseSchema.parse({
        suksess: true,
        data: serializeArbeidsplan(plan),
      }),
    );
  } catch (error) {
    return sendUnknownError(res, error, { kontekst: "arbeidsplan henting" });
  }
});

/**
 * GET /api/arbeidsplan/stats/progress
 * Hent fremdriftsstatistikk for gjeldende uke
 */
router.get("/stats/progress", async (req: Request, res: Response) => {
  try {
    const userId = requireUserId(req, res);
    if (!userId) return;

    const { weekNumber, weekYear } = getIsoWeekInfo(new Date());

    const plan = await Arbeidsplan.findOne({
      userId,
      year: weekYear,
      weekNumber,
    });

    if (!plan) {
      return res.json(
        ArbeidsplanProgressResponseSchema.parse({
          suksess: true,
          data: {
            totalBlocks: 0,
            completedBlocks: 0,
            percentage: 0,
            totalHours: 0,
            completedHours: 0,
          },
        }),
      );
    }

    const totalBlocks = plan.blocks.length;
    const completedBlocks = plan.blocks.filter((b) => b.completed).length;
    const percentage = totalBlocks > 0 ? Math.round((completedBlocks / totalBlocks) * 100) : 0;

    const completedHours =
      Math.round(
        plan.blocks
          .filter((b) => b.completed)
          .reduce((sum, b) => sum + parseTimerStreng(b.duration), 0) * 10,
      ) / 10;

    return res.json(
      ArbeidsplanProgressResponseSchema.parse({
        suksess: true,
        data: {
          totalBlocks,
          completedBlocks,
          percentage,
          totalHours: plan.totalHours,
          completedHours,
        },
      }),
    );
  } catch (error) {
    return sendUnknownError(res, error, { kontekst: "arbeidsplan fremdrift" });
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

    if (blockIndex < 0 || !Number.isInteger(blockIndex) || blockIndex >= plan.blocks.length) {
      return apiError.badRequest(res, "Ugyldig blokk-index");
    }

    plan.blocks[blockIndex].completed = completed;
    plan.blocks[blockIndex].completedAt = completed ? new Date() : undefined;

    await plan.save();

    return res.json(
      ArbeidsplanResponseSchema.parse({
        suksess: true,
        data: serializeArbeidsplan(plan),
        melding: "Studieblokk oppdatert",
      }),
    );
  } catch (error) {
    return sendUnknownError(res, error, { kontekst: "studieblokk oppdatering" });
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

    return res.json(
      ArbeidsplanDeleteResponseSchema.parse({
        suksess: true,
        melding: "Arbeidsplan slettet",
      }),
    );
  } catch (error) {
    return sendUnknownError(res, error, { kontekst: "arbeidsplan sletting" });
  }
});

export default router;
