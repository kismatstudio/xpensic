// Feedback System — floating "Share Feedback" button + multi-step modal.
//
// Flow:
//   1. Floating glassmorphism button (bottom-right) opens the modal.
//   2. Modal step 1: pick a feedback type (bug / feature / feedback).
//   3. Modal step 2: subject + description form.
//   4. Submit → POST /api/feedback → success confirmation.
//
// The module is self-contained: it builds its own modal (reusing the
// existing .modal / .btn / .field design tokens) so the multi-step flow
// isn't forced through the single-action openModal() helper. Toasts come
// from the shared toast component.

import { Feedback } from "./api.js?v=31";
import { toast } from "./components/toast.js?v=31";
import { escapeHtml } from "./util.js?v=31";

const APP_VERSION = "1.0.0";

const TYPES = [
  { id: "bug",      icon: "🐞", label: "Report a Bug",        hint: "Something isn't working as expected" },
  { id: "feature",  icon: "💡", label: "Suggest a Feature",   hint: "An idea to make Xpensic better" },
  { id: "feedback", icon: "💬", label: "Feedback",            hint: "General thoughts on your experience" },
];

const TYPE_LABEL = Object.fromEntries(TYPES.map((t) => [t.id, t.label]));

// --- Metadata ---------------------------------------------------------------

function detectDeviceType() {
  const ua = navigator.userAgent || "";
  if (/iPad|Tablet|Android(?!.*Mobile)/i.test(ua)) return "tablet";
  if (/Mobi|Android|iPhone|iPod/i.test(ua)) return "mobile";
  return "desktop";
}

function detectBrowser() {
  const ua = navigator.userAgent || "";
  if (/Edg\//i.test(ua)) return "Edge";
  if (/OPR\/|Opera/i.test(ua)) return "Opera";
  if (/Chrome\//i.test(ua)) return "Chrome";
  if (/Firefox\//i.test(ua)) return "Firefox";
  if (/Safari\//i.test(ua)) return "Safari";
  return "Unknown";
}

function currentPage() {
  const raw = (window.location.hash || "").replace(/^#\/?/, "");
  return raw || "dashboard";
}

function collectMetadata() {
  return {
    currentPage: currentPage(),
    browser: detectBrowser(),
    deviceType: detectDeviceType(),
    appVersion: APP_VERSION,
  };
}

// --- Floating button --------------------------------------------------------

/**
 * Mount the floating "Share Feedback" button (bottom-right). Safe to call
 * once; returns the button element. The button is hidden while the app is
 * locked (login gate) via CSS (body.app-locked .feedback-fab).
 */
export function mountFeedbackButton() {
  if (document.getElementById("feedback-fab")) return document.getElementById("feedback-fab");

  const fab = document.createElement("button");
  fab.type = "button";
  fab.id = "feedback-fab";
  fab.className = "feedback-fab";
  fab.setAttribute("aria-label", "Share feedback");
  fab.setAttribute("title", "Share Feedback");

  // Chat bubble icon — emoji for consistency with the label.
  const icon = document.createElement("span");
  icon.className = "feedback-fab__icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = "💬";

  const label = document.createElement("span");
  label.className = "feedback-fab__label";
  label.textContent = "Feedback";

  fab.append(icon, label);
  fab.addEventListener("click", openFeedbackModal);
  document.body.appendChild(fab);
  return fab;
}

// --- Modal ------------------------------------------------------------------

let activeModal = null;

function closeModal() {
  if (!activeModal) return;
  const overlay = activeModal;
  activeModal = null;
  overlay.remove();
  document.removeEventListener("keydown", onModalKey);
}

function onModalKey(e) {
  if (e.key === "Escape") closeModal();
}

function buildOverlay() {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay feedback-modal-overlay";
  overlay.setAttribute("role", "presentation");
  document.body.appendChild(overlay);
  activeModal = overlay;
  document.addEventListener("keydown", onModalKey);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal();
  });
  return overlay;
}

function buildHeader(title) {
  const header = document.createElement("header");
  header.className = "modal__header";
  const h = document.createElement("h2");
  h.className = "modal__title";
  h.textContent = title;
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "icon-btn";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.textContent = "×";
  closeBtn.addEventListener("click", closeModal);
  header.append(h, closeBtn);
  return header;
}

/**
 * Open the feedback modal. Only shows if the user is authenticated (the
 * app shell is mounted). Returns immediately if already open.
 */
export function openFeedbackModal() {
  if (activeModal) return;

  const overlay = buildOverlay();
  const dialog = document.createElement("div");
  dialog.className = "modal feedback-modal";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.tabIndex = -1;

  const header = buildHeader("💡 Help Us Improve Xpensic");
  const body = document.createElement("div");
  body.className = "modal__body feedback-modal__body";

  dialog.append(header, body);
  overlay.appendChild(dialog);

  renderTypePicker(body);
  requestAnimationFrame(() => dialog.focus());
}

// --- Step 1: type picker ----------------------------------------------------

function renderTypePicker(body) {
  body.innerHTML = `
    <p class="feedback-modal__intro">What would you like to share with us?</p>
    <div class="feedback-type-grid" role="radiogroup" aria-label="Feedback type">
      ${TYPES.map((t) => `
        <button type="button" class="feedback-type-card" data-type="${t.id}" role="radio" aria-checked="false">
          <span class="feedback-type-card__icon" aria-hidden="true">${t.icon}</span>
          <span class="feedback-type-card__label">${escapeHtml(t.label)}</span>
          <span class="feedback-type-card__hint">${escapeHtml(t.hint)}</span>
        </button>`).join("")}
    </div>
  `;

  const cards = [...body.querySelectorAll(".feedback-type-card")];
  cards.forEach((card) => {
    card.addEventListener("click", () => {
      cards.forEach((c) => {
        c.classList.remove("is-selected");
        c.setAttribute("aria-checked", "false");
      });
      card.classList.add("is-selected");
      card.setAttribute("aria-checked", "true");
      const type = card.dataset.type;
      renderForm(body, type);
    });
  });
}

// --- Step 2: form -----------------------------------------------------------

function renderForm(body, type) {
  const typeMeta = TYPES.find((t) => t.id === type);
  body.innerHTML = `
    <div class="feedback-form">
      <div class="feedback-form__type">
        <button type="button" class="feedback-form__back" aria-label="Change feedback type">←</button>
        <span class="feedback-form__type-badge">${typeMeta.icon} ${escapeHtml(typeMeta.label)}</span>
      </div>

      <div class="field">
        <label class="field__label" for="feedback-subject">Subject</label>
        <input class="field__input" id="feedback-subject" type="text" maxlength="120"
               placeholder="Short summary of your ${typeMeta.id === "bug" ? "issue" : typeMeta.id === "feature" ? "idea" : "thought"}"
               autocomplete="off" required />
        <p class="field__error" id="feedback-subject-error" hidden></p>
      </div>

      <div class="field">
        <label class="field__label" for="feedback-description">Description</label>
        <textarea class="field__textarea" id="feedback-description" rows="5" maxlength="4000"
                  placeholder="Tell us more…" required></textarea>
        <p class="field__error" id="feedback-description-error" hidden></p>
      </div>

      <div class="feedback-form__actions">
        <button type="button" class="btn feedback-form__cancel">Cancel</button>
        <button type="button" class="btn btn--primary feedback-form__submit">Submit Feedback</button>
      </div>
    </div>
  `;

  const subject = body.querySelector("#feedback-subject");
  const description = body.querySelector("#feedback-description");
  const subjectErr = body.querySelector("#feedback-subject-error");
  const descriptionErr = body.querySelector("#feedback-description-error");

  body.querySelector(".feedback-form__back").addEventListener("click", () => renderTypePicker(body));
  body.querySelector(".feedback-form__cancel").addEventListener("click", closeModal);

  const clearErrors = () => {
    subjectErr.hidden = true;
    descriptionErr.hidden = true;
  };
  subject.addEventListener("input", clearErrors);
  description.addEventListener("input", clearErrors);

  body.querySelector(".feedback-form__submit").addEventListener("click", async () => {
    const subjectVal = subject.value.trim();
    const descriptionVal = description.value.trim();
    let valid = true;

    if (!subjectVal) {
      subjectErr.textContent = "Please enter a subject.";
      subjectErr.hidden = false;
      valid = false;
    }
    if (!descriptionVal) {
      descriptionErr.textContent = "Please describe your feedback.";
      descriptionErr.hidden = false;
      valid = false;
    }
    if (!valid) return;

    const submitBtn = body.querySelector(".feedback-form__submit");
    submitBtn.disabled = true;
    submitBtn.textContent = "Submitting…";

    try {
      await Feedback.submit({
        type,
        subject: subjectVal,
        description: descriptionVal,
        userName: currentUserName(),
        ...collectMetadata(),
      });
      renderSuccess(body);
    } catch (err) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Submit Feedback";
      toast("Couldn't submit your feedback: " + (err?.message || "please try again."), "error", 5000);
    }
  });

  requestAnimationFrame(() => subject.focus());
}

function currentUserName() {
  try {
    return window.__xpensicProfileName || "";
  } catch {
    return "";
  }
}

// --- Step 3: success --------------------------------------------------------

function renderSuccess(body) {
  body.innerHTML = `
    <div class="feedback-success" role="status">
      <div class="feedback-success__icon" aria-hidden="true">✅</div>
      <h3 class="feedback-success__title">Thank You!</h3>
      <p class="feedback-success__text">Your feedback has been submitted successfully.</p>
      <p class="feedback-success__sub">We appreciate your help in improving Xpensic.</p>
      <button type="button" class="btn btn--primary feedback-success__done">Done</button>
    </div>
  `;

  body.querySelector(".feedback-success__done").addEventListener("click", closeModal);

  // Auto-close after a few seconds.
  setTimeout(() => {
    if (activeModal && activeModal.contains(body)) closeModal();
  }, 4000);
}