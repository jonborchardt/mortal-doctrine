import { useState, type PointerEvent } from 'react';
import { constraintStage, loadConstraints, runPipeline } from '@mortal-doctrine/animation';
import { MANNEQUIN_REACH } from '@mortal-doctrine/animation/testing';
import { apply, degToRad, IDENTITY, radToDeg, type Vec2 } from '@mortal-doctrine/math';
import { evaluate, loadRig } from '@mortal-doctrine/rig';
import { MANNEQUIN_RIG } from '@mortal-doctrine/rig/testing';

const RIG = loadRig(MANNEQUIN_RIG);
const REACH = MANNEQUIN_REACH.constraints.find((constraint) => constraint.type === 'two-bone-ik');
if (!REACH) throw new Error('The MANNEQUIN_REACH fixture has no two-bone IK constraint');
const START = REACH;
const LIMITS = MANNEQUIN_REACH.constraints.filter((constraint) => constraint.type === 'limit');

// The view, in world units (y up); the SVG flips y.
const VIEW = { left: -130, right: 130, bottom: -15, top: 195 };
const ARC_RADIUS = 14;
const ARC_STEPS = 24;

/** Two decimals, without the `-0.00` a float residue would print. */
const fixed = (value: number) => (Math.round(value * 100) / 100 + 0).toFixed(2);
const point = ({ x, y }: Vec2) => `${fixed(x)}, ${fixed(y)}`;
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const distance = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);

export function PoseConstraintsLab() {
  const [target, setTarget] = useState<Vec2>(START.target);
  const [bend, setBend] = useState(START.bend);
  const [mix, setMix] = useState(START.mix);

  // All pose math is the production packages'; the lab only edits the constraint data and draws.
  const constraints = loadConstraints({
    ...MANNEQUIN_REACH,
    constraints: MANNEQUIN_REACH.constraints.map((constraint) =>
      constraint.type === 'limit'
        ? constraint
        : constraint.type === 'aim'
          ? { ...constraint, target, mix }
          : { ...constraint, target, mix, bend },
    ),
  });
  const pose = runPipeline(RIG, {}, [constraintStage(RIG, constraints)]);
  const world = new Map(evaluate(RIG, pose).bones.map(({ id, transform }) => [id, transform]));
  const bones = new Map(
    RIG.bones.map((bone) => {
      const transform = world.get(bone.id) ?? IDENTITY;
      return [
        bone.id,
        {
          ...bone,
          rotation: pose.bones?.[bone.id]?.rotation ?? bone.rest.rotation,
          origin: { x: transform.tx, y: transform.ty },
          tip: apply(transform, { x: bone.length, y: 0 }),
          parentWorld: (bone.parent === null ? undefined : world.get(bone.parent)) ?? IDENTITY,
        },
      ];
    }),
  );
  const forearm = bones.get(START.child);
  const root = bones.get(START.parent)?.origin ?? { x: 0, y: 0 };
  const effector = forearm?.tip ?? root;
  const fullReach = forearm ? distance(root, forearm.origin) + forearm.length : 0;

  const dragTo = (event: PointerEvent<SVGCircleElement>) => {
    const matrix = event.currentTarget.ownerSVGElement?.getScreenCTM()?.inverse();
    if (!matrix) return;
    // Screen to view box. Whole world units keep the readouts exact.
    const at = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix);
    setTarget({
      x: clamp(Math.round(at.x), VIEW.left, VIEW.right),
      y: clamp(Math.round(-at.y), VIEW.bottom, VIEW.top),
    });
  };
  const setCoordinate = (axis: 'x' | 'y', value: number) => {
    if (Number.isFinite(value)) setTarget({ ...target, [axis]: value });
  };

  const fieldClass = 'rounded bg-neutral-800 px-2 py-1 text-sm';
  const labelClass = 'flex items-center gap-2 text-sm text-neutral-400';

  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold">Pose Constraints Lab</h1>
      <div className="flex flex-wrap items-center gap-4">
        <label className={labelClass}>
          Target x
          <input
            type="number"
            className={`${fieldClass} w-20`}
            min={VIEW.left}
            max={VIEW.right}
            value={target.x}
            onChange={(event) => setCoordinate('x', event.target.valueAsNumber)}
          />
        </label>
        <label className={labelClass}>
          Target y
          <input
            type="number"
            className={`${fieldClass} w-20`}
            min={VIEW.bottom}
            max={VIEW.top}
            value={target.y}
            onChange={(event) => setCoordinate('y', event.target.valueAsNumber)}
          />
        </label>
        <label className={labelClass}>
          Mix
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={mix}
            onChange={(event) => setMix(event.target.valueAsNumber)}
          />
          <output data-testid="pose-mix" className="font-mono">
            {mix.toFixed(2)}
          </output>
        </label>
        <label className={labelClass}>
          Bend
          <select
            className={fieldClass}
            value={bend}
            onChange={(event) => setBend(event.target.value === '1' ? 1 : -1)}
          >
            <option value={1}>elbow left of the reach line (1)</option>
            <option value={-1}>elbow right of the reach line (-1)</option>
          </select>
        </label>
        <button
          type="button"
          className="rounded bg-neutral-800 px-3 py-1 text-sm hover:bg-neutral-700"
          onClick={() => {
            setTarget(START.target);
            setBend(START.bend);
            setMix(START.mix);
          }}
        >
          Reset
        </button>
      </div>
      <div className="flex flex-wrap items-start gap-6">
        <svg
          role="img"
          aria-label={`${RIG.id} rig reaching for the target`}
          data-testid="pose-view"
          viewBox={`${VIEW.left} ${-VIEW.top} ${VIEW.right - VIEW.left} ${VIEW.top - VIEW.bottom}`}
          className="w-[36rem] max-w-full rounded border border-neutral-800 bg-neutral-950"
        >
          <line x1={VIEW.left} y1={0} x2={VIEW.right} y2={0} stroke="#404040" strokeWidth={0.5} />
          {LIMITS.map(({ bone: id, min, max }) => {
            const bone = bones.get(id);
            if (!bone) return null;
            // The allowed directions of the bone's +x axis, mapped from its parent's space.
            const arc = Array.from({ length: ARC_STEPS + 1 }, (_, step) => {
              const angle = degToRad(min + ((max - min) * step) / ARC_STEPS);
              const { x, y } = apply(bone.parentWorld, {
                x: bone.rest.translation.x + ARC_RADIUS * Math.cos(angle),
                y: bone.rest.translation.y + ARC_RADIUS * Math.sin(angle),
              });
              return `L${x} ${-y}`;
            });
            return (
              <path
                key={id}
                data-limit={id}
                d={`M${bone.origin.x} ${-bone.origin.y}${arc.join('')}Z`}
                fill="#38bdf833"
                stroke="#38bdf8"
                strokeWidth={0.5}
              >
                <title>{`${id} limit: ${min}° to ${max}°`}</title>
              </path>
            );
          })}
          {[...bones.values()].map(({ id, origin, tip }) => (
            <g key={id} data-bone={id}>
              <title>{`bone ${id}`}</title>
              <line
                x1={origin.x}
                y1={-origin.y}
                x2={tip.x}
                y2={-tip.y}
                stroke="#e5e5e5"
                strokeWidth={2}
                strokeLinecap="round"
              />
            </g>
          ))}
          <circle cx={effector.x} cy={-effector.y} r={2.5} fill="none" stroke="#4ade80" />
          <circle
            data-testid="pose-target-handle"
            cx={target.x}
            cy={-target.y}
            r={5}
            fill="#f9731666"
            stroke="#f97316"
            className="cursor-grab touch-none"
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              dragTo(event);
            }}
            onPointerMove={(event) => {
              if (event.buttons & 1) dragTo(event);
            }}
          >
            <title>target: drag to move</title>
          </circle>
        </svg>
        <div className="space-y-4">
          <section aria-labelledby="pose-reach-heading">
            <h2 id="pose-reach-heading" className="mb-1 text-sm text-neutral-400">
              Reach (world units)
            </h2>
            <dl className="grid w-fit grid-cols-[auto_auto] gap-x-4 font-mono text-xs">
              <dt>target</dt>
              <dd data-testid="pose-target">{point(target)}</dd>
              <dt>end effector ({START.child} tip)</dt>
              <dd data-testid="pose-effector">{point(effector)}</dd>
              <dt>effector distance from the {START.parent} origin</dt>
              <dd>
                <span data-testid="pose-effector-distance">{fixed(distance(root, effector))}</span>{' '}
                of {fixed(fullReach)} full reach
              </dd>
            </dl>
          </section>
          <section aria-labelledby="pose-limits-heading">
            <h2 id="pose-limits-heading" className="mb-1 text-sm text-neutral-400">
              Limited bone rotations (local, degrees, counter-clockwise)
            </h2>
            <dl className="grid w-fit grid-cols-[auto_auto] gap-x-4 font-mono text-xs">
              {LIMITS.map(({ bone: id, min, max }) => {
                const rotation = bones.get(id)?.rotation ?? 0;
                const atLimit = rotation === degToRad(min) || rotation === degToRad(max);
                return (
                  <div key={id} className="contents">
                    <dt>
                      {id} [{min}°, {max}°]
                    </dt>
                    <dd data-testid={`pose-limit-${id}`}>
                      {fixed(radToDeg(rotation))}°{atLimit ? ' (at limit)' : ''}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </section>
        </div>
      </div>
      <p className="text-sm text-neutral-400">
        The pose is the rest pose run through the constraint stage of{' '}
        <code>@mortal-doctrine/animation</code> with the <code>MANNEQUIN_REACH</code> fixture:
        two-bone IK on the right arm and an aim on the head, both at the target and the mix weight,
        then the angle limits (drawn in blue). Drag the orange target or type its position; the
        green ring is the end effector. Limits are hard: they apply at any mix. The drawing is a
        lab-local debug view.
      </p>
    </section>
  );
}
