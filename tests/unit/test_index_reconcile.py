"""Incremental index reconciliation when a requirement or test changes document, stdlib only."""
from pathlib import Path
import tempfile
import unittest

import webdoc_index

ROOT = Path(__file__).resolve().parents[2]
(ROOT / '.cache').mkdir(exist_ok=True)

RESOLVED = ('requirement', 'req_trace_to', 'req_trace_edge', 'test', 'test_verifies', 'req_verified_by')


def group(*rows):
    table = ''.join('| %s | Requirement %s | %s |\n' % (no, no, trace) for no, trace in rows)
    return ('<!--meta start {"requirement-group":"x"}-->\n| requirement-no | description | trace-to |\n|---|---|---|\n'
            + table + '<!--meta end {"requirement-group":"x"}-->\n')


def case(verifies):
    return ('<!--meta start {"test":"x","verifies":"%s","steps":[{"action":"Run","expected":"Done"}]}-->\n'
            '<!--meta end {"test":"x"}-->\n' % verifies)


class MovedDefinitionTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(dir=ROOT / '.cache')
        self.addCleanup(temp.cleanup)
        self.temp = Path(temp.name)
        self.docs = self.temp / 'docs'
        self.docs.mkdir()
        self.index = self.open_index('incremental')

    def open_index(self, name):
        index = webdoc_index.Index(str(ROOT), [{'name': 'LM', 'path': str(self.docs), 'component': 'LM'}],
                                   index_dir=str(self.temp / name))
        self.addCleanup(index._conn().close)
        return index

    def write(self, name, text):
        (self.docs / name).write_text(text, encoding='utf-8')

    def reconcile(self, index=None):
        index = index or self.index
        index.reconcile()
        self.assertEqual(index.state, 'ready')

    def rows(self, table, index=None):
        return sorted(tuple(row) for row in (index or self.index)._conn().execute('SELECT * FROM ' + table))

    def assert_matches_a_rebuild(self):
        rebuilt = self.open_index('rebuilt')
        self.reconcile(rebuilt)
        for table in RESOLVED:
            with self.subTest(table=table):
                self.assertEqual(self.rows(table), self.rows(table, rebuilt))

    def test_requirement_moved_to_another_document_keeps_one_trace_row_and_edge(self):
        self.write('a.md', group(('1', ''), ('1.1', '1')))
        self.reconcile()
        self.assertEqual(self.rows('req_trace_to'), [('R_LM_X_1.1', '1', 0)])
        self.assertEqual(self.rows('req_trace_edge'), [('R_LM_X_1.1', 'R_LM_X_1', 'LM/a', 'LM/a')])

        (self.docs / 'a.md').unlink()
        self.write('b.md', group(('1', ''), ('1.1', '1')))
        self.reconcile()
        self.assertEqual(self.rows('req_trace_to'), [('R_LM_X_1.1', '1', 0)])
        self.assertEqual(self.rows('req_trace_edge'), [('R_LM_X_1.1', 'R_LM_X_1', 'LM/b', 'LM/b')])
        parent = next(r for r in self.index.coverage()['requirements'] if r['id'] == 'R_LM_X_1')
        self.assertEqual(parent['traceFrom'], ['R_LM_X_1.1'])
        self.assert_matches_a_rebuild()

    def test_test_case_moved_to_another_document_keeps_one_verifies_row(self):
        self.write('reqs.md', group(('1', '')))
        self.write('a.md', case('x_1'))
        self.reconcile()
        self.assertEqual(self.rows('req_verified_by'), [('R_LM_X_1', 'T_LM_x')])

        (self.docs / 'a.md').unlink()
        self.write('b.md', case('x_1'))
        self.reconcile()
        self.assertEqual(self.rows('test_verifies'), [('T_LM_x', 'x_1', 0)])
        self.assertEqual(self.rows('req_verified_by'), [('R_LM_X_1', 'T_LM_x')])
        self.assertEqual(self.index.coverage()['requirements'][0]['verifiedBy'], ['T_LM_x'])
        self.assert_matches_a_rebuild()

    def test_moved_definition_drops_references_only_the_old_document_made(self):
        self.write('reqs.md', group(('1', ''), ('2', '')))
        self.write('a.md', group(('1.1', '1, 2')) + case('x_1, x_2'))
        self.reconcile()

        (self.docs / 'a.md').unlink()
        self.write('b.md', group(('1.1', '1')) + case('x_1'))
        self.reconcile()
        self.assertEqual(self.rows('req_trace_edge'), [('R_LM_X_1.1', 'R_LM_X_1', 'LM/b', 'LM/reqs')])
        self.assertEqual(self.rows('req_verified_by'), [('R_LM_X_1', 'T_LM_x')])
        self.assert_matches_a_rebuild()

    def test_definition_taken_over_before_the_old_document_drops_it(self):
        self.write('a.md', group(('1', ''), ('1.1', '1')) + case('x_1'))
        self.reconcile()
        self.write('b.md', group(('1', ''), ('1.1', '1')) + case('x_1'))
        self.reconcile()
        self.write('a.md', '# Moved to b\n')
        self.reconcile()
        self.assertEqual(self.rows('req_trace_to'), [('R_LM_X_1.1', '1', 0)])
        self.assertEqual(self.rows('req_trace_edge'), [('R_LM_X_1.1', 'R_LM_X_1', 'LM/b', 'LM/b')])
        self.assertEqual(self.rows('test_verifies'), [('T_LM_x', 'x_1', 0)])
        self.assertEqual(self.rows('req_verified_by'), [('R_LM_X_1', 'T_LM_x')])
        self.assert_matches_a_rebuild()

    def test_move_through_the_save_and_delete_endpoints_keeps_one_row(self):
        text = group(('1', ''), ('1.1', '1')) + case('x_1')
        self.write('a.md', text)
        self.reconcile()

        self.write('b.md', text)
        self.index.update_doc('LM', 'b.md', text)
        (self.docs / 'a.md').unlink()
        self.index.delete_doc('LM', 'a.md')
        self.assertEqual(self.rows('req_trace_to'), [('R_LM_X_1.1', '1', 0)])
        self.assertEqual(self.rows('req_trace_edge'), [('R_LM_X_1.1', 'R_LM_X_1', 'LM/b', 'LM/b')])
        self.assertEqual(self.rows('test_verifies'), [('T_LM_x', 'x_1', 0)])
        self.assertEqual(self.rows('req_verified_by'), [('R_LM_X_1', 'T_LM_x')])
        self.assert_matches_a_rebuild()


if __name__ == '__main__':
    unittest.main()
