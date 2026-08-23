/**
 * Parse an HTML string inertly (via DOMParser, so scripts never run and
 * resources never load), sanitize it against the allowlist policy above,
 * and return a DocumentFragment ready to append to the live document.
 */
export declare function sanitizeToFragment(html: string): DocumentFragment;
