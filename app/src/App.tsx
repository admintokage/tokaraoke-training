import { useEffect, useState } from 'react';
import { Library } from './screens/Library';
import { MicTest } from './screens/MicTest';
import { Practice } from './screens/Practice';

type Route = { name: 'library' } | { name: 'practice'; id: string } | { name: 'mic' };

/** URL の # で画面を切り替える (iPhone のスワイプで戻れるように) */
function parseRoute(hash: string): Route {
  const m = hash.match(/^#\/song\/([\w-]+)/);
  if (m) return { name: 'practice', id: m[1] };
  if (hash.startsWith('#/mic')) return { name: 'mic' };
  return { name: 'library' };
}

export function App() {
  const [route, setRoute] = useState(() => parseRoute(location.hash));
  useEffect(() => {
    const on = () => setRoute(parseRoute(location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  switch (route.name) {
    case 'practice':
      return <Practice key={route.id} songId={route.id} />;
    case 'mic':
      return <MicTest />;
    default:
      return <Library />;
  }
}
