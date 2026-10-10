"""Read-only table data endpoint: session policy, containment, limits and ETags."""
import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from urllib.parse import urlencode

import serve
import webdoc_index

ROOT = Path(__file__).resolve().parents[2]
(ROOT / '.cache').mkdir(exist_ok=True)


class WidgetDataEndpointTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / '.cache')
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        (self.folder / 'jobs.csv').write_text('job,status\na,running\n', encoding='utf-8')
        (self.folder / 'jobs.json').write_text('[{"job":"a"}]', encoding='utf-8')
        (self.folder / '.webdoc-auto.json').write_text('{"secret":true}', encoding='utf-8')
        self.allowed = {'Docs/demo'}
        self.handler = object.__new__(serve.DocHandler)
        self.handler.config = {'auth': SimpleNamespace(enabled=True, public_read=False),
                               'sources': [{'name': 'Docs', 'path': str(self.folder)}]}
        self.handler.principal = SimpleNamespace(authenticated=True, admin=False)
        self.handler.gate = SimpleNamespace(ready=True, unrestricted=False,
            can_read=lambda doc: doc in self.allowed)
        self.handler.index = SimpleNamespace(asset_referrers=lambda _: ['Docs/demo'],
            docs_in_folder=lambda _: ['Docs/demo'], tree=lambda *_: {'folders': [], 'docs': [{'id': 'Docs/demo'}]})
        self.handler._asset_cache = {}
        self.handler.headers = {}
        self.handler.sent = None
        def send(status, body, ctype='', extra=()):
            self.handler.sent = (status, body, dict(extra))
            return True
        self.handler._send = send
        self.handler._send_static = send
        self.handler._json = lambda status, value, extra=(): send(status, value, extra=extra)
        self.handler._deny = lambda *_args, **_kwargs: send(403, {'error': 'restricted'})
        self.handler._not_found = lambda: send(404, {'error': 'not found'})
        self.handler._not_ready = lambda: send(503, {'error': 'index building'})

    def request(self, action='file', **query):
        self.handler.path = '/api/data/' + action + '?' + urlencode(query)
        self.handler._data_get(action)
        return self.handler.sent

    def test_reads_csv_and_json_and_returns_etag(self):
        for name in ('jobs.csv', 'jobs.json'):
            with self.subTest(name=name):
                status, body, headers = self.request(src='Docs/' + name)
                self.assertEqual(status, 200)
                self.assertEqual(body, (self.folder / name).read_bytes())
                self.assertIn('ETag', headers)
                self.handler.headers['If-None-Match'] = headers['ETag']
                self.assertEqual(self.request(src='Docs/' + name)[:2], (304, b''))

    def test_access_is_rechecked_before_conditional_read(self):
        _, _, headers = self.request(src='Docs/jobs.csv')
        self.handler.headers['If-None-Match'] = headers['ETag']
        self.allowed.clear()
        self.assertEqual(self.request(src='Docs/jobs.csv')[0], 404)
        self.assertNotIn('ETag', self.handler.sent[2])

    def test_requires_the_session_and_ready_acl_map(self):
        self.handler.principal.authenticated = False
        self.assertEqual(self.request(src='Docs/jobs.csv')[0], 403)
        self.handler.principal.authenticated = True
        self.handler.gate.ready = False
        self.assertEqual(self.request(src='Docs/jobs.csv')[0], 503)

    def test_inherits_the_existing_asset_folder_policy_when_unreferenced(self):
        self.handler.index.asset_referrers = lambda _: []
        self.assertEqual(self.request(src='Docs/jobs.csv')[0], 200)
        self.allowed.clear(); self.handler._asset_cache.clear()
        self.assertEqual(self.request(src='Docs/jobs.csv')[0], 404)

    def test_refuses_traversal_hidden_files_ads_and_unsupported_formats(self):
        for source in ('Docs/../jobs.csv', 'Docs/./jobs.csv', 'Docs//jobs.csv', 'Docs/%2e%2e/jobs.csv',
                       'Docs/..\\jobs.csv', 'Docs/jobs.csv:secret', 'Docs/.webdoc-auto.json',
                       'Docs/jobs.csv.', 'Docs/jobs.md', 'Unknown/jobs.csv', 'https://elsewhere/jobs.csv'):
            with self.subTest(source=source):
                self.assertEqual(self.request(src=source)[0], 404)

    def test_refuses_a_symlink_or_junction_that_resolves_outside_the_source(self):
        outside = str(self.folder.parent / 'outside.csv')
        with patch('serve.os.path.realpath', side_effect=[str(self.folder), outside]):
            self.assertIsNone(serve.safe_data_path(str(self.folder), 'linked/jobs.csv'))
        with patch('serve.os.path.realpath', side_effect=[str(self.folder), outside]):
            self.assertEqual(self.request(src='Docs/linked/jobs.csv')[0], 404)

    def test_bounds_reads_to_two_mib(self):
        (self.folder / 'large.csv').write_bytes(b'x' * (serve.MAX_DATA_BYTES + 1))
        self.assertEqual(self.request(src='Docs/large.csv')[0], 413)

    def test_file_browser_filters_formats_private_files_and_hidden_names(self):
        result = self.request('tree', path='Docs', format='csv')
        self.assertEqual(result[0], 200)
        self.assertEqual(result[1]['files'], [{'id': 'Docs/jobs.csv', 'title': 'jobs.csv'}])
        self.allowed.clear()
        self.assertEqual(self.request('tree', path='Docs', format='csv')[1]['files'], [])
        self.assertEqual(self.request('tree', path='Docs/..', format='csv')[0], 404)

    def test_post_cannot_write_data(self):
        before = (self.folder / 'jobs.csv').read_bytes()
        self.handler.path = '/api/data/file?src=Docs/jobs.csv'
        self.handler._post()
        self.assertEqual(self.handler.sent[0], 405)
        self.assertEqual((self.folder / 'jobs.csv').read_bytes(), before)

    def test_browser_discovers_data_only_subfolders_without_leaking_private_files(self):
        folder = self.folder / 'data' / 'nested'
        folder.mkdir(parents=True)
        (folder / 'jobs.csv').write_text('job\na\n', encoding='utf-8')
        self.handler.index.tree = lambda *_: {'folders': [], 'docs': []}
        self.assertEqual(self.request('tree', path='Docs', format='csv')[1]['folders'], ['data'])
        self.assertEqual(self.request('tree', path='Docs/data', format='csv')[1]['folders'], ['nested'])
        self.allowed.clear(); self.handler._asset_cache.clear()
        self.assertEqual(self.request('tree', path='Docs', format='csv')[1]['folders'], [])

    def test_widget_source_is_indexed_as_an_asset_referrer_even_when_nested(self):
        folder = self.folder / 'index'
        index = webdoc_index.Index(str(ROOT), [{'name': 'Docs', 'path': str(self.folder), 'component': 'WD'}], index_dir=str(folder))
        db = index._conn()
        try:
            table = '<!--meta start ' + json.dumps({'widget': 'live-table', 'source': {'kind': 'csv', 'src': 'Docs/jobs.csv'}}) + '-->\n<!--meta end {"widget":"live-table"}-->'
            source = '<!--meta {"access":{"read":["staff"]}}-->\n<!--meta start {"widget":"collapse"}-->\n' + table + '\n<!--meta end {"widget":"collapse"}-->'
            index._write_doc(db, 'Docs/private', 'Docs', 'private.md', 'WD', source, 1, len(source))
            index._relink(db)
            self.assertEqual(index.asset_referrers('Docs/jobs.csv'), ['Docs/private'])
        finally:
            db.close()


if __name__ == '__main__':
    unittest.main()
