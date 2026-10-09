import { getRange, getMaxTargets } from "./range.js";
import { TargetPrompt } from "./prompt.js";
import { registerRegionSettings, initRegionCleanup } from "./regions.js";

const MODULE_ID = "auto-target";

/**
 * Activities we've already prompted for, so the re-issued use() isn't intercepted again.
 * use() clones the item on every call, so we key by stable UUID rather than object identity.
 */
const approved = new Set();
/** Attack uses awaiting their attack roll, so the actor sheet can be restored: key -> { restoreSheet, timer }. */
const sessions = new Map();
const keyFor = activity => `${activity.actor?.uuid}|${activity.relativeUUID}`;

const clearTargets = () => {
  for (const t of [...game.user.targets]) t.setTarget(false, { releaseOthers: false, groupSelection: true });
};

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

  const range = getRange(activity);
  const max = getMaxTargets(activity);
  if (!max || range.kind === "self") return;

  const source = canvas.tokens.placeables.find(t => t.actor === actor && t.controlled)
    ?? actor.getActiveTokens()[0];

  (async () => {
    // Get the actor sheet out of the way while targeting, and bring it back afterwards.
    const sheet = actor.sheet;
    const wasOpen = sheet?.rendered && !sheet.minimized;
    if (wasOpen) await sheet.minimize();
    const restoreSheet = () => { if (wasOpen && sheet.rendered && sheet.minimized) sheet.maximize(); };

    clearTargets(); // start from a clean slate, not leftovers from an earlier use
    const ok = await new TargetPrompt({ activity, range, max, source }).prompt();
    if (!ok) { clearTargets(); return restoreSheet(); }

    const key = keyFor(activity);
    const isAttack = activity.type === "attack";
    // For attacks, the sheet comes back and targets clear only once the attack roll has been made;
    // the timer covers a cancelled roll dialog.
    const finish = () => { restoreSheet(); clearTargets(); };
    if (isAttack) {
      const timer = setTimeout(() => { sessions.delete(key); finish(); }, 120000);
      sessions.set(key, { finish, timer });
    } else restoreSheet();

    // The hook's activity belongs to a throwaway item clone; re-run on the real one.
    const real = actor.items.get(activity.item.id)?.system.activities?.get(activity.id) ?? activity;
    // Drop the target snapshot taken before the prompt so dnd5e re-reads the chosen targets.
    foundry.utils.deleteProperty(messageConfig, "data.system.targets");

    approved.add(key);
    try {
      await real.use(usageConfig, dialogConfig, messageConfig);
    } catch (err) {
      const session = sessions.get(key);
      if (session) { clearTimeout(session.timer); sessions.delete(key); }
      finish();
      throw err;
    } finally {
      approved.delete(key);
      if (!isAttack) clearTargets(); // attacks clear after the roll, in the postRollAttack hook
    }
  })();

  return false;
});

/** Once the attack roll we prompted for has been made, bring the actor sheet back and reset targets. */
Hooks.on("dnd5e.postRollAttack", (rolls, { subject }) => {
  const key = subject && keyFor(subject);
  const session = sessions.get(key);
  if (!session) return;
  sessions.delete(key);
  clearTimeout(session.timer);
  session.finish();
});

initRegionCleanup();
