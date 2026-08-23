// auth.js - the browser's half of accounts and access groups.
// ---------------------------------------------------------------------------
// This module holds WHO is signed in, WHAT they may do, and the one fetch
// wrapper every state-changing request in the app goes through so the CSRF
// token is never forgotten. It renders nothing; auth-ui.js owns the screens.
//
// A standing rule for reading this file: nothing here is a security control.
// The server decides every question independently - this only decides what to
// SHOW. Hiding the edit button is courtesy; refusing the PUT is the control.
// ---------------------------------------------------------------------------

/**
 * The site's account policy, as published unauthenticated by /site.json and
 * /api/auth/me. Enough to render a sign-in screen and a group legend; never
 * anything about an individual account.
 * @typedef {Object} AuthPolicy
 * @property {boolean} enabled
 * @property {boolean} allowRegistration
 * @property {boolean} requireApproval
 * @property {boolean} publicRead - unrestricted documents readable signed out
 * @property {number} passwordMinLength
 * @property {GroupSpec[]} groups
 * @property {string[]} adminGroups
 */

/**
 * One access group as declared in config.json.
 * @typedef {Object} GroupSpec
 * @property {string} name - the canonical (lower-case) name used in ACLs
 * @property {string} label - the human-readable name
 * @property {string} description
 * @property {string|null} color - an operator-chosen hex colour, or null to derive one
 */

/**
 * The signed-in account, as /api/auth/me reports it.
 * @typedef {Object} CurrentUser
 * @property {string} username
 * @property {string} displayName
 * @property {string[]} groups
 * @property {boolean} admin
 * @property {boolean} authenticated
 */

/**
 * The normalised reply from any /api/auth/* endpoint. postAuth() guarantees
 * `ok`; every other field is whatever that particular endpoint chose to send,
 * which is why they are all optional here rather than split per-endpoint.
 * @typedef {Object} AuthReply
 * @property {boolean} ok
 * @property {string} [error]
 * @property {number} [retryAfter] - seconds the login throttle wants us to wait
 * @property {boolean} [pendingApproval] - registered, but an administrator must approve
 * @property {string} [message] - the "what happens next" sentence for a 202
 * @property {string} [csrf] - a freshly minted token, on the calls that mint one
 */

/**
 * One document's access state, from GET /api/index/access?id=... - what the
 * document DECLARES, what it EFFECTIVELY has after inheritance, and what this
 * user may do with it.
 * @typedef {Object} DocAccess
 * @property {string} id
 * @property {number} redactedSections - sections of this page withheld from this reader (>0 makes it read-only)
 * @property {Object|null} declared
 * @property {{read: string[]|null, write: string[]|null, hidden: boolean, explicit: boolean, inheritedFrom: string[]}} effective
 * @property {boolean} canRead
 * @property {boolean} canWrite
 * @property {boolean} canEditAccess
 * @property {string[]} knownGroups
 */

/**
 * The live session state this module owns. Read it; never assign to it from
 * outside (loadAuth / signIn / signOut keep it in step with the server).
 * @typedef {Object} AuthState
 * @property {boolean} enabled - accounts are switched on for this server
 * @property {boolean} loaded - /api/auth/me has answered at least once
 * @property {CurrentUser|null} user
 * @property {string|null} csrf
 * @property {boolean} canWrite - may edit a document that carries no write ACL
 * @property {boolean} canEditAccess - may add or change an access block
 * @property {boolean} needsBootstrap - no accounts exist yet; the first one is the admin
 * @property {AuthPolicy} policy
 */
/** @type {AuthState} */
export const auth = {
  enabled: false,
  loaded: false,
  user: null,
  csrf: null,
  canWrite: true,          // the pre-accounts default: anyone may edit
  canEditAccess: true,
  needsBootstrap: false,
  policy: {
    enabled: false, allowRegistration: false, requireApproval: false, publicRead: false,
    passwordMinLength: 10, groups: [], adminGroups: [],
  },
};

/** Listeners notified whenever the signed-in identity changes. @type {Array<() => void>} */
const listeners = [];
/**
 * @param {() => void} fn
 * @returns {void}
 */
export function onAuthChange(fn) { listeners.push(fn); }
function emit() { listeners.forEach(fn => { try { fn(); } catch (e) {} }); }

// ---- the session ----------------------------------------------------------
/**
 * Ask the server who we are. Also the only call that mints the CSRF cookie, so
 * boot must await it before any write is possible.
 * @returns {Promise<AuthState>}
 */
export async function loadAuth() {
  try {
    const res = await fetch('/api/auth/me', { cache: 'no-store', credentials: 'same-origin' });
    if (res.ok) applyMe(await res.json());
  } catch (e) { /* server unreachable: leave the pre-accounts defaults in place */ }
  auth.loaded = true;
  emit();
  return auth;
}

/** @param {Object<string, *>} body */
function applyMe(body) {
  auth.policy = body.auth || auth.policy;
  auth.enabled = !!(body.auth && body.auth.enabled);
  auth.user = body.user || null;
  auth.csrf = body.csrf || null;
  auth.canWrite = body.canWrite !== false;
  auth.canEditAccess = !!body.canEditAccess;
  auth.needsBootstrap = !!body.needsBootstrap;
}

/**
 * @param {string} username
 * @param {string} password
 * @returns {Promise<AuthReply>}
 */
export async function signIn(username, password) {
  const r = await postAuth('/api/auth/login', { username: username, password: password });
  if (r.ok) await loadAuth();
  return r;
}

/**
 * @param {string} username
 * @param {string} password
 * @param {string} displayName
 * @returns {Promise<AuthReply>}
 */
export async function register(username, password, displayName) {
  const r = await postAuth('/api/auth/register',
    { username: username, password: password, displayName: displayName });
  // 202 means the account exists but an administrator must approve it - there is
  // no session yet, so do NOT reload identity and bounce them into the app.
  if (r.ok && !r.pendingApproval) await loadAuth();
  return r;
}

/** @returns {Promise<void>} */
export async function signOut() {
  await postAuth('/api/auth/logout', {});
  await loadAuth();
}

/**
 * @param {string} currentPassword
 * @param {string} newPassword
 * @returns {Promise<AuthReply>}
 */
export async function changePassword(currentPassword, newPassword) {
  const r = await postAuth('/api/auth/password',
    { currentPassword: currentPassword, newPassword: newPassword });
  if (r.ok) await loadAuth();
  return r;
}

/**
 * POST a JSON body to an auth endpoint and normalise the reply into
 * {ok, ...payload}. Never throws - a dead server reads as a failed sign-in with
 * a message, not an unhandled rejection in the middle of the login screen.
 * @param {string} url
 * @param {Object<string, *>} payload
 * @returns {Promise<AuthReply>}
 */
async function postAuth(url, payload) {
  let res;
  try {
    res = await apiFetch(url, { method: 'POST', body: JSON.stringify(payload) });
  } catch (e) {
    return { ok: false, error: 'Could not reach the server. ' + (e.message || '') };
  }
  // Partial, not AuthReply: `ok` is what THIS function decides from the status
  // code, and the server never sends it.
  /** @type {Partial<AuthReply>} */
  let body = {};
  try { body = await res.json(); } catch (e) {}
  if (res.ok) {
    if (body.csrf) auth.csrf = body.csrf;
    return Object.assign({ ok: true }, body);
  }
  return Object.assign({ ok: false, error: body.error || ('Request failed (' + res.status + ')') }, body);
}

// ---- the fetch wrapper ----------------------------------------------------
/**
 * The ONE way this app makes a state-changing request.
 *
 * It attaches the CSRF token and same-origin credentials. Centralising it is
 * the point: a PUT that forgets the header is refused by the server, so a
 * second, hand-rolled fetch somewhere in the app would be a bug that only
 * shows up as an unexplained 403 in the field.
 * @param {string} url
 * @param {Omit<RequestInit, 'headers'> & {headers?: Object<string, string>}} [opts]
 *   headers is narrowed to a plain record on purpose: the copy below is an
 *   Object.assign, which would quietly drop a Headers instance or a pair array.
 * @returns {Promise<Response>}
 */
export function apiFetch(url, opts) {
  const options = Object.assign({ credentials: 'same-origin' }, opts || {});
  const method = (options.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    const headers = Object.assign({}, options.headers);
    options.headers = headers;
    const token = auth.csrf || readCookie('wd_csrf');
    if (token) headers['X-WebDoc-CSRF'] = token;
  }
  return fetch(url, options);
}

/**
 * @param {string} name
 * @returns {string|null}
 */
function readCookie(name) {
  const parts = String(document.cookie || '').split(';');
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

/**
 * The JSON a refused request comes back with. Every field is optional because
 * WHICH of them the server sends is precisely what tells the three refusals
 * apart - describeFailure() below is written as a walk down these flags.
 * @typedef {Object} FailureBody
 * @property {string} [error] - the server's own sentence, preferred when present
 * @property {boolean} [signInRequired] - there is no session at all
 * @property {boolean} [csrf] - the token, not the permission, was the problem
 * @property {boolean} [aclChange] - the write touched an access block
 * @property {number} [redactedSections] - sections of the submitted page were withheld from this reader
 * @property {string[]} [requiresGroups] - any one of these would have allowed it
 */

/**
 * Turn a failed write into a sentence worth showing. Distinguishes the three
 * refusals the access model can produce, because "Save failed (403)" tells the
 * author nothing about which of them they hit.
 * @param {Response} res
 * @returns {Promise<string>}
 */
export async function describeFailure(res) {
  /** @type {FailureBody} */
  let body = {};
  try { body = await res.json(); } catch (e) {}
  if (res.status === 401 || (res.status === 403 && body.signInRequired)) return 'Sign in to do that.';
  if (res.status === 403 && body.csrf) return 'Your session expired. Reload the page and try again.';
  if (res.status === 403 && body.aclChange) {
    return body.error || 'Changing who can see this page needs access-management rights.';
  }
  if (res.status === 403 && body.redactedSections) return body.error;
  if (res.status === 403) {
    const groups = body.requiresGroups || [];
    return groups.length
      ? 'You need to be in ' + groups.map(groupLabel).join(' or ') + ' to do that.'
      : (body.error || 'You do not have permission to do that.');
  }
  if (res.status === 413) return 'That document is too large to save.';
  if (res.status === 429) return body.error || 'Too many attempts. Wait a moment and try again.';
  return body.error || ('Request failed (' + res.status + ')');
}

// ---- groups ---------------------------------------------------------------
/**
 * @param {string} name
 * @returns {GroupSpec|null}
 */
export function groupSpec(name) {
  const key = String(name || '').toLowerCase();
  return (auth.policy.groups || []).find(g => g.name === key) || null;
}

/**
 * The human-readable name of a group. Falls back to the raw name so a group
 * that exists only in a document (not in config.json) still reads sensibly.
 * @param {string} name
 * @returns {string}
 */
export function groupLabel(name) {
  const spec = groupSpec(name);
  return (spec && spec.label) || String(name || '');
}

/**
 * A stable colour for a group.
 *
 * The hue comes from a hash of the name, so the same group is the same colour
 * everywhere without anyone having to configure one; saturation and lightness
 * come from THEME TOKENS, so both themes stay coherent and nothing here
 * hardcodes a palette. An operator-set hex in config.json always wins.
 * @param {string} name
 * @returns {string} a CSS colour
 */
export function groupColor(name) {
  const spec = groupSpec(name);
  if (spec && spec.color) return spec.color;
  const key = String(name || '');
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
  const hue = Math.abs(h) % 360;
  const css = getComputedStyle(document.documentElement);
  const sat = (css.getPropertyValue('--group-sat') || '').trim() || '62%';
  const light = (css.getPropertyValue('--group-light') || '').trim() || '46%';
  return 'hsl(' + hue + ' ' + sat + ' ' + light + ')';
}

/**
 * Whether the signed-in user holds any of these groups (administrators hold
 * everything). Display logic only - the server checks this itself.
 * @param {string[]} groups
 * @returns {boolean}
 */
export function inAnyGroup(groups) {
  if (!auth.enabled) return true;
  if (!auth.user) return false;
  if (auth.user.admin) return true;
  const mine = new Set(auth.user.groups || []);
  return (groups || []).some(g => mine.has(String(g).toLowerCase()));
}

/**
 * True when the app should show its sign-in wall instead of the library: the
 * server wants accounts, nobody is signed in, and reading is not public.
 * @returns {boolean}
 */
export function signInRequired() {
  return !!(auth.enabled && !auth.user && !auth.policy.publicRead);
}

// ---- per-document access --------------------------------------------------
/**
 * One document's access state. Used by the editor's access panel and the
 * restricted-page screen; cached per id until invalidateAccess() is called
 * (a save can change a whole chapter's inherited ACL).
 * @param {string} docId
 * @returns {Promise<DocAccess|null>}
 */
export async function docAccess(docId) {
  if (accessCache.has(docId)) return accessCache.get(docId);
  let info = null;
  try {
    const res = await fetch('/api/index/access?id=' + encodeURIComponent(docId),
      { cache: 'no-store', credentials: 'same-origin' });
    if (res.ok) info = await res.json();
  } catch (e) { info = null; }
  accessCache.set(docId, info);
  return info;
}
/** @type {Map<string, DocAccess|null>} */
const accessCache = new Map();
/** @returns {void} */
export function invalidateAccess() { accessCache.clear(); }

// ---- administration -------------------------------------------------------
/**
 * @returns {Promise<{users: Object[], groups: GroupSpec[]}|null>}
 */
export async function listUsers() {
  try {
    const res = await fetch('/api/auth/users', { cache: 'no-store', credentials: 'same-origin' });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) { return null; }
}

/**
 * @param {string} action - 'create' | 'update' | 'delete' | 'reset-password'
 * @param {Object<string, *>} payload
 * @returns {Promise<AuthReply>}
 */
export function adminUser(action, payload) {
  return postAuth('/api/auth/users/' + action, payload);
}
