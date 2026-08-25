// Per-user category routes. Each route reads/writes categories.csv via
// the db.js CRUD helpers. All routes require auth.

import { Router } from "express";
import { newId } from "../ids.js";
import {
  listCategories,
  addCategory,
  updateCategory,
  deleteCategory,
} from "../db.js";

export const categoriesRouter = Router();

function validateCategory(body) {
  const c = body || {};
  if (typeof c.name !== "string" || !c.name.trim()) return "Name is required.";
  if (typeof c.color !== "string" || !c.color) return "Color is required.";
  return null;
}

// GET /api/categories — list all categories for the current user.
categoriesRouter.get("/", (req, res) => {
  res.json({ ok: true, categories: listCategories(req.user.userId) });
});

// POST /api/categories — add a new category.
categoriesRouter.post("/", (req, res) => {
  const err = validateCategory(req.body);
  if (err) return res.status(400).json({ ok: false, error: err });
  const category = addCategory(req.user.userId, {
    // Honor a client-supplied id (same duplicate-prevention rationale
    // as the expenses route — the diff-sync keys rows by client ids).
    id: (typeof req.body.id === "string" && req.body.id) ? req.body.id : newId("cat"),
    name: req.body.name.trim(),
    color: req.body.color,
    icon: req.body.icon || "",
    isDefault: false,
    sortOrder: typeof req.body.sortOrder === "number" ? req.body.sortOrder : 0,
  });
  return res.json({ ok: true, category });
});

// PUT /api/categories/:id — replace a single category.
categoriesRouter.put("/:id", (req, res) => {
  const err = validateCategory(req.body);
  if (err) return res.status(400).json({ ok: false, error: err });
  const updated = updateCategory(req.user.userId, req.params.id, {
    name: req.body.name.trim(),
    color: req.body.color,
    icon: req.body.icon || "",
    isDefault: Boolean(req.body.isDefault),
    sortOrder: typeof req.body.sortOrder === "number" ? req.body.sortOrder : 0,
  });
  if (!updated) return res.status(404).json({ ok: false, error: "Category not found." });
  return res.json({ ok: true, category: updated });
});

// DELETE /api/categories/:id — remove a single category.
categoriesRouter.delete("/:id", (req, res) => {
  const ok = deleteCategory(req.user.userId, req.params.id);
  if (!ok) return res.status(404).json({ ok: false, error: "Category not found." });
  return res.json({ ok: true });
});