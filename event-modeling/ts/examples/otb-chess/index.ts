// The model of a single classical over-the-board game under the FIDE Laws of Chess.
import { m } from "#em"

export default m.model("Over-the-Board Chess", {
  description:
    "A tournament pairing starts a game on a board and a clock. Players move and press the clock, the arbiter rules on incidents, and the game ends by checkmate, resignation, agreement, or flag fall before the result is recorded.",
})
