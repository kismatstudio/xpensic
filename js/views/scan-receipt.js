// Scan Receipt — photograph or upload a bill, read it on the device, and
// record it as an expense after the user confirms.
//
// Flow (all inside one modal):
//   1. Pick   — "Take a photo" (camera on phones) or "Choose from gallery /
//               files". Drag-and-drop works on desktop.
//   2. Read   — the image is cleaned up and run through Tesseract.js (OCR)
//               by js/receipt-scan.js. It runs in the browser: the bill never
//               leaves the device, which keeps the app's end-to-end-encrypted
//               promise.
//   3. Review — js/receipt.js turns the text into the final payable amount,
//               date, merchant, items and a category chosen from the products.
//               The result is shown in the normal expense form so the user
//               can correct anything and add an optional Note before saving.

import { openModal } from "../components/modal.js?v=31";
import { buildExpenseForm } from "./expense-form.js?v=31";
import { escapeHtml } from "../util.js?v=31";
import {
  readReceiptFile, isEmptyScan, buildScanSummary, scanToExpense,
} from "../receipt-scan.js?v=31";

/**
 * @param {object} ctx
 * @param {object}   ctx.state    — app state (categories, settings)
 * @param {(value:object)=>void} ctx.onSave — persists the confirmed expense
 * @param {()=>void} [ctx.onManual] — opens the plain "Add expense" form
 */
export function openScanReceipt({ state, onSave, onManual }) {
  const categories = state.categories || [];
  const settings = state.settings || {};

  const body = document.createElement("div");
  body.className = "scan";
  const modal = openModal({ title: "Scan receipt", body, actions: [] });
  let closed = false;
  let scanId = 0; // bumped whenever a scan starts or is cancelled
  const origClose = modal.close;
  const closeAll = () => { closed = true; origClose(); };
  // Closing with ✕ / Esc / backdrop must also stop any scan in progress.
  new MutationObserver((_, obs) => {
    if (!document.body.contains(modal.el)) { closed = true; obs.disconnect(); }
  }).observe(document.body, { childList: true });

  function renderPicker(message = "") {
    body.innerHTML = `
      <p class="scan__lead">Take a photo of your bill or pick one from your gallery. We'll read the items,
      work out the final amount and suggest a category — you confirm before anything is saved.</p>
      ${message ? `<div class="scan__error" role="alert">${escapeHtml(message)}</div>` : ""}
      <div class="scan__drop" id="scan-drop">
        <div class="scan__actions">
          <button type="button" class="btn btn--primary scan__btn" id="scan-camera">
            <span aria-hidden="true">📷</span> Take a photo
          </button>
          <button type="button" class="btn scan__btn" id="scan-gallery">
            <span aria-hidden="true">🖼️</span> Choose from gallery / files
          </button>
        </div>
        <p class="scan__hint">or drop a bill image here</p>
      </div>
      <p class="scan__privacy">🔒 The bill is read on this device — the photo is not uploaded anywhere.</p>
      <input type="file" id="scan-input-camera" accept="image/*" capture="environment" hidden />
      <input type="file" id="scan-input-gallery" accept="image/*" hidden />
    `;
    const cam = body.querySelector("#scan-input-camera");
    const gal = body.querySelector("#scan-input-gallery");
    body.querySelector("#scan-camera").addEventListener("click", () => cam.click());
    body.querySelector("#scan-gallery").addEventListener("click", () => gal.click());
    [cam, gal].forEach((input) => input.addEventListener("change", () => {
      const f = input.files && input.files[0];
      input.value = "";
      if (f) handleFile(f);
    }));
    const drop = body.querySelector("#scan-drop");
    ["dragenter", "dragover"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("is-over"); }));
    ["dragleave", "drop"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove("is-over"); }));
    drop.addEventListener("drop", (e) => {
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) handleFile(f);
    });
  }

  async function handleFile(file) {
    const myScan = ++scanId;
    const isCancelled = () => closed || myScan !== scanId;

    body.innerHTML = `
      <div class="scan__busy">
        <div class="scan__busy-text">
          <div class="scan__status" id="scan-status" aria-live="polite">Preparing…</div>
          <div class="scan__bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span id="scan-bar"></span></div>
          <p class="scan__hint">Reading the bill on your device. The first scan downloads the reader (about 10 MB) and can take a little longer.</p>
          <button type="button" class="btn btn--sm" id="scan-cancel">Cancel</button>
        </div>
      </div>
    `;
    const statusEl = body.querySelector("#scan-status");
    const barEl = body.querySelector("#scan-bar");
    const barWrap = body.querySelector(".scan__bar");
    body.querySelector("#scan-cancel").addEventListener("click", () => { scanId++; renderPicker(); });
    const onProgress = (p, text) => {
      if (isCancelled() || !statusEl.isConnected) return;
      const pct = Math.round(Math.max(0, Math.min(1, p)) * 100);
      barEl.style.width = pct + "%";
      barWrap.setAttribute("aria-valuenow", String(pct));
      if (text) statusEl.textContent = text;
    };

    let scanned;
    try {
      scanned = await readReceiptFile(file, onProgress, isCancelled, { categories, expenses: state.expenses });
    } catch (err) {
      if (isCancelled()) return;
      // Bad file choices go back to the picker; engine problems offer a retry.
      if (err.code === "not-image" || err.code === "too-big" || err.code === "decode") renderPicker(err.message);
      else renderFailure(err.message);
      return;
    }
    if (isCancelled() || !scanned) return;
    renderReview(scanned.result, scanned.thumb);
  }

  function renderFailure(message) {
    body.innerHTML = `
      <div class="scan__error" role="alert">${escapeHtml(message)}</div>
      <div class="scan__footer">
        ${onManual ? `<button type="button" class="btn" id="scan-manual">Enter manually</button>` : ""}
        <button type="button" class="btn btn--primary" id="scan-retry">Try again</button>
      </div>
    `;
    body.querySelector("#scan-retry").addEventListener("click", () => renderPicker());
    body.querySelector("#scan-manual")?.addEventListener("click", () => { closeAll(); onManual(); });
  }

  function renderReview(r, thumb) {
    if (isEmptyScan(r)) {
      renderFailure("We couldn't read any text on this image. Make sure the bill is flat, well lit and fills the frame, then try again.");
      return;
    }

    const form = buildExpenseForm({ categories, settings, expenses: state.expenses, expense: scanToExpense(r, categories) });
    form.setAttribute("aria-label", "Confirm scanned expense");
    // A bill that only says "UPI" doesn't tell us the app: leave it unset so
    // the user picks it rather than saving a guess.
    if (r.payment.paymentMethod === "upi" && !r.payment.upiApp) {
      const upi = form.querySelector("#exp-upiApp");
      if (upi) upi.value = "";
    }
    // This flow has its own scan step: drop the voice + attachment controls.
    form.querySelector(".voice-entry")?.remove();
    form.querySelector("#exp-receipt")?.closest(".field")?.remove();

    const head = buildScanSummary({
      result: r, thumb, settings, categories,
      onPickAmount: (amount) => {
        const input = form.querySelector("#exp-amount");
        if (input) {
          input.value = String(amount);
          input.dispatchEvent(new Event("input", { bubbles: true }));
        }
      },
    });

    const footer = document.createElement("div");
    footer.className = "scan__footer";
    footer.innerHTML = `
      <button type="button" class="btn" id="scan-again">Scan another</button>
      <button type="button" class="btn btn--primary" id="scan-save">Add expense</button>
    `;
    footer.querySelector("#scan-again").addEventListener("click", () => renderPicker());
    footer.querySelector("#scan-save").addEventListener("click", () => {
      const res = form.readValues();
      if (!res.ok) return; // errors are shown inside the form
      onSave(res.value);
      closeAll();
    });
    form.addEventListener("submit", (e) => { e.preventDefault(); footer.querySelector("#scan-save").click(); });

    body.innerHTML = "";
    body.append(head, form, footer);
    // Land on the optional Note so the user is nudged to add context.
    const note = form.querySelector("#exp-note");
    if (note && matchMedia("(pointer: fine)").matches) note.focus();
  }

  renderPicker();
}
