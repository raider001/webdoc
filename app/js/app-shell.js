// app-shell.js - the shared handles the app's feature modules (reader, map,
// coverage, authoring) hang off. It owns nothing but state + tiny helpers + a
// service registry; main.js does all the wiring. Keeping these here (instead of in
// main.js) lets a feature module import them WITHOUT importing main.js - so the
// modules never form an import cycle with the bootstrap.
import { computeCoverage, computeTestStatus } from './coverage.js';

// The single shared app state (discovery result + current doc + scroll-spy handle).
export const state = { site: null, docs: [], byId: new Map(), current: null, spy: null };

export const el = id => document.getElementById(id);

// Combined status map: requirement rollups (which now include their Verified By
// tests) plus each test case's own pass/fail. Keys never collide (T namespace).
export function combinedStatus(reqs, tests, results) {
  const m = computeCoverage(reqs, results);
  computeTestStatus(tests, results).forEach((v, k) => m.set(k, v));
  return m;
}

// Download a string as a file (self-contained report), no server round-trip.
export function downloadFile(filename, text, mime) {
  const blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export function isoDate(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

// Service registry: cross-cutting functions the modules call each other through,
// set by main.js at boot. Using a shared object (not direct imports) is what keeps
// the feature modules acyclic. Known handles:
//   navigate(id)                       - route to a document
//   refreshCatalog()                   - re-discover after a write
//   closeMapView() / closeCoverageView() - close the other full-screen overlay
//   linkTestToRequirement / unlinkTestFromRequirement - edit a test's `verifies`
export const app = {};
