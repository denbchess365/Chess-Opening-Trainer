import { render } from 'preact';
import '@lichess-org/chessground/assets/chessground.base.css';
import '@lichess-org/chessground/assets/chessground.brown.css';
import '@lichess-org/chessground/assets/chessground.cburnett.css';
import './styles/theme.css';
import { App } from './app';
import { registerSW } from 'virtual:pwa-register';

registerSW({ immediate: true });
render(<App />, document.getElementById('app')!);
