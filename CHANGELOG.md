# Changelog

All notable changes to Auto Target Prompt. Targets Foundry VTT v14 and dnd5e 6.0.

## [0.2.0] - 2026-11-12

### Added
- Area spells (e.g. Fireball) open the target prompt after the template is placed, with no maximum, so the player clicks whoever is caught in the area. The chat card is updated with those targets and switched to Targeted mode on every client, so Save and damage buttons use them instead of selected tokens. Map targets are then cleared.
- A Skip button on the target prompt uses the ability with no targets. Cancel still aborts the use.

### Changed
- Attack targets are now kept through the damage roll (previously cleared as soon as the attack was rolled), then cleared. The next target prompt also starts from a clean slate.

### Fixed
- Targeting could be left permanently additive if a second prompt opened or one errored. The targeting override is now installed once and only active while a prompt is open.
- Opening a second prompt (for example a double-click on an item) is ignored while one is already open.
- Cancelling dnd5e's own configuration dialog, or a use failing, no longer leaves the actor sheet minimized and targets set.
- Expired-area cleanup only runs when the combat round or turn changes, skips scenes without regions, and no longer runs overlapping sweeps.

## [0.1.0] - 2026-10-08

### Added
- Target prompt shown before an activity is used, for activities that name a creature target and a range.
  - Pick anywhere from 1 up to the maximum number of targets, then press Confirm. Exceeding the maximum is rejected with a notice.
  - Range is read from the activity or item as written: feet, miles, metres, kilometres, touch, weapon reach, normal/long range, self, any and special. Distance is measured edge to edge and includes elevation.
  - Out-of-range targets are shown in red. Confirming still works and posts a warning.
  - Attack activities with no target count default to a single target. Self-range, `self`/`space` target types and template-area effects skip the prompt.
- Plain left-click targets tokens while the prompt is open, including tokens the player doesn't own. The prompt switches to Foundry's Target tool and restores the previous tool afterwards.
- The prompt remembers where it was last placed.
- The actor's sheet minimizes while targeting and comes back once the attack roll is made.
- Attack activities roll the attack automatically after Confirm. Targets are kept until the attack is rolled, then cleared.
- Timed spell areas (regions placed by dnd5e) are removed automatically when their duration ends: combat rounds, turns and minutes while in combat, world time otherwise. Instantaneous, permanent, until-dispelled and special durations are kept.
- GM-only "Clear Spell Areas" button in the Token controls removes every dnd5e-placed area from the current scene, after a confirmation.
- Settings: enable the target prompt (per client), and remove timed areas when they expire (world).
