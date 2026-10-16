"""Project configuration, resolver isolation, and compatibility of old mounts."""
import json
from pathlib import Path
import tempfile
import unittest
import serve
from webdoc_index import Index


def config(tmp_path, projects=None, **extra):
    data = dict(extra)
    if projects is not None:
        data['projects'] = projects
    path = tmp_path / 'config.json'
    path.write_text(json.dumps(data), encoding='utf-8')
    return serve.load_config(str(path))


def project(tmp_path, name, source=None, component='C'):
    folder = tmp_path / (source or name)
    folder.mkdir(exist_ok=True)
    return dict(name=name, title=name + ' project', defaultDoc=(source or name) + '/overview',
                indexDir=str(tmp_path / ('index-' + name)),
                sources=[dict(name=source or name, path=str(folder), component=component)])


def legacy_config_keeps_ids_default_and_index(tmp_path):
    p = project(tmp_path, 'LM')
    cfg = config(tmp_path, sources=p['sources'], defaultDoc='LM/overview', indexDir=p['indexDir'])
    assert cfg['legacy'] and cfg['projects'][0]['defaultDoc'] == 'LM/overview'
    assert cfg['projects'][0]['indexDir'] == p['indexDir']
    assert cfg['sources'][0]['name'] == 'LM'


def names_accept_hyphens_underscores_and_digits(tmp_path, name):
    cfg = config(tmp_path, [project(tmp_path, name)])
    assert cfg['projects'][0]['name'] == name


def invalid_names_refused(tmp_path, kind, name):
    p = project(tmp_path, 'Good')
    if kind == 'name': p['name'] = name
    else: p['sources'][0]['name' if kind == 'source' else 'component'] = name
    with unittest.TestCase().assertRaises(SystemExit): config(tmp_path, [p])


def duplicate_sources_and_index_locations_refused(tmp_path):
    a, b = project(tmp_path, 'LM'), project(tmp_path, 'FAF-CLONE')
    b['sources'][0]['name'] = 'LM'
    with unittest.TestCase().assertRaises(SystemExit): config(tmp_path, [a, b])
    b['sources'][0]['name'] = 'FAF-CLONE'
    b['indexDir'] = a['indexDir']
    with unittest.TestCase().assertRaises(SystemExit): config(tmp_path, [a, b])


def projects_isolate_search_requirements_coverage_map_and_resolution(tmp_path):
    a, b = project(tmp_path, 'LM', component='LM'), project(tmp_path, 'FAF-CLONE', component='FAF')
    group = ('<!--meta start {"requirement-group":"sys"}-->\n'
             '| requirement-no | description | trace-to |\n|---|---|---|\n'
             '| 1 | Requirement | R_%s_SYS_1 |\n<!--meta end {"requirement-group":"sys"}-->\n')
    indexes = []
    for p, foreign in [(a, 'FAF'), (b, 'LM')]:
        source = p['sources'][0]
        other = 'FAF-CLONE' if p is a else 'LM'
        text = '<!--meta ' + json.dumps(dict(title=p['name'] + ' unique', next=[other + '/overview'])) + '-->\n'
        (Path(source['path']) / 'overview.md').write_text(text + group % foreign, encoding='utf-8')
    cfg = config(tmp_path, [a, b])
    for p in cfg['projects']:
        idx = Index(str(tmp_path), p['sources'], index_dir=p['indexDir'])
        indexes.append(idx)
        idx.reconcile()
        assert idx.state == 'ready'
        assert {r['id'].split('/')[0] for r in idx.search('unique')} == {p['name']}
        foreign = 'FAF-CLONE' if p['name'] == 'LM' else 'LM'
        assert idx.search(foreign) == []
        coverage = idx.coverage()
        assert len(coverage['requirements']) == 1
        assert coverage['requirements'][0]['traceTo'] == []
        assert coverage['requirements'][0]['docId'] == p['name'] + '/overview'
        assert idx.canonical_id(foreign + '/overview') is None
        graph = idx.graph()
        assert len(graph['nodes']) == 1
        assert graph['nodes'][0][0] == p['name'] + '/overview'
        assert idx.resolve(p['name'] + '/overview', [foreign + '/overview']) == {foreign + '/overview': None}
    for idx in indexes: idx._conn().close()


def request_context_preserves_lm_urls_and_scopes_explicit_projects(tmp_path):
    cfg = config(tmp_path, [project(tmp_path, 'Other'), project(tmp_path, 'LM')])
    class Handler(serve.DocHandler):
        config = cfg
        indexes = {'LM': 'lm-index', 'Other': 'other-index'}
    for path in ['/docs/LM/overview.md', '/api/tests/LM', '/api/index/tree?project=LM']:
        h = object.__new__(Handler); h.path = path; h._select_project()
        assert h.index == 'lm-index' and [s['name'] for s in h.config['sources']] == ['LM']
    h = object.__new__(Handler); h.path = '/docs/LM/overview.md?project=Other'
    with unittest.TestCase().assertRaises(serve._Refused): h._select_project()
    h.path = '/site.json?project=Unknown'
    with unittest.TestCase().assertRaises(serve._Refused): h._select_project()


class ProjectTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parents[2] / '.cache')
        self.addCleanup(folder.cleanup)
        self.folder = Path(folder.name)

    def test_legacy(self): legacy_config_keeps_ids_default_and_index(self.folder)

    def test_fixture_site_identifies_legacy_urls_without_changing_project_scope(self):
        cfg = serve.load_config(str(Path(__file__).resolve().parents[1] / 'fixtures-config.json'))
        class Handler(serve.DocHandler):
            config = cfg
            indexes = {'default': 'fixture-index'}
        handler = object.__new__(Handler)
        handler.path = '/site.json'
        handler._select_project()
        handler._json = lambda status, body: replies.append((status, body))
        replies = []
        handler._site_json()
        status, site = replies[0]
        self.assertEqual(status, 200)
        self.assertTrue(site['legacy'])
        self.assertEqual(site['project'], 'default')
        self.assertEqual(site['defaultDoc'], 'Guides/getting-started')
        self.assertEqual([s['name'] for s in site['sources']], ['Guides'])
        self.assertEqual(handler.index, 'fixture-index')
    def test_duplicate_sources_and_index_locations(self): duplicate_sources_and_index_locations_refused(self.folder)
    def test_isolation(self): projects_isolate_search_requirements_coverage_map_and_resolution(self.folder)
    def test_compatible_urls(self): request_context_preserves_lm_urls_and_scopes_explicit_projects(self.folder)
    def test_valid_names(self):
        for name in ['FAF-CLONE', 'project_2', 'LM']:
            with self.subTest(name=name): names_accept_hyphens_underscores_and_digits(self.folder, name)
    def test_invalid_names(self):
        for kind, name in [('name', 'bad name'), ('name', '../bad'), ('source', 'bad!'), ('component', 'C-X'), ('component', 'C_X')]:
            with self.subTest(kind=kind, name=name): invalid_names_refused(self.folder, kind, name)

    def test_multiple_sources_resolve_only_within_their_project(self):
        a, b = project(self.folder, 'LM'), project(self.folder, 'FAF-CLONE')
        extra = project(self.folder, 'Extra_Source')['sources'][0]
        a['sources'].append(extra)
        (Path(extra['path']) / 'overview.md').write_text('# Extra page\n', encoding='utf-8')
        cfg = config(self.folder, [a, b])
        idx = Index(str(self.folder), cfg['projects'][0]['sources'], index_dir=a['indexDir'])
        try:
            idx.reconcile()
            assert idx.resolve('LM/overview', ['Extra_Source/overview']) == {'Extra_Source/overview': 'Extra_Source/overview'}
            assert idx.resolve('LM/overview', ['FAF-CLONE/overview']) == {'FAF-CLONE/overview': None}
        finally: idx._conn().close()

    def test_read_only_sources_refuse_document_result_and_run_writes(self):
        p = project(self.folder, 'LM'); p['sources'][0]['readOnly'] = True
        cfg = config(self.folder, [p])
        h = object.__new__(serve.DocHandler); h.config = cfg
        h._json = lambda status, body: (status, body)
        assert not h._can_write_source('LM')
        assert h._check_write('LM/overview', '', b'# Changed')[0] == 403
        assert h._check_delete('LM/overview', '')[0] == 403

    def test_duplicate_project_names_refused(self):
        p = project(self.folder, 'LM')
        with self.assertRaises(SystemExit): config(self.folder, [p, p])
