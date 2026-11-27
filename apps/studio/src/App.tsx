import { Suspense } from 'react';
import { findLab, LAB_CATEGORIES, type LabEntry } from './lab-registry';
import { LAB_INDEX } from './labs';

// Routing is plain URL paths with full page loads: every lab has a stable, directly loadable
// URL, and switching labs always tears down the previous one completely.
export function App() {
  const path = window.location.pathname;
  const lab = findLab(LAB_INDEX, path);
  const isHome = path === '/' || path === '';
  const Lab = lab?.component;

  return (
    <div className="flex min-h-screen bg-neutral-950 text-neutral-100">
      <nav className="w-56 shrink-0 border-r border-neutral-800 p-4" aria-label="Labs">
        <a href="/" className="mb-4 block text-lg font-bold">
          Mortal Doctrine Studio
        </a>
        {LAB_CATEGORIES.map((category) => (
          <LabGroup
            key={category}
            title={category}
            entries={LAB_INDEX.filter((entry) => entry.lab.category === category)}
            currentRoute={lab?.route}
          />
        ))}
      </nav>
      <main className="min-w-0 flex-1 p-6">
        {Lab ? (
          <Suspense fallback={<p>Loading lab…</p>}>
            <Lab />
          </Suspense>
        ) : isHome ? (
          <Home />
        ) : (
          <p role="alert">No lab at {path}.</p>
        )}
      </main>
    </div>
  );
}

function LabGroup(props: {
  title: string;
  entries: readonly LabEntry[];
  currentRoute: string | undefined;
}) {
  if (props.entries.length === 0) return null;
  return (
    <section className="mb-4">
      <h2 className="mb-1 text-xs tracking-wide text-neutral-500 uppercase">{props.title}</h2>
      <ul className="space-y-1 text-sm">
        {props.entries.map(({ status, lab }) => (
          <li key={lab.id}>
            {status === 'available' ? (
              <a
                href={lab.route}
                aria-current={lab.route === props.currentRoute ? 'page' : undefined}
                className="block rounded px-2 py-1 hover:bg-neutral-800 aria-[current=page]:bg-neutral-800"
              >
                {lab.name}
              </a>
            ) : (
              <span aria-disabled="true" className="block px-2 py-1 text-neutral-600">
                {lab.name} <span className="text-xs">(planned)</span>
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Home() {
  const labs = LAB_INDEX.filter((entry) => entry.status === 'available');
  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold">Development labs</h1>
      <ul className="grid gap-3 sm:grid-cols-2">
        {labs.map(({ lab }) => (
          <li key={lab.id}>
            <a
              href={lab.route}
              className="block rounded border border-neutral-800 p-4 hover:bg-neutral-900"
            >
              <span className="font-medium">{lab.name}</span>
              <span className="mt-1 block text-sm text-neutral-400">{lab.description}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
