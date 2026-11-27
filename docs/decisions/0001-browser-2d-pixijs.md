# 0001 — Browser-native 2D rendering with PixiJS

**Status:** Accepted (M0)

**Decision.** The game runs in the browser and renders strictly 2D with PixiJS v8. React is used
only for application UI and tooling.

**Context.** The game must be easy to distribute and to develop with fast iteration, and the
Studio needs rich interactive tooling next to the renderer. Combat is strictly 2D.

**Alternatives.**

- Native engine (Godot, Unity): strong editors, but heavier toolchains, harder agent-driven
  development and testing, and web export is secondary.
- Phaser: a full game framework with its own scene, physics and loop model, most of which we would
  bypass for a custom deterministic simulation.
- Raw Canvas 2D / WebGL: maximum control, but we would rebuild batching, textures, meshes and
  filters.
- React-driven rendering (e.g. react-pixi): puts React reconciliation in the frame loop.

**Rationale.** PixiJS is a focused, fast WebGL/WebGPU 2D renderer with meshes (needed for
deformation), filters and texture atlases, and no opinion about game logic. Browser delivery gives
Playwright-testable everything.

**Consequences.** We own the game loop, scene management and asset loading. Headless CI needs
software WebGL (SwiftShader). Rendering performance depends on browser and GPU.
