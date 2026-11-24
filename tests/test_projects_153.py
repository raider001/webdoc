"""Brief 153 browser gate; coordinator only. Runs with the full browser suite.

The module owns its temporary corpus, config, index and free-port server.
It leaves conftest's session server and the --base-url option unchanged.
No production or existing fixture documents are changed. Screenshots are actual
patched-build captures, not claimed to be before/after comparisons.
"""
import json
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request

import pytest
from playwright.sync_api import expect

pytestmark = pytest.mark.e2e
ROOT = Path(__file__).resolve().parents[1]
SCREENSHOTS = ROOT / '.cache' / 'screens-153'


@pytest.fixture(scope='session')
def projects_base_url():
    """Own a separate server; retain its workspace-local config/log for diagnosis."""
    assert (ROOT / 'app/js/main.js').is_file(), 'Build before running the browser gate'
    # Brief 153B explicitly gives this coordinator fixture its own free port.
    # Never take the session server's port or reuse an existing process.
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 0))
        port = probe.getsockname()[1]
    assert port not in {8790, 8793, 8794, 8795, 8796, 8797, 8798}
    base_url = f'http://127.0.0.1:{port}'
    cache = ROOT / '.cache'
    cache.mkdir(exist_ok=True)
    folder = Path(tempfile.mkdtemp(prefix='projects-153B-', dir=cache))
    projects = []
    for name, title, source, default, pages in [
        ('alpha', 'Alpha handbook', 'A', 'home', ['home', 'details']),
        ('beta', 'Beta notes', 'B', 'welcome', ['welcome']),
    ]:
        docs = folder / name
        docs.mkdir()
        for page_name in pages:
            (docs / (page_name + '.md')).write_text(
                '<!--meta ' + json.dumps({'title': title + ' ' + page_name}) + '-->\n'
                '# ' + title + ' ' + page_name + '\n\nOriginal paragraph.\n', encoding='utf-8')
        project = dict(name=name, title=title, defaultDoc=source + '/' + default,
                       indexDir=str(folder / ('index-' + name)),
                       sources=[dict(name=source, path=str(docs), component=source)])
        if name == 'alpha':
            project['description'] = 'Setup and operation of Alpha.'
        projects.append(project)
    config = folder / 'config.json'
    config.write_text(json.dumps(dict(siteTitle='Kalynx', projects=projects, watchIntervalSec=0)), encoding='utf-8')
    with (folder / 'server.log').open('w', encoding='utf-8') as log:
        proc = subprocess.Popen([sys.executable, '-B', str(ROOT / 'serve.py'), '--config', str(config),
                                 '--host', '127.0.0.1', '--port', str(port)], cwd=ROOT,
                                stdout=log, stderr=subprocess.STDOUT)
        try:
            deadline = time.monotonic() + 30
            while time.monotonic() < deadline:
                if proc.poll() is not None:
                    raise RuntimeError((folder / 'server.log').read_text(encoding='utf-8'))
                try:
                    statuses = []
                    for name in ['alpha', 'beta']:
                        with urllib.request.urlopen(base_url + '/api/index/status?project=' + name, timeout=1) as response:
                            statuses.append(json.load(response)['state'])
                    if statuses == ['ready', 'ready']:
                        break
                except OSError:
                    pass
                time.sleep(0.1)
            else:
                raise RuntimeError('Brief 153 fixture indexes did not become ready')
            yield base_url
        finally:
            proc.terminate()  # Only this fixture's own process.
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait(timeout=5)


@pytest.fixture(scope='session')
def browser_context_args(browser_context_args, projects_base_url):
    """Only this module's browser contexts use the two-project server."""
    return {**browser_context_args, 'base_url': projects_base_url}


def ready(page, url='/'):
    page.goto(url, wait_until='domcontentloaded')
    expect(page.locator('body')).to_have_attribute('data-app-ready', '1')


def test_start_cards_open_defaults_and_history(page, projects_base_url):
    ready(page)
    expect(page).to_have_title('Kalynx')
    expect(page.locator('#content h1')).to_have_text('Kalynx')
    expect(page.locator('.project-card')).to_have_count(2)
    alpha, beta = page.locator('.project-card').nth(0), page.locator('.project-card').nth(1)
    expect(alpha.locator('h2')).to_have_text('Alpha handbook')
    expect(alpha.locator('.project-name')).to_have_text('alpha')
    expect(alpha.locator('.project-description')).to_have_text('Setup and operation of Alpha.')
    expect(alpha.locator('.project-page-count')).to_have_text('2 pages')
    expect(beta.locator('.project-description')).to_have_count(0)
    expect(beta.locator('.project-page-count')).to_have_text('1 page')
    expect(page.locator('#projectSelect')).to_have_count(0)
    expect(page.locator('#editBtn')).to_be_hidden()
    beta.click()
    expect(page).to_have_url(projects_base_url + '/?project=beta#/B/welcome')
    expect(page.locator('#brand')).to_have_text('Beta notes')
    expect(page.locator('#content h1')).to_contain_text('Beta notes welcome')
    page.go_back()
    expect(page.locator('#content h1')).to_have_text('Kalynx')
    page.go_forward()
    expect(page.locator('#brand')).to_have_text('Beta notes')


def test_mouse_menu_outside_and_switching(page, projects_base_url):
    ready(page, '/?project=alpha#/A/details')
    button, menu = page.locator('#brand'), page.get_by_role('menu', name='Projects', exact=True)
    button.click()
    expect(menu).to_be_visible()
    expect(menu.locator('[aria-current=true]')).to_contain_text('Alpha handbook')
    button.click()
    expect(menu).to_be_hidden()
    button.click()
    page.locator('#content h1').click()
    expect(menu).to_be_hidden()
    expect(button).not_to_be_focused()
    # A focusable outside target must keep the focus the user gave it.
    button.click()
    search = page.locator('#docSearch')
    search.click()
    expect(menu).to_be_hidden()
    expect(search).to_be_focused()
    button.click()
    menu.get_by_role('menuitem', name='Beta notes', exact=True).click()
    expect(page).to_have_url(projects_base_url + '/?project=beta#/B/welcome')
    expect(page.locator('#brand')).to_have_text('Beta notes')


def test_keyboard_menu_and_all_projects(page, projects_base_url):
    ready(page, '/?project=alpha#/A/details')
    button, menu = page.locator('#brand'), page.locator('#projectMenu')
    button.focus()
    for key in ['Enter', 'Space', 'ArrowDown']:
        button.press(key)
        expect(menu).to_be_visible()
        expect(menu.get_by_role('menuitem').nth(0)).to_be_focused()
        page.keyboard.press('ArrowUp')
        expect(menu.get_by_role('menuitem', name='All projects', exact=True)).to_be_focused()
        page.keyboard.press('ArrowDown')
        page.keyboard.press('End')
        expect(menu.get_by_role('menuitem').last).to_be_focused()
        page.keyboard.press('Home')
        expect(menu.get_by_role('menuitem').first).to_be_focused()
        page.keyboard.press('Escape')
        expect(menu).to_be_hidden()
        expect(button).to_be_focused()
    button.press('ArrowUp')
    expect(menu.get_by_role('menuitem').last).to_be_focused()
    page.keyboard.press('Enter')
    expect(page).to_have_url(projects_base_url + '/')
    expect(page).to_have_title('Kalynx')
    expect(page.locator('.project-card')).to_have_count(2)
    page.locator('#brand').click()
    expect(page.locator('#projectMenu [aria-current=true]')).to_contain_text('All projects')


@pytest.mark.parametrize('bookmark', ['/?project=beta#/B/welcome', '/#/B/welcome'])
def test_bookmarks_resolve_the_owning_project(page, bookmark, projects_base_url):
    ready(page, bookmark)
    expect(page.locator('#brand')).to_have_text('Beta notes')
    expect(page.locator('#content h1')).to_contain_text('Beta notes welcome')
    expect(page).to_have_url(projects_base_url + '/?project=beta#/B/welcome')


@pytest.mark.parametrize('target', ['Beta notes', 'All projects'])
def test_edit_discard_guard_cancel_and_confirm(page, target, projects_base_url):
    ready(page, '/?project=alpha#/A/home')
    page.locator('#editBtn').click()
    editor = page.locator('.editor')
    expect(editor).to_be_visible()
    field = editor.locator('.blk-paragraph [contenteditable]').first
    field.fill('Unsaved draft')
    native_dialogs = []
    page.on('dialog', lambda dialog: (native_dialogs.append(dialog.type), dialog.dismiss()))
    page.locator('#brand').click()
    page.locator('#projectMenu').get_by_role('menuitem', name=target, exact=True).click()
    dialog = page.get_by_role('dialog', name='Discard unsaved changes?')
    expect(dialog).to_be_visible()
    expect(dialog.get_by_role('button', name='Cancel', exact=True)).to_be_focused()
    page.keyboard.press('Enter')
    expect(dialog).to_be_hidden()
    expect(editor).to_be_visible()
    expect(field).to_have_text('Unsaved draft')
    expect(page).to_have_url(projects_base_url + '/?project=alpha#/A/home')
    expect(page.locator('#brand')).to_be_focused()
    page.locator('#brand').click()
    page.locator('#projectMenu').get_by_role('menuitem', name=target, exact=True).click()
    dialog.get_by_role('button', name='Discard', exact=True).click()
    expect(page.locator('.editor')).to_have_count(0)
    if target == 'All projects':
        expect(page.locator('.project-card')).to_have_count(2)
        expect(page).to_have_title('Kalynx')
    else:
        expect(page.locator('#brand')).to_have_text('Beta notes')
        expect(page.locator('#content h1')).to_contain_text('Beta notes welcome')
    assert native_dialogs == [], 'Project navigation should use the shared discard dialog only'


@pytest.mark.parametrize('width', [1280, 1024, 400])
@pytest.mark.parametrize('theme', ['light', 'dark'])
def test_screenshots_start_header_and_menu(page, width, theme):
    page.set_viewport_size(dict(width=width, height=900))
    page.add_init_script('localStorage.setItem("wd-theme", ' + json.dumps(theme) + ')')
    ready(page)
    expect(page.locator('html')).to_have_attribute('data-theme', theme)
    expect(page.locator('.project-page-count').first).to_have_text('2 pages')
    expect(page.locator('.project-page-count').last).to_have_text('1 page')
    SCREENSHOTS.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(SCREENSHOTS / f'start-{width}-{theme}.png'), full_page=True)
    page.locator('.project-card').first.click()
    expect(page.locator('#brand')).to_have_text('Alpha handbook')
    expect(page.locator('#content h1')).to_be_visible()
    page.locator('.app-header').screenshot(path=str(SCREENSHOTS / f'header-{width}-{theme}.png'))
    page.locator('#brand').click()
    menu = page.locator('#projectMenu')
    expect(menu).to_be_visible()
    box = menu.bounding_box()
    assert box and box['x'] >= 0 and box['x'] + box['width'] <= width
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    page.screenshot(path=str(SCREENSHOTS / f'menu-{width}-{theme}.png'), full_page=True)
