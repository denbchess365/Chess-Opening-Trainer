import { describe, expect, it } from 'vitest';
import { checkPosition, goalText, materialSignature, possibleEpSquares, parseBoard } from '../src/core/positions';
import { pgnMainline } from '../src/core/pgn';

const KBN = '8/8/8/4k3/8/8/8/3BNK2 w - - 0 1';

describe('position validation', () => {
  it('accepts a legal KBN vs K position', () => {
    const r = checkPosition(KBN);
    expect(r).toMatchObject({ ok: true, errors: [], fen: KBN });
  });

  it('accepts a 4-field FEN and adds clocks', () => {
    expect(checkPosition('8/8/8/4k3/8/8/8/3BNK2 b - -').fen).toBe('8/8/8/4k3/8/8/8/3BNK2 b - - 0 1');
  });

  it.each([
    ['no white king', '8/8/8/4k3/8/8/8/3BN3 w - - 0 1', /White has no king/],
    ['two black kings', 'k7/8/8/4k3/8/8/8/3BNK2 w - - 0 1', /Black has 2 kings/],
    ['pawn on the 8th rank', 'P7/8/8/4k3/8/8/8/3BNK2 w - - 0 1', /1st or 8th rank/],
    ['pawn on the 1st rank', '8/8/8/4k3/8/8/8/p2BNK2 w - - 0 1', /1st or 8th rank/],
    ['side not to move in check', '4R3/8/8/4k3/8/8/8/3BNK2 w - - 0 1', /Black is in check but it’s White’s move/],
    ['nine pawns', '8/pppppppp/p7/4k3/8/8/8/3BNK2 w - - 0 1', /9 pawns/],
    ['garbage', 'hello', /not valid FEN/],
    ['bad row length', '9/8/8/4k3/8/8/8/3BNK2 w - - 0 1', /not valid FEN/],
  ])('rejects %s', (_n, fen, msg) => {
    const r = checkPosition(fen);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(msg);
  });

  it('the side to move may be in check', () => {
    expect(checkPosition('4R3/8/8/4k3/8/8/8/3BNK2 b - - 0 1').ok).toBe(true);
  });

  it('removes impossible castling and en-passant with a warning', () => {
    const r = checkPosition('4k3/8/8/8/8/8/8/4K3 w KQkq e6 0 1');
    expect(r.ok).toBe(true);
    expect(r.fen).toBe('4k3/8/8/8/8/8/8/4K3 w - - 0 1');
    expect(r.warnings).toHaveLength(2);
    const ok = checkPosition('rnbqkbnr/pppp1ppp/8/4pP2/8/8/PPPPP1PP/RNBQKBNR w KQkq e6 0 3');
    expect(ok.fen).toContain(' KQkq e6 ');
    expect(ok.warnings).toEqual([]);
  });

  it('warns about positions that are already over', () => {
    expect(checkPosition('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1').warnings.join()).toMatch(/stalemate/);
    expect(checkPosition('7k/6Q1/6K1/8/8/8/8/8 b - - 0 1').warnings.join()).toMatch(/checkmate/);
  });

  it('lists valid en-passant squares', () => {
    expect(possibleEpSquares(parseBoard('4k3/8/8/3pP3/8/8/8/4K3')!, 'w')).toEqual(['d6']);
  });
});

describe('position helpers', () => {
  it('material signature puts the stronger side first', () => {
    expect(materialSignature(KBN)).toBe('KBNvK');
    expect(materialSignature('8/8/8/4k3/8/8/8/3bnK2 w - - 0 1')).toBe('KBNvK');
    expect(materialSignature('8/8/4k3/4p3/8/8/4K3/R7 w - - 0 1')).toBe('KRvKP');
  });

  it('goal text', () => {
    expect(goalText('win', 'w', KBN)).toBe('White to move — mate the king');
    expect(goalText('draw', 'b', KBN)).toBe('White to move — Black holds the draw');
  });

  it('reads the main line of a PGN with a [FEN] start (variations ignored)', () => {
    const m = pgnMainline('[SetUp "1"]\n[FEN "8/8/8/4k3/8/8/8/3BNK2 w - - 10 50"]\n\n50. Ke2 (50. Kf2) Kd4 51. Kd2 *');
    expect(m.startFen).toBe('8/8/8/4k3/8/8/8/3BNK2 w - - 10 50');
    expect(m.sans).toEqual(['Ke2', 'Kd4', 'Kd2']);
    expect(m.fens[2]).toBe('8/8/8/8/3k4/8/3K4/3BN3 b - - 13 51');
  });

  it('PGN errors are readable', () => {
    expect(() => pgnMainline('1. e4 e5 2. Qxf7 Kxf7 3. Zz9')).toThrow(/Couldn’t read this PGN/);
  });
});
