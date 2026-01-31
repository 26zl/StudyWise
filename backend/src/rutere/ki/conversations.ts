import { Router } from "express";
import { ChatConversation } from "../../database/models/ChatConversation.js";
import { auth } from "../../middleware/auth.js";
import { logger } from "../../utils/logger.js";

const router = Router();

// Alle endepunkter krever autentisering
router.use(auth);

// GET /api/ki/conversations - List all conversations
router.get("/", async (req, res) => {
  try {
    const conversations = await ChatConversation.find({ userId: req.user!.id })
      .sort({ updatedAt: -1 })
      .limit(50)
      .select("_id title createdAt updatedAt messages")
      .lean();

    // Legg til message count
    const withCounts = conversations.map((conv) => ({
      ...conv,
      messageCount: conv.messages?.length || 0,
    }));

    logger.info({ userId: req.user!.id, count: conversations.length }, "Hentet samtaler");

    res.json({ conversations: withCounts });
  } catch (error) {
    logger.error({ err: error }, "Feil ved henting av samtaler");
    res.status(500).json({ feil: "Kunne ikke hente samtaler" });
  }
});

// GET /api/ki/conversations/:id - Get one conversation
router.get("/:id", async (req, res) => {
  try {
    const conversation = await ChatConversation.findOne({
      _id: req.params.id,
      userId: req.user!.id,
    }).lean();

    if (!conversation) {
      return res.status(404).json({ feil: "Samtale ikke funnet" });
    }

    logger.info({ userId: req.user!.id, conversationId: req.params.id }, "Hentet samtale");

    res.json({ conversation });
  } catch (error) {
    logger.error({ err: error }, "Feil ved henting av samtale");
    res.status(500).json({ feil: "Kunne ikke hente samtale" });
  }
});

// POST /api/ki/conversations - Create new conversation
router.post("/", async (req, res) => {
  try {
    const { title, messages } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ feil: "Mangler meldinger" });
    }

    // Auto-generate title if not provided
    const conversationTitle =
      title ||
      messages.find((m: any) => m.role === "user")?.content.slice(0, 50) ||
      "Ny samtale";

    const conversation = new ChatConversation({
      userId: req.user!.id,
      title: conversationTitle,
      messages,
    });

    await conversation.save();

    logger.info({ userId: req.user!.id, conversationId: conversation._id }, "Opprettet samtale");

    res.json({ conversation });
  } catch (error) {
    logger.error({ err: error }, "Feil ved oppretting av samtale");
    res.status(500).json({ feil: "Kunne ikke opprette samtale" });
  }
});

// PUT /api/ki/conversations/:id - Update conversation (add messages)
router.put("/:id", async (req, res) => {
  try {
    const { messages } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ feil: "Mangler meldinger" });
    }

    const conversation = await ChatConversation.findOneAndUpdate(
      { _id: req.params.id, userId: req.user!.id },
      {
        $push: { messages: { $each: messages } },
        updatedAt: new Date(),
      },
      { new: true }
    );

    if (!conversation) {
      return res.status(404).json({ feil: "Samtale ikke funnet" });
    }

    logger.info({ userId: req.user!.id, conversationId: req.params.id }, "Oppdatert samtale");

    res.json({ conversation });
  } catch (error) {
    logger.error({ err: error }, "Feil ved oppdatering av samtale");
    res.status(500).json({ feil: "Kunne ikke oppdatere samtale" });
  }
});

// DELETE /api/ki/conversations/:id - Delete conversation
router.delete("/:id", async (req, res) => {
  try {
    const result = await ChatConversation.deleteOne({
      _id: req.params.id,
      userId: req.user!.id,
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({ feil: "Samtale ikke funnet" });
    }

    logger.info({ userId: req.user!.id, conversationId: req.params.id }, "Slettet samtale");

    res.json({ suksess: true });
  } catch (error) {
    logger.error({ err: error }, "Feil ved sletting av samtale");
    res.status(500).json({ feil: "Kunne ikke slette samtale" });
  }
});

export default router; 