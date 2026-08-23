// graph-demo.js - driver for the Map/graph dev harness.
// ---------------------------------------------------------------------------
// The markup is app/dev/graph-demo.html; this is the script that used to live
// inline inside it. Moved out because serve.py's CSP has no 'unsafe-inline', so
// an inline module here never runs and the stage stays empty under the real
// server (it only "worked" against test fallbacks that send no CSP).
//
// IT DRIVES THE BARE ENGINE. createGraphController() is the graph with no chrome
// at all: one <canvas> in the element it is handed, and a command/report surface.
// That is deliberate here - if the engine ever starts needing a legend or a
// search box to boot, this page is where it shows up first, as a blank stage.
// The zoom controls, search field, legend and minimap the real map has are
// graph/chrome-view.js's, and the harness bar above the stage stands in for them.
//
// window.__graph IS THE CONTROLLER'S. This file used to overwrite it with its own
// return value on the last line, on the theory that the console wanted the richer
// object. It does not any more: the hit-test hook has exactly one owner now (it
// is installed on create and cleared on destroy), and a harness that stomps on it
// is a harness that hides the bug that ownership exists to prevent. The
// controller is on window.__graphDemo instead, for console poking.
import { createGraphController } from '/js/graph.js';
// ~8 docs forming a small DAG, plus: one edge to a MISSING id, one CYCLE,
// and a separate disconnected component (glossary/appendix).
const docs = [
    { id: 'intro', title: 'Introduction', description: 'What this system is and why it exists.', assumes: [], next: ['setup'] },
    { id: 'setup', title: 'Installation', description: 'Get the toolchain onto your machine.', assumes: ['intro'], next: ['config', 'cli'] },
    { id: 'config', title: 'Configuration', description: 'Project settings, environment variables and files.', assumes: ['setup'], next: ['deploy'] },
    { id: 'cli', title: 'The CLI', description: 'Command-line interface reference and everyday flags.', assumes: ['setup'], next: ['deploy'] },
    { id: 'deploy', title: 'Deploying', description: 'Ship a build to a running environment safely.', assumes: ['config', 'cli'], next: ['advanced', 'monitoring'] },
    { id: 'advanced', title: 'Advanced patterns', description: 'Power-user techniques and composition.', assumes: ['deploy', 'internals'], next: ['intro'] }, // internals = MISSING; next:intro = CYCLE
    { id: 'monitoring', title: 'Monitoring', description: 'Metrics, logs and alerting for live systems.', assumes: ['deploy'], next: [] },
    { id: 'troubleshoot', title: 'Troubleshooting', description: 'Diagnose and fix the usual failure modes.', assumes: ['cli'], next: ['advanced'] },
    // Disconnected component:
    { id: 'glossary', title: 'Glossary', description: 'Definitions of the terms used throughout.', assumes: [], next: ['appendix'] },
    { id: 'appendix', title: 'Appendix A', description: 'Reference tables and extra material.', assumes: ['glossary'], next: [] }
];
const stage = document.getElementById('stage');
const log = document.getElementById('log');
// #stage is position:relative and sized by the harness stylesheet, which is all
// the engine asks of the element it paints in - it appends its canvas and never
// clears what is already there.
const graph = createGraphController(stage, docs, {
    currentId: 'deploy',
    onOpenDoc: id => { log.textContent = 'open → ' + id; }
});
// The emitter, made visible. Nothing here reaches into the engine to ask what
// changed; every bit of it arrives in the event, which is the same contract the
// real chrome runs on.
graph.on('change', (s) => {
    console.log('[graph] change', s.editMode ? 'edit:' + s.connector : 'view', s.pendingSourceTitle || '');
});
document.getElementById('fitBtn').addEventListener('click', () => graph.fit());
document.getElementById('findBtn').addEventListener('click', () => {
    const hit = graph.search('deploy');
    log.textContent = hit ? 'found → ' + hit : 'no match';
});
document.getElementById('themeBtn').addEventListener('click', () => {
    const root = document.documentElement;
    const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try {
        localStorage.setItem('wd-theme', next);
    }
    catch (e) { }
});
// Expose the CONTROLLER for manual poking in the console. window.__graph is the
// controller's own hit-test hook and stays that way; see the header.
window.__graphDemo = graph;
