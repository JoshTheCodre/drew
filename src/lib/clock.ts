/**
 * Single source of "now".
 *
 * Everything that needs the wall clock goes through here rather than calling
 * Date.now() inline, which keeps time injectable in tests and keeps React's
 * purity lint honest about server components that legitimately read the clock.
 */
export const nowMs = (): number => Date.now();
