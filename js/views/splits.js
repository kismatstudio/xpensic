// Splits view — local expense splitter (Feature 5).
//
// Two main actions:
//   1. **New split** — opens a modal with title, total, participants
//      (with optional per-person share weights + paid amounts), and
//      an optional friend code. Computes the per-head breakdown live.
//   2. **History** — lists every saved split with a per-row "open" to
//      see the full breakdown and a delete affordance.
//
// Friend codes: generated locally as a 6-char string. Without a backend
// the recipient still has to type the numbers in on their own device,
// but the code gives them a stable identifier to refer to.

import { Store } from "../store.js";
import { openModal } from "../components/modal.js";
import { toast } from "../components/toast.js";
import { escapeHtml } from "../util.js";
import { formatDate, formatCurrency } from "../format.js";
import {
  addSplit,
  deleteSplit,
  computeSplit,
  sumPaid,
  generateFriendCode,
} from "../splitter.js";

export function renderSplits(container, { state, refresh }) {
  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <div class="view-header">
      <h1 class="section-title">Splits</h1>
      <div class="view-header__actions">
        <button class="btn btn--primary" type="button" id="splits-new">+ New split</button>
      </div>
    </div>
    <p class="muted" style="margin-top:0">
      Split bills with friends, trips, or roommates. Saved locally —
      share the friend code so others can enter the same numbers on
      their device.
    </p>
    <div id="splits-list"></div>
  `;
  container.appendChild(wrap);

  wrap.querySelector("#splits-new").addEventListener("click", () => {
    openNewSplitModal({ state, onSaved: () => { renderList(); refresh(); } });
  });

  function renderList() {
    const host = wrap.querySelector("#splits-list");
    const splits = Array.isArray(state.splits) ? state.splits : [];
    if (splits.length === 0) {
      host.innerHTML = `
        <div class="card empty-state">
          <div class="empty-state__title">No splits yet</div>
          <div class="empty-state__body">
            Tap <strong>+ New split</strong> to break a bill down
            per head. Useful for trips, dinners, and roommates.
          </div>
        </div>
      `;
      return;
    }
    // Newest first.
    const ordered = splits.slice().sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    host.innerHTML = `
      <ul class="split-list" role="list">
        ${ordered.map((s) => renderSplitRow(s, state.settings)).join("")}
      </ul>
    `;
    // Wire per-row actions.
    host.querySelectorAll("[data-split-action]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.id;
        const action = btn.dataset.splitAction;
        if (action === "open") openSplitModal({ state, id, refresh, onChanged: renderList });
        else if (action === "delete") deleteSplitWithConfirm({ state, id, refresh, onChanged: renderList });
        else if (action === "copy-code") copyFriendCode(state, id);
      });
    });
  }

  renderList();
}

function renderSplitRow(s, settings) {
  const people = s.participants?.length || 0;
  const code = s.friendCode
    ? `<span class="split-list__code" title="Friend code">${escapeHtml(s.friendCode)}</span>`
    : "";
  return `
    <li class="split-list__item card" data-id="${s.id}">
      <div class="split-list__head">
        <div>
          <div class="split-list__title">${escapeHtml(s.title || "Untitled")}</div>
          <div class="muted" style="font-size:var(--text-xs)">
            ${escapeHtml(formatDate(s.createdAt?.slice(0, 10), settings))} ·
            ${people} ${people === 1 ? "person" : "people"}
          </div>
        </div>
        <div class="split-list__total">${formatCurrency(s.total, settings)}</div>
      </div>
      ${s.note ? `<div class="muted split-list__note">${escapeHtml(s.note)}</div>` : ""}
      <div class="split-list__actions">
        ${code}
        ${s.friendCode ? `<button class="btn btn--sm" type="button" data-split-action="copy-code" data-id="${s.id}">Copy code</button>` : ""}
        <button class="btn btn--sm" type="button" data-split-action="open" data-id="${s.id}">Open</button>
        <button class="btn btn--sm btn--danger" type="button" data-split-action="delete" data-id="${s.id}">Delete</button>
      </div>
    </li>
  `;
}

// --- New split modal ------------------------------------------------------

function openNewSplitModal({ state, onSaved }) {
  const form = document.createElement("form");
  form.className = "split-form";
  form.noValidate = true;
  form.innerHTML = `
    <div class="field">
      <label class="field__label" for="split-title">Title</label>
      <input class="field__input" id="split-title" type="text" maxlength="80"
             placeholder="Dinner at the Italian place" required />
      <div class="field__error" id="split-title-err" hidden></div>
    </div>
    <div class="field">
      <label class="field__label" for="split-total">Total amount</label>
      <input class="field__input" id="split-total" type="number" min="0" step="0.01"
             inputmode="decimal" placeholder="0" required />
      <div class="field__error" id="split-total-err" hidden></div>
    </div>
    <div class="field">
      <label class="field__label" for="split-note">Note <span class="muted">(optional)</span></label>
      <input class="field__input" id="split-note" type="text" maxlength="120"
             placeholder="Saturday dinner with the team" />
    </div>

    <div class="field">
      <div class="split-form__row-head">
        <span class="field__label">Participants</span>
        <button type="button" class="btn btn--sm" id="split-add-row">+ Add person</button>
      </div>
      <div id="split-rows"></div>
    </div>

    <div class="field">
      <label class="field__label" for="split-code">Friend code <span class="muted">(optional)</span></label>
      <div style="display:flex; gap:8px; align-items:center">
        <input class="field__input" id="split-code" type="text" maxlength="6"
               placeholder="Auto-generated" />
        <button type="button" class="btn btn--sm" id="split-code-gen">Generate</button>
      </div>
      <div class="field__hint muted">
        Share this code with friends so they can enter the same numbers on
        their device. Without a server it stays a verbal / screenshot identifier.
      </div>
    </div>

    <div class="split-form__preview" id="split-preview" hidden></div>
  `;

  const $rows = form.querySelector("#split-rows");
  function addRow(name = "", share = 1, paid = 0) {
    const row = document.createElement("div");
    row.className = "split-form__row";
    row.innerHTML = `
      <input class="field__input split-form__name" type="text" placeholder="Name" maxlength="40" />
      <input class="field__input split-form__share" type="number" min="0" step="0.5" value="${share}" title="Share weight (1 = equal)" />
      <input class="field__input split-form__paid"  type="number" min="0" step="0.01" value="${paid}" title="Amount paid by this person" placeholder="Paid" />
      <button type="button" class="icon-btn split-form__remove" aria-label="Remove person">×</button>
    `;
    row.querySelector(".split-form__name").value = name;
    row.querySelector(".split-form__remove").addEventListener("click", () => {
      row.remove();
      updatePreview();
    });
    // Re-render the preview whenever any field changes.
    row.querySelectorAll("input").forEach((i) => i.addEventListener("input", updatePreview));
    $rows.appendChild(row);
  }
  addRow("You", 1, 0);
  addRow("Friend 1", 1, 0);
  addRow("Friend 2", 1, 0);
  form.querySelector("#split-add-row").addEventListener("click", () => addRow("", 1, 0));

  form.querySelector("#split-code-gen").addEventListener("click", () => {
    form.querySelector("#split-code").value = generateFriendCode();
  });

  const $total = form.querySelector("#split-total");
  const $preview = form.querySelector("#split-preview");

  function collectParticipants() {
    return Array.from($rows.querySelectorAll(".split-form__row")).map((row) => ({
      name: row.querySelector(".split-form__name").value.trim(),
      share: Number(row.querySelector(".split-form__share").value) || 0,
      paid: Number(row.querySelector(".split-form__paid").value) || 0,
    })).filter((p) => p.name);
  }

  function updatePreview() {
    const total = Number($total.value) || 0;
    const ps = collectParticipants();
    if (ps.length === 0 || total <= 0) {
      $preview.hidden = true;
      return;
    }
    const rows = computeSplit(total, ps);
    const settings = state.settings;
    $preview.hidden = false;
    $preview.innerHTML = `
      <div class="split-form__preview-title">Per-head breakdown</div>
      <ul class="split-form__preview-list">
        ${rows.map((r) => {
          const net = r.paid - r.owes;
          const label = net > 0
            ? `is owed ${formatCurrency(net, settings)}`
            : net < 0
              ? `owes ${formatCurrency(-net, settings)}`
              : "is settled up";
          return `
          <li>
            <span>${escapeHtml(r.name)}</span>
            <span class="muted">share ×${r.share}</span>
            <strong>${label}</strong>
          </li>`;
        }).join("")}
      </ul>
      <div class="muted split-form__preview-foot">
        ${formatCurrency(sumPaid(ps), settings)} paid · ${ps.length} ${ps.length === 1 ? "person" : "people"} ·
        ${formatCurrency(total, settings)} total
      </div>
    `;
  }
  $total.addEventListener("input", updatePreview);

  openModal({
    title: "New split",
    body: form,
    actions: [
      { label: "Cancel", value: false, kind: "default" },
      { label: "Save split", value: true, kind: "primary" },
    ],
    onAction: (value) => {
      if (!value) return true;
      const title = form.querySelector("#split-title").value.trim();
      const total = Number(form.querySelector("#split-total").value) || 0;
      const note = form.querySelector("#split-note").value.trim();
      const code = form.querySelector("#split-code").value.trim().toUpperCase();
      const ps = collectParticipants();

      let bad = false;
      const $titleErr = form.querySelector("#split-title-err");
      const $totalErr = form.querySelector("#split-total-err");
      $titleErr.hidden = true; $titleErr.textContent = "";
      $totalErr.hidden = true; $totalErr.textContent = "";
      if (!title) {
        $titleErr.textContent = "Give your split a short title.";
        $titleErr.hidden = false;
        bad = true;
      }
      if (total <= 0) {
        $totalErr.textContent = "Enter a total amount greater than 0.";
        $totalErr.hidden = false;
        bad = true;
      }
      if (ps.length < 2) {
        toast("Add at least 2 participants", "error");
        bad = true;
      }
      if (ps.some((p) => p.share <= 0)) {
        toast("Each participant needs a share weight greater than 0", "error");
        bad = true;
      }
      if (bad) return false;

      const record = addSplit(state, { title, total, note, participants: ps, friendCode: code });
      Store.save(state);
      // Persist to the server immediately (splits have no offline-only
      // affordance — they need to round-trip through the server so the
      // user sees them again after signing out / back in). The Store
      // listener fires `syncToServer()` as well; we also push
      // directly so a network blip doesn't lose the row.
      const syncFn = typeof syncToServer === "function" ? syncToServer : null;
      if (syncFn) {
        // eslint-disable-next-line no-console
        console.log("[splits] saved", record.id, "→ triggering server sync");
        syncFn();
      } else {
        // eslint-disable-next-line no-console
        console.log("[splits] saved", record.id, "→ server sync unavailable");
      }
      toast("Split saved", "success");
      onSaved && onSaved();
      return true;
    },
  });
}

// --- Open + delete --------------------------------------------------------

function openSplitModal({ state, id, refresh, onChanged }) {
  const s = (state.splits || []).find((x) => x.id === id);
  if (!s) return;
  const settings = state.settings;
  const rows = computeSplit(s.total, s.participants || []);

  openModal({
    title: s.title || "Split",
    body: `
      <div class="split-detail">
        <div class="split-detail__row">
          <div class="muted">Total</div>
          <strong>${formatCurrency(s.total, settings)}</strong>
        </div>
        ${s.friendCode ? `<div class="split-detail__row">
          <div class="muted">Friend code</div>
          <strong>${escapeHtml(s.friendCode)}</strong>
        </div>` : ""}
        ${s.note ? `<div class="muted split-detail__note">${escapeHtml(s.note)}</div>` : ""}
        <ul class="split-detail__list">
          ${rows.map((r) => {
            const net = r.paid - r.owes;
            const label = net > 0
              ? `is owed ${formatCurrency(net, settings)}`
              : net < 0
                ? `owes ${formatCurrency(-net, settings)}`
                : "is settled up";
            return `
            <li class="split-detail__item">
              <span>${escapeHtml(r.name)}</span>
              <span class="muted">×${r.share} · paid ${formatCurrency(r.paid, settings)}</span>
              <strong>${label}</strong>
            </li>`;
          }).join("")}
        </ul>
        <div class="muted split-detail__foot">
          Saved ${escapeHtml(formatDate(s.createdAt?.slice(0, 10), settings))}
        </div>
      </div>
    `,
    actions: [
      { label: "Close", value: false, kind: "default" },
    ],
  });
}

async function deleteSplitWithConfirm({ state, id, refresh, onChanged }) {
  const s = (state.splits || []).find((x) => x.id === id);
  if (!s) return;
  // Reuse the existing confirmDialog component.
  const { confirmDialog } = await import("../components/confirm.js");
  const ok = await confirmDialog({
    title: "Delete this split?",
    message: `“${s.title || "Untitled"}” will be removed from your history. This can't be undone.`,
    confirmLabel: "Delete",
    danger: true,
  });
  if (!ok) return;
  deleteSplit(state, id);
  Store.save(state);
  const syncFn = typeof syncToServer === "function" ? syncToServer : null;
  if (syncFn) {
    // eslint-disable-next-line no-console
    console.log("[splits] deleted", id, "→ triggering server sync");
    syncFn();
  } else {
    // eslint-disable-next-line no-console
    console.log("[splits] deleted", id, "→ server sync unavailable");
  }
  toast("Split deleted", "success");
  onChanged && onChanged();
  refresh();
}

async function copyFriendCode(state, id) {
  const s = (state.splits || []).find((x) => x.id === id);
  if (!s || !s.friendCode) return;
  try {
    await navigator.clipboard.writeText(s.friendCode);
    toast("Friend code copied", "success");
  } catch {
    toast("Copy failed — please select and copy manually", "info");
  }
}
