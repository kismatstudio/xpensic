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
} from "../db.js";

export const splitsRouter = Router();

// GET /api/splits — returns the full splits array for the current user.
splitsRouter.get("/", (req, res) => {
  res.json({ ok: true, splits: listSplits(req.user.userId) });
});

// POST /api/splits — create a new split. Body: { title, total, participants, ... }.
splitsRouter.post("/", (req, res) => {
  const body = req.body || {};
  if (!body || typeof body !== "object") {
    return res.status(400).json({ ok: false, error: "Body must be an object." });
  }
  if (!body.id) {
    return res.status(400).json({ ok: false, error: "Split must have an id." });
  }
  const row = addSplit(req.user.userId, body);
  return res.json({ ok: true, split: row });
});

// PUT /api/splits/:id — replace one split's fields.
splitsRouter.put("/:id", (req, res) => {
  const id = req.params.id;
  const patch = req.body || {};
  const updated = updateSplit(req.user.userId, id, patch);
  if (!updated) {
    return res.status(404).json({ ok: false, error: "Split not found." });
  }
  return res.json({ ok: true, split: updated });
});

// DELETE /api/splits/:id — remove one split.
splitsRouter.delete("/:id", (req, res) => {
  const id = req.params.id;
  const ok = deleteSplit(req.user.userId, id);
  if (!ok) {
    return res.status(404).json({ ok: false, error: "Split not found." });
  }
  return res.json({ ok: true });
});