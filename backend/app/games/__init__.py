"""Pure, server-authoritative game rule engines (no DB, no I/O).

Every engine implements :class:`app.games.base.GameEngine`; look them up by key in
:data:`ENGINES`.
"""

from app.games.base import GameEngine, IllegalMove
from app.games.chess import ChessEngine
from app.games.crazy_eights import CrazyEightsEngine
from app.games.four_in_a_row import FourInARowEngine
from app.games.ludo import LudoEngine
from app.games.truth_or_dare import TruthOrDareEngine
from app.games.werewolf import WerewolfEngine

ENGINES: dict[str, GameEngine] = {
    engine.key: engine
    for engine in (
        ChessEngine(),
        LudoEngine(),
        CrazyEightsEngine(),
        FourInARowEngine(),
        TruthOrDareEngine(),
        WerewolfEngine(),
    )
}

__all__ = ["ENGINES", "GameEngine", "IllegalMove"]
