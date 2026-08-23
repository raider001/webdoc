/**
 * The site's account policy, as published unauthenticated by /site.json and
 * /api/auth/me. Enough to render a sign-in screen and a group legend; never
 * anything about an individual account.
 */
export interface AuthPolicy {
    enabled: boolean;
    allowRegistration: boolean;
    requireApproval: boolean;
    /** unrestricted documents readable signed out */
    publicRead: boolean;
    passwordMinLength: number;
    groups: GroupSpec[];
    adminGroups: string[];
}
/**
 * One access group as declared in config.json.
 */
export interface GroupSpec {
    /** the canonical (lower-case) name used in ACLs */
    name: string;
    /** the human-readable name */
    label: string;
    description: string;
    /** an operator-chosen hex colour, or null to derive one */
    color: string | null;
}
/**
 * The signed-in account, as /api/auth/me reports it.
 */
export interface CurrentUser {
    username: string;
    displayName: string;
    groups: string[];
    admin: boolean;
    authenticated: boolean;
}
/**
 * One account as GET /api/auth/users lists it - the subset of a stored record
 * that is safe to send to a browser (webdoc_auth.py's public_user; never the
 * password hash). Distinct from CurrentUser, which is who YOU are: this is a
 * row in the administrator's table, so it carries `disabled` and the audit
 * timestamps and does not carry `authenticated`.
 */
export interface PublicUser {
    username: string;
    displayName: string;
    groups: string[];
    admin: boolean;
    disabled: boolean;
    /** ISO timestamp, or '' when the server has none */
    created: string;
    /** ISO timestamp, or '' when the account has never signed in */
    lastLogin: string;
}
/**
 * The normalised reply from any /api/auth/* endpoint. postAuth() guarantees
 * `ok`; every other field is whatever that particular endpoint chose to send,
 * which is why they are all optional here rather than split per-endpoint.
 */
export interface AuthReply {
    ok: boolean;
    error?: string;
    /** seconds the login throttle wants us to wait */
    retryAfter?: number;
    /** registered, but an administrator must approve */
    pendingApproval?: boolean;
    /** the "what happens next" sentence for a 202 */
    message?: string;
    /** a freshly minted token, on the calls that mint one */
    csrf?: string;
}
/**
 * The wire response of GET /api/auth/me: identity, policy, and the CSRF token
 * this browser must echo on every write. Every field is optional because the
 * reads below all default - a server with accounts switched off answers with a
 * subset, and that has to leave the pre-accounts defaults standing rather than
 * overwrite them with undefined.
 */
export interface AuthMeResponse {
    auth?: AuthPolicy;
    user?: CurrentUser | null;
    csrf?: string | null;
    canWrite?: boolean;
    canEditAccess?: boolean;
    needsBootstrap?: boolean;
}
/**
 * The access block a document DECLARES for itself, as opposed to what it
 * inherits: exactly what the author wrote in its meta header, or null when it
 * declares nothing.
 */
export interface DeclaredAccess {
    read?: string[];
    write?: string[];
    hidden?: boolean;
}
/**
 * One document's access state, from GET /api/index/access?id=... - what the
 * document DECLARES, what it EFFECTIVELY has after inheritance, and what this
 * user may do with it.
 */
export interface DocAccess {
    id: string;
    /** sections of this page withheld from this reader (>0 makes it read-only) */
    redactedSections: number;
    declared: DeclaredAccess | null;
    effective: {
        read: string[] | null;
        write: string[] | null;
        hidden: boolean;
        explicit: boolean;
        inheritedFrom: string[];
    };
    canRead: boolean;
    canWrite: boolean;
    canEditAccess: boolean;
    knownGroups: string[];
}
/**
 * The live session state this module owns. Read it; never assign to it from
 * outside (loadAuth / signIn / signOut keep it in step with the server).
 */
export interface AuthState {
    /** accounts are switched on for this server */
    enabled: boolean;
    /** /api/auth/me has answered at least once */
    loaded: boolean;
    user: CurrentUser | null;
    csrf: string | null;
    /** may edit a document that carries no write ACL */
    canWrite: boolean;
    /** may add or change an access block */
    canEditAccess: boolean;
    /** no accounts exist yet; the first one is the admin */
    needsBootstrap: boolean;
    policy: AuthPolicy;
}
export declare const auth: AuthState;
export declare function onAuthChange(fn: () => void): void;
/**
 * Ask the server who we are. Also the only call that mints the CSRF cookie, so
 * boot must await it before any write is possible.
 */
export declare function loadAuth(): Promise<AuthState>;
export declare function signIn(username: string, password: string): Promise<AuthReply>;
export declare function register(username: string, password: string, displayName: string): Promise<AuthReply>;
export declare function signOut(): Promise<void>;
export declare function changePassword(currentPassword: string, newPassword: string): Promise<AuthReply>;
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
export declare function apiFetch(url: string, opts?: Omit<RequestInit, 'headers'> & {
    headers?: Record<string, string>;
}): Promise<Response>;
/**
 * The JSON a refused request comes back with. Every field is optional because
 * WHICH of them the server sends is precisely what tells the three refusals
 * apart - describeFailure() below is written as a walk down these flags.
 */
export interface FailureBody {
    /** the server's own sentence, preferred when present */
    error?: string;
    /** there is no session at all */
    signInRequired?: boolean;
    /** the token, not the permission, was the problem */
    csrf?: boolean;
    /** the write touched an access block */
    aclChange?: boolean;
    /** sections of the submitted page were withheld from this reader */
    redactedSections?: number;
    /** any one of these would have allowed it */
    requiresGroups?: string[];
}
/**
 * Turn a failed write into a sentence worth showing. Distinguishes the three
 * refusals the access model can produce, because "Save failed (403)" tells the
 * author nothing about which of them they hit.
 */
export declare function describeFailure(res: Response): Promise<string>;
export declare function groupSpec(name: string): GroupSpec | null;
/**
 * The human-readable name of a group. Falls back to the raw name so a group
 * that exists only in a document (not in config.json) still reads sensibly.
 */
export declare function groupLabel(name: string): string;
/**
 * A stable colour for a group.
 *
 * The hue comes from a hash of the name, so the same group is the same colour
 * everywhere without anyone having to configure one; saturation and lightness
 * come from THEME TOKENS, so both themes stay coherent and nothing here
 * hardcodes a palette. An operator-set hex in config.json always wins.
 * @returns a CSS colour
 */
export declare function groupColor(name: string): string;
/**
 * Whether the signed-in user holds any of these groups (administrators hold
 * everything). Display logic only - the server checks this itself.
 */
export declare function inAnyGroup(groups: string[]): boolean;
/**
 * True when the app should show its sign-in wall instead of the library: the
 * server wants accounts, nobody is signed in, and reading is not public.
 */
export declare function signInRequired(): boolean;
/**
 * One document's access state. Used by the editor's access panel and the
 * restricted-page screen; cached per id until invalidateAccess() is called
 * (a save can change a whole chapter's inherited ACL).
 */
export declare function docAccess(docId: string): Promise<DocAccess | null>;
export declare function invalidateAccess(): void;
/**
 * The wire response of GET /api/auth/users: every account, plus the groups
 * declared in config.json so the administrator's table can offer them.
 */
export interface UsersResponse {
    users: PublicUser[];
    groups: GroupSpec[];
}
export declare function listUsers(): Promise<UsersResponse | null>;
/**
 * @param action - 'create' | 'update' | 'delete' | 'reset-password'
 */
export declare function adminUser(action: string, payload: Record<string, unknown>): Promise<AuthReply>;
