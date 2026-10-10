"""Index deduplication and session-specific document validators, stdlib only."""
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest

import serve
import webdoc_access
import webdoc_index

ROOT = Path(__file__).resolve().parents[2]
(ROOT / '.cache').mkdir(exist_ok=True)


class DocumentMetadataTests(unittest.TestCase):
    def test_duplicate_relations_are_not_written_to_the_sqlite_index(self):
        with tempfile.TemporaryDirectory(dir=ROOT / '.cache') as folder:
            index = webdoc_index.Index(str(ROOT), [], index_dir=folder)
            db = index._conn()
            try:
                index._write_doc(db, 'LM/a', 'LM', 'a.md', 'LM',
                                '<!--meta {"next":["LM/b","LM/b"],"assumes":["LM/c","LM/c"]}-->\n# A', 1, 80)
                rows = db.execute('SELECT kind,to_raw,ord FROM meta_edge ORDER BY kind').fetchall()
                self.assertEqual([tuple(row) for row in rows], [('assumes', 'LM/c', 0), ('next', 'LM/b', 0)])
            finally:
                db.close()

    def handler(self, path, enabled=False):
        handler = object.__new__(serve.DocHandler)
        handler.config = {'auth': SimpleNamespace(enabled=enabled)}
        handler.principal = SimpleNamespace(admin=False, groups=frozenset(), authenticated=True)
        handler.gate = SimpleNamespace(visibility=lambda _: webdoc_access.FULL, eff=lambda _: {'read': ['staff']})
        handler.headers = {}
        handler._doc_id_for = lambda *_: 'Scratch/a'
        handler.sent = None
        def send(status, body, ctype='', extra=()):
            handler.sent = (status, body, dict(extra))
            return True
        handler._send = send
        handler._send_static = send
        handler._not_found = lambda: send(404, b'')
        handler._deny = lambda *_: send(403, b'')
        return handler

    def test_document_etag_revalidates_and_changes_when_markdown_changes(self):
        with tempfile.TemporaryDirectory(dir=ROOT / '.cache') as folder:
            path = os.path.join(folder, 'a.md')
            Path(path).write_text('# Before', encoding='utf-8')
            handler = self.handler(path)
            handler._doc_file({}, path)
            self.assertEqual(handler.sent[0], 200)
            handler.headers['If-None-Match'] = handler.sent[2]['ETag']
            handler._doc_file({}, path)
            self.assertEqual(handler.sent[:2], (304, b''))
            Path(path).write_text('# After', encoding='utf-8')
            handler._doc_file({}, path)
            self.assertEqual(handler.sent[:2], (200, b'# After'))

    def test_access_is_checked_before_returning_a_conditional_304(self):
        with tempfile.TemporaryDirectory(dir=ROOT / '.cache') as folder:
            path = os.path.join(folder, 'a.md')
            Path(path).write_text('# Document', encoding='utf-8')
            handler = self.handler(path)
            handler._doc_file({}, path)
            handler.headers['If-None-Match'] = handler.sent[2]['ETag']
            for visibility, expected in ((webdoc_access.HIDDEN, 404), (webdoc_access.LOCKED, 403)):
                handler.gate.visibility = lambda _, visibility=visibility: visibility
                handler._doc_file({}, path)
                self.assertEqual(handler.sent[0], expected)

    def test_etag_describes_the_redacted_session_representation(self):
        with tempfile.TemporaryDirectory(dir=ROOT / '.cache') as folder:
            path = os.path.join(folder, 'a.md')
            Path(path).write_text('Public\n<!--access start {"read":["staff"]}-->\nSECRET\n<!--access end-->', encoding='utf-8')
            handler = self.handler(path, enabled=True)
            handler._doc_file({}, path)
            self.assertNotIn(b'SECRET', handler.sent[1])
            handler.headers['If-None-Match'] = handler.sent[2]['ETag']
            handler.principal.groups = frozenset(['staff'])
            handler._doc_file({}, path)
            self.assertEqual(handler.sent[0], 200)
            self.assertIn(b'SECRET', handler.sent[1])


if __name__ == '__main__':
    unittest.main()
