# Roadmap

Directional; refined as subsystems mature. Tickets are specified per milestone, not up front.

| Milestone                                              | Goal                                                                                                      |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| **M0** — Project and autonomous development foundation | Workspace, tooling, enforced boundaries, conventions, Studio lab convention, hello-world slice. **Done.** |
| **M1** — Independent technical subsystems              | Core subsystems built and verified in isolation, each with tests and (if visual) a Studio lab.            |
| **M2** — Combat engine and combat playground           | Hit/hurt boxes, attack resolution, hitstun/blockstun, combos, a playable sandbox with mannequins.         |
| **M3** — Character production pipeline                 | Character package format, schemas, rig/animation authoring, asset manifests, Character Lab.               |
| **M4** — First playable game                           | Two complete fighters, one arena, match flow.                                                             |
| **M5** — Six-character roster                          | Four more fighters; balance tooling.                                                                      |
| **M6** — Complete single-player and local multiplayer  | Menus, settings, AI opponents, local versus, audio.                                                       |
| **M7** — Online multiplayer                            | Rollback netcode built on the deterministic simulation.                                                   |

## M1 ticket graph

"Proposed deps" is the graph as originally drafted; "Recommended deps" applies the review below.
Both are pending owner approval; neither is an orch ticket yet.

| ID    | Ticket                                  | Layer(s)                  | Proposed deps | Recommended deps |
| ----- | --------------------------------------- | ------------------------- | ------------- | ---------------- |
| M1.01 | Deterministic simulation core hardening | foundation / simulation   | M0            | M0               |
| M1.02 | Device input capture and buffering      | presentation              | M1.01         | M1.01            |
| M1.03 | Gameplay command recognition            | simulation                | M1.02         | **M1.01**        |
| M1.04 | Mathematical and geometric primitives   | foundation                | M0            | M0               |
| M1.05 | Movement and kinematics engine          | simulation                | M1.01, M1.04  | **M1.01**        |
| M1.06 | Skeletal rig engine                     | animation                 | M1.04         | M1.04            |
| M1.07 | Rendering infrastructure                | presentation              | M0            | M0               |
| M1.08 | Skeletal animation engine               | animation                 | M1.06         | M1.06            |
| M1.09 | Skeletal mesh deformation and IK        | animation (+presentation) | M1.06         | **M1.08, M1.10** |
| M1.10 | Skeletal rendering integration          | presentation              | M1.06, M1.07  | M1.06, M1.07     |
| M1.11 | Camera engine                           | presentation              | M1.07         | M1.07            |
| M1.12 | Arena engine                            | presentation (+content)   | M1.07         | **M1.07, M1.11** |
| M1.13 | Visual effects engine                   | presentation              | M1.07         | **M1.01, M1.07** |
| M1.14 | Audio engine                            | presentation              | M0            | **M1.01**        |
| M1.15 | Deterministic replay system             | simulation (+app)         | M1.01, M1.02  | **M1.01**        |

### Review against the M0 repository

**Missing prerequisites (fold into M1.01, which must land alone and first):**

- **Package decomposition for simulation subsystems.** Today everything gameplay lives in
  `packages/simulation`. If movement and command recognition become their own packages, they need
  the input-frame contract, event base types, RNG and state-slice conventions from a package
  _below_ the composing `simulation` package, or the graph cycles. M1.01 should decide this
  explicitly. Either add a small `foundation` contracts package with only those types, or keep
  subsystems as modules of `packages/simulation` and accept more contention there.
- **Device-neutral input contract.** `PlayerInput` is `{ left, right }`. M1.01 should define the
  per-frame input value (directions + buttons) that M1.02 produces and M1.03/M1.15 consume.
  Without it, M1.02, M1.03 and M1.15 serialize on each other.
- **Numeric precision decision.** Gameplay is integer world units. Decide sub-unit precision
  (e.g. 1/100 unit integers) before movement adds velocities and gravity.
- **Layer-driven determinism lint.** The no-`Date`/`Math.random` ESLint block is hard-coded to
  `packages/simulation/**`; derive it from each package's declared layer before new
  simulation-layer packages appear in parallel.

**Unnecessary dependencies:**

- **M1.03 → M1.02.** Command recognition consumes recorded device-neutral frames and is tested
  with scripted input; it never needs device capture. Depending on M1.01 only lets M1.02 and
  M1.03 run in parallel.
- **M1.15 → M1.02.** Replay records the same device-neutral frames; the existing keyboard input
  is enough for its lab.
- **M1.05 → M1.04.** Simulation movement is integer arithmetic on simulation-owned state; it does
  not need a general float math library. Keeping M1.04 out of the simulation's critical path also
  keeps it from becoming a dumping ground shaped by two different numeric models.

**Missing dependencies:**

- **M1.13, M1.14 → M1.01.** Effects and audio are driven by simulation events, which M1.01
  introduces. (M1.14 does not need M1.07: audio is not rendered.)
- **M1.09 → M1.08, M1.10.** IK is a stage in the pose-evaluation pipeline that M1.08 creates.
  Mesh deformation is only observable once skeletal rendering exists. Alternatively, split M1.09
  into "IK + deformation evaluation" (after M1.08) and "deformed-mesh rendering" (after M1.10).
- **M1.12 → M1.11** if arena rendering includes parallax, which is a function of camera position.

**Overlapping responsibilities to resolve in the specs:**

- **Arena bounds** are gameplay (M1.05 owns walls and arena width in simulation state). M1.12
  owns arena _presentation_ (layers, parallax, art) and the arena content schema. Any
  gameplay-relevant camera rule (e.g. maximum fighter separation) belongs to M1.05, not M1.11.
- **Collision is unassigned.** Fighters currently pass through each other. Pushbox separation
  belongs in M1.05; hit/hurt-box overlap belongs to M2. Make that explicit in M1.05's spec.
- **Labs:** M1.02 owns the Input Lab (devices). M1.03 should get its own lab id (e.g. `commands`)
  rather than co-editing it. M1.09 extends the Animation Lab only after M1.08 lands.
- **M1.07 scope:** configurable viewport and resolution (960×540 and 2× are defaults), the
  world→screen transform, a layer/registration seam so M1.10–M1.13 add their own packages instead
  of editing `renderer/src/index.ts`, manifest-based texture loading, optional snapshot
  interpolation, and one shared host-loop helper for the game and labs (today the setup and
  teardown code is duplicated).
- **M1.06 fixtures:** a reference mannequin _and_ a non-humanoid fixture (extra limbs or wings),
  to prove the rig engine has no humanoid assumptions.

**Likely shared-file contention:**

| File(s)                                         | Touched by                            | Mitigation                                           |
| ----------------------------------------------- | ------------------------------------- | ---------------------------------------------------- |
| `packages/simulation/src/{state,step,index}.ts` | M1.01, M1.03, M1.05, M1.15            | M1.01 lands first and defines slice composition      |
| `packages/renderer/src/index.ts`                | M1.07, M1.10, M1.11, M1.12, M1.13     | M1.07 lands first with a registration seam           |
| `pnpm-lock.yaml`, `apps/studio/package.json`    | every ticket with a lab or dependency | Resolve by taking base and re-running `pnpm install` |
| `eslint.config.js`                              | each new simulation-layer package     | Layer-driven lint in M1.01                           |
| `docs/architecture.md`, `docs/roadmap.md`       | most tickets                          | Edit only the section for the subsystem              |
| `apps/game/src/App.tsx`                         | any game integration                  | Keep M1 integration in labs; game integration in M2  |

**Parallel waves with the recommended graph:**

1. M1.01 · M1.04 · M1.07
2. M1.02 · M1.03 · M1.05 · M1.15 · M1.14 (after M1.01) · M1.06 (after M1.04) · M1.11 · M1.13
   (after M1.07; M1.13 also after M1.01)
3. M1.08 · M1.10 (after M1.06 [+M1.07]) · M1.12 (after M1.11)
4. M1.09

The critical path is M1.04 → M1.06 → M1.08 → M1.09 (plus M1.10). M1.01 is the main
contention point and should get the most careful spec.

Deferred beyond M1: combat, hit/hurt boxes, combos, characters, AI, networking.
