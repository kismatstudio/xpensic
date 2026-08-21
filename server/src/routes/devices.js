// Stub for the multi-device registry router. The real implementation
// will list / add / revoke devices that hold wrapped master keys.
// Until then, every endpoint returns 501.

import express from "express";
export const devicesRouter = express.Router();
devicesRouter.all(/.*/, (_req, res) => res.status(501).json({ ok: false, error: "Device registry not yet implemented." }));