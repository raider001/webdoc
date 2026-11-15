"""Actual results routing over memory HTTP transport; no socket or runner."""
import json
from pathlib import Path
import tempfile
import unittest
import xml.etree.ElementTree as ET

import serve
import webdoc_index
import webdoc_parse_worker
from test_regressions_154c import Client

ROOT = Path(__file__).resolve().parents[2]


class MissingResults154D(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / '.cache', prefix='missing-results-154d-')
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        self.docs = self.home / 'source'
        self.docs.mkdir()
        (self.docs / 'overview.md').write_text('# Overview\n', encoding='utf-8')
        config = self.home / 'config.json'
        config.write_text(json.dumps({
            'sources': [{'name': 'Open', 'path': str(self.docs), 'component': 'D',
                         'testResults': '.results.xml', 'excludeDirectories': ['private']}],
            'auth': {'usersFile': str(self.home / 'auth/users.json')},
            'watchIntervalSec': 0, 'indexDir': str(self.home / 'index'),
        }), encoding='utf-8')
        self.config = serve.load_config(str(config))
        self.index = webdoc_index.Index(str(self.home), self.config['sources'], index_dir=str(self.home / 'index'))
        self.addCleanup(self.index._conn().close)
        self.addCleanup(webdoc_parse_worker._stop)
        self.index.reconcile()
        self.assertEqual(self.index.state, 'ready')

    def client(self, read_only):
        handler = serve.handler_class(read_only)
        handler.config = {**self.config, 'readOnly': read_only}
        handler.index = self.index
        handler.indexes = {self.config['projects'][0]['name']: self.index}
        handler.runs = None
        handler.csp = serve.build_csp(self.config['auth'])
        handler.log_message = lambda *args: None
        return Client(handler)

    def test_missing_configured_feed_is_404_in_both_modes(self):
        for read_only in (True, False):
            with self.subTest(readOnly=read_only):
                client = self.client(read_only)
                response = client.request('GET', '/site.json')
                self.assertEqual(response.status, 200)
                self.assertEqual(json.loads(response.body)['sources'][0]['testResults'], '/api/results/Open')
                self.assertEqual(client.request('GET', '/api/results/Open').status, 404)
                self.assertEqual(client.request('GET', '/api/results/Unknown').status, 404)
                for endpoint in ('tests', 'auto', 'xml'):
                    self.assertEqual(client.request('GET', '/api/' + endpoint + '/Open').status, 200)
                self.assertEqual(client.request('GET', '/docs/Open/overview.md').status, 200)
        self.assertFalse((self.docs / '.results.xml').exists())

    def test_read_only_empty_feed_and_reader_projection_keep_security(self):
        client = self.client(True)
        self.assertFalse(hasattr(client.handler, '_put'))
        self.assertFalse(hasattr(client.handler, '_auth_register'))
        path = self.docs / '.results.xml'
        path.write_text('<testsuite/>', encoding='utf-8')
        response = client.request('GET', '/api/results/Open')
        self.assertEqual(response.status, 200)
        self.assertEqual(list(ET.fromstring(response.body)), [])
        path.write_text('<testsuite><properties><property name="cwd" value="PATH-CANARY"/></properties>'
                        '<testcase classname="T_D_one" name="test_one"><failure message="PATH-CANARY">OUTPUT-CANARY</failure>'
                        '<system-out>STDOUT-CANARY</system-out></testcase></testsuite>', encoding='utf-8')
        response = client.request('GET', '/api/results/Open')
        self.assertEqual(response.status, 200)
        self.assertEqual(len(ET.fromstring(response.body).findall('testcase/failure')), 1)
        for secret in (b'PATH-CANARY', b'OUTPUT-CANARY', b'STDOUT-CANARY', b'cwd', b'system-out'):
            self.assertNotIn(secret, response.body)
        self.assertEqual(client.request('GET', '/docs/Open/.results.xml').status, 404)
        for method, endpoint in [('PUT', '/docs/Open/overview.md'), ('POST', '/api/runs'),
                                 ('PUT', '/api/tests/Open'), ('POST', '/api/auth/register')]:
            self.assertEqual(client.request(method, endpoint, '{}').status, 405)


if __name__ == '__main__':
    unittest.main()
