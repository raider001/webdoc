// errors.ts - one honest way to read a message off a caught value.
//
// `strict` turns on useUnknownInCatchVariables, so `catch (e)` gives `unknown`
// rather than `any` - and that is correct rather than pedantic: JavaScript lets
// you throw anything at all, so `e.message` on a caught value was always an
// assumption. Most of this codebase's throws are real Errors, but a rejected
// fetch, a JSON.parse on hostile input, or a third-party renderer can hand back
// a string, a DOMException, or an object with no message at all.
//
// Deliberately NOT a type guard: callers here want text to show a reader or put
// in the live region, not to branch on the error's class. The one place that
// DOES branch - a restricted document - has its own predicate,
// catalog.ts's isRestrictedError.
/**
 * The most useful human-readable string available for a caught value.
 *
 * An Error yields its message; anything else is stringified, which is what makes
 * this total. Never throws, and never returns undefined, so it is safe in a
 * catch block and in a template literal.
 */
export function errorMessage(e) {
    if (e instanceof Error)
        return e.message;
    if (typeof e === 'string')
        return e;
    return String(e);
}
