/**
 * The reflex-pointer rationale template, in its own leaf module.
 *
 * Why it does not live in retrieval-reflex.ts: `volunteer-events.ts` needs this
 * template, and `retrieval-reflex.ts` needs volunteer-events' logger to
 * register its pending write SYNCHRONOUSLY (a registration deferred behind a
 * dynamic `import()` lands a microtask late, and anything that drains
 * immediately after — a CLI exit path, a test awaiting the sink — sees an empty
 * pending set and the event is lost). Both directions as static imports would
 * be a runtime cycle. Parking the shared one-liner in a leaf both sides import
 * removes the cycle instead of tolerating it.
 *
 * Typed structurally rather than against `ReflexPointer` so this module imports
 * nothing — that is what makes it a leaf, and what keeps it that way.
 */

/** The fields the template reads. `ReflexPointer` satisfies this. */
export interface RationaleSource {
  arm: string;
  display: string;
}

export function reflexPointerRationale(p: RationaleSource): string {
  return `${p.arm} match "${p.display}"`;
}
