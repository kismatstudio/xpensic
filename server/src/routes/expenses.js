// Per-user expense routes. Each route reads/writes expenses.csv via the
// db.js CRUD helpers. All routes require auth (mounted under
// authRequired in server.js).

import { Router } from "express";
import { newId } from "../ids.js";
import {
  listExpenses,
  addExpense,
  updateExpense,
  deleteExpense,
} from "../db.js";

export const expensesRouter = Router();

function validateExpense(body) {
  const e = body || {};
  if (typeof e.amount !== "number" || e.amount < 0) return "Invalid amount.";
  if (typeof e.date !== "string" || !e.date) return "Date is required.";
  if (typeof e.categoryId !== "string" || !e.categoryId) return "Category is required.";
  if (typeof e.paymentMethod !== "string" || !e.paymentMethod) return "Payment method is required.";
  return null;
}

// GET /api/expenses — list all expenses for the current user.
expensesRouter.get("/", (req, res) => {
  res.json({ ok: true, expenses: listExpenses(req.user.userId) });
});

// POST /api/expenses — add a new expense.
expensesRouter.post("/", (req, res) => {
  const err = validateExpense(req.body);
  if (err) return res.status(400).json({ ok: false, error: err });
  const now = new Date().toISOString();
  const expense = addExpense(req.user.userId, {
    id: newId("exp"),
    amount: req.body.amount,
    date: req.body.date,
    categoryId: req.body.categoryId,
    note: req.body.note || "",
    time: req.body.time || "",
    paymentMethod: req.body.paymentMethod,
    upiApp: req.body.paymentMethod === "upi" ? (req.body.upiApp || "") : "",
    createdAt: now,
    updatedAt: now,
  });
  return res.json({ ok: true, expense });
});

// PUT /api/expenses/:id — replace a single expense.
expensesRouter.put("/:id", (req, res) => {
  const err = validateExpense(req.body);
  if (err) return res.status(400).json({ ok: false, error: err });
  const updated = updateExpense(req.user.userId, req.params.id, {
    amount: req.body.amount,
    date: req.body.date,
    categoryId: req.body.categoryId,
    note: req.body.note || "",
    time: req.body.time || "",
    paymentMethod: req.body.paymentMethod,
    upiApp: req.body.paymentMethod === "upi" ? (req.body.upiApp || "") : "",
  });
  if (!updated) return res.status(404).json({ ok: false, error: "Expense not found." });
  return res.json({ ok: true, expense: updated });
});

// DELETE /api/expenses/:id — remove a single expense.
expensesRouter.delete("/:id", (req, res) => {
  const ok = deleteExpense(req.user.userId, req.params.id);
  if (!ok) return res.status(404).json({ ok: false, error: "Expense not found." });
  return res.json({ ok: true });
});