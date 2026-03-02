import { Router } from "express";
import { logger } from "../../utils/logger.js";
import { apiError, sendZodError, sendUnknownError } from "../../utils/apiError.js";
import { TaskBreakdown } from "../../database/models/TaskBreakdown.js";
import { rateLimitKi } from "../../middleware/rate-limit.js";
import { SubTaskSchema } from "common";

const router = Router();
router.use(rateLimitKi);

// GET /api/ki/task-breakdown/:assignmentId
router.get("/:assignmentId", async (req, res) => {
  try {
    const { assignmentId } = req.params;
    const userId = req.user?.id;
    if (!userId) {
      return apiError.unauthorized(res);
    }

    const breakdown = await TaskBreakdown.findOne({ userId, assignmentId });

    if (!breakdown) {
      return res.json({ subtasks: [] });
    }

    res.json({ subtasks: breakdown.subtasks });
  } catch (error) {
    sendUnknownError(res, error, { kontekst: "GET task-breakdown" });
  }
});

// POST /api/ki/task-breakdown/:assignmentId
router.post("/:assignmentId", async (req, res) => {
  try {
    const { assignmentId } = req.params;
    const userId = req.user?.id;
    if (!userId) {
      return apiError.unauthorized(res);
    }

    const parsed = SubTaskSchema.array().safeParse(req.body.subtasks);
    if (!parsed.success) {
      return sendZodError(res, parsed.error, "subtasks");
    }

    const breakdown = await TaskBreakdown.findOneAndUpdate(
      { userId, assignmentId },
      { userId, assignmentId, subtasks: parsed.data, updatedAt: new Date() },
      { upsert: true, new: true }
    );

    logger.info({ userId, assignmentId }, "Saved task breakdown");
    res.json({ subtasks: breakdown.subtasks });
  } catch (error) {
    sendUnknownError(res, error, { kontekst: "POST task-breakdown" });
  }
});

// PUT /api/ki/task-breakdown/:assignmentId/toggle/:taskId
router.put("/:assignmentId/toggle/:taskId", async (req, res) => {
  try {
    const { assignmentId, taskId } = req.params;
    const userId = req.user?.id;
    if (!userId) {
      return apiError.unauthorized(res);
    }

    const breakdown = await TaskBreakdown.findOne({ userId, assignmentId });
    if (!breakdown) {
      return apiError.notFound(res, "Task breakdown");
    }

    const task = breakdown.subtasks.find((t) => t.id === taskId);
    if (!task) {
      return apiError.notFound(res, "Subtask");
    }

    task.completed = !task.completed;
    await breakdown.save();

    res.json({ subtasks: breakdown.subtasks });
  } catch (error) {
    sendUnknownError(res, error, { kontekst: "PUT task-breakdown toggle" });
  }
});

// DELETE /api/ki/task-breakdown/:assignmentId
router.delete("/:assignmentId", async (req, res) => {
  try {
    const { assignmentId } = req.params;
    const userId = req.user?.id;
    if (!userId) {
      return apiError.unauthorized(res);
    }

    await TaskBreakdown.deleteOne({ userId, assignmentId });

    logger.info({ userId, assignmentId }, "Deleted task breakdown");
    res.json({ subtasks: [] });
  } catch (error) {
    sendUnknownError(res, error, { kontekst: "DELETE task-breakdown" });
  }
});

export default router;
