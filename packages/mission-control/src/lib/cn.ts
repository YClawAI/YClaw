/**
 * Tiny classname joiner — filters out falsy values so call sites can use
 * inline conditionals without guarding undefined/null/false. Prefer this
 * over third-party deps (clsx, classnames) to keep the primitive surface
 * minimal; swap in a real lib if we ever need variant APIs.
 *
 * @example
 *   cn('panel', isActive && 'panel--active', disabled ? 'opacity-50' : null)
 */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}
