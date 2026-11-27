# Roadmap

Directional; refined as subsystems mature. Tickets are created per milestone, not up front.

| Milestone                                              | Goal                                                                                                         |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| **M0** — Project and autonomous development foundation | Workspace, tooling, enforced boundaries, conventions, Studio lab convention, hello-world slice. **Current.** |
| **M1** — Independent technical subsystems              | Core subsystems built and verified in isolation, each with tests and a Studio lab.                           |
| **M2** — Combat engine and combat playground           | Hit/hurt boxes, attack resolution, hitstun/blockstun, combos, a playable sandbox with mannequins.            |
| **M3** — Character production pipeline                 | Character package format, schemas, rig/animation authoring, asset manifests, Character Lab.                  |
| **M4** — First playable game                           | Two complete fighters, one arena, match flow.                                                                |
| **M5** — Six-character roster                          | Four more fighters; balance tooling.                                                                         |
| **M6** — Complete single-player and local multiplayer  | Menus, settings, AI opponents, local versus, audio.                                                          |
| **M7** — Online multiplayer                            | Rollback netcode built on the deterministic simulation.                                                      |

## Suggested M1 backlog (independently implementable)

Each item is a package plus tests plus a lab unless noted. Order reflects dependencies; items on
the same line can run in parallel.

1. **Simulation core hardening** — seeded PRNG in state; `step` returns `{ state, events }`;
   per-subsystem state slices; input history buffer. (Touches the shared contract — do first,
   alone.)
2. **Input** — press/release edge detection so taps shorter than a tick are not lost; gamepad;
   bindings; Input Lab. ‖ **Math foundation** — only the vector/transform helpers that the
   next items actually need.
3. **Movement** — walk, jump arcs, facing, pushboxes, arena bounds; Movement Lab. ‖
   **Skeleton** — rig schema, hierarchy evaluation, reference mannequin; Skeleton Lab.
4. **Collision** — box overlap, stable ordering; Collision Lab. ‖ **Animation** — keyframe
   evaluation and blending on the skeleton; Animation Lab.
5. **Camera** and **Effects** (presentation, event-driven) — Camera Lab, Effects Lab.
6. **Replay** — record initial state + inputs, deterministic playback; Replay Lab. Doubles as the
   determinism test harness for everything above.

Deferred beyond M1: combat, combos, characters, audio, AI, networking.
