"""Brief 151 browser gate. Coordinator only; fixtures are created and removed via the test server.

Use --base-url http://127.0.0.1:8797. No production documents are edited.
The screenshot test records the opened buffer (before) and an edited buffer
(after) at each size/theme. WEBDOC_SCREEN_PHASE=baseline records an additional
baseline set when the coordinator runs this test against the unpatched build.
"""
import json
import os
from pathlib import Path
import re
import time
import uuid

import pytest
from playwright.sync_api import expect

pytestmark = pytest.mark.e2e
ROOT = Path(__file__).resolve().parents[1]
BODY = """# Editor example

AlphaBeta

## Short heading

Second paragraph

> Quote text

- First item
- Second item

| Left | Right |
| :--- | ---: |
| first | one |
| second | two |

![Preview](/assets/how-to/editor.png)

<!--meta start {"requirement-group":"edit151"}-->
| requirement-no | description | trace-to |
|---|---|---|
| 1 | A long description that needs several lines in a narrow editor to be readable without moving a caret through a one-line input. | |
<!--meta end {"requirement-group":"edit151"}-->

<!--meta start {"test":"edit151","name":"A long test name that must remain readable even in a narrow editing pane","verifies":[],"steps":[{"action":"Open the editor","expected":"All fields are readable"}]}-->
<!--meta end {"test":"edit151"}-->
"""


@pytest.fixture
def editor_doc(page, base_url, playwright):
    # This gate needs a server on 8797 whose corpus has a writable Guides source,
    # which the suite's own fixture server (8017) does not. Skip rather than error,
    # so a default run - and the release workflow - is not failed by it.
    if base_url.rstrip('/') != 'http://127.0.0.1:8797':
        pytest.skip('Brief 151 runs only with --base-url http://127.0.0.1:8797')
    name = 'editor-151-' + uuid.uuid4().hex
    doc_id = 'Guides/' + name
    url = '/docs/Guides/' + name + '.md'
    source = '<!--meta\n' + json.dumps(dict(title='Editor example', description='', assumes=[], next=[])) + '\n-->\n\n' + BODY
    # This context survives a closed/crashed page and has no page route mocks.
    api = playwright.request.new_context(base_url=base_url)
    try:
        response = api.put(url, data=source)
        assert response.ok, response.text()
        page.goto('/#/' + doc_id, wait_until='domcontentloaded')
        expect(page.locator('body')).to_have_attribute('data-app-ready', '1')
        yield dict(id=doc_id, url=url, source=source)
    finally:
        try:
            response = api.delete(url)
            assert response.ok or response.status == 404, response.text()
        finally:
            api.dispose()


def edit(page):
    page.locator('#editBtn').click()
    expect(page.locator('.editor')).to_be_visible()
    expect(page.locator('.editor .blk')).not_to_have_count(0)


def at(field, offset):
    field.evaluate("""(el, offset) => { el.focus(); const r=document.createRange();
      r.setStart(el.firstChild || el, offset); r.collapse(true);
      const s=getSelection(); s.removeAllRanges(); s.addRange(r); }""", offset)


def actions(page, block, name):
    block.locator(':scope > .blk-gutter > button').click()
    page.get_by_role('menuitem', name=name, exact=True).click()


def save(page):
    page.locator('.editor-bar').get_by_role('button', name='Save', exact=True).click()
    expect(page.locator('.editor-status')).to_have_text('Saved')


def eventually(page, script, arg=None, timeout=5000):
    """Poll in Python: wait_for_function compiles strings with CSP-blocked eval."""
    deadline = time.monotonic() + timeout / 1000
    while True:
        result = page.evaluate(script, arg)
        if result:
            return
        assert time.monotonic() < deadline, 'Timed out polling: ' + script
        page.wait_for_timeout(50)


def test_enter_shift_enter_table_and_serialized_content(page, editor_doc):
    edit(page)
    text = page.locator('.blk-paragraph [contenteditable]').first
    at(text, 5)
    text.press('Enter')
    paragraphs = page.locator('.blk-paragraph [contenteditable]')
    expect(paragraphs.nth(0)).to_have_text('Alpha')
    expect(paragraphs.nth(1)).to_have_text('Beta')
    expect(paragraphs.nth(1)).to_be_focused()
    at(paragraphs.nth(1), 4)
    paragraphs.nth(1).press('Shift+Enter')
    page.keyboard.insert_text('Line')
    cell = page.locator('.blk-edit-tablecell').first
    at(cell, 2)
    count = page.locator('.blk').count()
    cell.press('Enter')
    assert page.locator('.blk').count() == count
    expect(cell).to_have_text('Left')
    save(page)
    stored = page.request.get(editor_doc['url']).text()
    # The serializer uses TWO SPACES followed by LF for Markdown hard breaks.
    assert 'Alpha\n\nBeta  \nLine\n\n' in stored, repr(stored)
    assert 'AlphaBeta' not in stored and 'LineBeta' not in stored
    page.locator('.editor-bar').get_by_role('button', name='Cancel', exact=True).click()
    edit(page)
    assert page.locator('.blk-paragraph [contenteditable]').count() >= 3
    expect(page.locator('.blk-paragraph [contenteditable]').nth(1)).to_have_text('Beta\nLine', use_inner_text=True)
    expect(page.locator('.blk-paragraph [contenteditable]').nth(1).locator('br')).to_have_count(1)


def test_danger_cancel_enter_and_focus_restore(page, editor_doc):
    page.locator('#deleteBtn').click()
    dialog = page.get_by_role('dialog')
    expect(dialog.get_by_role('button', name='Cancel', exact=True)).to_be_focused()
    page.keyboard.press('Enter')
    expect(dialog).not_to_be_visible()
    expect(page.locator('#deleteBtn')).to_be_focused()
    assert page.request.get(editor_doc['url']).ok


def test_dirty_cancel_new_navigation_and_unload(page, editor_doc):
    edit(page)
    text = page.locator('.blk-paragraph [contenteditable]').first
    text.fill('Unsaved buffer')
    for control in ['newDocBtn', 'graphBtn', 'covBtn', 'docSearch', 'splitBtn']:
        expect(page.locator('#' + control)).to_be_disabled()
    page.locator('.editor-bar').get_by_role('button', name='Cancel', exact=True).click()
    page.get_by_role('dialog').get_by_role('button', name='Cancel', exact=True).press('Enter')
    expect(text).to_have_text('Unsaved buffer')
    page.evaluate("location.hash='#/Guides/getting-started'")
    expect(page.get_by_role('dialog')).to_be_visible()
    expect(page).to_have_url(re.compile(re.escape(editor_doc['id']) + '$'))
    page.get_by_role('dialog').get_by_role('button', name='Cancel', exact=True).click()
    expect(text).to_have_text('Unsaved buffer')
    # Native beforeunload requires sticky user activation. Handle the dialog
    # before triggering navigation, since evaluate can wait for it to close.
    text.click()
    prompts = []
    def dismiss(dialog):
        prompts.append(dialog.type)
        dialog.dismiss()
    page.on('dialog', dismiss)
    try:
        with page.expect_event('dialog', timeout=5000):
            page.evaluate('() => { location.reload(); }')
        expect(text).to_have_text('Unsaved buffer')
        with page.expect_event('dialog', timeout=5000):
            page.close(run_before_unload=True)
        assert prompts == ['beforeunload', 'beforeunload']
        assert not page.is_closed()
        expect(text).to_have_text('Unsaved buffer')
    finally:
        page.remove_listener('dialog', dismiss)
    page.evaluate("location.hash='#/Guides/getting-started'")
    page.get_by_role('dialog').get_by_role('button', name='Discard', exact=True).click()
    expect(page.locator('.editor')).to_have_count(0)
    expect(page).to_have_url(re.compile('Guides/getting-started$'))
    expect(page.locator('#content h1')).to_be_visible()


def test_new_document_enter_focus_trap_and_dirty_guard(page, editor_doc):
    page.locator('#newDocBtn').click()
    dialog = page.get_by_role('dialog')
    path = dialog.get_by_label('Path (folders you choose)')
    expect(path).to_be_focused()
    new_name = 'editor-151-new-' + uuid.uuid4().hex
    path.fill(new_name)
    path.press('Enter')
    expect(page.locator('.editor')).to_be_visible()
    expect(page.locator('.editor-status')).to_have_text('Unsaved changes')
    page.locator('.editor-bar').get_by_role('button', name='Cancel', exact=True).click()
    dialog = page.get_by_role('dialog')
    expect(dialog.get_by_role('button', name='Cancel', exact=True)).to_be_focused()
    dialog.get_by_role('button', name='Cancel', exact=True).press('Shift+Tab')
    expect(dialog.get_by_role('button', name='Discard', exact=True)).to_be_focused()
    dialog.get_by_role('button', name='Discard', exact=True).press('Tab')
    expect(dialog.get_by_role('button', name='Cancel', exact=True)).to_be_focused()
    dialog.get_by_role('button', name='Discard', exact=True).click()
    expect(page.locator('.editor')).to_have_count(0)
    assert page.request.get('/docs/Guides/' + new_name + '.md').status == 404


def test_handles_target_their_block_type_change_delete_undo_and_keyboard(page, editor_doc):
    edit(page)
    heading = page.locator('.blk.blk-heading').nth(1)
    actions(page, heading, 'Delete block')
    expect(page.locator('.blk.blk-heading')).to_have_count(1)
    expect(page.locator('.blk-paragraph').nth(1)).to_contain_text('Second paragraph')
    page.locator('.editor-undo-toast').get_by_role('button', name='Undo').click()
    expect(page.locator('.blk.blk-heading')).to_have_count(2)
    block = page.locator('.blk-paragraph').first
    actions(page, block, 'Change block type')
    page.get_by_role('menuitem', name='quote', exact=True).click()
    expect(page.locator('.blk-quote').first).to_contain_text('AlphaBeta')
    field = page.locator('.blk-quote [contenteditable]').first
    field.press('Alt+ArrowDown')
    expect(field).to_be_focused()
    field.press('Escape')
    expect(page.locator('.blk-quote .blk-handle').first).to_be_focused()
    page.keyboard.press('Enter')
    page.keyboard.press('End')
    expect(page.get_by_role('menuitem', name='Delete block')).to_be_focused()
    page.keyboard.press('Escape')
    expect(page.get_by_role('menu')).to_have_count(0)


@pytest.mark.parametrize('width', [1280, 400])
def test_pointer_reorder_mouse_and_touch_path(page, editor_doc, width):
    page.set_viewport_size(dict(width=width, height=900))
    edit(page)
    handle = page.locator('.blk-paragraph .blk-handle').first
    target = page.locator('.blk.blk-heading').nth(1)
    # Entry restores the reader's heading, which can leave this earlier
    # paragraph above the canvas. Raw mouse/CDP coordinates do not auto-scroll.
    handle.scroll_into_view_if_needed()
    target.scroll_into_view_if_needed()
    start, end = handle.bounding_box(), target.bounding_box()
    assert handle.evaluate('''el => { const r=el.getBoundingClientRect();
      return document.elementFromPoint(r.x+r.width/2, r.y+12) === el; }''')
    # PointerEvent path is identical for touch; CDP sends actual touch input in a second pass.
    page.mouse.move(start['x'] + start['width']/2, start['y'] + 12)
    page.mouse.down()
    # Prove the gesture began on the handle before checking its drop zone.
    page.mouse.move(end['x'] + 20, end['y'] + end['height'] - 1, steps=12)
    expect(handle.locator('xpath=../..')).to_have_class(re.compile(r'\bis-dragging\b'))
    expect(target).to_have_class(re.compile(r'\bdrop-after\b'))
    page.mouse.up()
    blocks = page.locator('.editor-blocks > .blk')
    expect(blocks.nth(1)).to_contain_text('Short heading')
    expect(blocks.nth(2)).to_contain_text('AlphaBeta')
    # Chromium's real touch path, including pointer capture and touch-action:none.
    handle = page.locator('.blk-paragraph .blk-handle').first
    target = blocks.nth(3)
    handle.scroll_into_view_if_needed()
    target.scroll_into_view_if_needed()
    start, end = handle.bounding_box(), target.bounding_box()
    assert handle.evaluate('''el => { const r=el.getBoundingClientRect();
      return document.elementFromPoint(r.x+12, r.y+12) === el; }''')
    session = page.context.new_cdp_session(page)
    session.send('Input.dispatchTouchEvent', dict(type='touchStart', touchPoints=[dict(x=start['x']+12, y=start['y']+12)]))
    session.send('Input.dispatchTouchEvent', dict(type='touchMove', touchPoints=[dict(x=end['x']+20, y=end['y']+end['height']-1)]))
    expect(handle.locator('xpath=../..')).to_have_class(re.compile(r'\bis-dragging\b'))
    expect(target).to_have_class(re.compile(r'\bdrop-after\b'))
    session.send('Input.dispatchTouchEvent', dict(type='touchEnd', touchPoints=[]))
    session.detach()
    expect(blocks.nth(3)).to_contain_text('AlphaBeta')
    save(page)
    stored = page.request.get(editor_doc['url']).text()
    assert stored.index('Short heading') < stored.index('Second paragraph') < stored.index('AlphaBeta')


def test_table_axes_autogrow_preview_metadata_search_and_shortcut(page, editor_doc):
    edit(page)
    table = page.locator('.blk-tablebox')
    table.get_by_role('button', name='Insert row before 2', exact=True).click()
    expect(table.locator('tbody tr')).to_have_count(3)
    table.get_by_role('button', name='Delete row 1', exact=True).click()
    expect(table.locator('tbody tr')).to_have_count(2)
    table.get_by_role('button', name='Insert column after 1', exact=True).click()
    expect(table.locator('thead th')).to_have_count(3)
    table.get_by_role('button', name='Delete column 2', exact=True).click()
    expect(table.locator('thead th')).to_have_count(2)
    expect(page.locator('.blk-img-preview')).to_be_visible()
    expect(page.get_by_label('Image URL', exact=True)).to_have_value('/assets/how-to/editor.png')
    expect(page.locator('.blk-img-preview')).to_have_attribute('alt', 'Preview')
    for name in ['Requirement description 1', 'Test name']:
        field = page.get_by_role('textbox', name=name, exact=True)
        assert field.evaluate('(e) => e.clientHeight >= e.scrollHeight - 2')
    page.locator('.editor-bar').get_by_role('button', name='Metadata', exact=True).click()
    title = page.locator('.editor-meta').get_by_label('Title', exact=True)
    title.fill('Different title')
    expect(page.locator('.editor-title-warning')).to_be_visible()
    search = page.get_by_role('combobox', name='Search Assumed knowledge')
    search.fill('getting-started')
    search.press('ArrowDown')
    search.press('Enter')
    expect(page.locator('.meta-chip')).to_contain_text('Guides/getting-started')
    title.press('Control+s')
    expect(page.locator('.editor-status')).to_have_text('Saved')
    expect(page.locator('.editor')).to_be_visible()


def test_editor_controls_share_sizes_fonts_and_alignment(page, editor_doc):
    edit(page)
    row = page.locator('.blk.blk-heading').first
    select, heading = row.locator('select').bounding_box(), row.locator('[contenteditable]').bounding_box()
    assert abs((select['y'] + select['height']/2) - (heading['y'] + heading['height']/2)) < 1
    key = page.get_by_label('Test key', exact=True)
    name = page.get_by_role('textbox', name='Test name', exact=True)
    assert abs(key.bounding_box()['x'] - name.bounding_box()['x']) < 1
    assert key.evaluate('(el)=>getComputedStyle(el).fontFamily') == name.evaluate('(el)=>getComputedStyle(el).fontFamily')
    req = page.locator('.blk-requirement .req-row:not(.req-head)').first
    number, trace, remove = req.locator('input.req-f').bounding_box(), req.locator('.req-trace').bounding_box(), req.get_by_role('button').bounding_box()
    assert round(number['height']) == round(trace['height']) == round(remove['height']) == 28
    assert abs(number['y'] - trace['y']) < 1 and abs(number['y'] - remove['y']) < 1
    for label in ['Row', 'Column', 'Requirement', 'Step']:
        button = page.get_by_role('button', name=label, exact=True)
        layout = button.evaluate('''el => {
          const s=getComputedStyle(el), parent=getComputedStyle(el.parentElement);
          const icon=el.querySelector('svg').getBoundingClientRect();
          const text=[...el.childNodes].find(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
          const r=document.createRange(); r.selectNodeContents(text);
          const label=r.getBoundingClientRect();
          return {display:s.display, parent:parent.display, align:s.alignItems,
            justify:s.justifyContent, gap:parseFloat(s.columnGap), nowrap:s.whiteSpace,
            height:el.getBoundingClientRect().height, lines:r.getClientRects().length,
            centreDelta:Math.abs(icon.y+icon.height/2-label.y-label.height/2),
            separation:label.x-icon.right}; }''')
        # CSS blockifies inline-flex children of flex/grid containers; the
        # inner flex layout and its icon/text alignment are what matter.
        expected = 'flex' if layout['parent'] in ('flex', 'inline-flex', 'grid', 'inline-grid') else 'inline-flex'
        assert layout['display'] == expected, (label, layout)
        assert layout['align'] == layout['justify'] == 'center', (label, layout)
        assert layout['nowrap'] == 'nowrap' and layout['gap'] == 4, (label, layout)
        assert round(layout['height']) == 28 and layout['lines'] == 1, (label, layout)
        assert layout['centreDelta'] < 2 and layout['separation'] >= 4, (label, layout)


def test_shared_link_image_dialog_selection_and_form_submit(page, editor_doc):
    edit(page)
    text = page.locator('.blk-paragraph [contenteditable]').first
    at(text, 5)
    text.press('Control+k')
    dialog = page.get_by_role('dialog', name='Edit link')
    dialog.get_by_label('Text', exact=True).fill('Guide')
    dialog.get_by_label('URL', exact=True).fill('Guides/getting-started')
    dialog.get_by_label('URL', exact=True).press('Enter')
    expect(text.locator('a')).to_have_text('Guide')
    expect(text).to_be_focused()
    text.press('Control+Shift+g')
    dialog = page.get_by_role('dialog', name='Insert image')
    dialog.get_by_label('Image URL', exact=True).fill('/assets/how-to/editor.png')
    dialog.get_by_label('Alt text', exact=True).fill('Diagram')
    dialog.get_by_label('Alt text', exact=True).press('Enter')
    expect(text.locator('img[alt="Diagram"]')).to_be_visible()


def test_add_menu_stays_in_view_and_focuses_the_appended_block(page, editor_doc):
    page.set_viewport_size(dict(width=400, height=900))
    edit(page)
    add = page.locator('.editor-blocks > .blk-add-end')
    add.click()
    menu = page.get_by_role('menu')
    rect = menu.bounding_box()
    assert rect['x'] >= 0 and rect['y'] >= 0
    assert rect['x'] + rect['width'] <= 400 and rect['y'] + rect['height'] <= 900
    page.keyboard.press('Escape')
    expect(add).to_be_focused()
    add.press('Enter')
    page.keyboard.press('Home')
    page.keyboard.press('Enter')
    field = page.locator('.editor-blocks > .blk').last.locator('[contenteditable]')
    expect(field).to_be_focused()
    rect = field.bounding_box()
    assert rect['y'] >= page.locator('.editor-canvas').bounding_box()['y']


def test_save_failure_has_visible_error_and_retains_dirty_buffer(page, editor_doc):
    edit(page)
    page.locator('.blk-paragraph [contenteditable]').first.fill('Keep this')
    page.route('**' + editor_doc['url'], lambda route: route.fulfill(status=500, body='Simulated save failure') if route.request.method == 'PUT' else route.continue_())
    page.locator('.editor-bar').get_by_role('button', name='Save', exact=True).click()
    expect(page.locator('.editor-status')).to_have_attribute('data-state', 'error')
    expect(page.locator('.editor-status')).to_contain_text('Save failed')
    expect(page.locator('.editor')).to_have_attribute('data-dirty', 'true')
    expect(page.locator('.blk-paragraph [contenteditable]').first).to_have_text('Keep this')
    page.unroute('**' + editor_doc['url'])


def test_disk_change_is_visible_and_close_reloads_without_losing_reading_position(page, editor_doc):
    page.locator('#content').evaluate('(el) => el.scrollTop=200')
    position = page.locator('#content').evaluate('(el) => el.scrollTop')
    edit(page)
    text = page.locator('.blk-paragraph [contenteditable]').first
    text.fill('My buffer')
    changed = editor_doc['source'].replace('AlphaBeta', 'Changed externally')
    assert page.request.put(editor_doc['url'], data=changed).ok
    expect(page.locator('.editor-status')).to_contain_text('Files changed on disk', timeout=15000)
    expect(text).to_have_text('My buffer')
    page.locator('.editor-bar').get_by_role('button', name='Cancel', exact=True).click()
    page.get_by_role('dialog').get_by_role('button', name='Discard', exact=True).click()
    expect(page.locator('#content .doc')).to_contain_text('Changed externally')
    eventually(page, '(pos) => Math.abs(document.querySelector("#content").scrollTop-pos)<5', position)


@pytest.mark.parametrize('theme', ['light', 'dark'])
@pytest.mark.parametrize('width', [1280, 1024, 400])
def test_editor_screenshots_and_layout(page, editor_doc, width, theme):
    page.set_viewport_size(dict(width=width, height=900))
    page.evaluate('(t) => document.documentElement.dataset.theme=t', theme)
    edit(page)
    folder = ROOT / '.cache' / 'screens-151'
    folder.mkdir(parents=True, exist_ok=True)
    phase = os.getenv('WEBDOC_SCREEN_PHASE', 'before')
    page.screenshot(path=str(folder / f'{phase}-{width}-{theme}.png'))
    if phase == 'baseline':
        return
    page.locator('.editor-bar').get_by_role('button', name='Metadata', exact=True).click()
    page.locator('.blk-paragraph [contenteditable]').first.fill('Edited text, with space to write and a visible Save button.')
    # Use keyboard navigation to exercise :focus-visible, not the browser's
    # modality-dependent behavior of a programmatic focus after a mouse click.
    page.locator('.editor-bar').get_by_role('button', name='Cancel', exact=True).focus()
    page.keyboard.press('Tab')
    expect(page.locator('.editor-bar').get_by_role('button', name='Save', exact=True)).to_be_focused()
    page.screenshot(path=str(folder / f'after-{width}-{theme}.png'))
    button = page.locator('.editor-bar').get_by_role('button', name='Save', exact=True)
    bounds = button.bounding_box()
    assert bounds['x'] >= 0 and bounds['x'] + bounds['width'] <= width
    assert round(bounds['height']) == 32
    assert page.locator('.blk-small').first.evaluate('(el)=>Math.round(el.getBoundingClientRect().height)') == 28
    contrast = button.evaluate("""el => {
      const rgb = s => (s.match(/[\\d.]+/g)||[]).slice(0,3).map(Number);
      const lum = s => rgb(s).map(x=>x/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((a,x,i)=>a+x*[.2126,.7152,.0722][i],0);
      const ratio=(a,b)=>(Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05);
      const s=getComputedStyle(el), stops=s.backgroundImage.match(/rgb[a]?\\([^)]*\\)/g)||[s.backgroundColor];
      return {text:stops.map(c=>ratio(s.color,c)), width:parseFloat(s.outlineWidth), style:s.outlineStyle,
        focus:ratio(s.outlineColor,getComputedStyle(el.closest('.editor-bar')).backgroundColor),
        focusVisible:el.matches(':focus-visible'), colors:{text:s.color,stops,outline:s.outlineColor}};
    }""")
    assert all(value >= 4.5 for value in contrast['text']), contrast
    assert contrast['focusVisible'] and contrast['width'] >= 2 and contrast['style'] != 'none', contrast
    assert contrast['focus'] >= 3, contrast
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    # Hidden fields cannot intercept clicks; every visible block handle owns its row.
    assert page.locator('.editor').evaluate("""root => [...root.querySelectorAll('[hidden]')].every(el => getComputedStyle(el).display === 'none')""")
    assert page.locator('.blk-handle').first.evaluate("""el => {const r=el.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===el;}""")
    # Browser-native accessible-name audit for every visible authoring control.
    for control in page.locator('.editor button,.editor input,.editor select,.editor textarea,.editor [contenteditable=true]').all():
        if control.is_visible():
            assert control.evaluate("""el => !!(el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.labels?.length || el.textContent.trim())"""), control.evaluate('e=>e.outerHTML')


def test_split_and_divider_recentre_current_page_and_keep_toggle_clear(page, editor_doc):
    page.set_viewport_size(dict(width=1100, height=900))
    page.locator('#graphBtn').click()
    eventually(page, '() => !!window.__graph?.center')
    page.locator('#splitBtn').click()
    expect(page.locator('body')).to_have_class(re.compile('is-map-split'))
    script = """id => { const g=window.__graph, c=g?.center(id), r=document.querySelector('.graph-canvas-host')?.getBoundingClientRect(); return c && r && Math.abs(c.x-(r.x+r.width/2))<3 && Math.abs(c.y-(r.y+r.height/2))<3; }"""
    eventually(page, script, editor_doc['id'])
    divider = page.locator('#mapDivider')
    divider.focus()
    divider.press('ArrowRight')
    eventually(page, script, editor_doc['id'])
    toggle, legend = page.locator('.graph-edit-toggle').bounding_box(), page.locator('.graph-legend').bounding_box()
    assert toggle['y'] + toggle['height'] <= legend['y']
