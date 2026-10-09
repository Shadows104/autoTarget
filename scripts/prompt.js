import { distanceBetween, rangeStatus } from "./range.js";

const { ApplicationV2 } = foundry.applications.api;
const MODULE_ID = "auto-target";

/**
 * Small floating panel shown while the player picks targets with Foundry's normal targeting.
 * Resolves true on Confirm (1..max targets), false on Cancel/close.
 */
export class TargetPrompt extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "auto-target-prompt",
    classes: ["auto-target-prompt"],
    window: { title: "AUTOTARGET.Title", resizable: false },
    position: { width: 320, height: "auto" },
    actions: {
      confirm: TargetPrompt.#onConfirm,
      cancel: TargetPrompt.#onCancel
    }
  };

  constructor({ activity, range, max, source }, options = {}) {
    // Reopen where the player last left the prompt, so it doesn't sit on top of their targets.
    const { left, top } = game.settings.get(MODULE_ID, "promptPosition") ?? {};
    if (Number.isFinite(left) && Number.isFinite(top)) {
      options = foundry.utils.mergeObject({ position: { left, top } }, options);
    }
    super(options);
    this.activity = activity;
    this.range = range;
    this.max = max;
    this.source = source; // the acting token
    this.#promise = new Promise(res => { this.#resolve = res; });
    this.#hookId = Hooks.on("targetToken", (user, token, targeted) => this.#onTarget(user, token, targeted));
    this.#patchClicks();
  }

  #promise; #resolve; #hookId; #done = false; #unpatch;

  /**
   * While open, switch to Foundry's Target tool so a plain left-click targets any token,
   * and make clicks additive (the tool normally replaces existing targets unless Shift is held).
   */
  #patchClicks() {
    const prevControl = ui.controls.control?.name;
    const prevTool = ui.controls.tool?.name;
    ui.controls.activate({ control: "tokens", tool: "target" });

    const proto = CONFIG.Token.objectClass.prototype;
    const hadOwn = Object.hasOwn(proto, "setTarget");
    const original = proto.setTarget;
    proto.setTarget = function (targeted = true, options = {}) {
      return original.call(this, targeted, { ...options, releaseOthers: false });
    };
    this.#unpatch = () => {
      if (hadOwn) proto.setTarget = original;
      else delete proto.setTarget;
      if (prevControl && prevTool) ui.controls.activate({ control: prevControl, tool: prevTool });
    };
  }

  /** Show the prompt and wait for the player's decision. */
  async prompt() {
    await this.render({ force: true });
    return this.#promise;
  }

  #onTarget(user, token, targeted) {
    if (user.id !== game.user.id) return;
    if (targeted && game.user.targets.size > this.max) {
      token.setTarget(false, { releaseOthers: false, groupSelection: true });
      ui.notifications.warn(game.i18n.format("AUTOTARGET.MaxReached", { max: this.max }));
      return;
    }
    this.render();
  }

  /** @override */
  async _renderHTML() {
    const targets = [...game.user.targets];
    const items = targets.map(t => {
      const dist = this.source ? distanceBetween(this.source, t) : 0;
      const status = this.source ? rangeStatus(this.range, dist) : "ok";
      return { name: t.name, dist: Math.round(dist * 10) / 10, status };
    });
    const root = document.createElement("div");
    root.innerHTML = `
      <div class="at-counter">${game.i18n.format("AUTOTARGET.Counter", { count: items.length, max: this.max })}</div>
      <div class="at-range">${game.i18n.format("AUTOTARGET.Range", { range: foundry.utils.escapeHTML(this.range.label) })}</div>
      ${items.length ? "" : `<div class="at-empty">${game.i18n.localize("AUTOTARGET.NoTargets")}</div>`}
      <ul class="at-list">
        ${items.map(i => `<li class="${i.status === "out" ? "at-out" : ""}">${foundry.utils.escapeHTML(i.name)} — ${i.dist}
          ${i.status === "out" ? `(${game.i18n.localize("AUTOTARGET.OutOfRange")})` : i.status === "long" ? "(long)" : ""}</li>`).join("")}
      </ul>
      <footer>
        <button type="button" data-action="confirm" ${items.length ? "" : "disabled"}>${game.i18n.localize("AUTOTARGET.Confirm")}</button>
        <button type="button" data-action="cancel">${game.i18n.localize("AUTOTARGET.Cancel")}</button>
      </footer>`;
    this._outOfRange = items.filter(i => i.status === "out").map(i => i.name);
    return root;
  }

  /** @override */
  _replaceHTML(result, content) {
    content.replaceChildren(result);
  }

  #finish(value) {
    if (this.#done) return;
    this.#done = true;
    Hooks.off("targetToken", this.#hookId);
    this.#unpatch?.();
    this.#resolve(value);
  }

  static #onConfirm() {
    if (this._outOfRange?.length) {
      ui.notifications.warn(game.i18n.format("AUTOTARGET.WarnOutOfRange", {
        names: this._outOfRange.join(", "), range: this.range.label
      }));
    }
    this.#finish(true);
    this.close();
  }

  static #onCancel() {
    this.#finish(false);
    this.close();
  }

  /** @override */
  async close(options) {
    this.#finish(false);
    const { left, top } = this.position;
    if (Number.isFinite(left) && Number.isFinite(top)) {
      game.settings.set(MODULE_ID, "promptPosition", { left, top });
    }
    return super.close(options);
  }
}
