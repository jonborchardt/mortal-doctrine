import { Container, Graphics } from 'pixi.js';
import { worldToScreen, type Renderable, type View } from '@mortal-doctrine/renderer';
import {
  parseEffectDefinitions,
  parseEffectMapping,
  type EffectDefinition,
  type EffectMapping,
} from './definitions';

/**
 * Spawned-event keys whose frame is more than this many frames before the newest snapshot frame
 * are forgotten (10 s at 60 Hz).
 */
export const KEY_WINDOW_FRAMES = 600;

export interface ActiveEffect {
  /** The effect definition's id. */
  readonly id: string;
  /** Identity of the event that spawned it. */
  readonly key: string;
  readonly ageMs: number;
  readonly lifetimeMs: number;
}

export interface EffectsRenderableOptions {
  readonly definitions: readonly EffectDefinition[];
  readonly mapping: EffectMapping;
  /** The renderer layer to mount in. Default `effects`. */
  readonly layer?: string;
}

export interface EffectsRenderable extends Renderable {
  /** Ages every active effect by `elapsedMs` of display time and removes the expired ones. */
  advance(elapsedMs: number): void;
  /** Destroys every active effect and forgets every spawned event (host-driven restore/seek). */
  clear(): void;
  /** Active effects, oldest first. */
  readonly active: readonly ActiveEffect[];
}

interface Effect {
  readonly definition: EffectDefinition;
  readonly key: string;
  readonly container: Container;
  /** Unit direction per particle; empty for a sprite. */
  readonly directions: readonly { x: number; y: number }[];
  /** World position in sub-units. */
  readonly x: number;
  readonly y: number;
  ageMs: number;
}

/**
 * Spawns placeholder effects for the mapped events of each drawn frame, once per event
 * identity, at the event's fighter. Effects age only by `advance`. Mount it with
 * `ArenaRenderer.register`. Throws naming the field for invalid definitions or mapping.
 */
export function createEffectsRenderable(options: EffectsRenderableOptions): EffectsRenderable {
  const definitions = parseEffectDefinitions(options.definitions);
  const mapping = parseEffectMapping(options.mapping, definitions);
  const byId = new Map(definitions.map((definition) => [definition.id, definition]));

  const container = new Container({ label: 'effects' });
  let effects: Effect[] = [];
  /** Event key → its frame. */
  const spawned = new Map<string, number>();
  let lastFrame: number | undefined;
  let view: View | undefined;
  let destroyed = false;

  const place = (effect: Effect) => {
    if (!view) return;
    const { x, y } = worldToScreen(view, effect.x, effect.y);
    effect.container.position.set(x, y);
    effect.container.scale.set(view.scale);
  };
  const animate = ({ definition, container: root, directions, ageMs }: Effect) => {
    const t = Math.min(1, ageMs / definition.lifetimeMs);
    root.alpha = 1 - t;
    if (definition.kind === 'sprite') root.children[0]?.scale.set(0.5 + 0.5 * t);
    else {
      directions.forEach(({ x, y }, index) =>
        root.children[index]?.position.set(
          x * definition.distance * t,
          y * definition.distance * t,
        ),
      );
    }
  };

  const clear = () => {
    for (const effect of effects) effect.container.destroy({ children: true });
    effects = [];
    spawned.clear();
  };

  const spawn = (definition: EffectDefinition, key: string, x: number, y: number) => {
    const root = new Container({ label: definition.id });
    const directions: { x: number; y: number }[] = [];
    const { size, colour } = definition;
    if (definition.kind === 'sprite') {
      root.addChild(new Graphics().circle(0, 0, size / 2).fill(colour));
    } else {
      for (let index = 0; index < definition.count; index++) {
        // Screen space is y-down; any direction is fine as long as it is a fixed function.
        const angle = (hash(`${key}#${index}`) / 2 ** 32) * 2 * Math.PI;
        directions.push({ x: Math.cos(angle), y: Math.sin(angle) });
        root.addChild(new Graphics().rect(-size / 2, -size / 2, size, size).fill(colour));
      }
    }
    const effect: Effect = { definition, key, container: root, directions, x, y, ageMs: 0 };
    container.addChild(root);
    effects.push(effect);
    place(effect);
    animate(effect);
  };

  return {
    layer: options.layer ?? 'effects',
    container,
    update({ state, events, view: frameView }) {
      if (destroyed) return;
      view = frameView;
      if (lastFrame !== undefined && state.frame < lastFrame) clear();
      lastFrame = state.frame;
      for (const [key, frame] of spawned) {
        if (frame < state.frame - KEY_WINDOW_FRAMES) spawned.delete(key);
      }

      const occurrences = new Map<string, number>();
      for (const event of events) {
        const target = mapping[event.type];
        if (!target) continue;
        const fields = event as unknown as Readonly<Record<string, unknown>>;
        const base = JSON.stringify(
          Object.keys(fields)
            .sort()
            .map((field) => [field, fields[field]]),
        );
        const occurrence = occurrences.get(base) ?? 0;
        occurrences.set(base, occurrence + 1);
        const key = `${base}#${occurrence}`;
        if (spawned.has(key)) continue;
        spawned.set(key, event.frame);
        const fighter = state.fighters[event.player];
        const definition = byId.get(target.effect)!;
        spawn(
          definition,
          key,
          fighter.x + (target.offset?.x ?? 0),
          fighter.y + (target.offset?.y ?? 0),
        );
      }
      for (const effect of effects) place(effect);
    },
    advance(elapsedMs) {
      if (destroyed || !(elapsedMs > 0)) return;
      effects = effects.filter((effect) => {
        effect.ageMs += elapsedMs;
        if (effect.ageMs < effect.definition.lifetimeMs) {
          animate(effect);
          return true;
        }
        effect.container.destroy({ children: true });
        return false;
      });
    },
    clear,
    get active() {
      return effects.map(({ definition, key, ageMs }) => ({
        id: definition.id,
        key,
        ageMs,
        lifetimeMs: definition.lifetimeMs,
      }));
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      clear();
      container.destroy({ children: true });
    },
  };
}

// FNV-1a with a final avalanche, as in `@mortal-doctrine/audio`.
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
