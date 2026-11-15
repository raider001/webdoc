"""Two-project routing plus ACLs over real HTTP handlers in memory; no socket."""
import json
from pathlib import Path
import tempfile
import unittest

import serve
import webdoc_auth
import webdoc_index
import webdoc_parse_worker
from test_regressions_154c import Client, PASSWORD

ROOT = Path(__file__).resolve().parents[2]


class ProjectSecurity158(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / '.cache', prefix='projects-security-158-')
        self.addCleanup(self.temp.cleanup)
        home = Path(self.temp.name)
        projects = []
        for name, title, component in [('LM', 'LM', 'LM'), ('FAF-CLONE', 'FAF Clone', 'FAF')]:
            docs = home / name
            docs.mkdir()
            for leaf, access in [('overview', None), ('locked', {'read': ['staff']}),
                                 ('hidden', {'hidden': True, 'read': ['staff']})]:
                meta = {'title': name + ' ' + leaf, 'description': name + '-SECRET-' + leaf}
                if access:
                    meta['access'] = access
                (docs / (leaf + '.md')).write_text('<!--meta ' + json.dumps(meta) + '-->\n# ' + leaf + '\n' +
                                                  name + '-BODY-' + leaf + '\n', encoding='utf-8')
            projects.append(dict(name=name, title=title, defaultDoc=name + '/overview',
                                 indexDir=str(home / ('index-' + name)),
                                 sources=[dict(name=name, path=str(docs), component=component)]))
        config = home / 'config.json'
        config.write_text(json.dumps(dict(siteTitle='Kalynx', projects=projects, watchIntervalSec=0,
            auth=dict(enabled=True, publicRead=True, usersFile=str(home / 'auth/users.json'),
                      pbkdf2Iterations=50000, groups={'staff': {}}))), encoding='utf-8')
        self.config = serve.load_config(str(config))
        self.indexes = {}
        for project in self.config['projects']:
            index = webdoc_index.Index(str(home), project['sources'], index_dir=project['indexDir'])
            self.addCleanup(index._conn().close)
            index.reconcile()
            self.assertEqual(index.state, 'ready')
            self.indexes[project['name']] = index
        self.addCleanup(webdoc_parse_worker._stop)
        self.users = webdoc_auth.UserStore(self.config['auth'].users_file, 50000)
        self.users.create('staffer', PASSWORD, groups=['staff'])
        self.sessions = webdoc_auth.SessionStore()

    def client(self, read_only):
        handler = serve.handler_class(read_only)
        handler.config = {**self.config, 'readOnly': read_only}
        handler.indexes = self.indexes
        handler.index = self.indexes['LM']
        handler.users, handler.sessions = self.users, self.sessions
        handler.login_limiter = webdoc_auth.RateLimiter(10, 300, 900)
        handler.ip_limiter = webdoc_auth.RateLimiter(60, 300, 900)
        handler.csp = serve.build_csp(self.config['auth'])
        handler.log_message = lambda *args: None
        return Client(handler)

    def test_switching_projects_preserves_acl_and_never_reuses_the_previous_index(self):
        signed_in = self.client(False)
        self.assertEqual(signed_in.login('staffer').status, 200)
        for read_only in (False, True):
            for member in (False, True):
                client = self.client(read_only)
                if member:
                    client.cookies.update(signed_in.cookies)
                for name, other in [('LM', 'FAF-CLONE'), ('FAF-CLONE', 'LM'), ('LM', 'FAF-CLONE')]:
                    with self.subTest(readOnly=read_only, staff=member, project=name):
                        response = client.request('GET', '/site.json?project=' + name)
                        self.assertEqual(response.status, 200)
                        site = json.loads(response.body)
                        self.assertEqual(site['project'], name)
                        self.assertEqual(site['readOnly'], read_only)
                        self.assertEqual([s['name'] for s in site['sources']], [name])
                        self.assertEqual([p['name'] for p in site['projects']], ['LM', 'FAF-CLONE'])
                        status = client.request('GET', '/api/index/status?project=' + name)
                        self.assertEqual(json.loads(status.body)['docs'], 3 if member else 2)
                        for endpoint in ('graph', 'tree?path=' + name, 'search?q=SECRET', 'coverage'):
                            separator = '&' if '?' in endpoint else '?'
                            response = client.request('GET', '/api/index/' + endpoint + separator + 'project=' + name)
                            self.assertEqual(response.status, 200)
                            self.assertNotIn(other.encode(), response.body)
                            if not member:
                                self.assertNotIn((name + '/hidden').encode(), response.body)
                                self.assertNotIn(b'SECRET-locked', response.body)
                        for leaf, code in [('overview', 200), ('locked', 200 if member else 403),
                                           ('hidden', 200 if member else 404)]:
                            response = client.request('GET', '/docs/' + name + '/' + leaf + '.md?project=' + name)
                            self.assertEqual(response.status, code)
                            if code != 200:
                                self.assertNotIn(b'-BODY-', response.body)
                        self.assertEqual(client.request('GET', '/docs/' + other + '/overview.md?project=' + name).status, 404)
                        if read_only:
                            self.assertEqual(client.request('PUT', '/docs/' + name + '/overview.md', '# changed').status, 405)


if __name__ == '__main__':
    unittest.main()
