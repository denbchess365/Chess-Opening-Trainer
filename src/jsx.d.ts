import 'preact';

declare module 'preact' {
  namespace JSX {
    interface IntrinsicElements {
      /** chessground's custom <piece> element, reused for the promotion picker. */
      piece: HTMLAttributes<HTMLElement>;
    }
  }
}
