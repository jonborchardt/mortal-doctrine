# 0002 — Custom deterministic fixed-step simulation

**Status:** Accepted (M0)

**Decision.** Gameplay runs in a custom pure-TypeScript simulation at a fixed 60 Hz, advanced by
integer frames, with serializable state and seeded randomness. No general-purpose physics engine.

**Context.** Fighting games are defined by frame data: startup, active and recovery frames, hitstun
and exact interactions. Replays, frame-step debugging, automated balance testing and eventual
rollback netcode all require that identical state and inputs give identical results, everywhere.

**Alternatives.**

- Physics engine (Matter.js, Rapier, Box2D): continuous dynamics we do not want; not designed for
  cheap snapshot/restore; cross-platform determinism is not guaranteed for float builds.
- Variable timestep: frame data becomes time-based and inconsistent across machines.
- Fixed-point arithmetic everywhere: strongest cross-platform guarantee, but costly to write and
  read; not needed while gameplay values are integers.

**Rationale.** Fighting-game "physics" is simple (axis-aligned boxes, scripted motion). A small
custom simulation is easier to keep deterministic, serializable and headless than an adapted
engine.

**Consequences.** We implement movement, collision and combat ourselves. Gameplay code must avoid
clocks, `Math.random`, nondeterministic iteration and unintended float behavior; ESLint and the
simulation `tsconfig` enforce the mechanical parts. Numeric precision beyond integers is an
explicit later decision.
