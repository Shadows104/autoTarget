import { getRange, getMaxTargets } from "./range.js";
import { TargetPrompt, installTargetPatch } from "./prompt.js";
import { promptAreaTargets, initAreaCardFix } from "./area.js";
import { registerRegionSettings, initRegionCleanup } from "./regions.js";

const MODULE_ID = "auto-target";

/**
 * Activities we've already prompted for, so the re-issued use() isn't intercepted again.
 * use() clones the item on every call, so we key by stable UUID rather than object identity.
 */
const approved = new Set();
/** Attack uses awaiting their attack roll: key -> { finish, restoreSheet, timer }. */
const sessions = new Map();
/** Attacks that have been rolled whose targets are being kept for the damage roll. */
const awaitingDamage = new Set();
const keyFor = activity => `${activity.actor?.uuid}|${activity.relativeUUID}`;

const clearTargets = () => {
  for (const t of [...game.user.targets]) t.setTarget(false, { releaseOthers: false, groupSelection: true });
};

Hooks.once("ready", installTargetPatch);

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "enabled", {
    name: "AUTOTARGET.SettingEnabled",
    hint: "AUTOTARGET.SettingEnabledHint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });
  registerRegionSettings();
  // Remembered position of the target prompt.
  game.settings.register(MODULE_ID, "promptPosition", {
    scope: "client",
    config: false,
    type: Object,
    default: {}
  });
});

/**
 * dnd5e's pre-use hooks are synchronous, so we cancel the use, run the async prompt,
 * then call activity.use() again with the same configuration.
 */
Hooks.on("dnd5e.preUseActivity", (activity, usageConfig, dialogConfig, messageConfig) => {
  if (!game.settings.get(MODULE_ID, "enabled")) return;
  if (approved.delete(keyFor(activity))) return;

  const actor = activity.actor;
  if (!actor || !canvas?.ready) return;
  // Only one prompt at a time (also swallows an accidental double-click on an item).
  if (TargetPrompt.active) { TargetPrompt.active.bringToFront(); return false; }

  const range = getRange(activity);
  const max = getMaxTargets(activity);
  if (!max || range.kind === "self") return;

  const source = canvas.tokens.placeables.find(t => t.actor === actor && t.controlled)
    ?? actor.getActiveTokens()[0];

  (async () => {
    // Get the actor sheet out of the way while targeting, and bring it back afterwards.
    const sheet = actor.sheet;
    const wasOpen = sheet?.rendered && !sheet.minimized;
    const restoreSheet = () => { if (wasOpen && sheet.rendered && sheet.minimized) sheet.maximize(); };
    const key = keyFor(activity);
    const finish = () => { restoreSheet(); clearTargets(); };
    let started = false;

    try {
      if (wasOpen) await sheet.minimize();
      clearTargets(); // start from a clean slate, not leftovers from an earlier use
      const ok = await new TargetPrompt({ activity, range, max, source }).prompt();
      if (!ok) return finish();

      const isAttack = activity.type === "attack";
      // For attacks, the sheet comes back once the attack is rolled and targets stay for the damage roll;
      // the timer covers a cancelled roll dialog.
      if (isAttack) {
        const timer = setTimeout(() => { sessions.delete(key); finish(); }, 120000);
        sessions.set(key, { finish, restoreSheet, timer });
      } else restoreSheet();

      // The hook's activity belongs to a throwaway item clone; re-run on the real one.
      const real = actor.items.get(activity.item.id)?.system.activities?.get(activity.id) ?? activity;
      // Drop the target snapshot taken before the prompt so dnd5e re-reads the chosen targets.
      foundry.utils.deleteProperty(messageConfig, "data.system.targets");

      approved.add(key);
      started = true;
      const results = await real.use(usageConfig, dialogConfig, messageConfig);
      // Use was cancelled (configuration dialog closed, not enough resources...): no roll is coming.
      if (!results && sessions.has(key)) {
        clearTimeout(sessions.get(key).timer);
        sessions.delete(key);
        finish();
      } else if (!isAttack) clearTargets(); // attack targets are kept for the damage roll (see below)
    } catch (err) {
      const session = sessions.get(key);
      if (session) { clearTimeout(session.timer); sessions.delete(key); }
      finish();
      throw err;
    } finally {
      if (started) approved.delete(key);
    }
  })();

  return false;
});

/** Once the attack roll we prompted for has been made, bring the actor sheet back but keep the targets. */
Hooks.on("dnd5e.postRollAttack", (rolls, { subject }) => {
  const key = subject && keyFor(subject);
  const session = sessions.get(key);
  if (!session) return;
  sessions.delete(key);
  clearTimeout(session.timer);
  session.restoreSheet();
  awaitingDamage.add(key);
});

/**
 * dnd5e reads the current targets when damage is rolled, so they must survive until then.
 * Clear them once that damage has been rolled. (A miss leaves them until the next prompt, which resets them.)
 */
Hooks.on("dnd5e.rollDamage", (rolls, { subject }) => {
  if (subject && awaitingDamage.delete(keyFor(subject))) clearTargets();
});

/** Area spells: once dnd5e has placed the template, let the player click who is caught in it. */
Hooks.on("dnd5e.postUseActivity", (activity, usageConfig, results) => {
  if (!game.settings.get(MODULE_ID, "enabled")) return;
  if (!activity.target?.template?.type || !results?.templates?.length) return;
  promptAreaTargets(activity, results, clearTargets);
});

initAreaCardFix();
initRegionCleanup();
