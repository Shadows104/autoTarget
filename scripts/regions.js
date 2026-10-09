/**
 * Cleans up the template regions dnd5e creates for area activities:
 *  - timed effects are removed when their duration runs out (combat rounds/turns while in combat,
 *    otherwise world time). Permanent / until-dispelled / special durations are left alone.
 *
 * On placement we store an expiry plan in a flag on the region. The active GM then sweeps for
 * expired regions whenever combat or world time advances.
 */

const MODULE_ID = "auto-target";
const FLAG = "expiry";

const SECONDS = {
  second: 1, round: 6, turn: 6, minute: 60, hour: 3600, day: 86400, month: 2592000, year: 31536000
};
/** Durations with no definite end (and instantaneous effects, which stay until the GM clears them). */
const OPEN_ENDED = new Set(["inst", "perm", "disp", "dstr", "spec"]);
/** Combat rounds in a minute. */
const ROUNDS_PER_MINUTE = 10;

export function registerRegionSettings() {
  game.settings.register(MODULE_ID, "cleanUpRegions", {
    name: "AUTOTARGET.SettingCleanup",
    hint: "AUTOTARGET.SettingCleanupHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });
}

/**
 * Work out when a region placed for this activity should disappear.
 * @returns {object|null}  Expiry plan, or null if the region should stay.
 */
function planExpiry(activity) {
  const { units, value, expiry } = activity.duration ?? {};
  if (!units || OPEN_ENDED.has(units) || !(units in SECONDS)) return null;
  const amount = Number(value);
  if (!(amount > 0)) return null;

  // Combat-tracked durations: expire relative to the caster's place in the turn order.
  const combat = game.combat;
  if (combat?.started && ["round", "turn", "minute"].includes(units)) {
    const N = combat.turns.length || 1;
    const combatant = combat.combatants.find(c => c.actorId === activity.actor?.id);
    const startTurn = combatant ? combat.turns.findIndex(t => t.id === combatant.id) : combat.turn;
    let round = combat.round;
    let turn = startTurn;
    if (units === "turn") {
      const total = startTurn + amount;
      round += Math.floor(total / N);
      turn = total % N;
    } else round += units === "minute" ? amount * ROUNDS_PER_MINUTE : amount;
    // Ends at the start of that turn unless the effect says it lasts through it.
    return { type: "combat", combat: combat.id, round, turn, strict: expiry === "turnEnd" };
  }

  return { type: "time", at: game.time.worldTime + amount * SECONDS[units] };
}

function isExpired(plan) {
  switch (plan?.type) {
    case "time": return game.time.worldTime >= plan.at;
    case "combat": {
      const combat = game.combats.get(plan.combat);
      if (!combat) return true; // combat ended
      if (combat.round > plan.round) return true;
      if (combat.round < plan.round) return false;
      return plan.strict ? combat.turn > plan.turn : combat.turn >= plan.turn;
    }
    default: return false;
  }
}

/** Delete every expired region we planned. Only the active GM runs this. */
async function sweep() {
  if (!game.user.isActiveGM || !game.settings.get(MODULE_ID, "cleanUpRegions")) return;
  for (const scene of game.scenes) {
    const ids = scene.regions.filter(r => isExpired(r.getFlag(MODULE_ID, FLAG))).map(r => r.id);
    if (!ids.length) continue;
    try { await scene.deleteEmbeddedDocuments("Region", ids); }
    catch (err) { console.warn(`${MODULE_ID} | could not remove expired regions`, err); }
  }
}

export function initRegionCleanup() {
  // The placing user's client records the plan.
  Hooks.on("dnd5e.postCreateMeasuredTemplate", (activity, regions) => {
    if (!game.settings.get(MODULE_ID, "cleanUpRegions")) return;
    const plan = planExpiry(activity);
    if (!plan) return;
    for (const region of regions) {
      region.setFlag(MODULE_ID, FLAG, plan).catch(err => console.warn(`${MODULE_ID} | could not flag region`, err));
    }
  });

  // The GM sweeps as time moves, plus once on load for anything that expired while away.
  Hooks.on("updateCombat", sweep);
  Hooks.on("deleteCombat", sweep);
  Hooks.on("updateWorldTime", sweep);
  Hooks.once("ready", sweep);
}

/** Regions that dnd5e placed for an activity on the given scene. */
function spellAreas(scene) {
  return scene?.regions.filter(r => r.getFlag("dnd5e", "activity")) ?? [];
}

async function clearSpellAreas() {
  const areas = spellAreas(canvas.scene);
  if (!areas.length) return ui.notifications.info(game.i18n.localize("AUTOTARGET.NoAreas"));
  const confirmed = await foundry.applications.api.DialogV2.confirm({
    window: { title: game.i18n.localize("AUTOTARGET.ClearAreas") },
    content: `<p>${game.i18n.format("AUTOTARGET.ClearAreasConfirm", { count: areas.length })}</p>`
  });
  if (confirmed) await canvas.scene.deleteEmbeddedDocuments("Region", areas.map(r => r.id));
}

/** GM-only toolbar button (Token controls) to remove every spell area from the scene. */
Hooks.on("getSceneControlButtons", controls => {
  if (!game.user.isGM || !controls.tokens) return;
  controls.tokens.tools.clearSpellAreas = {
    name: "clearSpellAreas",
    order: 50,
    title: "AUTOTARGET.ClearAreas",
    icon: "fa-solid fa-broom",
    button: true,
    onChange: () => clearSpellAreas()
  };
});
