import { Router } from "express";
import { logger } from "../../utils/logger.js";
import { apiError, sendZodError, sendUnknownError, requireUserId } from "../../utils/apiError.js";
import { TaskBreakdown } from "../../database/models/TaskBreakdown.js";
import { rateLimitKi } from "../../middleware/rate-limit.js";
import { SubTaskSchema, TaskBreakdownResponseSchema } from "common/ki";

const router = Router();
router.use(rateLimitKi);

// GET /api/ki/task-breakdown/:assignmentId
router.get("/:assignmentId", async (req, res) => {
  try {
    const { assignmentId } = req.params;
    const userId = requireUserId(req, res);
    if (!userId) return;

    const breakdown = await TaskBreakdown.findOne({ userId, assignmentId });

    if (!breakdown) {
      const empty = TaskBreakdownResponseSchema.parse({ subtasks: [] });
      return res.json(empty);
    }

    const payload = TaskBreakdownResponseSchema.parse({ subtasks: breakdown.subtasks });
    return res.json(payload);
  } catch (error) {
    sendUnknownError(res, error, { kontekst: "GET task-breakdown" });
  }
});

// POST /api/ki/task-breakdown/:assignmentId
router.post("/:assignmentId", async (req, res) => {
  try {
    const { assignmentId } = req.params;
    const userId = requireUserId(req, res);
    if (!userId) return;

    const parsed = SubTaskSchema.array().safeParse(req.body.subtasks);
    if (!parsed.success) {
      return sendZodError(res, parsed.error, "subtasks");
    }

    const breakdown = await TaskBreakdown.findOneAndUpdate(
      { userId, assignmentId },
      { userId, assignmentId, subtasks: parsed.data, updatedAt: new Date() },
      { upsert: true, returnDocument: "after" },
    );

    logger.info({ userId, assignmentId }, "Saved task breakdown");
    const payload = TaskBreakdownResponseSchema.parse({ subtasks: breakdown!.subtasks });
    return res.json(payload);
  } catch (error) {
    sendUnknownError(res, error, { kontekst: "POST task-breakdown" });
  }
});

// PUT /api/ki/task-breakdown/:assignmentId/toggle/:taskId
router.put("/:assignmentId/toggle/:taskId", async (req, res) => {
  try {
    const { assignmentId, taskId } = req.params;
    const userId = requireUserId(req, res);
    if (!userId) return;

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

    const payload = TaskBreakdownResponseSchema.parse({ subtasks: breakdown.subtasks });
    return res.json(payload);
  } catch (error) {
    sendUnknownError(res, error, { kontekst: "PUT task-breakdown toggle" });
  }
});

// DELETE /api/ki/task-breakdown/:assignmentId
router.delete("/:assignmentId", async (req, res) => {
  try {
    const { assignmentId } = req.params;
    const userId = requireUserId(req, res);
    if (!userId) return;

    await TaskBreakdown.deleteOne({ userId, assignmentId });

    logger.info({ userId, assignmentId }, "Deleted task breakdown");
    const payload = TaskBreakdownResponseSchema.parse({ subtasks: [] });
    return res.json(payload);
  } catch (error) {
    sendUnknownError(res, error, { kontekst: "DELETE task-breakdown" });
  }
});

export default router;
