// Stub for the encrypted-blob router. The real implementation will
// store AEAD ciphertext blobs (avatars, recovery bundles, etc.).
// Until then, every endpoint returns 501.

import express from "express";
export const blobsRouter = express.Router();
blobsRouter.all(/.*/, (_req, res) => res.status(501).json({ ok: false, error: "Encrypted blobs not yet implemented." }));