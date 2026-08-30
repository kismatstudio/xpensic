// Per-user splits routes (Feature 5 persistence).
//
// Each split is a self-contained record stored in splits.csv. We
// expose a tiny CRUD surface that mirrors the per-resource endpoints
// the client already uses for /api/expenses and /api/categories.
//
// Endpoints:
//   GET    /api/splits         — list every split for the signed-in user
//   POST   /api/splits         — create a new split
//   PUT    /api/splits/:id     — replace one split's fields
//   DELETE /api/splits/:id     — remove one split

import { Router } from "express";
import {
  listSplits,
  addSplit,
  updateSplit,
  deleteSplit,
} from "../d1.js";

export const splitsRouter = Router();

// GET /api/splits — returns the full splits array for the current user.
splitsRouter.get("/", async (req, res) => {
  res.json({ ok: true, splits: await listSplits(req.user.userId) });
});

// POST /api/splits — create a new split. Body: { title, total, participants, ... }.
splitsRouter.post("/", async (req, res) => {
  const body = req.body || {};
  if (!body || typeof body !== "object") {
    return res.status(400).json({ ok: false, error: "Body must be an object." });
  }
  if (!body.id) {
    return res.status(400).json({ ok: false, error: "Split must have an id." });
  }
  const row = await addSplit(req.user.userId, body);
  return res.json({ ok: true, split: row });
});

// PUT /api/splits/:id — replace one split's fields.
splitsRouter.put("/:id", async (req, res) => {
  const id = req.params.id;
  const patch = req.body || {};
  const updated = await updateSplit(req.user.userId, id, patch);
  if (!updated) {
    return res.status(404).json({ ok: false, error: "Split not found." });
  }
  return res.json({ ok: true, split: updated });
});

// DELETE /api/splits/:id — remove one split.
splitsRouter.delete("/:id", async (req, res) => {
  const id = req.params.id;
  const ok = await deleteSplit(req.user.userId, id);
  if (!ok) {
    return res.status(404).json({ ok: false, error: "Split not found." });
  }
  return res.json({ ok: true });
});