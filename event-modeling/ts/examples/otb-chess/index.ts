// The model of a single classical over-the-board game under the FIDE Laws of Chess.
import { m } from "#em"

import { Conclusion } from "./conclusion.ts"
import { DrawsAndResignation } from "./draws.ts"
import { Play } from "./play.ts"
import { ArbiterRulings } from "./rulings.ts"
import { GameSetup } from "./setup.ts"
import { Spectating } from "./spectating.ts"

export default m.model("Over-the-Board Chess", {
  description:
    "A tournament pairing starts a game on a board and a clock. Players move and press the clock, the arbiter rules on incidents, and the game ends by checkmate, resignation, agreement, or flag fall before the result is recorded.",
  chapters: [GameSetup, Play, DrawsAndResignation, ArbiterRulings, Conclusion, Spectating],
})
