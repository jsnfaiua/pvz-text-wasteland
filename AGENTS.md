# Repository Guidelines

## Project Structure & Module Organization

This repository is a browser-based, text-themed Plants vs. Zombies game. `index.html`, `style.css`, and `game-init.js` are the page, global styling, and application entry point. Keep reusable JavaScript in `source-code/`: engine primitives belong in `core/`, gameplay behavior in `systems/`, player logic in `entities/`, screens and HUD code in `ui/`, persistence in `persistence/`, networking in `multiplayer/`, and wasteland-specific features in `mod-wasteland/`. Audio assets live under `assets/audio/`. Treat `backup/` as reference material, `docs/` as design documentation, and `saves/` plus `users.json` as runtime data rather than source code.

## Build, Test, and Development Commands

No dependency installation or compilation step is required.

- `RUN.bat` starts the preferred local server on port 8000 and opens the game.
- `node server.js` starts the Node server directly; then visit `http://localhost:8000`.
- `powershell -ExecutionPolicy Bypass -File ps-server.ps1` uses the PowerShell server fallback.
- `node dev-tools/smoke-test.js` checks wasteland imports, basic exports, and pure-function assertions (including the `wstate.js` whitelist serialization round-trip). It currently reports browser-only globals in Node, so also test affected screens in a browser.
- `node dev-tools/full-run-test.mjs` runs the full in-headless simulation across multiple seeds (spawn/search/craft/melee/drive/save-load round-trips); run after touching `wstate.js` or `survival.js` save/load paths.
- `node dev-tools/cdp-diagnose.mjs` (with `node server.js` + Chrome `--remote-debugging-port=9222` running) drives a real browser into the wasteland and asserts screen switch, canvas rendering, and zero console errors.
- Wasteland multiplayer (Phase 1): `source-code/mod-wasteland/mpWasteland.js` — `startWastelandMP('host'|'guest')` reuses `window.Net.mp` (PeerJS room layer). It must only import `survival.js` exports plus leaf modules (`world.js`/`wlook.js`) to stay out of the circular dependency zone. Handshake topic is `wstart` (`{seed, difficulty, character}`); host generates the seed, both sides generate the same deterministic world locally. To test real P2P, launch two Chrome instances with **separate `--user-data-dir`** (same-profile two tabs cannot connect PeerJS — IndexedDB cache collision yields `peer-unavailable`).
- `node dev-tools/car-pathfinding-test.js [--trials N] [--seed N] [--verbose]` runs the car pathfinding regression suite: full-frame drive simulations of cross-terrain trips (city/suburb/ruins/wild starts × camp/city/suburb/ruins/free destinations × full/realistic fuel), obstacle/vehicle/junk avoidance, jammed-road pressure, and out-of-fuel graceful stop. It must never deadlock, wreck without reason, or loop indefinitely; unreachable targets are expected to stop at the nearest drivable spot with a message.
- `node dev-tools/astar-verify.mjs [--seeds N] [--rounds N]` verifies the shared A* pathfinding (`source-code/mod-wasteland/wpath.js`): asserts reachability is never lost vs the legacy Dijkstra reference, path cost is never worse, no wall-corner cutting / tile skipping, and `astarPath` single-path consistency. Run after touching any pathfinding logic.
- `powershell -ExecutionPolicy Bypass -File dev-tools/CHECK-MODULES.ps1` checks module paths and duplicate declarations.

## Coding Style & Naming Conventions

Use ES modules for browser code, four-space indentation, semicolons, single-quoted strings, and trailing commas in multiline objects. Follow existing `camelCase` names for variables/functions and `UPPER_SNAKE_CASE` for constants. Keep modules focused and preserve the dependency direction described in `docs/ARCHITECTURE.md`. There is no configured formatter or linter; match adjacent code and avoid unrelated reformatting.

**Serialization rule (mandatory):** never `JSON.stringify` a whole game-state object (e.g. `sv`) — it contains DOM/canvas/function references and will either throw or corrupt. All save files and multiplayer snapshots must use explicit whitelist fields. The wasteland module centralizes this in `source-code/mod-wasteland/wstate.js` (`serializeSV` / `applySnapshot` / `createRunDefaults`), shared by both save/load and the future `mpWasteland.js` sync layer. New state to persist must be added to that whitelist, not serialized ad hoc.

## Development Baseline (mandatory — treat as contract)

The authoritative design reference is `docs/系统架构与设计文档.md` (with `docs/architecture-diagram.svg`). All subsequent development MUST follow it. The following invariants are non-negotiable; breaking any of them is a defect, not a design choice:

1. **Single-player / multiplayer zero-difference (hard goal).** Multiplayer may only add "more players playing together". Every gameplay rule, input feedback, numeric outcome, effect, sound, UI, drop, settlement, and save/progress behavior must be identical to single-player. Any inconsistency must be fixed, never kept as a "design difference" (checklist in the doc §5).
2. **Serialization single source of truth** = `wstate.js` whitelist (see Serialization rule above). Never `JSON.stringify(sv)`. New persistent/synced state goes into the whitelist.
3. **Circular dependency zones must not grow.** `render↔windoor↔wzombie`, `wnpc↔wgear`, `wvehicle→wdev→wnpc→wvehicle`. New modules must not be dragged into them.
4. **Multiplayer host-authority model must be preserved.** `updateGuest` split; 100ms wsync snapshot (34-tile spatial culling); wevt events (50ms outbox); wdiff bidirectional terrain edits; host-authoritative combat/bite/drops/summons/dev; guest never deducts its own HP; zombies merged by runtime id; NPC parties managed locally per side; Terraria-style dual saves (world save belongs to host).
5. **Performance red lines (frame-rate defenses, doc §6.1) must never regress.** Save writes queued out of the RAF loop; zombie A* flow field rebuild throttled (0.35s cooldown + targets near-field only); driving BFS chunked across frames; snapshot payloads spatially culled; effects/drops/bullets hard-capped; no main-loop crash on malformed entity data. New per-frame logic must not introduce frame spikes; a frozen RAF main loop is the worst possible regression.
6. **Verification discipline.** Touch `wstate.js`/`survival.js` save paths → run `smoke-test.js` + `full-run-test.mjs`. Touch pathfinding → run `astar-verify.mjs` (+ `car-pathfinding-test.js` for vehicles). Touch render/main-loop/multiplayer → verify in a real browser: `_cdp-perf.mjs` (single-player FPS scenarios) and `_cdp-mp-real.mjs` (two Chrome instances, real multiplayer); confirm host and guest both run at full frame rate with zero long frames and zero `Runtime.exceptionThrown`.

## Testing Guidelines

Add focused assertions to `dev-tools/smoke-test.js` for testable wasteland logic. Name assertions by module and behavior. Before submitting, run both checks above and manually verify startup, the changed screen, save/load behavior, and multiplayer behavior when relevant. No coverage threshold is currently enforced.

## Commit & Pull Request Guidelines

Git history is unavailable in this checkout. Use concise imperative commits such as `fix: prevent duplicate wave spawn`. Keep each commit scoped. Pull requests should explain behavior changes, list verification steps, link relevant issues, and include screenshots or short recordings for visual changes. Do not commit real account data or personal save files.

## Agent-Specific Instructions

Never bulk-delete files without explicit approval; delete individual files with one command per file. After implementing a feature or bug fix, document how to use and configure it.
