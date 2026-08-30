// Per-user data route — GET only. Assembles the full v5 blob from the
// per-table CSV stores so the client can hydrate on boot with a single
// request. PUT /api/data has been removed; the client now pushes
// mutations through the per-resource endpoints (/api/expenses,
// /api/categories, /api/budgets, /api/settings, /api/auth/profile).

import { Router } from "express";
import { getAssembledBlob } from "../d1.js";

export const dataRouter = Router();

// GET /api/data — returns the full v5 blob for the current user.
dataRouter.get("/", async (req, res) => {
  const blob = await getAssembledBlob(req.user.userId);
  return res.json({ ok: true, data: blob });
});
