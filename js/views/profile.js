// Profile view — the full Profile screen shown when the user taps "Profile"
// in the nav drawer. The header section (avatar + name + phone) is also
// rendered into the drawer (see renderNavProfile in main.js); this view
// is the "detail" page that includes an Edit button and a sign-out flow.
//
// Edit profile flow:
//   • Name + mobile number (validated, like the auth gate).
//   • Profile picture (optional):
//       - "Choose photo…" lets the user pick an existing image from the
//         device, which we crop + downscale via processProfilePicture.
//       - A grid of built-in "hero" silhouettes from util.js is offered as
//         an alternative when the user doesn't have a personal photo handy.
//   • "Remove" clears the custom picture (falls back to the generated
//     initials avatar).

import {
  formatIndianPhone, generateAvatarDataUrl,
  validateIndianPhone, escapeHtml, processProfilePicture,
  listHeroAvatars, generateHeroAvatarDataUrl,
} from "../util.js";
import { Store } from "../store.js";
import { openModal } from "../components/modal.js";
import { toast } from "../components/toast.js";
import { confirmDialog } from "../components/confirm.js";

/**
 * Renders the full Profile view. Re-renders in-place after any change so
 * the avatar, name, and phone stay in sync.
 */
export function renderProfile(container, ctx) {
  const { state, refresh, onSignOut } = ctx;

  const wrap = document.createElement("div");
  wrap.className = "profile-view";
  container.appendChild(wrap);

  const draw = () => {
    const p = state.profile || {};
    const avatar = p.avatarDataUrl || generateAvatarDataUrl(p);
    const phoneDisplay = formatIndianPhone(p.phone) || "—";

    wrap.innerHTML = `
      <h1 class="section-title">Profile</h1>

      <div class="card profile-card">
        <div class="profile-card__header">
          <img class="profile-card__avatar" id="profile-avatar"
               src="${escapeHtml(avatar)}" alt="Profile picture" />
          <div class="profile-card__id">
            <div class="profile-card__name" id="profile-name-display">${escapeHtml(p.name || "—")}</div>
            ${!p.name ? `<button class="btn btn--sm profile-card__add-name" type="button" id="profile-add-name">+ Add your name</button>` : ""}

            <div class="profile-card__phone" id="profile-phone-display">${escapeHtml(phoneDisplay)}</div>
          </div>
        </div>

        <div class="profile-card__meta muted">
          Identifies you on this device. Your data stays in this browser.
        </div>

        <div class="profile-card__actions">
          <button class="btn btn--primary" type="button" id="profile-edit">Edit profile</button>
          <button class="btn" type="button" id="profile-signout">Sign out</button>
        </div>
      </div>

      <div class="card profile-stats" id="profile-stats">
        <!-- filled in by draw() -->
      </div>
    `;
    drawStats();
    wireActions();
  };

  function drawStats() {
    const stats = wrap.querySelector("#profile-stats");
    const since = state.expenses.length
      ? state.expenses
          .map((e) => e.createdAt || e.updatedAt || "")
          .filter(Boolean)
          .sort()[0]
      : null;
    const sinceDisplay = since
      ? new Date(since).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
      : "—";
    stats.innerHTML = `
      <div class="card__title">Activity</div>
      <div class="profile-stats__grid">
        <div>
          <div class="profile-stats__num">${state.expenses.length}</div>
          <div class="muted">expenses logged</div>
        </div>
        <div>
          <div class="profile-stats__num">${state.categories.length}</div>
          <div class="muted">categories</div>
        </div>
        <div>
          <div class="profile-stats__num">${sinceDisplay}</div>
          <div class="muted">first expense</div>
        </div>
      </div>
    `;
  }

  function wireActions() {
    wrap.querySelector("#profile-edit").addEventListener("click", () => openEdit());
    wrap.querySelector("#profile-signout").addEventListener("click", () => onSignOut());
    // The "+ Add your name" CTA only renders when name is empty; the
    // listener is a no-op when the button doesn't exist.
    const addNameBtn = wrap.querySelector("#profile-add-name");
    if (addNameBtn) addNameBtn.addEventListener("click", () => openEdit());
  }  function openEdit() {
    const p = state.profile || {};
    // Modal-local state for the picture picker. `pendingAvatar` is set by
    // both the device-upload path (a real photo data URL) and the hero
    // picker (a generated data URL). `avatarRemoved` distinguishes the
    // case where the user explicitly clicked Remove.
    const currentAvatar = p.avatarDataUrl || generateAvatarDataUrl(p);
    let pendingAvatar = null;
    let avatarRemoved = false;

    const body = document.createElement("div");
    const heroes = listHeroAvatars();
    body.innerHTML = `
      <div class="field prof-avatar-field">
        <span class="field__label">Profile picture (optional)</span>
        <div class="prof-avatar-field__row">
          <img class="prof-avatar-field__preview" id="prof-avatar-preview"
               src="${escapeHtml(currentAvatar)}" alt="Profile picture preview" />
          <div class="prof-avatar-field__buttons">
            <label class="btn prof-avatar-field__upload" for="prof-avatar-input">
              Choose photo…
              <input type="file" id="prof-avatar-input" accept="image/*" hidden />
            </label>
            <button class="btn" type="button" id="prof-avatar-remove">Remove photo</button>
          </div>
        </div>
        <div class="field__hint muted" id="prof-avatar-hint">
          Pick one from your device, or choose a built-in character below.
        </div>
        <div class="field__error" id="prof-avatar-error" hidden></div>
      </div>

      <div class="field">
        <span class="field__label">Built-in characters</span>
        <div class="hero-grid" id="prof-hero-grid" role="radiogroup" aria-label="Pick a built-in character">
          ${heroes.map((h) => `
            <button type="button" class="hero-grid__cell" data-hero-id="${escapeHtml(h.id)}"
                    role="radio" aria-checked="false" aria-label="${escapeHtml(h.name)}"
                    title="${escapeHtml(h.name)}">
              <img class="hero-grid__img" src="${escapeHtml(generateHeroAvatarDataUrl(h.id))}" alt="" />
              <span class="hero-grid__name">${escapeHtml(h.name)}</span>
            </button>
          `).join("")}
        </div>
        <div class="field__hint muted">
          Tap a character to set them as your avatar. Or stay with the auto-generated initials.
        </div>
      </div>

      <div class="field">
        <label class="field__label" for="prof-name">Name (optional)</label>
        <input class="field__input" id="prof-name" type="text" maxlength="60"
               value="${escapeHtml(p.name || "")}" autocomplete="name" />
        <div class="field__error" id="prof-name-error" hidden></div>
      </div>
      <div class="field">
        <label class="field__label" for="prof-phone">Mobile number (optional)</label>
        <div class="login-gate__phone-wrap">
          <span class="login-gate__phone-prefix" aria-hidden="true">+91</span>
          <input class="field__input login-gate__phone-input" id="prof-phone"
                 type="tel" inputmode="numeric" pattern="[0-9]*"
                 value="${escapeHtml(p.phone || "")}" maxlength="10" />
        </div>
        <div class="field__hint muted">10 digits, Indian mobile.</div>
        <div class="field__error" id="prof-phone-error" hidden></div>
      </div>
    `;
    openModal({
      title: "Edit profile",
      body,
      actions: [
        { label: "Cancel", value: false, kind: "default" },
        { label: "Save", value: true, kind: "primary" },
      ],
      onAction: (v) => {
        if (!v) return true;
        const name = body.querySelector("#prof-name").value.trim();
        const rawPhone = body.querySelector("#prof-phone").value.trim();
        const phoneResult = rawPhone
          ? validateIndianPhone(rawPhone)
          : { ok: true, value: "" };
        const $nameErr = body.querySelector("#prof-name-error");
        const $phoneErr = body.querySelector("#prof-phone-error");
        let hasError = false;
        if (!phoneResult.ok) { $phoneErr.textContent = phoneResult.error; $phoneErr.hidden = false; hasError = true; }
        if (hasError) return false;

        // Resolve the avatar to persist (priority order):
        //   1. `pendingAvatar` — user picked a new photo or hero this session
        //   2. `""`             — user clicked Remove this session
        //   3. `p.avatarDataUrl` — no change
        // When the avatar is empty, render() falls back to the generated
        // initials avatar via `|| generateAvatarDataUrl(p)`.
        let avatarToSave;
        if (pendingAvatar) avatarToSave = pendingAvatar;
        else if (avatarRemoved) avatarToSave = "";
        else avatarToSave = p.avatarDataUrl || "";

        Store.updateProfile(state, {
          name,
          phone: phoneResult.value,
          avatarDataUrl: avatarToSave,
        });
        Store.save(state);
        toast("Profile updated", "success");
        draw();
        if (typeof ctx.refreshNav === "function") ctx.refreshNav();
        return true;
      },
    });

    // --- Picture upload + hero-picker wiring ------------------------------
    const $preview = body.querySelector("#prof-avatar-preview");
    const $input = body.querySelector("#prof-avatar-input");
    const $remove = body.querySelector("#prof-avatar-remove");
    const $err = body.querySelector("#prof-avatar-error");
    const $hint = body.querySelector("#prof-avatar-hint");
    const $grid = body.querySelector("#prof-hero-grid");

    function setPreview(src) { $preview.src = src; }
    function setError(msg) {
      if (msg) { $err.textContent = msg; $err.hidden = false; }
      else { $err.textContent = ""; $err.hidden = true; }
    }
    function generatedFallback() {
      // Used only when the user removes their photo AND hasn't picked a
      // hero — the avatar should still look intentional, so we regenerate
      // the initials avatar from the current name.
      return generateAvatarDataUrl({
        name: body.querySelector("#prof-name").value,
        phone: body.querySelector("#prof-phone").value,
      });
    }
    function markHeroSelected(heroId) {
      $grid.querySelectorAll(".hero-grid__cell").forEach((cell) => {
        const isSel = cell.dataset.heroId === heroId;
        cell.classList.toggle("is-selected", isSel);
        cell.setAttribute("aria-checked", isSel ? "true" : "false");
      });
    }

    $input.addEventListener("change", async (ev) => {
      const file = ev.target.files && ev.target.files[0];
      ev.target.value = ""; // allow re-picking the same file
      if (!file) return;
      setError("");
      $hint.textContent = "Processing…";
      const result = await processProfilePicture(file);
      if (!result.ok) {
        setError(result.error);
        $hint.textContent = "Pick one from your device, or choose a built-in character below.";
        return;
      }
      pendingAvatar = result.dataUrl;
      avatarRemoved = false;
      setPreview(result.dataUrl);
      markHeroSelected(""); // clear hero selection
      $hint.textContent = "Looks good — click Save to apply, or pick a character instead.";
    });

    $remove.addEventListener("click", () => {
      pendingAvatar = null;
      avatarRemoved = true;
      setError("");
      setPreview(generatedFallback());
      markHeroSelected("");
      $hint.textContent = "Photo removed. We'll show your initials instead.";
    });

    // Hero-picker — click a cell to swap the preview to that silhouette.
    $grid.querySelectorAll(".hero-grid__cell").forEach((cell) => {
      cell.addEventListener("click", () => {
        const heroId = cell.dataset.heroId;
        pendingAvatar = generateHeroAvatarDataUrl(heroId);
        avatarRemoved = false;
        setError("");
        setPreview(pendingAvatar);
        markHeroSelected(heroId);
        $hint.textContent = `Picked the ${cell.title} character. Click Save to apply.`;
      });
    });
  }

  draw();
}
