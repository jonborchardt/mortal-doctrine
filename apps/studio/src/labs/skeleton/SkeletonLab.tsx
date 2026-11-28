import { useState } from 'react';
import { loadMesh, type Mesh } from '@mortal-doctrine/animation';
import { LIMB_MESH, LIMB_RIG } from '@mortal-doctrine/animation/testing';
import { apply, degToRad, radToDeg } from '@mortal-doctrine/math';
import { evaluate, extendRig, loadRig, type Pose, type Rig } from '@mortal-doctrine/rig';
import { MANNEQUIN_RIG, NON_HUMANOID_RIG, TAIL_EXTENSION } from '@mortal-doctrine/rig/testing';
import type { Facing } from '@mortal-doctrine/skeleton-renderer';
import { SkeletonCanvas } from './SkeletonCanvas';

const LIMB = loadRig(LIMB_RIG);
const NO_MESHES: readonly Mesh[] = [];

const FIXTURES = [
  { id: 'mannequin', name: 'Mannequin', rig: loadRig(MANNEQUIN_RIG), meshes: NO_MESHES },
  {
    id: 'non-humanoid',
    name: 'Four arms and wings',
    rig: loadRig(NON_HUMANOID_RIG),
    meshes: NO_MESHES,
  },
  {
    id: 'mannequin-tail',
    name: 'Mannequin + tail extension',
    rig: loadRig(extendRig(MANNEQUIN_RIG, TAIL_EXTENSION)),
    meshes: NO_MESHES,
  },
  // One skinned mesh across both bones: rotating `lower` bends it at the joint.
  { id: 'mesh-limb', name: 'Mesh limb', rig: LIMB, meshes: [loadMesh(LIMB, LIMB_MESH)] },
] as const;

const NONE = '';

/** Two decimals, without the `-0.00` a float residue would print. */
const fixed = (value: number) => (Math.round(value * 100) / 100 + 0).toFixed(2);

type Bone = Rig['bones'][number];

/** Bones in hierarchy order (each bone followed by its descendants), with their depth. */
function boneTree(
  rig: Rig,
  parent: string | null = null,
  depth = 0,
): { readonly bone: Bone; readonly depth: number }[] {
  return rig.bones
    .filter((bone) => bone.parent === parent)
    .flatMap((bone) => [{ bone, depth }, ...boneTree(rig, bone.id, depth + 1)]);
}

/** Outline in the view's background colour, so a label stays legible where it crosses a bone. */
const HALO = {
  stroke: '#0a0a0a',
  strokeWidth: 1.2,
  strokeLinejoin: 'round',
  paintOrder: 'stroke',
} as const;
const LABEL_SIZE = 4.5;

/** -1 left of the rig's centre line, 1 right of it, 0 on it. Labels are placed away from it. */
const sideOf = (x: number): -1 | 0 | 1 => (Math.abs(x) < 0.5 ? 0 : x < 0 ? -1 : 1);
const TEXT_ANCHOR = { [-1]: 'end', 0: 'middle', 1: 'start' } as const;

export function SkeletonLab() {
  const [fixtureId, setFixtureId] = useState<string>(FIXTURES[0].id);
  // Only what the user changed: bone rotations in degrees and attachment choices. Reset and
  // fixture changes clear both, which is the fixture's rest pose.
  const [degrees, setDegrees] = useState<Readonly<Record<string, number>>>({});
  const [attachments, setAttachments] = useState<Readonly<Record<string, string | null>>>({});
  const [facing, setFacing] = useState<Facing>(1);

  const { rig, meshes } = FIXTURES.find((fixture) => fixture.id === fixtureId) ?? FIXTURES[0];
  const reset = () => {
    setDegrees({});
    setAttachments({});
    setFacing(1);
  };
  // Degrees stop here: the pose is in radians.
  const pose: Pose = {
    bones: Object.fromEntries(
      Object.entries(degrees).map(([id, value]) => [id, { rotation: degToRad(value) }]),
    ),
    attachments,
  };
  const result = evaluate(rig, pose);
  const bones = new Map(rig.bones.map((bone) => [bone.id, bone]));
  const boneOf = (id: string): Bone => {
    const bone = bones.get(id);
    if (!bone) throw new Error(`Skeleton Lab: rig "${rig.id}" has no bone "${id}"`);
    return bone;
  };

  const buttonClass = 'rounded bg-neutral-800 px-3 py-1 text-sm hover:bg-neutral-700';
  const fieldClass = 'rounded bg-neutral-800 px-2 py-1 text-sm';

  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold">Skeleton Lab</h1>
      <div className="flex items-center gap-2">
        <label className="text-sm text-neutral-400" htmlFor="skeleton-fixture">
          Fixture rig
        </label>
        <select
          id="skeleton-fixture"
          className={fieldClass}
          value={fixtureId}
          onChange={(event) => {
            setFixtureId(event.target.value);
            reset();
          }}
        >
          {FIXTURES.map((fixture) => (
            <option key={fixture.id} value={fixture.id}>
              {fixture.name}
            </option>
          ))}
        </select>
        <button type="button" className={buttonClass} onClick={reset}>
          Reset
        </button>
        <label className="text-sm text-neutral-400" htmlFor="skeleton-facing">
          Facing (rendered view)
        </label>
        <select
          id="skeleton-facing"
          className={fieldClass}
          value={facing}
          onChange={(event) => setFacing(event.target.value === '-1' ? -1 : 1)}
        >
          <option value={1}>right (1)</option>
          <option value={-1}>left (-1)</option>
        </select>
      </div>
      <div className="flex flex-wrap items-start gap-6">
        {/* World space is y-up; the view flips y. */}
        <svg
          role="img"
          aria-label={`${rig.id} rig debug view`}
          aria-describedby="skeleton-anchor-list skeleton-slot-list"
          data-testid="skeleton-view"
          viewBox="-130 -195 260 210"
          className="w-[36rem] max-w-full rounded border border-neutral-800 bg-neutral-950"
        >
          <line x1={-130} y1={0} x2={130} y2={0} stroke="#404040" strokeWidth={0.5} />
          {result.bones.map(({ id, transform }) => {
            const tip = apply(transform, { x: boneOf(id).length, y: 0 });
            return (
              <g key={id} data-bone={id}>
                <title>{`bone ${id}`}</title>
                <line
                  x1={transform.tx}
                  y1={-transform.ty}
                  x2={tip.x}
                  y2={-tip.y}
                  stroke="#e5e5e5"
                  strokeWidth={2}
                  strokeLinecap="round"
                />
                <circle
                  cx={transform.tx}
                  cy={-transform.ty}
                  r={2}
                  fill="#171717"
                  stroke="#e5e5e5"
                />
              </g>
            );
          })}
          {result.slots.map(({ id, bone, attachment, transform }) => {
            // Drawn three quarters of the way along the slot's bone: clear of the joints at both
            // ends, and its label clears whatever is attached at the bone's middle.
            const at = apply(transform, { x: boneOf(bone).length * 0.75, y: 0 });
            // Slot labels sit below the marker; anchor labels sit level with theirs (or above or
            // below it on the centre line), so the two do not share a spot.
            const side = sideOf(at.x) || 1;
            return (
              <g key={id} data-slot={id}>
                <title>{`slot ${id}: ${attachment ?? 'none'}`}</title>
                <rect
                  x={at.x - 2.5}
                  y={-at.y - 2.5}
                  width={5}
                  height={5}
                  fill={attachment === null ? 'none' : '#38bdf8'}
                  stroke="#38bdf8"
                />
                <text
                  x={at.x + side * 4}
                  y={-at.y + 6.5}
                  textAnchor={TEXT_ANCHOR[side]}
                  fontSize={LABEL_SIZE}
                  fill="#38bdf8"
                  {...HALO}
                >
                  {attachment ?? `${id}: none`}
                </text>
              </g>
            );
          })}
          {result.anchors.map(({ id, position }) => {
            const side = sideOf(position.x);
            // On the centre line: above the marker, or below it at ground level and under.
            const dy = side !== 0 ? 1.6 : position.y > 0.5 ? -4 : 7;
            return (
              <g key={id} data-anchor={id}>
                <title>{`anchor ${id}`}</title>
                <circle cx={position.x} cy={-position.y} r={2} fill="#facc15" />
                <text
                  x={position.x + side * 8}
                  y={-position.y + dy}
                  textAnchor={TEXT_ANCHOR[side]}
                  fontSize={LABEL_SIZE}
                  fill="#facc15"
                  {...HALO}
                >
                  {id}
                </text>
              </g>
            );
          })}
        </svg>
        <SkeletonCanvas rig={rig} meshes={meshes} pose={pose} facing={facing} />
        <div className="space-y-4">
          <section aria-labelledby="skeleton-anchors">
            <h2 id="skeleton-anchors" className="mb-1 text-sm text-neutral-400">
              Anchor world positions (x, y; y-up)
            </h2>
            <dl
              id="skeleton-anchor-list"
              className="grid w-fit grid-cols-[auto_auto] gap-x-4 font-mono text-xs"
            >
              {result.anchors.map(({ id, position }) => (
                <div key={id} className="contents">
                  <dt className="text-yellow-400">{id}</dt>
                  <dd data-testid={`skeleton-anchor-${id}`}>
                    {fixed(position.x)}, {fixed(position.y)}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
          <section aria-labelledby="skeleton-slots">
            <h2 id="skeleton-slots" className="mb-1 text-sm text-neutral-400">
              Slots in draw order (back to front): active attachment
            </h2>
            <dl
              id="skeleton-slot-list"
              className="grid w-fit grid-cols-[auto_auto_auto] items-center gap-x-4 gap-y-1 font-mono text-xs"
            >
              {result.slots.map(({ id, attachment }) => (
                <div key={id} className="contents">
                  <dt className="text-sky-400">{id}</dt>
                  <dd data-testid={`skeleton-slot-${id}`}>{attachment ?? 'none'}</dd>
                  <dd>
                    <select
                      aria-label={`${id} attachment`}
                      className={fieldClass}
                      value={attachment ?? NONE}
                      onChange={(event) =>
                        setAttachments({
                          ...attachments,
                          [id]: event.target.value === NONE ? null : event.target.value,
                        })
                      }
                    >
                      <option value={NONE}>none</option>
                      {rig.attachments
                        .filter((owned) => owned.slot === id)
                        .map((owned) => (
                          <option key={owned.id} value={owned.id}>
                            {owned.id}
                          </option>
                        ))}
                    </select>
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
        <section aria-labelledby="skeleton-bones">
          <h2 id="skeleton-bones" className="mb-1 text-sm text-neutral-400">
            Bone rotations (local, degrees, counter-clockwise; children indented under parents)
          </h2>
          <div className="grid w-fit grid-cols-[auto_auto_auto] items-center gap-x-3 font-mono text-xs">
            {boneTree(rig).map(({ bone, depth }) => {
              const value = degrees[bone.id] ?? radToDeg(bone.rest.rotation);
              // One decimal, so a fractional rest rotation is not shown as a whole number.
              const shown = Number(value.toFixed(1));
              return (
                <label key={bone.id} className="contents">
                  <span style={{ paddingLeft: `${depth * 0.75}rem` }}>{bone.id}</span>
                  <input
                    type="range"
                    aria-label={`${bone.id} rotation`}
                    aria-valuetext={`${shown} degrees`}
                    min={-180}
                    max={180}
                    step={1}
                    value={Math.round(value)}
                    onChange={(event) =>
                      setDegrees({ ...degrees, [bone.id]: event.target.valueAsNumber })
                    }
                  />
                  <output data-testid={`skeleton-rotation-${bone.id}`}>{shown}°</output>
                </label>
              );
            })}
          </div>
        </section>
      </div>
      <p className="text-sm text-neutral-400">
        White lines are bones (joint to tip), blue squares are slots (filled when an attachment is
        active), yellow dots are anchors. Evaluation is <code>@mortal-doctrine/rig</code>; that
        drawing is a lab-local debug view. The canvas beside it is the production{' '}
        <code>@mortal-doctrine/skeleton-renderer</code> renderable drawing the same rig and pose
        with solid-colour placeholder textures, mirrored about the rig origin when facing left.
      </p>
    </section>
  );
}
