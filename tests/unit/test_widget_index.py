"""Stdlib-only tests for server parity and access redaction inside widgets."""
import unittest
from types import SimpleNamespace

import webdoc_index
import webdoc_access


def wrap(name, body):
    return '<!--meta start {"widget":"%s"}-->\n%s\n<!--meta end {"widget":"%s"}-->' % (name, body, name)


REQ = '''<!--meta start {"requirement-group":"queue"}-->
| requirement-no | description | trace-to |
|---|---|---|
| 1 | Queue | sys_1 |
<!--meta end {"requirement-group":"queue"}-->'''
TEST = '''<!--meta start {"test":"queue","steps":[{"action":"Run","expected":"Done"}]}-->
<!--meta end {"test":"queue"}-->'''


class WidgetIndexTests(unittest.TestCase):
    def test_duplicate_next_and_assumes_keep_first_order(self):
        for field in ('next', 'assumes'):
            with self.subTest(field=field):
                source = '<!--meta {"%s":["LM/a","LM/a","LM/b","LM/a"]}-->\nBody' % field
                meta, body, ok = webdoc_index.split_meta_ex(source)
                self.assertTrue(ok)
                self.assertEqual(meta[field], ['LM/a', 'LM/b'])
                self.assertEqual(body, 'Body')

    def test_invalid_relation_items_are_not_indexed_as_ids(self):
        meta, _, ok = webdoc_index.split_meta_ex('<!--meta {"next":"LM/a","assumes":[null,"LM/a",42,"LM/a"]}-->')
        self.assertTrue(ok)
        self.assertEqual(meta, {'next': [], 'assumes': ['LM/a']})

    def test_indexes_requirements_and_tests_nested_in_widgets(self):
        reqs, tests = webdoc_index.extract_blocks(wrap('collapse', REQ + '\n' + wrap('collapse', TEST)), 'WD')
        self.assertEqual([r['id'] for r in reqs], ['R_WD_QUEUE_1'])
        self.assertEqual([t['id'] for t in tests], ['T_WD_queue'])
        self.assertEqual(tests[0]['steps'][0]['action'], 'Run')

    def test_header_does_not_consume_first_widget(self):
        body = wrap('collapse', '# Heading')
        self.assertEqual(webdoc_index.split_meta_ex(body), ({}, body, True))

    def test_widget_headings_and_links_remain_searchable(self):
        body = wrap('collapse', '## Running\n[link](Docs/overview)\n' + REQ)
        self.assertEqual(webdoc_index.extract_headings(body), ['Running'])
        self.assertEqual(webdoc_index.extract_links(body), [('Docs/overview', False)])

    def test_code_examples_are_not_indexed_as_widgets_or_requirements(self):
        self.assertEqual(webdoc_index.extract_blocks('```text\n' + wrap('collapse', REQ) + '\n```', 'WD'), ([], []))

    def test_malformed_wrappers_do_not_crash_indexing(self):
        self.assertEqual(webdoc_index.extract_blocks('<!--meta start {"widget":"collapse",}-->\nbody', 'WD'), ([], []))

    def test_section_access_is_redacted_inside_a_widget(self):
        cfg = SimpleNamespace(enabled=True)
        reader = SimpleNamespace(admin=False, groups=frozenset(), authenticated=True)
        source = wrap('collapse', 'Public\n<!--access start {"read":["staff"]}-->\nSECRET\n<!--access end-->')
        redacted, count = webdoc_access.redact_sections(cfg, reader, source)
        self.assertEqual(count, 1)
        self.assertNotIn('SECRET', redacted)
        self.assertIn('Public', redacted)
        self.assertIn('wd-restricted', redacted)
        self.assertIn('"widget":"collapse"', redacted)


if __name__ == '__main__':
    unittest.main()
