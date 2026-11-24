import { useEffect } from 'preact/hooks';
import { init, loadError, ready } from './state/store';
import { DialogHost } from './ui/dialogs';
import { route } from './ui/router';
import { Build } from './ui/screens/Build';
import { Home } from './ui/screens/Home';
import { Practice } from './ui/screens/Practice';
import { Settings } from './ui/screens/Settings';
import { Stats } from './ui/screens/Stats';
import { unlockAudioOnGesture } from './ui/sound';
import { installAutoBackupTriggers } from './state/gistBackup';
import { maybeAutoSync } from './state/lichessSync';

export function App() {
  useEffect(() => {
    init().then(maybeAutoSync);
    unlockAudioOnGesture();
    installAutoBackupTriggers();
  }, []);

  if (loadError.value)
    return (
      <div class="screen">
        <div class="topbar"><h1>Repertoire Trainer</h1></div>
        <div class="card">
          Couldn't open the on-device database: {loadError.value}
          <p class="muted small">Private browsing can block storage. Try reopening the app from the home screen.</p>
        </div>
      </div>
    );
  if (!ready.value) return <div class="screen" />;

  const r = route.value;
  let screen;
  switch (r.name) {
    case 'build':
      screen = <Build key={r.params.id} repId={r.params.id} />;
      break;
    case 'practice':
      screen = <Practice key={location.hash} params={r.params} />;
      break;
    case 'stats':
      screen = <Stats />;
      break;
    case 'settings':
      screen = <Settings />;
      break;
    default:
      screen = <Home />;
  }
  return (
    <>
      {screen}
      <DialogHost />
    </>
  );
}
