// auth.svelte.js - a reactive MIRROR of the session state app/js/auth.js owns.
//
// auth.js is deliberately untouched by this phase, and deliberately NOT reactive:
// it is a plain module object the whole vanilla shell reads directly, plus an
// onAuthChange() listener list. A component cannot track a plain object, so the
// few fields the account screens actually draw are copied into runes here and
// refreshed from that same listener.
//
// A MIRROR, not a second source of truth. Nothing in this file ever writes back.
// Sign-in, sign-out, registration and password changes all go through auth.js,
// which updates itself against the server and then emits - and the emit is what
// lands here. Writing to authView would produce a screen that disagrees with the
// module every other part of the app asks.
//
// WHY ONLY THESE FIELDS: `csrf`, `canWrite` and `canEditAccess` are read by the
// editor and the fetch wrapper, never drawn by an account screen. Mirroring them
// would invite a component to make a permission decision, which is exactly the
// mistake auth.js's own header warns about - the server decides; this decides
// what to show.
//
// The `.svelte.js` extension is required - it is what tells the compiler to
// process runes in a plain module rather than treat $state as an undefined name.
import { auth, onAuthChange } from '/js/auth.js';

/** @typedef {import('/js/auth.js').CurrentUser} CurrentUser */
/** @typedef {import('/js/auth.js').GroupSpec} GroupSpec */

/**
 * One account as GET /api/auth/users reports it, for the administrator's list.
 *
 * Spelled out here rather than in the component that draws it, because a
 * typedef declared inside a `.svelte` script is not importable from anywhere
 * else - and both AdminPanel and UserRow need this shape. auth.js types
 * listUsers() only as a passthrough of the server's JSON (`Object[]`), which is
 * honest about the wire but useless to a component.
 * @typedef {Object} AdminUser
 * @property {string} username
 * @property {string} [displayName]
 * @property {string[]} [groups]
 * @property {boolean} [admin]
 * @property {boolean} [disabled]
 */

/**
 * @typedef {Object} AuthView
 * @property {boolean} enabled - accounts are switched on for this server
 * @property {CurrentUser|null} user - the signed-in account, or null
 * @property {boolean} needsBootstrap - no accounts exist; the first one is the admin
 * @property {boolean} allowRegistration - the wall may offer a "create account" mode
 * @property {boolean} requireApproval - a new account cannot sign in until approved
 * @property {number} passwordMinLength - quoted to the visitor on the register form
 */

/** @type {AuthView} */
export const authView = $state({
  enabled: false,
  user: null,
  needsBootstrap: false,
  allowRegistration: false,
  requireApproval: false,
  passwordMinLength: 10,
});

/**
 * Copy the current session into the mirror. Idempotent, and cheap enough to call
 * on every emit.
 * @returns {void}
 */
function pull() {
  const policy = auth.policy || {};
  authView.enabled = auth.enabled;
  // A fresh object each time, not the live one: $state deep-proxies what it is
  // given, and handing it auth.js's own object would make every read of
  // auth.user in the vanilla shell go through a proxy this module installed.
  authView.user = auth.user ? { ...auth.user } : null;
  authView.needsBootstrap = auth.needsBootstrap;
  authView.allowRegistration = !!policy.allowRegistration;
  authView.requireApproval = !!policy.requireApproval;
  authView.passwordMinLength = policy.passwordMinLength || 10;
}

// onAuthChange() has no unsubscribe, so subscribing twice would mean two pulls
// per emit for the rest of the session. Every island entry point calls this, so
// it has to be safe to call from all of them.
let subscribed = false;

/**
 * Start mirroring, and take a first reading now. Called by every entry point in
 * islands/auth.js rather than at import time: this module is inside a lazily
 * loaded bundle, and a listener registered at import time would run at a moment
 * the shell did not choose.
 * @returns {void}
 */
export function startAuthSync() {
  pull();
  if (subscribed) return;
  subscribed = true;
  onAuthChange(pull);
}
