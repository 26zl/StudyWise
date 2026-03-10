/*
 * API Ruter for Arbeidsplan
 * CRUD operasjoner for å lagre, hente, oppdatere og slette arbeidsplaner
 */

import { Router, Request, Response } from "express";
import { z, ZodError } from "zod";
import { Arbeidsplan } from "../../database/models/arbeidsplan.js";
import { autentiserJwt } from "../../middleware/auth.js";

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

// Alle ruter krever autentisering
router.use(autentiserJwt);

/**
 * POST /api/arbeidsplan
 * Opprett eller erstatt arbeidsplan for en uke
 */
router.post("/", async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ 
        suksess: false, 
        feil: "Ikke autentisert" 
      });
    }

    // Valider input
    const data = CreateArbeidsplanSchema.parse(req.body);

    // Sjekk om plan for denne uken allerede eksisterer
    const existing = await Arbeidsplan.findOne({
      userId,
      year: data.year,
      weekNumber: data.weekNumber,
    });

    let plan;
    if (existing) {
      // Oppdater eksisterende plan
      existing.week = data.week;
      existing.blocks = data.blocks as any;
      existing.totalHours = data.totalHours;
      plan = await existing.save();
    } else {
      // Opprett ny plan
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
    console.error("Feil ved oppretting av arbeidsplan:", error);
    if (error instanceof ZodError) {
      return res.status(400).json({
        suksess: false,
        feil: "Ugyldig data",
        detaljer: error.errors,
      });
    }
    res.status(500).json({
      suksess: false,
      feil: "Kunne ikke opprette arbeidsplan",
    });
  }
});

/**
 * GET /api/arbeidsplan/current
 * Hent arbeidsplan for gjeldende uke
 */
router.get("/current", async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ 
        suksess: false, 
        feil: "Ikke autentisert" 
      });
    }

    // Beregn gjeldende uke
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
    console.error("Feil ved henting av arbeidsplan:", error);
    res.status(500).json({
      suksess: false,
      feil: "Kunne ikke hente arbeidsplan",
    });
  }
});

/**
 * GET /api/arbeidsplan/:year/:weekNumber
 * Hent arbeidsplan for spesifikk uke
 */
router.get("/:year/:weekNumber", async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ 
        suksess: false, 
        feil: "Ikke autentisert" 
      });
    }

    const year = parseInt(req.params.year, 10);
    const weekNumber = parseInt(req.params.weekNumber, 10);

    if (isNaN(year) || isNaN(weekNumber)) {
      return res.status(400).json({
        suksess: false,
        feil: "Ugyldig år eller ukenummer",
      });
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
    console.error("Feil ved henting av arbeidsplan:", error);
    res.status(500).json({
      suksess: false,
      feil: "Kunne ikke hente arbeidsplan",
    });
  }
});

/**
 * PATCH /api/arbeidsplan/:id/block
 * Oppdater en enkelt studieblokk (f.eks. marker som fullført)
 */
router.patch("/:id/block", async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ 
        suksess: false, 
        feil: "Ikke autentisert" 
      });
    }

    const planId = req.params.id;
    const { blockIndex, completed } = UpdateBlockSchema.parse(req.body);

    const plan = await Arbeidsplan.findOne({
      _id: planId,
      userId,
    });

    if (!plan) {
      return res.status(404).json({
        suksess: false,
        feil: "Arbeidsplan ikke funnet",
      });
    }

    if (blockIndex >= plan.blocks.length) {
      return res.status(400).json({
        suksess: false,
        feil: "Ugyldig blokk-index",
      });
    }

    // Oppdater blokken
    plan.blocks[blockIndex].completed = completed;
    if (completed) {
      plan.blocks[blockIndex].completedAt = new Date();
    } else {
      plan.blocks[blockIndex].completedAt = undefined;
    }

    await plan.save();

    res.json({
      suksess: true,
      data: plan,
      melding: "Studieblokk oppdatert",
    });
  } catch (error) {
    console.error("Feil ved oppdatering av studieblokk:", error);
    if (error instanceof ZodError) {
      return res.status(400).json({
        suksess: false,
        feil: "Ugyldig data",
        detaljer: error.errors,
      });
    }
    res.status(500).json({
      suksess: false,
      feil: "Kunne ikke oppdatere studieblokk",
    });
  }
});

/**
 * DELETE /api/arbeidsplan/:id
 * Slett en arbeidsplan
 */
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ 
        suksess: false, 
        feil: "Ikke autentisert" 
      });
    }

    const planId = req.params.id;

    const result = await Arbeidsplan.deleteOne({
      _id: planId,
      userId,
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({
        suksess: false,
        feil: "Arbeidsplan ikke funnet",
      });
    }

    res.json({
      suksess: true,
      melding: "Arbeidsplan slettet",
    });
  } catch (error) {
    console.error("Feil ved sletting av arbeidsplan:", error);
    res.status(500).json({
      suksess: false,
      feil: "Kunne ikke slette arbeidsplan",
    });
  }
});

/**
 * GET /api/arbeidsplan/stats/progress
 * Hent fremdriftsstatistikk for gjeldende uke
 */
router.get("/stats/progress", async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ 
        suksess: false, 
        feil: "Ikke autentisert" 
      });
    }

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
    const completedBlocks = plan.blocks.filter((b: any) => b.completed).length;
    const percentage = totalBlocks > 0 
      ? Math.round((completedBlocks / totalBlocks) * 100) 
      : 0;

    // Beregn timer (veldig forenklet estimat)
    const hoursPerBlock = plan.totalHours / totalBlocks;
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
    console.error("Feil ved henting av fremdrift:", error);
    res.status(500).json({
      suksess: false,
      feil: "Kunne ikke hente fremdrift",
    });
  }
});

// Hjelpefunksjon for å beregne ukenummer
function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

export default router;  