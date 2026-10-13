// Receipt scanning engine shared by the sidebar "Scan Receipt" popup and the
// "Receipt (optional)" field of the Add Expense form.
//
//   readReceiptFile(file, …)  image → OCR → parsed receipt (see receipt.js)
//   buildScanSummary(…)       the "what we found" panel shown after a scan
//   applyScanToForm(…)        fills an expense form from a scan result
//
// OCR runs in the browser with Tesseract.js, so the bill image never leaves
// the device (the app's data is end-to-end encrypted).

import { parseReceipt } from "./receipt.js?v=31";
import { classifyText } from "./categorize.js?v=31";
import { escapeHtml, todayISO, currentTimeHHMM } from "./util.js?v=31";
import { formatCurrency } from "./format.js?v=31";

const TESSERACT_SRC = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
const TESSERACT_SRI = "sha384-GJqSu7vueQ9qN0E9yLPb3Wtpd7OrgK8KmYzC8T1IysG1bcvxvIO4qtYR/D3A991F";
export const MAX_FILE_BYTES = 15 * 1024 * 1024;

// ---------------------------------------------------------------------------
// OCR engine (loaded on first use)
// ---------------------------------------------------------------------------

let tesseractPromise = null;

function loadTesseract() {
  if (typeof window !== "undefined" && window.Tesseract) return Promise.resolve(window.Tesseract);
  if (!tesseractPromise) {
    tesseractPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = TESSERACT_SRC;
      s.integrity = TESSERACT_SRI;
      s.crossOrigin = "anonymous";
      s.async = true;
      s.onload = () => (window.Tesseract ? resolve(window.Tesseract) : reject(new Error("scanner-load")));
      s.onerror = () => { tesseractPromise = null; s.remove(); reject(new Error("scanner-load")); };
      document.head.appendChild(s);
    });
  }
  return tesseractPromise;
}

// ---------------------------------------------------------------------------
// Image preparation
// ---------------------------------------------------------------------------

async function decodeImage(file) {
  try {
    // Honours the EXIF orientation, so photos taken in portrait aren't sideways.
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    // Older browsers: decode through an <img>.
    return await new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("decode")); };
      img.src = url;
    });
  }
}

/**
 * Scales the photo to a size OCR reads well (long side ≤ 2400px, text at
 * least ~1400px wide), converts to greyscale and stretches the contrast so
 * faded thermal-paper print stands out.
 * `mode: "plain"` keeps greyscale only; `"binary"` adds a threshold for a
 * second-opinion pass on low-contrast bills.
 */
function prepareCanvas(source, mode = "plain") {
  const sw = source.width;
  const sh = source.height;
  let scale = 1;
  const longSide = Math.max(sw, sh);
  if (longSide > 2400) scale = 2400 / longSide;
  else if (sw < 1400) scale = Math.min(2, 1400 / sw);
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(source, 0, 0, w, h);

  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) {
    const g = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 | 0;
    d[i] = d[i + 1] = d[i + 2] = g;
    hist[g]++;
  }
  // Percentile stretch (2% … 98%) so one dark corner doesn't flatten the text.
  const total = w * h;
  let lo = 0;
  let hi = 255;
  for (let acc = 0; lo < 255; lo++) { acc += hist[lo]; if (acc > total * 0.02) break; }
  for (let acc = 0; hi > 0; hi--) { acc += hist[hi]; if (acc > total * 0.02) break; }
  if (hi - lo < 30) { lo = 0; hi = 255; }
  const range = hi - lo;
  const mid = lo + range * 0.55;
  for (let i = 0; i < d.length; i += 4) {
    let v = ((d[i] - lo) * 255) / range;
    v = v < 0 ? 0 : v > 255 ? 255 : v;
    if (mode === "binary") v = d[i] > mid ? 255 : 0;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function thumbnailUrl(source) {
  const max = 160;
  const scale = Math.min(1, max / Math.max(source.width, source.height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(source.width * scale));
  c.height = Math.max(1, Math.round(source.height * scale));
  c.getContext("2d").drawImage(source, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.7);
}

// ---------------------------------------------------------------------------
// Recognition
// ---------------------------------------------------------------------------

function rank(p) {
  const c = { high: 3, medium: 2, low: 1 }[p.totalConfidence] || 0;
  return (p.total != null ? 10 : 0) + c + Math.min(p.items.length, 5) * 0.1;
}

/**
 * Runs OCR. A first pass reads the greyscale image; if the bill's total
 * isn't found with high confidence, a second pass (thresholded image,
 * different page-segmentation mode) is tried and the better parse wins.
 */
async function recognizeReceipt(bitmap, onProgress, isCancelled) {
  onProgress(0.02, "Loading the scanner…");
  const Tesseract = await loadTesseract();
  if (isCancelled()) return null;

  let phase = 0;
  const phases = 2; // upper bound; the bar simply fills within the current phase
  const worker = await Tesseract.createWorker("eng", 1, {
    logger: (m) => {
      if (m.status === "recognizing text") {
        onProgress(0.1 + 0.8 * ((phase + m.progress) / phases), "Reading the bill…");
      } else if (/loading|initializ/i.test(m.status || "")) {
        onProgress(0.05 + 0.05 * (m.progress || 0), "Preparing the scanner…");
      }
    },
  });
  try {
    const attempts = [
      { mode: "plain", psm: "4" },
      { mode: "binary", psm: "6" },
    ];
    let best = null;
    for (const a of attempts) {
      if (isCancelled()) return null;
      await worker.setParameters({
        tessedit_pageseg_mode: a.psm,
        preserve_interword_spaces: "1",
      });
      const canvas = prepareCanvas(bitmap, a.mode);
      const { data } = await worker.recognize(canvas);
      const parsed = parseReceipt(data.text || "");
      parsed.rawText = data.text || "";
      if (!best || rank(parsed) > rank(best)) best = parsed;
      if (best.total != null && best.totalConfidence === "high") break;
      phase += 1;
    }
    onProgress(1, "Done");
    return best;
  } finally {
    worker.terminate().catch(() => {});
  }
}

function scanError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/**
 * Validates, decodes and reads a bill image.
 * @param {File} file
 * @param {(fraction:number, text:string)=>void} onProgress
 * @param {()=>boolean} isCancelled
 * @param {{categories?:Array, expenses?:Array}} [ctx] the user's categories / past expenses,
 *        used to refine the category the same way typed notes are classified
 * @returns {Promise<{ result: object, thumb: string } | null>}  null when cancelled
 * @throws Error with `.code` ("not-image" | "too-big" | "decode" | "scanner-load" | "failed")
 *         and a user-friendly `.message`
 */
export async function readReceiptFile(file, onProgress = () => {}, isCancelled = () => false, ctx = {}) {
  if (!/^image\//.test(file.type) && !/\.(jpe?g|png|webp|heic|heif|bmp|gif)$/i.test(file.name || "")) {
    throw scanError("not-image", "That file isn't an image. Please choose a photo of the bill (JPG, PNG or WebP).");
  }
  if (file.size > MAX_FILE_BYTES) {
    throw scanError("too-big", "That image is larger than 15 MB. Please choose a smaller photo.");
  }
  let bitmap;
  try {
    bitmap = await decodeImage(file);
  } catch {
    throw scanError("decode", "This image format can't be opened here. Try a JPG or PNG photo (iPhone HEIC photos: choose “Most Compatible” in camera settings).");
  }
  const thumb = thumbnailUrl(bitmap);
  let result;
  try {
    result = await recognizeReceipt(bitmap, onProgress, isCancelled);
  } catch (err) {
    if (isCancelled()) return null;
    if (err && err.message === "scanner-load") {
      throw scanError("scanner-load", "The scanner couldn't be loaded. Check your internet connection and try again.");
    }
    throw scanError("failed", "Something went wrong while reading the bill. Please try again with a clearer photo.");
  }
  if (isCancelled() || !result) return null;
  refineCategory(result, ctx);
  return { result, thumb };
}

/**
 * The receipt classifier reads the whole bill; the shared note classifier adds
 * what the user has taught the app (a shop they always file under a category)
 * and their own category names. If those are confident, they win.
 */
function refineCategory(r, { categories, expenses } = {}) {
  if (!Array.isArray(categories) || categories.length === 0) return;
  const text = [r.merchant, ...r.items.slice(0, 8).map((i) => i.name)].filter(Boolean).join(" ");
  const m = classifyText(text, { categories, expenses });
  if (m && (m.source === "history" || m.source === "name") && m.confidence === "high") {
    r.categoryId = m.categoryId;
    r.categoryConfidence = "high";
    r.categoryMatched = m.matched;
  }
}

/** True when OCR found nothing usable at all. */
export function isEmptyScan(r) {
  return r.total == null && r.items.length === 0 && !r.merchant;
}

// ---------------------------------------------------------------------------
// Presentation helpers
// ---------------------------------------------------------------------------

export function resolveCategoryId(id, categories) {
  if (categories.some((c) => c.id === id)) return id;
  const other = categories.find((c) => c.id === "cat_other") ||
    categories.find((c) => /^other/i.test(c.name));
  return (other || categories[0] || {}).id || "";
}

/**
 * The "what we found" panel: merchant, detected final amount (with a
 * confidence note), alternative amounts, category reasoning and items.
 * @param {(amount:number)=>void} onPickAmount — called when an alternative chip is clicked
 */
export function buildScanSummary({ result: r, thumb, settings, categories, onPickAmount }) {
  const categoryId = resolveCategoryId(r.categoryId, categories);
  const cat = categories.find((c) => c.id === categoryId);

  const sure = r.total != null && r.totalConfidence === "high";
  const banner = r.total == null
    ? `<div class="scan__banner scan__banner--warn">We couldn't find the total on this bill — please enter the amount below.</div>`
    : sure
      ? `<div class="scan__banner scan__banner--ok">Final amount detected: <strong>${escapeHtml(formatCurrency(r.total, settings))}</strong></div>`
      : `<div class="scan__banner scan__banner--warn">We think the total is <strong>${escapeHtml(formatCurrency(r.total, settings))}</strong>, but we're not fully sure — please check it against your bill.</div>`;

  const alts = (r.otherAmounts || []).filter((v) => v !== r.total);
  const altsHtml = alts.length
    ? `<div class="scan__alts">Other amounts on the bill: ${alts.map((v) =>
        `<button type="button" class="scan__chip" data-amount="${v}">${escapeHtml(formatCurrency(v, settings))}</button>`).join("")}</div>`
    : "";

  const upiHint = r.payment.paymentMethod === "upi" && !r.payment.upiApp
    ? " The bill mentions UPI — please check which UPI app was used."
    : "";
  const why = r.categoryMatched.length
    ? `Category suggested from: ${escapeHtml(r.categoryMatched.join(", "))}.`
    : "We couldn't tell the category from the items — please pick one.";
  const items = r.items.slice(0, 14);

  const el = document.createElement("div");
  el.className = "scan__result";
  el.innerHTML = `
    <div class="scan__summary">
      <img class="scan__thumb scan__thumb--sm" src="${thumb}" alt="Scanned bill" />
      <div class="scan__summary-text">
        <div class="scan__merchant">${escapeHtml(r.merchant || "Scanned bill")}</div>
        ${banner}
      </div>
    </div>
    ${altsHtml}
    <p class="scan__why">${cat ? `${escapeHtml(cat.icon || "")} <strong>${escapeHtml(cat.name)}</strong> — ` : ""}${why}${escapeHtml(upiHint)}</p>
    ${items.length ? `
      <details class="scan__items">
        <summary>${r.items.length} item${r.items.length === 1 ? "" : "s"} detected</summary>
        <ul>${items.map((it) => `<li><span>${escapeHtml(it.name)}</span><span>${escapeHtml(formatCurrency(it.amount, settings))}</span></li>`).join("")}</ul>
      </details>` : ""}
  `;
  el.querySelectorAll(".scan__chip").forEach((chip) =>
    chip.addEventListener("click", () => onPickAmount(Number(chip.dataset.amount))));
  return el;
}

/** The prefilled `expense` object for buildExpenseForm (note stays blank). */
export function scanToExpense(r, categories) {
  return {
    amount: r.total != null ? r.total : "",
    date: r.date || todayISO(),
    time: r.time || currentTimeHHMM(),
    categoryId: resolveCategoryId(r.categoryId, categories),
    paymentMethod: r.payment.paymentMethod || "cash",
    upiApp: r.payment.upiApp || "",
    note: "",
  };
}
