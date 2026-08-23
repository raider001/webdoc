declare global {
    interface Window {
        /**
         * The controller, exposed for poking at from the console on this harness
         * page only. Deliberately NOT window.__graph: that name belongs to the
         * engine's own hit-test hook, which GraphCanvas installs and clears, and
         * an earlier version of this file overwrote it - leaving a destroyed
         * instance reachable under the name the Playwright suite drives.
         */
        __graphDemo?: unknown;
    }
}
export {};
