// Per-user budget + settings routes.
//
// Budgets are stored as flat rows in budgets.csv (one row per
// user+month+category) but the client expects the nested
// { monthly: { "2026-07": { cat_food: 400 } } } shape. db.js handles
// the reassembly on read and the flattening on write.
//
// Settings (currency, theme, date format) are stored inside the user's
// blob in blobs.csv — they're small and rarely change, so keeping them
// in the blob is simpler than a separate table.

import { Router } from "express";
import { getBudgets, setBudgets, getSettings, setSettings } from "../db.js";

export const budgetsRouter = Router();
export const settingsRouter = Router();

// GET /api/budgets — returns { monthly: { "2026-07": { cat_food: 400 } } }
budgetsRouter.get("/", (req, res) => {
  res.json({ ok: true, budgets: getBudgets(req.user.userId) });
});

// PUT /api/budgets — replaces all of the user's budget rows.
// Body: { monthly: { "2026-07": { cat_food: 400, cat_transport: 150 } } }
budgetsRouter.put("/", (req, res) => {
  const body = req.body || {};
  if (!body.monthly || typeof body.monthly !== "object") {
    return res.status(400).json({ ok: false, error: "Body must have a 'monthly' object." });
  }
  setBudgets(req.user.userId, body);
  return res.json({ ok: true, budgets: getBudgets(req.user.userId) });
});

// GET /api/settings — returns the settings object.
settingsRouter.get("/", (req, res) => {
  const settings = getSettings(req.user.userId);
  if (!settings) return res.json({ ok: true, settings: {} });
  return res.json({ ok: true, settings });
});

// PUT /api/settings — merges a patch into the settings object.
settingsRouter.put("/", (req, res) => {
  const patch = req.body || {};
  if (typeof patch !== "object" || Array.isArray(patch)) {
    return res.status(400).json({ ok: false, error: "Settings must be an object." });
  }
  const settings = setSettings(req.user.userId, patch);
  return res.json({ ok: true, settings });
});