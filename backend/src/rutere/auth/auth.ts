import { Router } from "express";
//import jwt from "jsonwebtoken";

const router = Router();

// TODO: Implementer JWT auth senere
// Placeholder endpoint
router.post("/login", (req, res) => {
  const { canvasToken, canvasUrl } = req.body;

  // Valider input
  if (!canvasToken || !canvasUrl) {
    return res.status(400).json({ error: "Canvas token og URL er påkrevd" });
  }

  // TODO: Verifiser token mot Canvas API
  // TODO: Generer JWT token
  // TODO: Returner JWT til klient

  res.json({ message: "Auth endpoint klar for implementering" });
});

export default router;
