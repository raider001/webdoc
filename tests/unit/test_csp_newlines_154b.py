"""HTML response bytes and the theme CSP must agree across checkout line endings."""
import base64
import hashlib
from pathlib import Path
import re
import tempfile
import unittest
from unittest.mock import Mock, patch

import serve
import webdoc_auth


ROOT = Path(__file__).resolve().parents[2]
INLINE = re.compile(r'<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>', re.S | re.I)


class CspNewlines(unittest.TestCase):
    def assert_response_scripts_allowed(self, path, app_dir):
        handler = object.__new__(serve.DocHandler)
        handler._send_static = Mock()
        handler._file(str(path))
        status, body, ctype = handler._send_static.call_args.args
        self.assertEqual(status, 200)
        self.assertTrue(ctype.startswith('text/html'))
        self.assertNotIn(b'\r', body)
        with patch.object(serve, 'APP_DIR', str(app_dir)):
            policy = serve.build_csp(webdoc_auth.AuthConfig({}, str(app_dir)))
        scripts = INLINE.findall(body.decode('utf-8'))
        self.assertTrue(scripts)
        for script in scripts:
            digest = base64.b64encode(hashlib.sha256(script.encode('utf-8')).digest()).decode('ascii')
            self.assertIn("'sha256-" + digest + "'", policy)
        self.assertNotIn("'unsafe-inline'", policy)
        return body

    def test_lf_crlf_and_cr_html_responses_match_the_policy(self):
        (ROOT / '.cache').mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=ROOT / '.cache', prefix='csp-154b-') as folder:
            path = Path(folder) / 'index.html'
            html = '<!doctype html>\n<script>\nwindow.theme = "café";\n</script>\n'
            for ending in ('\n', '\r\n', '\r'):
                with self.subTest(ending=repr(ending)):
                    path.write_bytes(html.replace('\n', ending).encode('utf-8'))
                    body = self.assert_response_scripts_allowed(path, path.parent)
                    self.assertEqual(body.decode('utf-8'), html)

    def test_real_index_response_matches_the_policy(self):
        self.assert_response_scripts_allowed(ROOT / 'app/index.html', ROOT / 'app')

    def test_non_html_bytes_are_preserved(self):
        (ROOT / '.cache').mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=ROOT / '.cache', prefix='csp-154b-') as folder:
            path = Path(folder) / 'sample.txt'
            data = b'keep\r\nthese\rbytes\n'
            path.write_bytes(data)
            handler = object.__new__(serve.DocHandler)
            handler._send_static = Mock()
            handler._file(str(path))
            self.assertEqual(handler._send_static.call_args.args[1], data)


if __name__ == '__main__':
    unittest.main()
