"""Browser-free fixture startup probe; owns only its child server on port 8797."""
import json
from pathlib import Path
import re
import socket
import subprocess
import sys
import time
import urllib.request
from urllib.parse import urljoin, urlsplit

ROOT = Path(__file__).resolve().parents[1]
BASE = 'http://127.0.0.1:8797'


def check_modules():
    """Check the served entry's complete static import graph, without executing it."""
    imports = re.compile(r'''^\s*(?:import\s+(?:[^;\n]*?\s+from\s+)?|export\s+[^;\n]*?\s+from\s+)(['"])([^'"]+)\1''', re.M)
    pending, visited = ['/js/main.js'], set()
    while pending:
        path = pending.pop()
        if path in visited:
            continue
        visited.add(path)
        body = get(path)
        for _, specifier in imports.findall(body):
            target = urlsplit(urljoin(BASE + path, specifier))
            assert target.netloc == '127.0.0.1:8797' and target.path.startswith('/js/'), specifier
            assert all(part.lower() not in {'sealed', 'world', 'exam-half', 'sealed-raw', 'sealed-manifests', 'squad2'}
                       and not part.lower().startswith(('wl-sandbox-world', 'wl-sandbox-eff', 'wl-sandbox-w1'))
                       for part in target.path.split('/')), specifier
            pending.append(target.path)
    print(f'PASS: {len(visited)} served static entry modules (not a browser execution check).', flush=True)



def get(path):
    start = time.monotonic()
    with urllib.request.urlopen(BASE + path, timeout=4) as response:
        body = response.read().decode('utf-8')
        result = json.loads(body) if 'application/json' in response.headers.get('Content-Type', '') else body
        print(f'{response.status} {path} ({time.monotonic() - start:.3f}s)', flush=True)
        return result


def main():
    # Refuse a pre-existing listener: never reuse or stop somebody else's server.
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 8797))
    log_path = ROOT / '.cache' / 'fixture-serve-150c.log'
    with log_path.open('w', encoding='utf-8') as log:
        proc = subprocess.Popen([sys.executable, '-B', '-u', 'serve.py', '--config',
                                 'tests/fixtures-config.json', '--host', '127.0.0.1',
                                 '--port', '8797'], cwd=ROOT, stdout=log, stderr=subprocess.STDOUT)
        try:
            deadline = time.monotonic() + 30
            while True:
                assert proc.poll() is None, log_path.read_text(encoding='utf-8')
                try:
                    site = get('/site.json')
                    status = get('/api/index/status')
                    if status['state'] in ('ready', 'error'):
                        break
                except OSError:
                    pass
                assert time.monotonic() < deadline, 'fixture server did not become ready'
                time.sleep(.25)
            assert status['state'] == 'ready', status
            assert [s['name'] for s in site['sources']] == ['Guides']
            assert site['defaultDoc'] == 'Guides/getting-started'
            print('SITE ' + json.dumps(site, sort_keys=True), flush=True)
            check_modules()
            for _ in range(3):
                # Same requests as loadSite/loadAuth/waitForIndex/requirements/loadResults,
                # followed by the lazy tree, route and access queries.
                get('/')
                site = get('/site.json')
                get('/api/auth/me')
                suffix = '?project=' + site['project'] if site.get('project') else ''
                assert get('/api/index/status' + suffix)['state'] == 'ready'
                coverage = get('/api/index/coverage' + suffix)
                requirement = next(r for r in coverage['requirements'] if r['id'] == 'R_FX_FIX_1')
                assert requirement['verifiedBy'] == ['T_FX_fix_1'], requirement
                get('/api/tests/Guides')
                get('/api/auto/Guides')
                get('/api/xml/Guides')
                get('/api/index/tree?path=&project=default')
                get('/api/index/tree?path=Guides&project=default')
                for name in ('getting-started', 'Verification', 'Requirements'):
                    assert '# ' in get('/docs/Guides/' + name + '.md')
                get('/api/index/access?id=Guides%2FRequirements&project=default')
            print('PASS: fixture startup APIs and inverse verification link, three rounds.', flush=True)
        finally:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait(timeout=5)
            print('Stopped owned fixture server.', flush=True)


if __name__ == '__main__':
    main()

