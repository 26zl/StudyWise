import { Router } from "express";
import { logger } from "../../utils/logger.js";
import { TaskBreakdown } from "../../database/models/TaskBreakdown.js";
import { rateLimitKi } from "../../middleware/rate-limit.js";

const router = Router();
router.use(rateLimitKi); // Bruk rate limiting i stedet for auth

// GET /api/ki/task-breakdown/:assignmentId
router.get("/:assignmentId", async (req, res) => {
  try {
    const { assignmentId } = req.params;
    
    // Vi trenger userId - hvis det finnes req.user fra global auth middleware
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const breakdown = await TaskBreakdown.findOne({
      userId,
      assignmentId,
    });

    if (!breakdown) {
      return res.json({ subtasks: [] });
    }

    res.json({ subtasks: breakdown.subtasks });
  } catch (error) {
    logger.error({ err: error }, "Failed to fetch task breakdown");
    res.status(500).json({ error: "Failed to fetch task breakdown" });
  }
});

// POST /api/ki/task-breakdown/:assignmentId
router.post("/:assignmentId", async (req, res) => {
  try {
    const { assignmentId } = req.params;
    const { subtasks } = req.body;
    
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!Array.isArray(subtasks)) {
      return res.status(400).json({ error: "Invalid subtasks format" });
    }

    const breakdown = await TaskBreakdown.findOneAndUpdate(
      { userId, assignmentId },
      {
        userId,
        assignmentId,
        subtasks,
        updatedAt: new Date(),
      },
      { upsert: true, new: true }
    );

    logger.info({ userId, assignmentId }, "Saved task breakdown");
    res.json({ subtasks: breakdown.subtasks });
  } catch (error) {
    logger.error({ err: error }, "Failed to save task breakdown");
    res.status(500).json({ error: "Failed to save task breakdown" });
  }
});

// PUT /api/ki/task-breakdown/:assignmentId/toggle/:taskId
router.put("/:assignmentId/toggle/:taskId", async (req, res) => {
  try {
    const { assignmentId, taskId } = req.params;
    
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const breakdown = await TaskBreakdown.findOne({ userId, assignmentId });
    if (!breakdown) {
      return res.status(404).json({ error: "Task breakdown not found" });
    }

    const task = breakdown.subtasks.find((t: any) => t.id === taskId);
    if (task) {
      task.completed = !task.completed;
      await breakdown.save();
    }

    res.json({ subtasks: breakdown.subtasks });
  } catch (error) {
    logger.error({ err: error }, "Failed to toggle task");
    res.status(500).json({ error: "Failed to toggle task" });
  }
});

// DELETE /api/ki/task-breakdown/:assignmentId
router.delete("/:assignmentId", async (req, res) => {
  try {
    const { assignmentId } = req.params;
    
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    await TaskBreakdown.deleteOne({ userId, assignmentId });

    logger.info({ userId, assignmentId }, "Deleted task breakdown");
    res.json({ success: true });
  } catch (error) {
    logger.error({ err: error }, "Failed to delete task breakdown");
    res.status(500).json({ error: "Failed to delete task breakdown" });
  }
});

export default router; 