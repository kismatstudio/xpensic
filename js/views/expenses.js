// Expenses list view — filterable + sortable list of all expenses.
// Phase 2: Add/Edit/Delete via modal + table.
// Phase 3: Filter bar (date range, category multi-select), text search,
//          payment-method chip on each row, sort by date+time.

import { Store } from "../store.js";
import { formatCurrency, formatDate } from "../format.js";
import { openModal } from "../components/modal.js";
import { confirmDialog } from "../components/confirm.js";
import { toast } from "../components/toast.js";
import { buildExpenseForm } from "./expense-form.js";
import {
  compareISO,
  compareHHMM,
  escapeHtml,
  paymentMethodLabel,
  upiAppLabel,
  parseSearchQuery,
} from "../util.js";

/**
 * Renders the Expenses view into the given container.
 * @param {HTMLElement} container
 * @param {object} ctx  — { state, onChange }
 *        state    : the mutable store state (kept in main.js)
 *        onChange : optional callback after a mutation (so other views can re-render)
 */
export function renderExpenses(container, { state, onChange }) {
  const settings = state.settings;
  // Build a category lookup so we can show names + colors in the table.
  const catById = new Map(state.categories.map((c) => [c.id, c]));

  // --- Header + Add button ------------------------------------------------
  const header = document.createElement("div");
  header.className = "view-header";
  header.innerHTML = `
    <h1 class="section-title">Expenses</h1>
    <button class="btn btn--primary" type="button" id="add-expense-btn">+ Add expense</button>
  `;
  container.appendChild(header);

  // --- Filter bar (Phase 3) -----------------------------------------------
  // Three filter controls + a search box, plus a "Clear" button that
  // resets everything in one click.
  const toolbar = document.createElement("div");
  toolbar.className = "toolbar toolbar--filters";
  toolbar.innerHTML = `
    <div class="filter-group">
      <label class="filter-group__label" for="filter-from">From</label>
      <input class="field__input filter-group__input" type="date" id="filter-from" />
    </div>
    <div class="filter-group">
      <label class="filter-group__label" for="filter-to">To</label>
      <input class="field__input filter-group__input" type="date" id="filter-to" />
    </div>
    <div class="filter-group">
      <label class="filter-group__label" for="filter-categories">Categories</label>
      <select class="field__select filter-group__input" id="filter-categories" multiple
              size="1" aria-label="Filter by category"></select>
    </div>
    <div class="filter-group filter-group--grow">
      <label class="filter-group__label" for="exp-search">Search</label>
      <input class="field__input filter-group__input" type="search" id="exp-search"
             placeholder="Try: Food last month, >1000, January, ₹250" />
    </div>
    <button class="btn btn--ghost" type="button" id="filter-clear" title="Clear all filters">Clear</button>
    <span class="muted toolbar__count" id="exp-count">0 expenses</span>
  `;
  container.appendChild(toolbar);

  // --- Table (or empty state) ---------------------------------------------
  const tableWrap = document.createElement("div");
  tableWrap.className = "card";
  tableWrap.style.padding = "0";
  container.appendChild(tableWrap);

  // Populate the category multi-select once. We rebuild the <option> list
  // any time the categories change (e.g. after adding a new one).
  function refreshCategoryFilter() {
    const sel = container.querySelector("#filter-categories");
    sel.innerHTML = state.categories
      .map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`)
      .join("");
  }
  refreshCategoryFilter();

  // Local view state for filters / search. A single source of truth for
  // what the user has currently filtered to.
  const view = {
    from: "",
    to: "",
    categories: new Set(),
    search: "",
  };

  // Read the current UI values into `view`. Called on every input change
  // so refresh() always sees the latest filter state.
  function readFilters() {
    view.from = container.querySelector("#filter-from").value;
    view.to = container.querySelector("#filter-to").value;
    const sel = container.querySelector("#filter-categories");
    view.categories = new Set(Array.from(sel.selectedOptions).map((o) => o.value));
    view.search = container.querySelector("#exp-search").value;
  }

  // Apply all current filters and render the table.
  function refresh() {
    readFilters();
    const q = view.search.trim();

    // Phase 7: the free-text search now understands a small query language
    // (amount comparisons, time tokens, category names). Free text is
    // matched against the note + amount (the legacy behavior).
    const search = parseSearchQuery(q, state.categories);
    const searchDesc = search.describe();

    // Filter pipeline: date range AND category membership AND smart search.
    const rows = state.expenses
      .filter((e) => !view.from || compareISO(e.date, view.from) >= 0)
      .filter((e) => !view.to   || compareISO(e.date, view.to)   <= 0)
      .filter((e) => view.categories.size === 0 || view.categories.has(e.categoryId))
      .filter((e) => search.match(e))
      .slice()
      // Newest first: by date desc, then by time desc, then by creation time
      // for stable ordering when two records share a date+time.
      .sort((a, b) => {
        const c = compareISO(b.date, a.date);
        if (c !== 0) return c;
        const t = compareHHMM(b.time || "00:00", a.time || "00:00");
        if (t !== 0) return t;
        return (b.createdAt || "").localeCompare(a.createdAt || "");
      });

    // Update the count line. Show "X of Y" when filters are active so the
    // user can see at a glance that the list is filtered. When the smart
    // search picked up structured tokens, we also show what it understood.
    const total = state.expenses.length;
    const filtersActive =
      view.from || view.to || view.categories.size > 0 || q;
    const countEl = container.querySelector("#exp-count");
    if (countEl) {
      const base = !filtersActive
        ? `${total} expense${total === 1 ? "" : "s"}`
        : `${rows.length} of ${total} expense${total === 1 ? "" : "s"}`;
      countEl.innerHTML = searchDesc
        ? `${base} <span class="muted" style="font-size:var(--text-xs); margin-left:6px">(${escapeHtml(searchDesc)})</span>`
        : base;
    }

    // Empty states: one for "no data at all" and a separate one for
    // "data exists but the current filters hide it all".
    if (state.expenses.length === 0) {
      tableWrap.innerHTML = `
        <div class="empty-state">
          <div class="empty-state__title">No expenses yet</div>
          <div class="empty-state__body">Click <strong>+ Add expense</strong> to record your first one.</div>
        </div>
      `;
      return;
    }
    if (rows.length === 0) {
      tableWrap.innerHTML = `
        <div class="empty-state">
          <div class="empty-state__title">No matches</div>
          <div class="empty-state__body">Try adjusting the date range, categories, or search.</div>
        </div>
      `;
      return;
    }

    tableWrap.innerHTML = `
      <table class="data-table" aria-label="Expenses">
        <thead>
          <tr>
            <th>Date</th>
            <th>Category</th>
            <th>Note</th>
            <th>Payment</th>
            <th class="data-table__num">Amount</th>
            <th class="data-table__actions">Actions</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((e) => {
            const cat = catById.get(e.categoryId);
            // Build a short "Method · App" label for the payment chip.
            const method = paymentMethodLabel(e.paymentMethod);
            const app = e.paymentMethod === "upi" && e.upiApp ? upiAppLabel(e.upiApp) : "";
            const paymentText = app ? `${method} · ${app}` : method;
            // Show the time next to the date when it was captured.
            const dateText = e.time
              ? `${formatDate(e.date, settings)} <span class="muted" style="font-size:var(--text-xs)">${escapeHtml(e.time)}</span>`
              : formatDate(e.date, settings);
            return `
              <tr data-id="${e.id}">
                <td data-label="Date">${dateText}</td>
                <td data-label="Category">
                  <span class="cat-chip">
                    <span class="cat-swatch" style="background:${cat?.color || "var(--color-border-strong)"}"></span>
                    ${escapeHtml(cat?.name || "—")}
                  </span>
                </td>
                <td data-label="Note" class="data-table__note">${e.note ? escapeHtml(e.note) : "<span class='muted'>—</span>"}</td>
                <td data-label="Payment"><span class="pay-chip">${escapeHtml(paymentText)}</span></td>
                <td data-label="Amount" class="data-table__num">${formatCurrency(e.amount, settings)}</td>
                <td data-label="Actions" class="data-table__actions">
                  <button class="btn btn--sm" data-action="edit" data-id="${e.id}">Edit</button>
                  <button class="btn btn--sm btn--danger" data-action="delete" data-id="${e.id}">Delete</button>
                </td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    `;
  }

  refresh();

  // --- Wire the filter controls -------------------------------------------
  // Every control calls refresh() on input. We also wire "Clear" to reset
  // all fields in one click.
  const wire = (selector, evt = "input") => {
    const el = container.querySelector(selector);
    if (el) el.addEventListener(evt, refresh);
  };
  wire("#filter-from", "change");
  wire("#filter-to", "change");
  wire("#filter-categories", "change");
  wire("#exp-search", "input");

  container.querySelector("#filter-clear").addEventListener("click", () => {
    container.querySelector("#filter-from").value = "";
    container.querySelector("#filter-to").value = "";
    const catSel = container.querySelector("#filter-categories");
    Array.from(catSel.options).forEach((o) => { o.selected = false; });
    container.querySelector("#exp-search").value = "";
    refresh();
  });

  // --- Add expense --------------------------------------------------------
  container.querySelector("#add-expense-btn").addEventListener("click", () => {
    openExpenseFormModal({
      state,
      categories: state.categories,
      onSaved: () => { refreshCategoryFilter(); refresh(); onChange && onChange(); },
    });
  });

  // --- Row actions (event delegation on the table wrap) -------------------
  tableWrap.addEventListener("click", async (ev) => {
    const btn = ev.target.closest("button[data-action]");
    if (!btn) return;
    const id = btn.dataset.id;
    const expense = state.expenses.find((x) => x.id === id);
    if (!expense) return;

    if (btn.dataset.action === "edit") {
      openExpenseFormModal({
        state,
        categories: state.categories,
        expense,
        onSaved: () => { refreshCategoryFilter(); refresh(); onChange && onChange(); },
      });
    } else if (btn.dataset.action === "delete") {
      // Confirm before destroying data — destructive actions always get a confirm step.
      const ok = await confirmDialog({
        title: "Delete expense?",
        message: "This can't be undone.",
        confirmLabel: "Delete",
        danger: true,
      });
      if (!ok) return;
      Store.deleteExpense(state, id);
      Store.save(state);
      toast("Expense deleted", "success");
      refresh();
      onChange && onChange();
    }
  });
}

// --- Modal wrapper around the expense form ---------------------------------

function openExpenseFormModal({ state, categories, expense, onSaved }) {
  const isEdit = Boolean(expense);
  const form = buildExpenseForm({ categories, expense });

  openModal({
    title: isEdit ? "Edit expense" : "Add expense",
    body: form,
    actions: [
      { label: "Cancel", value: false, kind: "default" },
      { label: isEdit ? "Save changes" : "Add expense", value: true, kind: "primary" },
    ],
    onAction: (value) => {
      if (!value) return true; // Cancel — close the modal
      // Primary action — read & validate. If invalid, return `false` to keep the modal open.
      const result = form.readValues();
      if (!result.ok) return false;

      if (isEdit) {
        Store.updateExpense(state, expense.id, result.value);
        toast("Expense updated", "success");
      } else {
        Store.addExpense(state, result.value);
        toast("Expense added", "success");
      }
      Store.save(state);
      onSaved && onSaved();
      return true;
    },
  });
}
