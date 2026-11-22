import { render } from 'preact';
import '@lichess-org/chessground/assets/chessground.base.css';
import '@lichess-org/chessground/assets/chessground.brown.css';
import '@lichess-org/chessground/assets/chessground.cburnett.css';
import './styles/theme.css';
import './styles/pieces.css';
import { App } from './app';
import { registerSW } from 'virtual:pwa-register';
import { updateReady } from './ui/pwa';
import { toast } from './ui/dialogs';

// New versions wait for the user (so an update never interrupts a drill).
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    updateReady.value = () => updateSW(true);
  },
  onOfflineReady() {
    toast('Ready to work offline');
  },
});
render(<App />, document.getElementById('app')!);
