// auth.ts - the browser's half of accounts and access groups.
// ---------------------------------------------------------------------------
// This module holds WHO is signed in, WHAT they may do, and the one fetch
// wrapper every state-changing request in the app goes through so the CSRF
// token is never forgotten. It renders nothing; auth-ui.js owns the screens.
//
// A standing rule for reading this file: nothing here is a security control.
// The server decides every question independently - this only decides what to
// SHOW. Hiding the edit button is courtesy; refusing the PUT is the control.
// ---------------------------------------------------------------------------
import { errorMessage } from './errors.js';
export const auth = {
    enabled: false,
    loaded: false,
    user: null,
    csrf: null,
    canWrite: true, // the pre-accounts default: anyone may edit
    canEditAccess: true,
    needsBootstrap: false,
    policy: {
        enabled: false, allowRegistration: false, requireApproval: false, publicRead: false,
        passwordMinLength: 10, groups: [], adminGroups: [],
    },
};
/** Listeners notified whenever the signed-in identity changes. */
const listeners = [];
export function onAuthChange(fn) { listeners.push(fn); }
function emit() { listeners.forEach(fn => { try {
    fn();
}
catch (e) { } }); }
// ---- the session ----------------------------------------------------------
/**
 * Ask the server who we are. Also the only call that mints the CSRF cookie, so
 * boot must await it before any write is possible.
 */
export async function loadAuth() {
    try {
        const res = await fetch('/api/auth/me', { cache: 'no-store', credentials: 'same-origin' });
        if (res.ok)
            applyMe(await res.json());
    }
    catch (e) { /* server unreachable: leave the pre-accounts defaults in place */ }
    auth.loaded = true;
    emit();
    return auth;
}
function applyMe(body) {
    auth.policy = body.auth || auth.policy;
    auth.enabled = !!(body.auth && body.auth.enabled);
    auth.user = body.user || null;
    auth.csrf = body.csrf || null;
    auth.canWrite = body.canWrite !== false;
    auth.canEditAccess = !!body.canEditAccess;
    auth.needsBootstrap = !!body.needsBootstrap;
}
export async function signIn(username, password) {
    const r = await postAuth('/api/auth/login', { username: username, password: password });
    if (r.ok)
        await loadAuth();
    return r;
}
export async function register(username, password, displayName) {
    const r = await postAuth('/api/auth/register', { username: username, password: password, displayName: displayName });
    // 202 means the account exists but an administrator must approve it - there is
    // no session yet, so do NOT reload identity and bounce them into the app.
    if (r.ok && !r.pendingApproval)
        await loadAuth();
    return r;
}
export async function signOut() {
    await postAuth('/api/auth/logout', {});
    await loadAuth();
}
export async function changePassword(currentPassword, newPassword) {
    const r = await postAuth('/api/auth/password', { currentPassword: currentPassword, newPassword: newPassword });
    if (r.ok)
        await loadAuth();
    return r;
}
/**
 * POST a JSON body to an auth endpoint and normalise the reply into
 * {ok, ...payload}. Never throws - a dead server reads as a failed sign-in with
 * a message, not an unhandled rejection in the middle of the login screen.
 */
async function postAuth(url, payload) {
    let res;
    try {
        res = await apiFetch(url, { method: 'POST', body: JSON.stringify(payload) });
    }
    catch (e) {
        return { ok: false, error: 'Could not reach the server. ' + (errorMessage(e) || '') };
    }
    // Partial, not AuthReply: `ok` is what THIS function decides from the status
    // code, and the server never sends it.
    let body = {};
    try {
        body = await res.json();
    }
    catch (e) { }
    if (res.ok) {
        if (body.csrf)
            auth.csrf = body.csrf;
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
 * @param opts - headers is narrowed to a plain record on purpose: the copy below
 *   is an Object.assign, which would quietly drop a Headers instance or a pair array.
 */
export function apiFetch(url, opts) {
    const options = Object.assign({ credentials: 'same-origin' }, opts || {});
    const method = (options.method || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') {
        const headers = Object.assign({}, options.headers);
        options.headers = headers;
        const token = auth.csrf || readCookie('wd_csrf');
        if (token)
            headers['X-WebDoc-CSRF'] = token;
    }
    return fetch(url, options);
}
function readCookie(name) {
    const parts = String(document.cookie || '').split(';');
    for (const part of parts) {
        const eq = part.indexOf('=');
        if (eq < 0)
            continue;
        if (part.slice(0, eq).trim() === name)
            return decodeURIComponent(part.slice(eq + 1).trim());
    }
    return null;
}
/**
 * Turn a failed write into a sentence worth showing. Distinguishes the three
 * refusals the access model can produce, because "Save failed (403)" tells the
 * author nothing about which of them they hit.
 */
export async function describeFailure(res) {
    let body = {};
    try {
        body = await res.json();
    }
    catch (e) { }
    if (res.status === 401 || (res.status === 403 && body.signInRequired))
        return 'Sign in to do that.';
    if (res.status === 403 && body.csrf)
        return 'Your session expired. Reload the page and try again.';
    if (res.status === 403 && body.aclChange) {
        return body.error || 'Changing who can see this page needs access-management rights.';
    }
    if (res.status === 403 && body.redactedSections) {
        // The server pairs this flag with its own sentence; the fallback is for a
        // refusal that arrives without one, which otherwise handed the author the
        // word "undefined" as their error message.
        return body.error || 'This page contains sections you are not cleared to see, so it cannot be saved here.';
    }
    if (res.status === 403) {
        const groups = body.requiresGroups || [];
        return groups.length
            ? 'You need to be in ' + groups.map(groupLabel).join(' or ') + ' to do that.'
            : (body.error || 'You do not have permission to do that.');
    }
    if (res.status === 413)
        return 'That document is too large to save.';
    if (res.status === 429)
        return body.error || 'Too many attempts. Wait a moment and try again.';
    return body.error || ('Request failed (' + res.status + ')');
}
// ---- groups ---------------------------------------------------------------
export function groupSpec(name) {
    const key = String(name || '').toLowerCase();
    return (auth.policy.groups || []).find(g => g.name === key) || null;
}
/**
 * The human-readable name of a group. Falls back to the raw name so a group
 * that exists only in a document (not in config.json) still reads sensibly.
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
 * @returns a CSS colour
 */
export function groupColor(name) {
    const spec = groupSpec(name);
    if (spec && spec.color)
        return spec.color;
    const key = String(name || '');
    let h = 2166136261;
    for (let i = 0; i < key.length; i++) {
        h ^= key.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    const hue = Math.abs(h) % 360;
    const css = getComputedStyle(document.documentElement);
    const sat = (css.getPropertyValue('--group-sat') || '').trim() || '62%';
    const light = (css.getPropertyValue('--group-light') || '').trim() || '46%';
    return 'hsl(' + hue + ' ' + sat + ' ' + light + ')';
}
/**
 * Whether the signed-in user holds any of these groups (administrators hold
 * everything). Display logic only - the server checks this itself.
 */
export function inAnyGroup(groups) {
    if (!auth.enabled)
        return true;
    if (!auth.user)
        return false;
    if (auth.user.admin)
        return true;
    const mine = new Set(auth.user.groups || []);
    return (groups || []).some(g => mine.has(String(g).toLowerCase()));
}
/**
 * True when the app should show its sign-in wall instead of the library: the
 * server wants accounts, nobody is signed in, and reading is not public.
 */
export function signInRequired() {
    return !!(auth.enabled && !auth.user && !auth.policy.publicRead);
}
// ---- per-document access --------------------------------------------------
/**
 * One document's access state. Used by the editor's access panel and the
 * restricted-page screen; cached per id until invalidateAccess() is called
 * (a save can change a whole chapter's inherited ACL).
 */
export async function docAccess(docId) {
    if (accessCache.has(docId))
        return accessCache.get(docId); // has() on the same line is the guarantee; a cached null is a real answer
    let info = null;
    try {
        const res = await fetch('/api/index/access?id=' + encodeURIComponent(docId), { cache: 'no-store', credentials: 'same-origin' });
        if (res.ok)
            info = await res.json();
    }
    catch (e) {
        info = null;
    }
    accessCache.set(docId, info);
    return info;
}
const accessCache = new Map();
export function invalidateAccess() { accessCache.clear(); }
export async function listUsers() {
    try {
        const res = await fetch('/api/auth/users', { cache: 'no-store', credentials: 'same-origin' });
        if (!res.ok)
            return null;
        return await res.json();
    }
    catch (e) {
        return null;
    }
}
/**
 * @param action - 'create' | 'update' | 'delete' | 'reset-password'
 */
export function adminUser(action, payload) {
    return postAuth('/api/auth/users/' + action, payload);
}
