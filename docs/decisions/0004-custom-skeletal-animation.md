# 0004 — Custom declarative 2D skeletal animation

**Status:** Accepted; not yet implemented (M1+)

**Decision.** Characters use hierarchical 2D skeletons with illustrated attachments, driven by a
custom, declarative, serializable animation system that can also be authored programmatically.
Evaluation lives in a presentation-independent layer.

**Context.** Characters are asymmetric (extra arms, wings, summons, changing attachments) and
heavily stylized. Animation should be generated and edited by agents as data, inspected in Studio,
and evaluated deterministically where gameplay needs a transform.

**Alternatives.**

- Spine / DragonBones runtimes: mature editors, but commercial licensing (Spine), binary/editor-
  centric workflows, and runtimes we cannot make deterministic or extend per character.
- Frame-by-frame sprite sheets: simple, but expensive to produce for many characters and moves,
  and inflexible for attachments and variations.

**Rationale.** A data-first rig and animation format fits agent-driven authoring, testing and
Studio labs, and supports per-character skeletal extensions without engine forks.

**Consequences.** We build keyframes, interpolation, IK, mesh deformation and attachment swapping
ourselves, incrementally. Animation never determines combat timing; move frame data does.
