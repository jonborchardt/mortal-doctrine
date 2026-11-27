# 0003 — Separation of simulation and presentation

**Status:** Accepted (M0)

**Decision.** The simulation produces read-only state snapshots (and, later, typed event arrays).
Rendering, effects, camera and audio consume them and never write back. The host app owns the
loop and couples the two only by passing snapshots. Simulation and display rates are independent.

**Context.** Determinism, headless testing, replays and rollback all require that nothing in
presentation can influence gameplay, and that the simulation can run with no presentation at all.

**Alternatives.**

- Game objects that own both logic and sprites (typical engine model): convenient, but couples
  gameplay to rendering and makes rollback and headless runs hard.
- An event bus shared by both sides: hides data flow and ordering; easy to create feedback loops.

**Rationale.** One-way data flow is the simplest structure that keeps the simulation pure and makes
every presentation system independently replaceable.

**Consequences.** Presentation may need to derive transient visual state (interpolation, particle
lifetimes) from snapshots and events. Rollback will re-simulate without re-triggering
presentation, so presentation must tolerate corrected snapshots. React participates in neither
loop.
