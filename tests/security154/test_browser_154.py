"""Coordinator-only Playwright checks. The implementing session MUST NOT run these.

Run: python -B -m pytest -o addopts= --base-url http://127.0.0.1:8799
     tests/security154/test_browser_154.py
"""
import json
from pathlib import Path
import re
import sys

import pytest
from playwright.sync_api import expect

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'unit'))
from test_security_154 import Fixture


@pytest.fixture(scope='session', autouse=True)
def static_server():
    # Override the shared corpus server; each test owns a free-port fixture.
    yield


def boot(page, fixture):
    errors = []
    failed = []
    on_error = lambda error: errors.append(str(error))
    on_failed = lambda request: failed.append((request.url, request.failure))
    page.on('pageerror', on_error)
    page.on('requestfailed', on_failed)
    try:
        page.goto(fixture.base + '/#/Open/overview')
        expect(page.locator('body')).to_have_attribute('data-app-ready','1',timeout=30000)
        expect(page.locator('#content h1').first).to_have_text('1 Overview')
    except AssertionError as error:
        raise AssertionError(f'{error}\nPage errors: {errors}; failed requests: {failed}') from error
    finally:
        page.remove_listener('pageerror', on_error)
        page.remove_listener('requestfailed', on_failed)


@pytest.mark.parametrize('read_only', [True, False])
@pytest.mark.parametrize('feed', ['missing', 'empty', 'unavailable'])
def test_source_without_results_boots(page, read_only, feed):
    fixture = Fixture(readOnly=read_only)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    try:
        assert not (fixture.docs / 'results.xml').exists()
        # The real API contract for a configured file that has never been made.
        response = page.request.get(fixture.base + '/api/results/Open')
        assert response.status == 404
        if feed == 'empty':
            page.route('**/api/results/Open', lambda route: route.fulfill(
                status=200, content_type='application/xml', body='<testsuite/>'))
        elif feed == 'unavailable':
            page.route('**/api/results/Open', lambda route: route.abort())
        boot(page, fixture)
        expect(page.locator('.tc-result')).to_have_text(['Untested', 'Untested'])
        assert errors == []
    finally:
        fixture.close()


@pytest.mark.parametrize('read_only', [True, False])
def test_optional_results_request_cannot_hold_boot_open(page, read_only):
    fixture = Fixture(readOnly=read_only)
    held = []
    # Hold the first optional request until AFTER the ready assertion. This
    # regresses awaiting the results bundle, including its sidecars, at boot.
    page.route('**/api/tests/Open', lambda route: held.append(route))
    try:
        with page.expect_request('**/api/tests/Open'):
            boot(page, fixture)
        assert held
        expect(page.locator('.tc-result')).to_have_text(['Untested', 'Untested'])
    finally:
        for route in held:
            route.fulfill(status=200, content_type='application/json', body='{}')
        page.unroute('**/api/tests/Open')
        fixture.close()


def test_read_only_UI_and_lazy_modules(page):
    fixture=Fixture(readOnly=True)
    requests=[]; violations=[]
    page.on('request',lambda request:requests.append(request.url))
    errors=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.add_init_script("document.addEventListener('securitypolicyviolation',e=>{(window.__csp154??=[]).push({directive:e.violatedDirective,blocked:e.blockedURI})})")
    try:
        boot(page, fixture)
        for identifier in ('editBtn','deleteBtn','newDocBtn','accountBtn'):
            expect(page.locator('#'+identifier)).to_be_hidden()
        expect(page.locator('.tc-run,.tc-run-all,.runner-overlay')).to_have_count(0)
        page.locator('#graphBtn').click()
        expect(page.locator('#graphOverlay')).to_be_visible()
        expect(page.get_by_role('button',name='Edit connections',exact=True)).to_have_count(0)
        page.keyboard.press('Escape')
        page.locator('#covBtn').click()
        expect(page.locator('#covOverlay')).to_be_visible()
        page.wait_for_function("() => !!(window.__graph && window.__graph.count() > 0)")
        point=page.evaluate("window.__graph.center('T_D_one')")
        assert point
        page.mouse.click(point['x'],point['y'])
        expect(page.locator('.cov-report')).to_be_visible()
        expect(page.locator('.cov-report')).to_contain_text('One')
        page.evaluate("document.dispatchEvent(new CustomEvent('webdoc:run-test',{detail:{testId:'T_D_one'}}))")
        expect(page.locator('.runner-overlay')).to_have_count(0)
        expect(page.locator('.cov-vtest-add,.cov-vtest-rm,.cov-auto-url,.cov-medit-bar')).to_have_count(0)
        assert not any(re.search(r'/(?:authoring|editor|runner|automated-runs)(?:[./-])',url) or '/RunControls-' in url for url in requests),requests
        assert page.evaluate('window.__csp154 || []') == []
        assert errors == []
        for method,path in [('PUT','/docs/Open/overview.md'),('POST','/api/runs'),('PUT','/api/tests/Open'),('POST','/api/auth/register')]:
            response=page.request.fetch(fixture.base+path,method=method,data='{}')
            assert response.status==405
    finally:
        fixture.close()


def test_private_edit_save_map_and_manual_record_controls(page):
    fixture=Fixture()
    requests = []
    page.on('request', lambda request: requests.append(request.url))
    try:
        boot(page, fixture)
        assert not any('/css/editor.css' in url or '/editor.js' in url or '/editor/' in url for url in requests), requests
        expect(page.locator('#editBtn')).to_be_visible()
        expect(page.locator('#newDocBtn')).to_be_visible()
        page.locator('#editBtn').click()
        expect(page.locator('.editor')).to_be_visible()
        assert any('/css/editor.css' in url for url in requests), requests
        field=page.locator('.editor [contenteditable="true"]').filter(has_text='Private interactive fixture.').first
        field.fill('EDIT-FLOW-154')
        page.get_by_role('button',name='Save',exact=True).click()
        # 151C retains the saved buffer; close it explicitly before reading.
        expect(page.locator('.editor .editor-status')).to_have_text('Saved')
        assert 'EDIT-FLOW-154' in (fixture.docs/'overview.md').read_text(encoding='utf-8')
        page.locator('.editor').get_by_role('button',name='Cancel',exact=True).click()
        expect(page.locator('.editor')).to_have_count(0)
        expect(page.locator('#content')).to_contain_text('EDIT-FLOW-154')
        assert 'EDIT-FLOW-154' in (fixture.docs/'overview.md').read_text(encoding='utf-8')
        expect(page.locator('#deleteBtn')).to_be_visible()
        page.locator('#graphBtn').click()
        expect(page.locator('#graphOverlay')).to_be_visible()
        expect(page.get_by_role('button',name='Edit connections',exact=True)).to_be_visible()
        page.keyboard.press('Escape')
        automated = page.locator('#test-T_D_one')
        manual = page.locator('#test-T_D_manual')
        run_now = automated.get_by_role('button', name='Run now', exact=True)
        expect(run_now).to_be_visible()
        expect(run_now).to_have_attribute('title', 'Run this test case')
        assert not any('/css/runner.css' in url for url in requests), requests
        with page.expect_response(lambda response: response.request.method == 'POST' and
                                  response.url.split('?')[0].endswith('/api/runs')) as started:
            run_now.click()
        assert started.value.status == 202
        assert started.value.request.post_data_json['ids'] == ['T_D_one']
        expect(automated).to_contain_text('Started by: page')
        expect(page.locator('.runner-overlay')).to_have_count(0)
        assert not any('/css/runner.css' in url for url in requests), requests
        record = manual.get_by_role('button', name='Record manual result', exact=True)
        expect(record).to_be_visible()
        expect(record).to_have_attribute('title', 'Run this test case')
        record.click()
        expect(page.locator('.runner-overlay')).to_be_visible()
        expect(page.locator('.runner-overlay')).to_contain_text('Manual check')
        assert any('/css/runner.css' in url for url in requests), requests
    finally:
        fixture.close()


def test_strict_CSP_styles_in_editor_and_downloaded_report(page):
    fixture=Fixture()
    try:
        page.add_init_script("document.addEventListener('securitypolicyviolation',e=>{(window.__csp154??=[]).push(e.violatedDirective)})")
        boot(page, fixture)
        page.locator('#editBtn').click()
        expect(page.locator('.editor')).to_be_visible()
        assert page.evaluate('window.__csp154 || []')==[]
        report=page.evaluate("""async () => {
          const {generateReportHtml}=await import('/js/report.js');
          return generateReportHtml({title:'Coverage',requirements:[],tests:[],detail:[],reqStatus:new Map(),testStatus:new Map()});
        }""")
        path=fixture.home/'report-154.html'; path.write_text(report,encoding='utf-8')
        page.goto(path.as_uri())
        expect(page.locator('h1')).to_have_text('Coverage')
        assert page.locator('meta[http-equiv="Content-Security-Policy"]').get_attribute('content')
        assert page.evaluate("getComputedStyle(document.querySelector('.rpt')).maxWidth")=='960px'
    finally:
        fixture.close()
