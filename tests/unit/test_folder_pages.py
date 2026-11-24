"""Folder pages: which document stands for a folder, and what the tree and the
folder endpoint say about it. Stdlib only, against a real index on a temp corpus."""
from pathlib import Path
import tempfile
import unittest

import webdoc_access
import webdoc_index

ROOT = Path(__file__).resolve().parents[2]
(ROOT / '.cache').mkdir(exist_ok=True)


def page(title=None, description=''):
    meta = {}
    if title:
        meta['title'] = title
    if description:
        meta['description'] = description
    head = ('<!--meta\n%s\n-->\n\n' % __import__('json').dumps(meta)) if meta else ''
    return head + '# %s\n\nBody.\n' % (title or 'Untitled')


class FakeGate:
    """Just enough of webdoc_access.Gate: a fixed visibility per id."""
    unrestricted = False

    def __init__(self, hidden=(), locked=()):
        self.hidden, self.locked = set(hidden), set(locked)

    def visibility(self, doc_id):
        if doc_id in self.hidden:
            return webdoc_access.HIDDEN
        if doc_id in self.locked:
            return webdoc_access.LOCKED
        return webdoc_access.FULL


class FolderPageTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(dir=ROOT / '.cache')
        self.addCleanup(temp.cleanup)
        self.docs = Path(temp.name) / 'docs'
        files = {
            'home.md': page('Home'),
            # sibling page: guide.md beside guide/
            'guide.md': page('The Guide', 'How to use it.'),
            'guide/step1.md': page('Step One'),
            # README inside a folder
            'kit/README.md': page('Kit Overview', 'All about the kit.'),
            'kit/parts.md': page('Parts', 'The parts list.'),
            # index.md outranks README.md; an untitled index is named after its folder
            'kit/sub/index.md': page(),
            'kit/sub/README.md': page('Sub Readme'),
            # a sibling outranks an index inside
            'both.md': page('Both Sibling'),
            'both/index.md': page('Both Index'),
            # no page at all: generated
            'notes/a.md': page('Note A', 'First note.'),
            'notes/deeper/b.md': page('Note B'),
            # LIKE treats _ as a wildcard; the folder below must not swallow "aXb"
            'a_b/x.md': page('In a_b'),
            'aXb/y.md': page('In aXb'),
        }
        for rel, text in files.items():
            path = self.docs / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding='utf-8')
        self.index = webdoc_index.Index(str(ROOT), [{'name': 'Lib', 'path': str(self.docs), 'component': 'LB'}],
                                        index_dir=str(Path(temp.name) / 'index'))
        self.addCleanup(lambda: self.index._conn().close())
        self.index.reconcile()
        self.assertEqual(self.index.state, 'ready')

    def test_tree_attaches_each_folders_page_and_does_not_list_it_twice(self):
        level = self.index.tree('Lib')
        self.assertEqual(level['folders'], ['a_b', 'aXb', 'both', 'guide', 'kit', 'notes'])
        self.assertEqual(level['pages'], {
            'both': {'id': 'Lib/both', 'title': 'Both Sibling'},
            'guide': {'id': 'Lib/guide', 'title': 'The Guide'},
            'kit': {'id': 'Lib/kit/README', 'title': 'Kit Overview'},
        })
        # The sibling files are now reached through their folder's row.
        self.assertEqual([d['id'] for d in level['docs']], ['Lib/home'])

    def test_an_inner_page_is_left_out_of_its_own_folder_listing(self):
        kit = self.index.tree('Lib/kit')
        self.assertEqual([d['id'] for d in kit['docs']], ['Lib/kit/parts'])
        self.assertEqual(kit['pages'], {'sub': {'id': 'Lib/kit/sub/index', 'title': 'Sub'}})
        # index.md won, so README.md in the same folder is an ordinary page.
        self.assertEqual([d['id'] for d in self.index.tree('Lib/kit/sub')['docs']], ['Lib/kit/sub/README'])
        # A sibling outranks an index inside: that index is then just a page.
        self.assertEqual([d['id'] for d in self.index.tree('Lib/both')['docs']], ['Lib/both/index'])

    def test_folder_with_a_readme_page(self):
        info = self.index.folder('Lib/kit')
        self.assertEqual(info['title'], 'Kit Overview')
        self.assertEqual(info['page'], {'id': 'Lib/kit/README', 'title': 'Kit Overview', 'description': 'All about the kit.'})
        self.assertEqual(info['docs'], [{'id': 'Lib/kit/parts', 'title': 'Parts', 'description': 'The parts list.'}])
        self.assertEqual(info['folders'], [{'name': 'sub', 'path': 'Lib/kit/sub', 'docs': 2, 'title': 'Sub',
                                            'description': '', 'page': 'Lib/kit/sub/index'}])

    def test_folder_with_a_sibling_page(self):
        info = self.index.folder('Lib/guide')
        self.assertEqual(info['page']['id'], 'Lib/guide')
        self.assertEqual([d['id'] for d in info['docs']], ['Lib/guide/step1'])

    def test_folder_without_a_page_is_generated_from_its_contents(self):
        info = self.index.folder('Lib/notes')
        self.assertIsNone(info['page'])
        self.assertEqual(info['title'], 'Notes')
        self.assertEqual(info['docs'], [{'id': 'Lib/notes/a', 'title': 'Note A', 'description': 'First note.'}])
        self.assertEqual(info['folders'], [{'name': 'deeper', 'path': 'Lib/notes/deeper', 'docs': 1,
                                            'title': 'Deeper', 'description': '', 'page': None}])

    def test_source_root_is_a_folder(self):
        info = self.index.folder('Lib')
        self.assertIsNone(info['page'])
        self.assertEqual(info['title'], 'Lib')
        self.assertEqual([f['name'] for f in info['folders']], ['a_b', 'aXb', 'both', 'guide', 'kit', 'notes'])

    def test_like_wildcards_do_not_leak_between_folders(self):
        self.assertEqual([d['id'] for d in self.index.folder('Lib/a_b')['docs']], ['Lib/a_b/x'])

    def test_missing_folder_and_a_document_path_are_not_folders(self):
        self.assertIsNone(self.index.folder('Lib/nope'))
        self.assertIsNone(self.index.folder('Lib/home'))
        self.assertIsNone(self.index.folder(''))

    def test_a_folder_of_hidden_pages_does_not_exist(self):
        gate = FakeGate(hidden={'Lib/notes/a', 'Lib/notes/deeper/b'})
        self.assertIsNone(self.index.folder('Lib/notes', gate))
        self.assertNotIn('notes', self.index.tree('Lib', gate)['folders'])

    def test_a_hidden_page_file_falls_back_to_the_next_candidate(self):
        gate = FakeGate(hidden={'Lib/both'})
        self.assertEqual(self.index.tree('Lib', gate)['pages']['both']['id'], 'Lib/both/index')
        gate = FakeGate(hidden={'Lib/kit/README'})
        info = self.index.folder('Lib/kit', gate)
        self.assertIsNone(info['page'])
        self.assertEqual(info['title'], 'Kit')

    def test_a_locked_page_keeps_its_title_but_not_its_description(self):
        gate = FakeGate(locked={'Lib/kit/README', 'Lib/kit/parts'})
        info = self.index.folder('Lib/kit', gate)
        self.assertEqual(info['page'], {'id': 'Lib/kit/README', 'title': 'Kit Overview', 'description': '', 'locked': True})
        self.assertEqual(info['docs'], [{'id': 'Lib/kit/parts', 'title': 'Parts', 'description': '', 'locked': True}])
        self.assertEqual(self.index.tree('Lib', gate)['pages']['kit'], {'id': 'Lib/kit/README', 'title': 'Kit Overview', 'locked': True})


if __name__ == '__main__':
    unittest.main()
