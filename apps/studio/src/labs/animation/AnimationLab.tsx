import { useEffect, useRef, useState } from 'react';
import {
  blendStage,
  loadClip,
  orderSlots,
  runPipeline,
  sample,
  type Clip,
} from '@mortal-doctrine/animation';
import { RAISE_STAFF, WALK_CYCLE, WING_FLAP } from '@mortal-doctrine/animation/testing';
import { apply, radToDeg } from '@mortal-doctrine/math';
import { evaluate, loadRig, type Rig } from '@mortal-doctrine/rig';
import { MANNEQUIN_RIG, NON_HUMANOID_RIG } from '@mortal-doctrine/rig/testing';

interface Fixture {
  readonly id: string;
  readonly name: string;
  readonly rig: Rig;
  readonly clips: readonly [Clip, ...Clip[]];
}

const MANNEQUIN: Fixture = {
  id: 'mannequin',
  name: 'Mannequin',
  rig: loadRig(MANNEQUIN_RIG),
  clips: [loadClip(WALK_CYCLE), loadClip(RAISE_STAFF)],
};
const FIXTURES: readonly Fixture[] = [
  MANNEQUIN,
  {
    id: 'non-humanoid',
    name: 'Four arms and wings',
    rig: loadRig(NON_HUMANOID_RIG),
    clips: [loadClip(WING_FLAP)],
  },
];

const NONE = '';
const FRAMES_PER_MS = 60 / 1000;
const DEFAULT_WEIGHT = 0.5;

/** Two decimals, without the `-0.00` a float residue would print. */
const fixed = (value: number) => (Math.round(value * 100) / 100 + 0).toFixed(2);

export function AnimationLab() {
  const rootRef = useRef<HTMLElement>(null);
  // The playhead, in frames. Playback moves it every display frame without touching React.
  const headRef = useRef(0);
  const [fixture, setFixture] = useState(MANNEQUIN);
  const [clipId, setClipId] = useState(MANNEQUIN.clips[0].id);
  const [secondId, setSecondId] = useState(NONE);
  const [weight, setWeight] = useState(DEFAULT_WEIGHT);
  const [playing, setPlaying] = useState(false);
  // Where the controls last put the playhead; changing it redraws.
  const [frame, setFrame] = useState(0);

  const { rig } = fixture;
  const clip = fixture.clips.find((candidate) => candidate.id === clipId) ?? fixture.clips[0];
  const second = fixture.clips.find((candidate) => candidate.id === secondId);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const byTestId = (id: string) => root.querySelector(`[data-testid="${id}"]`);
    const write = (target: Element | null, text: string) => {
      if (target && target.textContent !== text) target.textContent = text;
    };
    const bones = rig.bones.map((bone) => ({
      ...bone,
      line: root.querySelector(`[data-bone="${bone.id}"] line`),
      angle: byTestId(`animation-angle-${bone.id}`),
    }));
    const slots = byTestId('animation-slots');
    const frameReadout = byTestId('animation-frame');
    const scrub = root.querySelector<HTMLInputElement>('input[data-scrub]');

    // All pose math is the production packages'; this only writes the result to the DOM.
    const draw = () => {
      const head = headRef.current;
      const pose = runPipeline(
        rig,
        sample(clip, head),
        second ? [blendStage(sample(second, head), weight)] : [],
      );
      const result = evaluate(rig, pose);
      const transforms = new Map(result.bones.map(({ id, transform }) => [id, transform]));
      for (const { id, length, rest, line, angle } of bones) {
        const transform = transforms.get(id);
        if (transform && line) {
          const tip = apply(transform, { x: length, y: 0 });
          // World space is y-up; the view flips y.
          line.setAttribute('x1', String(transform.tx));
          line.setAttribute('y1', String(-transform.ty));
          line.setAttribute('x2', String(tip.x));
          line.setAttribute('y2', String(-tip.y));
        }
        write(angle, `${fixed(radToDeg(pose.bones?.[id]?.rotation ?? rest.rotation))}°`);
      }
      write(
        slots,
        orderSlots(result.slots, pose.drawOrder)
          .map((slot) => `${slot.id}: ${slot.attachment ?? 'none'}`)
          .join(', '),
      );
      write(frameReadout, fixed(head));
      if (scrub) scrub.value = String(Math.floor(head));
    };

    draw();
    if (!playing) return;

    let last: number | undefined;
    let handle = requestAnimationFrame(function tick(now: number) {
      let head = headRef.current + (last === undefined ? 0 : (now - last) * FRAMES_PER_MS);
      last = now;
      // A looping clip wraps; any other clip stops on its last frame.
      if (head >= clip.duration && clip.loop) head %= clip.duration;
      headRef.current = Math.min(head, clip.duration);
      draw();
      if (head >= clip.duration) setPlaying(false);
      else handle = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(handle);
  }, [rig, clip, second, weight, playing, frame]);

  // Event handlers only: refs must not be read during render.
  /** Stops playback on `next`, clamped to the clip. */
  const stopAt = (next: number) => {
    headRef.current = Math.min(Math.max(next, 0), clip.duration);
    setFrame(headRef.current);
    setPlaying(false);
  };
  const reset = () => {
    stopAt(0);
    setSecondId(NONE);
    setWeight(DEFAULT_WEIGHT);
  };

  const buttonClass =
    'rounded bg-neutral-800 px-3 py-1 text-sm hover:bg-neutral-700 disabled:opacity-40';
  const fieldClass = 'rounded bg-neutral-800 px-2 py-1 text-sm';
  const labelClass = 'flex items-center gap-2 text-sm text-neutral-400';

  return (
    <section ref={rootRef} className="space-y-4">
      <header className="flex items-baseline gap-4">
        <h1 className="text-xl font-semibold">Animation Lab</h1>
        <span className="font-mono text-sm text-neutral-400">
          Frame <span data-testid="animation-frame" /> / {clip.duration} ·{' '}
          <span data-testid="animation-mode">{playing ? 'playing' : 'paused'}</span>
        </span>
      </header>
      <div className="flex flex-wrap items-center gap-4">
        <div className={labelClass}>
          <label htmlFor="animation-rig">Rig</label>
          <select
            id="animation-rig"
            className={fieldClass}
            value={fixture.id}
            onChange={(event) => {
              const next = FIXTURES.find((candidate) => candidate.id === event.target.value);
              if (!next) return;
              setFixture(next);
              setClipId(next.clips[0].id);
              reset();
            }}
          >
            {FIXTURES.map(({ id, name }) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div className={labelClass}>
          <label htmlFor="animation-clip">Clip</label>
          <select
            id="animation-clip"
            className={fieldClass}
            value={clip.id}
            onChange={(event) => {
              setClipId(event.target.value);
              stopAt(0);
            }}
          >
            {fixture.clips.map(({ id }) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </div>
        <div className={labelClass}>
          <label htmlFor="animation-second-clip">Second clip</label>
          <select
            id="animation-second-clip"
            className={fieldClass}
            value={second?.id ?? NONE}
            onChange={(event) => setSecondId(event.target.value)}
          >
            <option value={NONE}>none</option>
            {fixture.clips.map(({ id }) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </div>
        <label className={labelClass}>
          Blend weight
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={weight}
            disabled={!second}
            onChange={(event) => setWeight(event.target.valueAsNumber)}
          />
          <output data-testid="animation-weight" className="font-mono">
            {weight.toFixed(2)}
          </output>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={buttonClass}
          disabled={playing}
          onClick={() => {
            // Play at the end of a clip that does not loop starts over.
            if (headRef.current >= clip.duration) headRef.current = 0;
            setPlaying(true);
          }}
        >
          Play
        </button>
        <button
          type="button"
          className={buttonClass}
          disabled={!playing}
          onClick={() => stopAt(Math.floor(headRef.current))}
        >
          Pause
        </button>
        <button
          type="button"
          className={buttonClass}
          onClick={() => stopAt(Math.floor(headRef.current) - 1)}
        >
          Step back
        </button>
        <button
          type="button"
          className={buttonClass}
          onClick={() => stopAt(Math.floor(headRef.current) + 1)}
        >
          Step forward
        </button>
        <button type="button" className={buttonClass} onClick={reset}>
          Reset
        </button>
        <label className={labelClass}>
          Frame
          <input
            data-scrub
            type="range"
            min={0}
            max={clip.duration}
            step={1}
            defaultValue={0}
            onChange={(event) => stopAt(event.target.valueAsNumber)}
            className="w-64"
          />
        </label>
      </div>
      <div className="flex flex-wrap items-start gap-6">
        <svg
          role="img"
          aria-label={`${rig.id} rig playing ${clip.id}`}
          data-testid="animation-view"
          viewBox="-130 -195 260 210"
          className="w-[36rem] max-w-full rounded border border-neutral-800 bg-neutral-950"
        >
          <line x1={-130} y1={0} x2={130} y2={0} stroke="#404040" strokeWidth={0.5} />
          {rig.bones.map(({ id }) => (
            <g key={`${rig.id}/${id}`} data-bone={id}>
              <title>{`bone ${id}`}</title>
              <line stroke="#e5e5e5" strokeWidth={2} strokeLinecap="round" />
            </g>
          ))}
        </svg>
        <div className="space-y-4">
          <section aria-labelledby="animation-slots-heading">
            <h2 id="animation-slots-heading" className="mb-1 text-sm text-neutral-400">
              Slots in draw order (back to front): active attachment
            </h2>
            <p data-testid="animation-slots" className="font-mono text-xs" />
          </section>
          <section aria-labelledby="animation-angles-heading">
            <h2 id="animation-angles-heading" className="mb-1 text-sm text-neutral-400">
              Bone rotations (local, degrees, counter-clockwise)
            </h2>
            <dl className="grid w-fit grid-cols-[auto_auto] gap-x-4 font-mono text-xs">
              {rig.bones.map(({ id }) => (
                <div key={`${rig.id}/${id}`} className="contents">
                  <dt>{id}</dt>
                  <dd data-testid={`animation-angle-${id}`} />
                </div>
              ))}
            </dl>
          </section>
        </div>
      </div>
      <p className="text-sm text-neutral-400">
        Poses come from <code>@mortal-doctrine/animation</code> (sample, then the blend stage when a
        second clip is chosen, both clips at the same frame) and <code>@mortal-doctrine/rig</code>;
        the drawing is a lab-local debug view. Playback advances 60 frames per second and samples
        between frames; Pause, Step and the Frame slider land on whole frames.
      </p>
    </section>
  );
}
