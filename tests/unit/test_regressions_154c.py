"""Real HTTP handler/ACL/session replays over memory streams; no server/socket."""
import contextlib
import http.client
from http.cookies import SimpleCookie
import io
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import bootstrap_admin
import serve
import webdoc_auth
import webdoc_index
import webdoc_parse_worker

ROOT = Path(__file__).resolve().parents[2]
PASSWORD = 'correct-horse-battery'
HOST = '127.0.0.1:8796'  # authority only: no socket is opened
PUBLIC = '<!--meta {"title":"Public"}-->\n# Public\n![logo](open-logo.svg)\n'
LOCKED = '<!--meta {"title":"Public","access":{"read":["ops"]}}-->\n# Public\n![logo](open-logo.svg)\n'


class MemorySocket:
    def __init__(self, data):
        self.data, self.output = data, bytearray()

    def makefile(self, *args, **kwargs):
        return io.BytesIO(self.data)

    def sendall(self, data):
        self.output.extend(data)

    def settimeout(self, value):
        pass


class Client:
    def __init__(self, handler):
        self.handler, self.cookies = handler, {}

    def request(self, method, path, body=b''):
        if isinstance(body, dict):
            body = json.dumps(body).encode('utf-8')
        if isinstance(body, str):
            body = body.encode('utf-8')
        headers = {'Host': HOST, 'Content-Length': str(len(body))}
        if self.cookies:
            headers['Cookie'] = '; '.join(k + '=' + v for k, v in self.cookies.items())
        if method not in ('GET', 'HEAD'):
            headers['Origin'] = 'http://' + HOST
            headers['X-WebDoc-CSRF'] = self.cookies.get('wd_csrf', '')
        wire = (method + ' ' + path + ' HTTP/1.1\r\n' +
                ''.join(k + ': ' + v + '\r\n' for k, v in headers.items()) + '\r\n').encode('ascii') + body
        connection = MemorySocket(wire)
        self.handler(connection, ('127.0.0.1', 12345), SimpleNamespace(server_port=8796))
        response = http.client.HTTPResponse(MemorySocket(bytes(connection.output)))
        response.begin()
        for value in response.headers.get_all('Set-Cookie', []):
            cookie = SimpleCookie(value)
            self.cookies.update({k: v.value for k, v in cookie.items()})
        return SimpleNamespace(status=response.status, body=response.read(), headers=response.headers)

    def login(self, username):
        self.request('GET', '/api/auth/me')
        return self.request('POST', '/api/auth/login', {'username': username, 'password': PASSWORD})


class Regressions154C(unittest.TestCase):
    def setUp(self):
        (ROOT / '.cache').mkdir(exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / '.cache', prefix='regressions-154c-')
        self.addCleanup(self.temp.cleanup)
        home = Path(self.temp.name)
        docs = home / 'docs'
        docs.mkdir()
        self.docs = docs
        (docs / 'public.md').write_text(PUBLIC, encoding='utf-8')
        (docs / 'broken.md').write_text('<!--meta {"title":"Broken",}-->\n# Broken\nkeyword_broken\n', encoding='utf-8')
        (docs / 'open-logo.svg').write_text('<svg>PUBLIC_IMAGE_BYTES</svg>', encoding='utf-8')
        config = home / 'config.json'
        config.write_text(json.dumps({
            'sources': [{'name': 'Lib', 'path': str(docs), 'component': 'T'}],
            'indexDir': str(home / 'index'), 'watchIntervalSec': 0,
            'auth': {'enabled': True, 'usersFile': str(home / 'auth/users.json'),
                     'pbkdf2Iterations': 50000,
                     'groups': {'staff': {}, 'ops': {}, 'admins': {}}},
        }), encoding='utf-8')
        # Real offline bootstrap, with only its interactive prompts adapted.
        with patch.object(sys, 'argv', ['bootstrap_admin.py', '--config', str(config), '--username', 'rootadmin']), \
             patch('getpass.getpass', return_value=PASSWORD), contextlib.redirect_stdout(io.StringIO()):
            bootstrap_admin.main()
        cfg = serve.load_config(str(config))
        self.handler = serve.handler_class()
        self.handler.config = cfg
        self.handler.csp = serve.build_csp(cfg['auth'])
        self.handler.log_message = lambda *args: None
        self.handler.users = webdoc_auth.UserStore(cfg['auth'].users_file, 50000)
        self.handler.sessions = webdoc_auth.SessionStore()
        self.handler.login_limiter = webdoc_auth.RateLimiter(10, 300, 900)
        self.handler.ip_limiter = webdoc_auth.RateLimiter(60, 300, 900)
        self.index = webdoc_index.Index(str(home), cfg['sources'], index_dir=str(home / 'index'))
        self.addCleanup(self.index._conn().close)
        self.addCleanup(webdoc_parse_worker._stop)
        self.index.reconcile()
        self.assertEqual(self.index.state, 'ready')
        self.handler.index = self.index
        self.handler.indexes = {cfg['projects'][0]['name']: self.index}
        self.root = Client(self.handler)
        self.assertEqual(self.root.login('rootadmin').status, 200)

    def update(self, client, **body):
        return client.request('POST', '/api/auth/users/update', body)

    def account(self, name, groups):
        response = self.root.request('POST', '/api/auth/users/create',
                                     {'username': name, 'password': PASSWORD, 'groups': groups})
        self.assertEqual(response.status, 201, response.body)
        client = Client(self.handler)
        self.assertEqual(client.login(name).status, 200)
        return client

    def test_admin_validation_then_malformed_page_and_asset_lock(self):
        response = self.update(self.root, username='rootadmin', admin=False)
        self.assertEqual(response.status, 400)
        self.assertIn('last administrator', json.loads(response.body)['error'])
        plain = self.account('plain', [])
        staff = self.account('staffer', ['staff'])
        ops = self.account('opsuser', ['ops'])
        group = self.account('groupadmin', ['admins'])
        self.assertEqual(self.update(group, username='rootadmin', disabled=True).status, 200)
        try:
            # Reproduce both later 403s while the earlier test has disabled root.
            self.assertEqual(self.root.request('GET', '/docs/Lib/broken.md').status, 403)
            self.assertEqual(self.root.request('PUT', '/docs/Lib/public.md', LOCKED).status, 403)
            response = self.update(group, username='groupadmin', groups=[])
            self.assertEqual(response.status, 400)
            self.assertIn('last administrator', json.loads(response.body)['error'])
        finally:
            self.assertEqual(self.update(group, username='rootadmin', disabled=False).status, 200)
            self.assertEqual(self.root.login('rootadmin').status, 200)
        for client in (plain, staff, Client(self.handler)):
            response = client.request('GET', '/docs/Lib/broken.md')
            self.assertEqual(response.status, 403)
            self.assertNotIn(b'keyword_broken', response.body)
        response = self.root.request('GET', '/docs/Lib/broken.md')
        self.assertEqual(response.status, 200)
        self.assertIn(b'keyword_broken', response.body)
        self.assertEqual(plain.request('GET', '/docs/Lib/open-logo.svg').status, 200)
        response = self.root.request('PUT', '/docs/Lib/public.md', LOCKED)
        self.assertEqual(response.status, 200, response.body)
        self.assertIn(plain.request('GET', '/docs/Lib/open-logo.svg').status, (403, 404))
        self.assertEqual(ops.request('GET', '/docs/Lib/open-logo.svg').status, 200)
        self.assertEqual(self.root.request('PUT', '/docs/Lib/public.md', PUBLIC).status, 200)
        self.assertEqual(plain.request('GET', '/docs/Lib/open-logo.svg').status, 200)

    def test_unindexed_files_still_fail_closed_even_for_an_administrator(self):
        (self.docs / 'unindexed.md').write_text('UNINDEXED-CANARY', encoding='utf-8')
        for method in ('GET', 'PUT', 'DELETE'):
            response = self.root.request(method, '/docs/Lib/unindexed.md', b'replacement' if method == 'PUT' else b'')
            self.assertEqual(response.status, 404)
            self.assertNotIn(b'UNINDEXED-CANARY', response.body)
        self.assertEqual((self.docs / 'unindexed.md').read_text(encoding='utf-8'), 'UNINDEXED-CANARY')

    def test_internal_exceptions_and_policy_refusals_remain_generic(self):
        for error, expected in ((OSError("[WinError 183] C:\\private\\account.json"), 500),
                                (serve._Refused('C:\\private\\internal'), 400)):
            with self.subTest(error=type(error).__name__), \
                 patch.object(self.handler, 'route', side_effect=error), contextlib.redirect_stdout(io.StringIO()):
                response = self.root.request('GET', '/')
            self.assertEqual(response.status, expected)
            self.assertEqual(json.loads(response.body)['error'], 'request failed' if expected == 500 else 'request refused')
            self.assertEqual(response.headers['Server'], 'Kalynx')
            self.assertNotIn(b'private', response.body)
            self.assertNotIn(b'WinError', response.body)


if __name__ == '__main__':
    unittest.main()
