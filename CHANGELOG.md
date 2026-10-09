# Changelog

All notable changes to Auto Target Prompt. Targets Foundry VTT v14 and dnd5e 6.0.

## [Unreleased]

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
