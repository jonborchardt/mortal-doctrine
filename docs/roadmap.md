# Roadmap

Directional; refined as subsystems mature. Work is tracked as orch tickets, not in this file.

| Milestone                                              | Goal                                                                                                |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| **M0** — Project and autonomous development foundation | Workspace, tooling, enforced boundaries, conventions, Studio lab convention, hello world. **Done.** |
| **M1** — Independent technical subsystems              | Core subsystems built and verified in isolation, each with tests and (if visual) a Studio lab.      |
| **M2** — Combat engine and combat playground           | Hit/hurt boxes, attack resolution, hitstun/blockstun, combos, a playable sandbox with mannequins.   |
| **M3** — Character production pipeline                 | Character package format, schemas, rig/animation authoring, asset manifests, Character Lab.         |
| **M4** — First playable game                           | Two complete fighters, one arena, match flow.                                                       |
| **M5** — Six-character roster                          | Four more fighters; balance tooling.                                                                |
| **M6** — Complete single-player and local multiplayer  | Menus, settings, AI opponents, local versus, audio polish.                                          |
| **M7** — Online multiplayer                            | Rollback netcode built on the deterministic simulation.                                             |

## M1 backlog

The individual specifications, acceptance criteria and status live in **orch** (the source of
truth): `orch ticket show <id>`, or `orch ticket list --repo .` for the whole milestone. This
table only maps planning ids to tickets.

**M1.01 (#182) is the foundation gate.** Every other M1 ticket has a blocking orch dependency on
it, so none becomes ready until it merges. M1.17 is nonblocking technical debt.

| ID    | orch | Ticket                                      | Priority | Depends on | Layer(s)                 |
| ----- | ---- | ------------------------------------------- | -------- | ---------- | ------------------------ |
| M1.01 | #182 | Deterministic simulation core and contracts | P1       | —          | foundation, simulation   |
| M1.02 | #183 | Device input capture and buffering          | P1       | 01         | presentation             |
| M1.03 | #184 | Gameplay command recognition                | P1       | 01         | simulation               |
| M1.04 | #185 | Mathematical and geometric primitives       | P1       | 01         | foundation               |
| M1.05 | #186 | Movement, kinematics and pushboxes          | P1       | 01         | simulation               |
| M1.06 | #187 | Skeletal rig engine                         | P1       | 01, 04     | animation                |
| M1.07 | #188 | Rendering infrastructure and extension API  | P1       | 01         | presentation             |
| M1.08 | #189 | Skeletal animation engine                   | P1       | 01, 06     | animation                |
| M1.09 | #190 | Inverse kinematics and pose constraints     | P2       | 01, 06, 08 | animation                |
| M1.10 | #191 | Skeletal rendering integration              | P1       | 01, 06, 07 | presentation             |
| M1.11 | #192 | Camera engine                               | P2       | 01, 07     | presentation             |
| M1.12 | #193 | Arena and parallax engine                   | P2       | 01, 07, 11 | presentation (+ content) |
| M1.13 | #194 | Visual effects engine                       | P2       | 01, 07     | presentation             |
| M1.14 | #195 | Audio engine                                | P2       | 01         | presentation             |
| M1.15 | #196 | Deterministic replay system                 | P1       | 01         | simulation (+ app)       |
| M1.16 | #197 | Skeletal mesh deformation and skinning      | P2       | 01, 06, 10 | animation, presentation  |
| M1.17 | #198 | Windows development process cleanup         | P3       | 01         | tooling                  |
| M1.18 | #199 | M1 technical integration and acceptance     | P1       | 01–16      | application              |

**Parallel waves** (after M1.01 merges): {02, 03, 04, 05, 07, 14, 15, 17} → {06, 11, 13} →
{08, 10, 12} → {09, 16} → 18. Critical path: 04 → 06 → 08 → 09, and 06 + 07 → 10 → 16.

## Architectural decisions carried into M1

- **Input:** device capture (M1.02, presentation) is separate from command recognition (M1.03,
  simulation). Both consume the device-neutral input frame and the canonical SOCD rule from
  M1.01. Replay (M1.15) records those same authoritative frames, never device events.
- **Arena:** gameplay bounds and arena width belong to movement (M1.05). Presentation geometry
  and parallax belong to M1.12, which consumes the camera (M1.11).
- **Collision:** pushbox separation belongs to M1.05. Hitboxes and hurtboxes belong to M2.
- **Labs:** separate labs for Input (`input`) and Command Recognition (`commands`); IK gets
  `pose-constraints`; integration gets `integration`.
- **Rendering:** M1.07 provides the layer/renderable registration seam, so M1.10–M1.13 add
  packages instead of editing `packages/renderer`.
- **Events:** effects (M1.13), audio (M1.14) and camera shake (M1.11) consume simulation events
  and must stay idempotent when frames are re-simulated (restore, seek, future rollback).
- **Skeletons:** rig evaluation (M1.06), animation evaluation (M1.08), constraints (M1.09) and
  skinning evaluation (M1.16) are animation-layer and Pixi-free. Drawing is M1.10/M1.16.

## Planning notes

- **Dependency kinds.** Orch dependencies express architectural or delivery dependencies only.
  Shared-file contention is resolved by ownership boundaries (who owns which file or seam), not by
  serializing independent work.
- **M1.05 stays independent of rendering.** Its Movement Lab uses a lab-local view or an existing
  public renderer interface, never renderer internals.
- **Arena consistency is checked in M1.18.** M1.05 (gameplay bounds) and M1.12 (visual geometry)
  each follow the coordinate conventions on their own; M1.18 verifies they agree.
- **M1.04 is provisional.** Its spec challenge must confirm a meaningful capability with several
  consumers, or recommend folding it into M1.06.
- **Skeleton Lab** is extended in sequence by M1.10 and M1.16; the Animation Lab adopts Pixi
  rendering in M1.18.
- **Shared-file hotspots:** `packages/simulation` composition (M1.03, M1.05, M1.15 add phases or
  hooks), `apps/studio/package.json` and `pnpm-lock.yaml` (every lab; see
  [build-system.md](build-system.md#lockfile-conflicts)), and `apps/game/src/App.tsx` (game
  integration waits for M1.18).
