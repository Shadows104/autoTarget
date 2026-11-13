import { TargetPrompt } from "./prompt.js";

const MODULE_ID = "auto-target";

/** Build the descriptor dnd5e stores on chat cards (mirrors TargetsField.getDescriptors). */
function describe(token) {
  const doc = token.document;
  const { statuses, system, uuid: actor } = doc.actor ?? {};
  if (!actor) return null;
  const ac = statuses.has("coverTotal") ? null : system.attributes?.ac?.value;
  return { actor, ac: ac ?? null, img: doc.texture?.src, name: doc.name, token: doc.uuid };
}

/**
 * After an area activity's template has been placed, let the player click whoever is caught in it.
 * There's no maximum: it's whoever the player says is in the area. The chat card is updated afterwards
 * because dnd5e snapshots its targets before the template exists.
 * @param {Activity} activity
 * @param {{message?: ChatMessage}} results  dnd5e usage results.
 * @param {() => void} clearTargets
 */
export async function promptAreaTargets(activity, results, clearTargets) {
  if (!canvas?.ready || TargetPrompt.active) return;
  const actor = activity.actor;
  if (!actor) return;

  const source = canvas.tokens.placeables.find(t => t.actor === actor && t.controlled)
    ?? actor.getActiveTokens()[0];
  const sheet = actor.sheet;
  const wasOpen = sheet?.rendered && !sheet.minimized;
  const restoreSheet = () => { if (wasOpen && sheet.rendered && sheet.minimized) sheet.maximize(); };

  try {
    if (wasOpen) await sheet.minimize();
    clearTargets();
    const range = { kind: "unlimited", normal: Infinity, long: Infinity, label: game.i18n.localize("AUTOTARGET.AreaLabel") };
    const ok = await new TargetPrompt({ activity, range, max: Infinity, source }).prompt();
    if (!ok) return clearTargets();

    const descriptors = [...game.user.targets].map(describe).filter(Boolean);
    const message = results?.message;
    if (message && descriptors.length) {
      showAsTargeted(message);
      // The flag lets every client switch this card to Targeted mode when the update arrives.
      await message.update({ "system.targets": descriptors, flags: { [MODULE_ID]: { areaTargets: true } } });
    }
    // The card now holds the targets itself (Save/damage buttons read them from it), so reset the map.
    clearTargets();
  } finally {
    restoreSheet();
  }
}

/**
 * A card created with no recorded targets is locked into dnd5e's "Selected" mode, so its save/damage buttons
 * would use selected tokens. Switch this one chat message to "Targeted" (display state only; nothing is
 * stored on spells, items or actors).
 */
function showAsTargeted(message) {
  message._targetState.mode = "targeted";
  for (const el of document.querySelectorAll(`[data-message-id="${message.id}"] recorded-targets`)) {
    el.targetingMode = "targeted";
  }
}

/** On every client: when one of our area cards receives its targets, flip it to Targeted. */
export function initAreaCardFix() {
  Hooks.on("updateChatMessage", (message, changes) => {
    if (!message.getFlag(MODULE_ID, "areaTargets")) return;
    if (!foundry.utils.hasProperty(changes, "system.targets")) return;
    showAsTargeted(message);
    setTimeout(() => showAsTargeted(message), 250); // after the card has re-rendered
  });
}
