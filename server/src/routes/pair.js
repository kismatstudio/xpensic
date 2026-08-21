// Stub for the trusted-device pairing router. The real implementation
// will handle QR-pair flows and short-lived pairing codes. Until then,
// every endpoint returns 501.

import express from "express";
export const pairRouter = express.Router();
pairRouter.all(/.*/, (_req, res) => res.status(501).json({ ok: false, error: "Pairing not yet implemented." }));