// icons.js - the app's icon set as DOM nodes, one function per icon. Each
// function returns a FRESH element on every call (never a shared/cached node -
// a single SVG element can't live in two places in the document at once).
//
// Every icon here has a byte-identical twin under /icons/*.svg (e.g. editIcon()
// mirrors icons/edit.svg) - the standalone files are the viewable/editable
// source; keep both in sync by hand if you change one. Same visual contract as
// the hand-drawn delete icon already in index.html: viewBox 0 0 24 24,
// stroke="currentColor", stroke-width 2, round caps/joins, fill="none" (except
// playIcon, filled per convention). Sizing comes from the shared .ico CSS rule
// (1em square), so an icon matches whatever font-size its button already sets -
// no per-call width/height needed.
import { html } from './html.js';
export const editIcon = () => html `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3L21 7L8 20L3 21L4 16L17 3Z"/><path d="M14 6L18 10"/></svg>`.firstElementChild;
export const checkIcon = () => html `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12L10 17L19 7"/></svg>`.firstElementChild;
export const closeIcon = () => html `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6L18 18"/><path d="M18 6L6 18"/></svg>`.firstElementChild;
export const playIcon = () => html `<svg class="ico" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true"><path d="M8 5L19 12L8 19Z"/></svg>`.firstElementChild;
export const fitIcon = () => html `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 9V3H9"/><path d="M15 3H21V9"/><path d="M21 15V21H15"/><path d="M9 21H3V15"/></svg>`.firstElementChild;
export const sunIcon = () => html `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2V4M12 20V22M4.22 4.22L5.64 5.64M18.36 18.36L19.78 19.78M2 12H4M20 12H22M4.22 19.78L5.64 18.36M18.36 5.64L19.78 4.22"/></svg>`.firstElementChild;
export const moonIcon = () => html `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z"/></svg>`.firstElementChild;
export const focusIcon = () => html `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/></svg>`.firstElementChild;
export const plusIcon = () => html `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5V19"/><path d="M5 12H19"/></svg>`.firstElementChild;
export const minusIcon = () => html `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12H19"/></svg>`.firstElementChild;
export const chevronDownIcon = () => html `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9L12 15L18 9"/></svg>`.firstElementChild;
export const warningIcon = () => html `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3L22 20H2Z"/><path d="M12 9V13"/><circle cx="12" cy="17" r="1" fill="currentColor" stroke="none"/></svg>`.firstElementChild;
export const externalLinkIcon = () => html `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17L17 7"/><path d="M9 7H17V15"/></svg>`.firstElementChild;
export const arrowUpIcon = () => html `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5"/><path d="M5 12L12 5L19 12"/></svg>`.firstElementChild;
export const arrowDownIcon = () => html `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5V19"/><path d="M5 12L12 19L19 12"/></svg>`.firstElementChild;
export const circleIcon = () => html `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/></svg>`.firstElementChild;
export const mapIcon = () => html `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 6H16"/><path d="M7 8L11 16"/><path d="M17 8L13 16"/><circle cx="6" cy="6" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="12" cy="18" r="2"/></svg>`.firstElementChild;
export const lockIcon = () => html `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7A4 4 0 0 1 16 7V10"/><circle cx="12" cy="15.5" r="1.2" fill="currentColor" stroke="none"/></svg>`.firstElementChild;
export const userIcon = () => html `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21C4 17.13 7.58 14 12 14C16.42 14 20 17.13 20 21"/></svg>`.firstElementChild;
