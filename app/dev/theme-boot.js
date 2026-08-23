"use strict";
// theme-boot.js - resolve the colour theme before the harness's first paint.
// ---------------------------------------------------------------------------
// The same code app/index.html runs in its own inline boot script (outdented,
// nothing else changed), shared by every dev harness that has themed chrome.
// index.html keeps its copy inline because that one IS hashed into the policy;
// the harnesses cannot, because serve.py's build_csp() emits
// "script-src 'self' <hashes>" with no 'unsafe-inline' and _inline_script_hashes
// only ever reads index.html. An inline copy here is blocked outright, so the
// harness keeps whatever theme the stylesheet defaults to and only the console
// says why.
//
// Loaded with a plain <script src> - no type="module", no defer - so it stays
// parser-blocking and still runs before first paint, exactly as inline did.
(function () {
    try {
        var stored = localStorage.getItem('wd-theme');
        var sysDark = matchMedia('(prefers-color-scheme: dark)').matches;
        document.documentElement.setAttribute('data-theme', stored || (sysDark ? 'dark' : 'light'));
    }
    catch (e) {
        document.documentElement.setAttribute('data-theme', 'light');
    }
})();
