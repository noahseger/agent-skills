// The tests that assemble models write slices of every shape, many wrong on purpose, and each
// declares its own names, so here a slice and `d` are not typed. test/typecheck.ts checks the types
// a model gets.
import { m as em, d as typed } from "#em"

// biome-ignore lint/suspicious/noExplicitAny: see above
type Loose = any

export const d = typed as Record<string, Loose>
export const m = { ...em, slice: em.slice as (name?: string) => Loose }
/** A mapping's argument, as untyped as the slice it is in. */
export type C = typeof d
