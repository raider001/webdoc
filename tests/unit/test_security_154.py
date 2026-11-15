"""Audit request replays, stdlib only, isolated sources and a free port per fixture."""
import concurrent.futures
import ctypes
import http.client
import json
import os
import socket
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

import serve
import webdoc_auth
import webdoc_index
import webdoc_parse_worker
import webdoc_access

ROOT = Path(__file__).resolve().parents[2]
CASE = '<!--meta start {"test":"one","name":"One","steps":[{"action":"Run","expected":"OK"}]}-->\n<!--meta end {"test":"one"}-->\n'
MANUAL_CASE = '<!--meta start {"test":"manual","name":"Manual check","steps":[{"action":"Inspect manually","expected":"Looks correct"}]}-->\n<!--meta end {"test":"manual"}-->\n'


class Fixture:
    """Also used by the coordinator's Playwright tests. No production config."""
    def __init__(self, **options):
        with socket.socket() as reservation:
            reservation.bind(('127.0.0.1', int(os.environ.get('WEBDOC_TEST_PORT', '0'))))
            self.port = reservation.getsockname()[1]
        self.host = '127.0.0.1:' + str(self.port)
        self.base = 'http://' + self.host
        (ROOT / '.cache').mkdir(exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix='security-154-', dir=ROOT / '.cache')
        self.home = Path(self.temp.name)
        self.docs = self.home / 'source'
        self.docs.mkdir()
        (self.docs / 'overview.md').write_text('# Overview\n\nPrivate interactive fixture.\n[Results](results.xml)\n' + CASE + MANUAL_CASE, encoding='utf-8')
        (self.docs / 'restricted-chapter-longname.md').write_text('<!--meta {"access":{"read":["staff"],"write":["staff"]}}-->\nRESTRICTED-CANARY\n', encoding='utf-8')
        (self.docs / 'hidden-folder-longname').mkdir()
        (self.docs / 'hidden-folder-longname' / 'hiddenpage.md').write_text('<!--meta {"access":{"hidden":true,"read":["staff"]}}-->\nHIDDEN-CANARY', encoding='utf-8')
        (self.docs / 'private').mkdir()
        for rel in ('private/secret-notes.md', 'private/jobs.csv', '.env', '.results.xml.run-lock', '.webdoc-tests.json'):
            (self.docs / rel).write_text('SECRET-CANARY' if not rel.endswith('.json') else '{}', encoding='utf-8')
        (self.docs / '.git').mkdir()
        (self.docs / '.git' / 'config').write_text('SECRET-CANARY', encoding='utf-8')
        self.runner = self.home / 'runner.py'
        self.runner.write_text('''import os, sys, pathlib, xml.etree.ElementTree as E
print('STDOUT-CANARY ' + os.getcwd())
suite=E.Element('testsuite')
c=E.SubElement(suite,'testcase',classname='T_D_one',name='test_one',time='.01')
E.SubElement(c,'failure',message='C:\\\\private\\\\runner.py').text='ABSOLUTE-PATH-CANARY'
E.SubElement(c,'system-out').text=os.environ.get('WEBDOC_SECRET_CANARY','NOT-INHERITED')
E.ElementTree(suite).write(sys.argv[1],encoding='utf-8')
''', encoding='utf-8')
        self.config = dict(siteTitle='Security 154', defaultDoc='Open/overview', theme='auto',
            watchIntervalSec=0, indexDir=str(self.home / 'index'),
            auth=dict(usersFile=str(self.home / 'accounts' / 'users.json')),
            sources=[dict(name='Open', path=str(self.docs), component='D', excludeDirectories=['private'],
                testResults='results.xml', runTests=dict(command=[sys.executable, '-B', str(self.runner), '{results}'],
                    cwd=str(self.home), output=str(self.home / 'output.xml'), timeoutSec=10,
                    cases=['T_D_one'], env={'DECLARED_ENV': 'allowed'}))])
        auth = options.pop('auth', {})
        bootstrap = options.pop('bootstrapAccounts', True)
        read_only_flag = options.pop('readOnlyFlag', False)
        result_file = options.pop('resultFile', None)
        if result_file:
            self.config['sources'][0]['testResults'] = result_file
        self.config['auth'].update(auth)
        self.config.update(options)
        if 'allowedHosts' in self.config:
            self.config['allowedHosts'] = [host.format(port=self.port) for host in self.config['allowedHosts']]
        self.authority = (self.config.get('allowedHosts') or [self.host])[0]
        self.origin = 'http://' + self.authority
        self.config_path = self.home / 'config.json'
        self.config_path.write_text(json.dumps(self.config), encoding='utf-8')
        if auth.get('enabled') and bootstrap:
            store = webdoc_auth.UserStore(self.config['auth']['usersFile'], 50000)
            store.create('operator', 'long-password-154', admin=True)
            store.create('reader', 'long-password-154')
        self.log = open(self.home / 'server.log', 'w', encoding='utf-8')
        env = dict(os.environ, WEBDOC_SECRET_CANARY='ENV-CANARY-154', WEBDOC_INDEX_WORKERS='1', OMP_NUM_THREADS='1')
        flags = subprocess.BELOW_NORMAL_PRIORITY_CLASS if os.name == 'nt' else 0
        command = [sys.executable, '-B', str(ROOT / 'serve.py'), '--config', str(self.config_path),
                   '--host', '127.0.0.1', '--port', str(self.port)]
        if read_only_flag:
            command.append('--read-only')
        self.process = None
        try:
            self.process = subprocess.Popen(command,
                cwd=ROOT, env=env, stdout=self.log, stderr=subprocess.STDOUT, creationflags=flags)
            for _ in range(200):
                if self.process.poll() is not None:
                    self.log.flush()
                    raise AssertionError((self.home / 'server.log').read_text(encoding='utf-8'))
                try:
                    status, raw, _ = self.request('GET', '/api/index/status')
                    if status == 200 and json.loads(raw)['state'] == 'ready':
                        break
                except OSError:
                    pass
                time.sleep(.025)
            else:
                raise AssertionError('fixture server did not become ready')
        except BaseException:
            self.close()
            raise

    def request(self, method, path, body=None, headers=None, cookies=None):
        conn = http.client.HTTPConnection('127.0.0.1', self.port, timeout=15)
        hdr = {'Host': self.authority, **(headers or {})}
        if cookies:
            hdr['Cookie'] = '; '.join(k + '=' + v for k, v in cookies.items())
            if 'wd_csrf' in cookies:
                hdr['X-WebDoc-CSRF'] = cookies['wd_csrf']
        if isinstance(body, dict):
            body = json.dumps(body).encode()
            hdr['Content-Type'] = 'application/json'
        try:
            conn.request(method, path, body=body, headers=hdr)
            response = conn.getresponse()
            raw = response.read()
            if cookies is not None:
                for key, value in response.getheaders():
                    if key.lower() == 'set-cookie':
                        name, _, token = value.split(';', 1)[0].partition('=')
                        cookies[name] = token
            return response.status, raw, dict(response.getheaders())
        finally:
            conn.close()

    def login(self, name):
        cookies = {}
        self.request('GET', '/api/auth/me', cookies=cookies)
        code, body, _ = self.request('POST', '/api/auth/login', {'username': name, 'password': 'long-password-154'},
            {'Origin': self.origin}, cookies)
        assert code == 200, (code, body)
        return cookies

    def close(self):
        if self.process is not None and self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=10)
        # Child parser inherits Windows file handles during spawn. Its pipe EOF
        # cleanup is asynchronous after the server exits.
        time.sleep(.2)
        self.log.close()
        for attempt in range(30):
            try:
                self.temp.cleanup()
                break
            except PermissionError:
                if attempt == 29: raise
                time.sleep(.05)


class SecurityReplays(unittest.TestCase):
    def fixture(self, **kwargs):
        fixture = Fixture(**kwargs)
        self.addCleanup(fixture.close)
        return fixture

    def test_F5_rebinding_is_refused_before_get_write_delete_graph_or_sidecar(self):
        f = self.fixture()
        evil = {'Host': f'rebind.attacker.example:{f.port}', 'Origin': f'http://rebind.attacker.example:{f.port}'}
        for method, path, data in [('GET','/docs/Open/overview.md',None), ('GET','/api/index/graph',None),
                ('PUT','/docs/Open/overview.md',b'OVERWRITE'), ('PUT','/docs/Open/new.md',b'NEW'),
                ('DELETE','/docs/Open/overview.md',None), ('PUT','/api/tests/Open',{})]:
            with self.subTest(method=method, path=path):
                self.assertEqual(f.request(method, path, data, evil)[0], 403)
        self.assertIn('Overview', (f.docs / 'overview.md').read_text())
        for path in ('/docs/Open/overview.md','/api/tests/Open','/api/auth/register','/api/runs'):
            self.assertEqual(f.request('PUT' if '/docs/' in path or '/tests/' in path else 'POST', path, b'{}', {'Origin':'null'})[0], 403)

    def test_configured_host_allowlist_is_exact(self):
        f=self.fixture(allowedHosts=['docs.example:{port}'])
        self.assertEqual(f.request('GET','/site.json')[0],200)
        for host in (f.host, f'docs.example:{f.port + 1}', f'docs.example.attacker:{f.port}'):
            self.assertEqual(f.request('GET','/site.json',headers={'Host':host})[0],403)

    def test_F1_existing_unindexed_file_and_short_aliases_fail_closed(self):
        f = self.fixture(auth={'enabled':True, 'publicRead':True})
        writer = f.login('reader')
        (f.docs / 'unindexed.md').write_text('UNINDEXED-CANARY')
        for method in ('GET','PUT','DELETE'):
            self.assertEqual(f.request(method, '/docs/Open/unindexed.md', b'changed' if method=='PUT' else None,
                                       {'Origin':f.origin}, writer)[0], 404)
        self.assertEqual(f.request('GET','/docs/Open/restricted-chapter-longname.md')[0],403)
        self.assertEqual(f.request('GET','/docs/Open/hidden-folder-longname/hiddenpage.md')[0],404)
        long = str(f.docs / 'restricted-chapter-longname.md')
        alias = long
        if os.name == 'nt':
            fn = ctypes.WinDLL('kernel32', use_last_error=True).GetShortPathNameW
            fn.argtypes = [ctypes.c_wchar_p, ctypes.c_wchar_p, ctypes.c_uint]
            fn.restype = ctypes.c_uint
            buf = ctypes.create_unicode_buffer(32768)
            if fn(long, buf, len(buf)):
                alias = buf.value
        if os.path.normcase(alias) != os.path.normcase(long):
            # Fixture volume has genuine 8.3 names: replay exact GET/PUT/DELETE.
            leaf = os.path.basename(alias)
            for method in ('GET','PUT','DELETE'):
                self.assertEqual(f.request(method, '/docs/Open/'+leaf, b'changed' if method=='PUT' else None,
                    {'Origin':f.origin},writer)[0],404)
        else:
            # Workspace-only rule prohibits a C: fixture. Exercise the real
            # canonicalisation decision with a simulated OS long-name answer.
            fake = str(f.docs / 'RESTRI~1.MD')
            with patch('serve.os.path.exists', return_value=True), patch('serve.long_path', side_effect=[long,str(f.docs)]):
                self.assertIsNone(serve.canonical_path(str(f.docs),fake))
            with patch('serve.os.path.exists', return_value=True), patch('serve.long_path', side_effect=[str(f.docs/'hidden-folder-longname'),str(f.docs)]):
                self.assertIsNone(serve.canonical_path(str(f.docs),str(f.docs/'HIDDEN~1')))
            print('154: fixture volume has no short alias; canonicalisation function tested directly')
        # Sidecar alias/junction resolution fails closed too.
        h=object.__new__(serve.DocHandler); h.config={'sources':[{'name':'Open','path':str(f.docs)}]}
        with patch('serve.long_path', side_effect=[str(f.home/'outside'),str(f.docs)]):
            self.assertIsNone(h._sidecar_path('Open', h.TESTS_FILE))

    def test_F2_registration_closed_by_default_and_never_bootstraps_admin(self):
        f=self.fixture(auth={'enabled':True,'publicRead':True})
        cookies={}; f.request('GET','/api/auth/me',cookies=cookies)
        self.assertEqual(f.request('POST','/api/auth/register',{'username':'attacker','password':'long-password-154'}, {'Origin':f.origin},cookies)[0],403)
        # The legacy firstUserIsAdmin knob cannot restore the vulnerability.
        config=webdoc_auth.AuthConfig({'firstUserIsAdmin':True},str(f.home))
        self.assertFalse(config.first_user_is_admin)
        fresh=webdoc_auth.UserStore(str(f.home/'fresh'/'users.json'),50000)
        record,error=fresh.create('first','long-password-154',first_only_admin=True)
        self.assertIsNone(error); self.assertFalse(record['admin'])

    def test_F2_explicit_registration_is_non_admin_and_approval_applies_to_first(self):
        f=self.fixture(bootstrapAccounts=False,auth={'enabled':True,'publicRead':True,'allowRegistration':True,'firstUserIsAdmin':True,
                            'defaultGroups':['admins','ordinary'],'requireApproval':True})
        cookies={}; f.request('GET','/api/auth/me',cookies=cookies)
        status,raw,_=f.request('POST','/api/auth/register',{'username':'visitor','password':'long-password-154'}, {'Origin':f.origin},cookies)
        self.assertEqual(status,202)
        store=webdoc_auth.UserStore(f.config['auth']['usersFile'],50000)
        visitor=store.get('visitor')
        self.assertFalse(visitor['admin']); self.assertNotIn('admins',visitor['groups']); self.assertTrue(visitor['disabled'])

    def test_F3_F6_run_rights_environment_and_reader_result_projection(self):
        f=self.fixture(auth={'enabled':True,'publicRead':True,'writeGroups':['writers']})
        reader=f.login('reader'); operator=f.login('operator')
        headers={'Origin':f.origin,'X-WebDoc-Run':'1'}
        body={'source':'Open','ids':['T_D_one']}
        self.assertEqual(f.request('POST','/api/runs',body,headers,reader)[0],403)
        code,raw,_=f.request('POST','/api/runs',body,headers,operator)
        self.assertEqual(code,202,raw); rid=json.loads(raw)['id']
        for _ in range(200):
            code,raw,_=f.request('GET','/api/runs/'+rid,cookies=operator)
            if json.loads(raw)['state']=='finished':break
            time.sleep(.02)
        else:self.fail('runner did not finish')
        self.assertIn(b'STDOUT-CANARY',raw)
        self.assertIn('NOT-INHERITED',(f.docs/'results.xml').read_text())
        self.assertNotIn('ENV-CANARY-154',(f.docs/'results.xml').read_text())
        self.assertNotIn('webdoc.outputTail',(f.docs/'results.xml').read_text())
        for path in ('/site.json','/api/runs/'+rid,'/api/runs?source=Open','/docs/Open/results.xml'):
            code,raw,_=f.request('GET',path,cookies=reader)
            self.assertEqual(code,200,(path,raw))
            for secret in (b'STDOUT-CANARY',b'ABSOLUTE-PATH-CANARY',b'ENV-CANARY-154',str(f.home).encode(),b'outputTail',b'private'):
                self.assertNotIn(secret,raw,(path,secret,raw))

    def test_F4_review_120kb_parser_under_half_second(self):
        payload='```x\n'*24000
        start=time.monotonic()
        result=webdoc_index.parse_document('Open/attack','D',payload)
        elapsed=time.monotonic()-start
        print('154: 120kB parser seconds:',round(elapsed,4))
        self.assertLess(elapsed,.5); self.assertEqual(result['headings'],[])
        # Also cover the repeated unclosed comment vector and nested metadata.
        for body in ('<!--access start {'*8000, '<!--meta start {}-->\n'*1000):
            begin=time.monotonic(); webdoc_parse_worker.bounded_parse('Open/attack','D',body)
            self.assertLess(time.monotonic()-begin,.7)
        regions=webdoc_access.parse_section_regions('<!-- ACCESS start {"read":["staff"]}-->\n'*200)
        self.assertEqual(len(regions),1)
        self.assertTrue(regions[0]['spec']['malformed'])

    def test_F4_cap_put_and_watcher_never_delay_a_concurrent_get_one_second(self):
        f=self.fixture(watchIntervalSec=1)
        payload=(('```x\n'*(serve.MAX_DOC_BODY//5)).encode()+b'xx')[:serve.MAX_DOC_BODY]
        self.assertEqual(len(payload),serve.MAX_DOC_BODY)
        def attack():return f.request('PUT','/docs/Open/attack.md',payload,{'Origin':f.origin})[0]
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as ex:
            future=ex.submit(attack)
            latencies=[]
            for _ in range(8):
                begin=time.monotonic(); self.assertEqual(f.request('GET','/docs/Open/overview.md')[0],200)
                latencies.append(time.monotonic()-begin)
            self.assertIn(future.result(),(200,201))
        (f.docs/'dropped.md').write_bytes(payload)
        for _ in range(25):
            begin=time.monotonic(); self.assertEqual(f.request('GET','/docs/Open/overview.md')[0],200)
            latencies.append(time.monotonic()-begin); time.sleep(.06)
        print('154: maximum concurrent GET seconds:',round(max(latencies),4))
        self.assertLess(max(latencies),1)
        self.assertEqual(f.request('PUT','/docs/Open/over-cap.md',b'x'*(serve.MAX_DOC_BODY+1),{'Origin':f.origin})[0],413)

    def test_F6_generic_error_no_windows_paths_and_neutral_server_header(self):
        f=self.fixture()
        code,raw,headers=f.request('PUT','/docs/Open/overview.md/x.md',b'# Attack',{'Origin':f.origin})
        self.assertEqual(code,500); self.assertEqual(json.loads(raw),{'error':'request failed'})
        self.assertNotIn(b'WinError',raw); self.assertNotIn(str(f.home).encode(),raw)
        self.assertEqual(headers['Server'],'Kalynx')

    def test_F8_F9_excluded_and_dot_components_are_never_read_written_or_listed(self):
        f=self.fixture()
        for path in ('private/secret-notes.md','.env','.git/config','.webdoc-tests.json','.results.xml.run-lock'):
            self.assertEqual(f.request('GET','/docs/Open/'+path)[0],404,path)
        for path in ('private/secret-notes.md','.hidden/new.md','private/new.md'):
            for method in ('PUT','DELETE'):
                self.assertEqual(f.request(method,'/docs/Open/'+path,b'CHANGED' if method=='PUT' else None,{'Origin':f.origin})[0],404)
        self.assertEqual(f.request('GET','/api/data/file?src=Open/private/jobs.csv')[0],404)
        code,raw,_=f.request('GET','/docs/Open/')
        self.assertEqual(code,200)
        names=[x['name'] for x in json.loads(raw)['entries']]
        self.assertNotIn('private',names); self.assertFalse(any(x.startswith('.') for x in names))

    def test_F7_every_non_read_method_is_405_before_any_handler(self):
        f=self.fixture(readOnly=True,auth={'enabled':True,'allowRegistration':True})
        code,raw,_=f.request('GET','/site.json')
        self.assertTrue(json.loads(raw)['readOnly']); self.assertFalse(json.loads(raw)['auth']['allowRegistration'])
        for method in ('PUT','POST','DELETE','PATCH','OPTIONS','TRACE','CONNECT','UNRECOGNIZED'):
            for path in ('/docs/Open/overview.md','/api/runs','/api/tests/Open','/api/auto/Open','/api/auth/register','/api/auth/users/create'):
                with self.subTest(method=method,path=path):
                    code,_,headers=f.request(method,path,b'{}',{'Origin':f.origin})
                    self.assertEqual(code,405); self.assertEqual(headers['Allow'],'GET, HEAD')
        self.assertEqual(f.request('HEAD','/site.json')[:2],(200,b''))
        # A fresh interpreter verifies absence rather than reusing imported test modules.
        script='import sys,serve; h=serve.handler_class(True); assert "webdoc_runs" not in sys.modules; assert "webdoc_mutations" not in sys.modules; assert not hasattr(h,"_put"); assert not hasattr(h,"_auth_register")'
        subprocess.run([sys.executable,'-B','-c',script],cwd=ROOT,check=True)

    def test_browser_headers_CSP_override_and_https_only_HSTS(self):
        f=self.fixture()
        _,_,headers=f.request('GET','/')
        csp=headers['Content-Security-Policy']
        self.assertNotIn("'unsafe-inline'",csp)
        self.assertEqual(headers['Cross-Origin-Opener-Policy'],'same-origin')
        self.assertEqual(headers['Cross-Origin-Resource-Policy'],'same-origin')
        self.assertIn('camera=()',headers['Permissions-Policy'])
        self.assertNotIn('Strict-Transport-Security',headers)
        config=webdoc_auth.AuthConfig({'contentSecurityPolicy':"upgrade-insecure-requests"},str(f.home))
        csp=serve.build_csp(config)
        for directive in ("object-src 'none'","base-uri 'none'","frame-ancestors 'none'","script-src 'self'",'sha256-','upgrade-insecure-requests'):
            self.assertIn(directive,csp)
        for override in ("script-src * 'unsafe-inline'","style-src-elem *","object-src *"):
            config.content_security_policy=override
            with self.assertRaises(ValueError):serve.build_csp(config)
        f.close(); self._cleanups.pop()
        secure=self.fixture(servedOverHttps=True)
        self.assertEqual(secure.request('GET','/')[2]['Strict-Transport-Security'],'max-age=31536000')

    def test_private_interactive_edit_create_delete_sidecars_and_run_work(self):
        f=self.fixture()
        for method,path,body,expected in [('PUT','/docs/Open/new.md',b'# New',201),('PUT','/docs/Open/new.md',b'# Edited',200),
                ('PUT','/api/tests/Open',{'T_D_one':{'pass':True}},200),('PUT','/api/auto/Open',{},200),('DELETE','/docs/Open/new.md',None,200)]:
            self.assertEqual(f.request(method,path,body,{'Origin':f.origin})[0],expected)
        self.assertEqual(f.request('GET','/api/index/graph')[0],200)
        self.assertEqual(f.request('POST','/api/runs',{'source':'Open','ids':['T_D_one']},{'Origin':f.origin,'X-WebDoc-Run':'1'})[0],202)

    def test_configured_dot_results_keep_private_coverage_working_through_API(self):
        f=self.fixture(resultFile='.results.xml')
        report=b'<testsuite><testcase classname="T_D_one" name="test_one"/></testsuite>'
        (f.docs/'.results.xml').write_bytes(report)
        self.assertEqual(f.request('GET','/docs/Open/.results.xml')[0],404)
        self.assertEqual(f.request('GET','/api/results/Open')[:2],(200,report))
        self.assertEqual(json.loads(f.request('GET','/site.json')[1])['sources'][0]['testResults'],'/api/results/Open')

    def test_read_only_cli_flag_and_configured_body_cap(self):
        f=self.fixture(readOnlyFlag=True)
        self.assertTrue(json.loads(f.request('GET','/site.json')[1])['readOnly'])
        self.assertEqual(f.request('POST','/api/runs',{}, {'Origin':f.origin})[0],405)
        f.close(); self._cleanups.pop()
        f=self.fixture(maxDocBodyBytes=1024)
        self.assertEqual(f.request('PUT','/docs/Open/cap.md',b'x'*1025,{'Origin':f.origin})[0],413)
        self.assertEqual(f.request('PUT','/docs/Open/cap.md',b'x'*1024,{'Origin':f.origin})[0],201)

    def test_first_administrator_is_created_only_by_explicit_offline_command(self):
        f=self.fixture(bootstrapAccounts=False,auth={'enabled':True})
        # Windows getpass uses the console even with redirected stdin. Supply a
        # prompt adapter in the subprocess while exercising the actual CLI main.
        entry="import sys,getpass,bootstrap_admin; getpass.getpass=lambda prompt:sys.stdin.readline().rstrip(chr(10)); bootstrap_admin.main()"
        result=subprocess.run([sys.executable,'-B','-c',entry,'--config',str(f.config_path),'--username','firstadmin'],
            cwd=ROOT,input='long-password-154\nlong-password-154\n',capture_output=True,text=True,timeout=15)
        self.assertEqual(result.returncode,0,result.stderr)
        store=webdoc_auth.UserStore(f.config['auth']['usersFile'],50000)
        self.assertTrue(store.get('firstadmin')['admin'])
        self.assertEqual(json.loads(f.request('GET','/api/auth/me')[1])['needsBootstrap'],False)


if __name__=='__main__':
    unittest.main()
