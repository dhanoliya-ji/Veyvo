import { ChessBoard } from './chess/ChessBoard';
import { CrazyEightsTable } from './cards/CrazyEightsTable';
import { FourInARowBoard } from './FourInARowBoard';
import type { GameCtx } from './GameParts';
import { LudoBoard } from './ludo/LudoBoard';
import { TruthOrDareTable } from './TruthOrDareTable';
import { WerewolfTable } from './WerewolfTable';

/** Renders the board for `ctx.game.game_type` from the server's personalised view. */
export function GameBoard({ ctx }: { ctx: GameCtx }) {
  if (!ctx.game.board) return null;
  switch (ctx.game.game_type) {
    case 'chess':
      return <ChessBoard ctx={ctx} />;
    case 'ludo':
      return <LudoBoard ctx={ctx} />;
    case 'crazy_eights':
      return <CrazyEightsTable ctx={ctx} />;
    case 'four_in_a_row':
      return <FourInARowBoard ctx={ctx} />;
    case 'truth_or_dare':
      return <TruthOrDareTable ctx={ctx} />;
    case 'werewolf':
      return <WerewolfTable ctx={ctx} />;
    default:
      return null;
  }
}

/** Ids whose turn it is right now (Werewolf has simultaneous phases, so we highlight nobody there). */
export function turnIds(ctx: Pick<GameCtx, 'game'>): string[] {
  const b = ctx.game.board as { turn?: string | null } | null;
  return b?.turn ? [b.turn] : [];
}
