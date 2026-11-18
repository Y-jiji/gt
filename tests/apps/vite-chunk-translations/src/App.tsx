import { lazy, Suspense, useState, type ComponentType } from 'react';
import { LocaleSelector, T, useGT } from 'gt-react';
import { msg, t, useMessages } from 'gt-react/unstable';

export type RouteProps = { name: string; count: number; userRole: string };

const routes = {
  home: lazy(() => import('./routes/Home')),
  orders: lazy(() => import('./routes/Orders')),
  settings: lazy(() => import('./routes/Settings')),
  reports: lazy(() => import('./routes/Reports')),
};

// A second import of the same chunk, which starts before the first when the
// pointer reaches the button
const prefetchReports = () => void import('./routes/Reports');

type RouteName = keyof typeof routes;

// Vite writes these imports after the compiler's first pass has run
const dialogs = import.meta.glob<{ default: ComponentType }>('./dialogs/*.tsx');

const isRoute = (name: string): name is RouteName => name in routes;

// No chunk's file holds the next two messages: a `msg` is rendered away from
// where it is written, and the stable API looks its ICU strings up in the
// catalog. A build with chunk translations loads them in its unsplit file.
const notice = msg`Maintenance starts tonight`;

// The entry imports this module once gt-react has started, so what the
// module reads as it is evaluated is translated: a constant, a table of
// labels, and a message the entry's file holds.
((window.__evaluated ??= {}).app ??= []).push(performance.now());

const status = t`All systems operational`;
const LEGEND = [t`Open`, t`Closed`];
const product = t`Acme workspace`;

export function App() {
  const gt = useGT();
  const m = useMessages();
  const initial = window.location.hash.slice(1);
  const [route, setRoute] = useState<RouteName>(
    isRoute(initial) ? initial : 'home'
  );
  const [count, setCount] = useState(1);
  const [Dialog, setDialog] = useState<ComponentType>();
  const Route = routes[route];

  return (
    <main>
      <header>
        <h1 data-test='title'>{t`Workspace overview`}</h1>
        <T>
          <p data-test='tagline'>
            Everything your team needs, in <i>one place</i>.
          </p>
        </T>
        <p data-test='msg'>{m(notice)}</p>
        <p data-test='stable'>{gt('Billing moved to a new page')}</p>
        <LocaleSelector />
      </header>
      <nav>
        <button data-nav='home' onClick={() => setRoute('home')}>
          {t`Home`}
        </button>
        <button data-nav='orders' onClick={() => setRoute('orders')}>
          {t`Orders`}
        </button>
        <button data-nav='settings' onClick={() => setRoute('settings')}>
          {t`Settings`}
        </button>
        <button
          data-nav='reports'
          onPointerEnter={prefetchReports}
          onClick={() => setRoute('reports')}
        >
          {t`Reports`}
        </button>
        <button data-nav='count' onClick={() => setCount(count + 1)}>
          {t`Add one`}
        </button>
        <button
          data-nav='help'
          onClick={async () => {
            const dialog = await dialogs['./dialogs/Help.tsx']();
            setDialog(() => dialog.default);
          }}
        >
          {t`Help`}
        </button>
      </nav>
      <Suspense fallback={<p data-test='loading'>…</p>}>
        <Route name='Ada' count={count} userRole='admin' />
      </Suspense>
      {Dialog && <Dialog />}
      <footer data-test='footer'>
        {product}: {status} ({LEGEND.join(', ')})
      </footer>
    </main>
  );
}
