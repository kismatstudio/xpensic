// Categories view — Phase 5.
//
// Full CRUD on categories:
//   • Add   — name + color, defaults to a sensible unused color
//   • Edit  — inline rename + recolor
//   • Delete — must reassign any expenses using the category to another
//              category first; we surface a pick-list in the confirm dialog
//              so the user can't accidentally orphan data
//
// Default categories (isDefault: true) can be renamed/recolored but not
// deleted — the user can pick "Other" as the reassignment target if they
// really want to drop one.

import { Store } from "../store.js";
import { openModal } from "../components/modal.js";
import { toast } from "../components/toast.js";
import { escapeHtml } from "../util.js";

/**
 * Renders the Categories view.
 * @param {HTMLElement} container
 * @param {object} ctx — { state, refresh }
 */
export function renderCategories(container, { state, refresh }) {
  // Track which row is being edited so a second click elsewhere cancels it.
  let editingId = null;

  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <div class="view-header">
      <h1 class="section-title">Categories</h1>
      <button class="btn btn--primary" type="button" id="add-cat-btn">+ Add category</button>
    </div>
  `;
  container.appendChild(wrap);

  // The list re-renders on every change so colors / counts stay in sync.
  const list = document.createElement("div");
  list.className = "card";
  list.style.padding = "0";
  wrap.appendChild(list);

  function renderList() {
    // Count how many expenses use each category so the user can see the
    // blast radius before deleting one.
    const usage = new Map();
    for (const e of state.expenses) {
      usage.set(e.categoryId, (usage.get(e.categoryId) || 0) + 1);
    }

    if (state.categories.length === 0) {
      list.innerHTML = `
        <div class="empty-state">
          <div class="empty-state__title">No categories</div>
          <div class="empty-state__body">Add one to start tracking expenses.</div>
        </div>
      `;
      return;
    }

    list.innerHTML = `
      <ul class="cat-list cat-list--manage" role="list">
        ${state.categories.map((c) => {
          const count = usage.get(c.id) || 0;
          // While a row is being edited we render an inline form instead of
          // the static row.
          if (editingId === c.id) return renderEditRow(c, count);
          return renderStaticRow(c, count);
        }).join("")}
      </ul>
    `;

    // Wire row actions via event delegation. We re-bind on every render
    // because the inner HTML is regenerated.
    list.querySelectorAll("[data-action]").forEach((btn) => {
      btn.addEventListener("click", () => handleRowAction(btn));
    });
  }

  function renderStaticRow(c, count) {
    return `
      <li class="cat-list__item cat-list__row" data-id="${c.id}">
        <span class="cat-swatch" style="background:${c.color}"></span>
        <span class="cat-list__name">
          ${escapeHtml(c.name)}
          ${c.isDefault ? `<span class="muted" style="font-size:var(--text-xs); margin-left:6px">default</span>` : ""}
        </span>
        <span class="muted cat-list__count">${count} expense${count === 1 ? "" : "s"}</span>
        <span class="cat-list__actions">
          <button class="btn btn--sm" data-action="edit" data-id="${c.id}">Edit</button>
          <button class="btn btn--sm btn--danger" data-action="delete" data-id="${c.id}"
                  ${c.isDefault ? "disabled title=\"Default categories can't be deleted\"" : ""}>Delete</button>
        </span>
      </li>
    `;
  }

  function renderEditRow(c, count) {
    return `
      <li class="cat-list__item cat-list__row cat-list__row--editing" data-id="${c.id}">
        <input type="color" class="cat-list__color" data-edit="color" value="${c.color}" aria-label="Category color" />
        <input type="text" class="field__input cat-list__name-input" data-edit="name" value="${escapeHtml(c.name)}" maxlength="40" />
        <span class="muted cat-list__count">${count} expense${count === 1 ? "" : "s"}</span>
        <span class="cat-list__actions">
          <button class="btn btn--sm btn--primary" data-action="save" data-id="${c.id}">Save</button>
          <button class="btn btn--sm" data-action="cancel" data-id="${c.id}">Cancel</button>
        </span>
      </li>
    `;
  }

  // --- Row action dispatch -----------------------------------------------
  async function handleRowAction(btn) {
    const id = btn.dataset.id;
    const action = btn.dataset.action;
    const cat = state.categories.find((c) => c.id === id);
    if (!cat) return;

    if (action === "edit") {
      editingId = id;
      renderList();
      // Focus the name field for fast keyboard entry.
      const nameInput = list.querySelector(`[data-edit="name"]`);
      if (nameInput) { nameInput.focus(); nameInput.select(); }
    } else if (action === "cancel") {
      editingId = null;
      renderList();
    } else if (action === "save") {
      const row = btn.closest(".cat-list__row");
      const name = row.querySelector('[data-edit="name"]').value.trim();
      const color = row.querySelector('[data-edit="color"]').value;
      if (!name) {
        toast("Category name is required", "error");
        return;
      }
      Store.updateCategory(state, id, { name, color });
      Store.save(state);
      editingId = null;
      toast("Category updated", "success");
      renderList();
      refresh();
    } else if (action === "delete") {
      await deleteCategoryWithReassign(id);
    }
  }

  // --- Delete with reassign ---------------------------------------------
  // If the category is in use, we open a confirm dialog that lists the
  // other categories as radio options so the user must pick where the
  // existing expenses should move. If unused, a plain confirm is enough.
  async function deleteCategoryWithReassign(id) {
    const cat = state.categories.find((c) => c.id === id);
    if (!cat) return;
    if (cat.isDefault) {
      toast("Default categories can't be deleted", "error");
      return;
    }

    const usage = state.expenses.filter((e) => e.categoryId === id).length;
    const otherCats = state.categories.filter((c) => c.id !== id);

    if (usage === 0) {
      // Nothing to reassign — simple confirm.
      const ok = await openConfirm({
        title: "Delete category?",
        message: `“${cat.name}” has no expenses. Delete it?`,
        confirmLabel: "Delete",
        danger: true,
      });
      if (!ok) return;
      Store.deleteCategory(state, id);
      Store.save(state);
      toast("Category deleted", "success");
      renderList();
      refresh();
      return;
    }

    // Category in use — require a reassignment target.
    if (otherCats.length === 0) {
      toast("Add another category first, then reassign expenses", "error");
      return;
    }

    openReassignDialog({ cat, usage, otherCats, onConfirm: (reassignTo) => {
      const result = Store.deleteCategory(state, id, { reassignTo });
      if (!result.ok) {
        toast(result.error, "error");
        return;
      }
      Store.save(state);
      toast(`Moved ${usage} expense${usage === 1 ? "" : "s"} and deleted category`, "success");
      renderList();
      refresh();
    }});
  }

  // --- Add category ------------------------------------------------------
  wrap.querySelector("#add-cat-btn").addEventListener("click", () => {
    openAddCategoryDialog({ state, onAdded: () => { renderList(); refresh(); } });
  });

  renderList();
}

// --- Helpers ---------------------------------------------------------------

// A small pool of colors used when adding a new category, so the user
// doesn't have to pick one. We pick the first unused color in the list.
const CATEGORY_COLOR_POOL = [
  "#ef4444", "#f97316", "#f59e0b", "#eab308", "#84cc16",
  "#22c55e", "#10b981", "#14b8a6", "#06b6d4", "#3b82f6",
  "#6366f1", "#8b5cf6", "#a855f7", "#ec4899", "#f43f5e",
  "#64748b",
];

function pickNextColor(categories) {
  const used = new Set(categories.map((c) => c.color.toLowerCase()));
  return CATEGORY_COLOR_POOL.find((c) => !used.has(c.toLowerCase())) || CATEGORY_COLOR_POOL[0];
}

function openAddCategoryDialog({ state, onAdded }) {
  // Build a tiny form for the new category. We keep this inline (instead
  // of reusing the full expense form) because the fields are simple and
  // specific to this flow.
  const suggestedColor = pickNextColor(state.categories);

  const form = document.createElement("form");
  form.className = "cat-form";
  form.noValidate = true;
  form.innerHTML = `
    <div class="field">
      <label class="field__label" for="new-cat-name">Name</label>
      <input class="field__input" id="new-cat-name" type="text" maxlength="40" placeholder="e.g. Groceries" required />
      <div class="field__error" id="new-cat-name-err"></div>
    </div>
    <div class="field">
      <label class="field__label" for="new-cat-color">Color</label>
      <input class="cat-form__color" id="new-cat-color" type="color" value="${suggestedColor}" />
    </div>
  `;

  openModal({
    title: "Add category",
    body: form,
    actions: [
      { label: "Cancel", value: false, kind: "default" },
      { label: "Add", value: true, kind: "primary" },
    ],
    onAction: (value) => {
      if (!value) return true;
      const nameEl = form.querySelector("#new-cat-name");
      const colorEl = form.querySelector("#new-cat-color");
      const name = nameEl.value.trim();
      if (!name) {
        const err = form.querySelector("#new-cat-name-err");
        err.textContent = "Name is required.";
        nameEl.setAttribute("aria-invalid", "true");
        return false; // keep modal open
      }
      // Reject duplicate names (case-insensitive) so the user doesn't end
      // up with two "Food" categories by accident.
      const dupe = state.categories.find((c) => c.name.toLowerCase() === name.toLowerCase());
      if (dupe) {
        const err = form.querySelector("#new-cat-name-err");
        err.textContent = "A category with this name already exists.";
        nameEl.setAttribute("aria-invalid", "true");
        return false;
      }
      Store.addCategory(state, { name, color: colorEl.value });
      Store.save(state);
      toast("Category added", "success");
      onAdded && onAdded();
      return true;
    },
  });
}

function openReassignDialog({ cat, usage, otherCats, onConfirm }) {
  // A confirm-style modal with a radio group of the other categories.
  // We build the body imperatively so we can read the chosen radio value
  // when the user clicks the primary action.
  const body = document.createElement("div");
  body.innerHTML = `
    <p style="margin: 0 0 var(--space-3) 0;">
      <strong>${escapeHtml(cat.name)}</strong> is used by
      <strong>${usage}</strong> expense${usage === 1 ? "" : "s"}.
      Choose a category to move them to before deleting.
    </p>
    <div class="reassign-list" role="radiogroup" aria-label="Reassign expenses to">
      ${otherCats.map((c, i) => `
        <label class="reassign-item">
          <input type="radio" name="reassign" value="${c.id}" ${i === 0 ? "checked" : ""} />
          <span class="cat-swatch" style="background:${c.color}"></span>
          <span>${escapeHtml(c.name)}</span>
        </label>
      `).join("")}
    </div>
  `;

  openModal({
    title: "Delete “" + cat.name + "”?",
    body,
    actions: [
      { label: "Cancel", value: false, kind: "default" },
      { label: "Reassign & delete", value: true, kind: "danger" },
    ],
    onAction: (value) => {
      if (!value) return true;
      const checked = body.querySelector('input[name="reassign"]:checked');
      if (!checked) return false; // shouldn't happen, but be safe
      onConfirm(checked.value);
      return true;
    },
  });
}

// Tiny local confirm dialog. We don't import confirmDialog from
// components/confirm.js because that one doesn't support a custom
// "danger" label cleanly; instead we just call openModal directly.
function openConfirm({ title, message, confirmLabel, danger }) {
  return new Promise((resolve) => {
    openModal({
      title,
      body: `<p style="margin:0; color:var(--color-text);">${escapeHtml(message)}</p>`,
      actions: [
        { label: "Cancel", value: false, kind: "default" },
        { label: confirmLabel || "Confirm", value: true, kind: danger ? "danger" : "primary" },
      ],
      onAction: (value) => { resolve(Boolean(value)); },
    });
  });
}
