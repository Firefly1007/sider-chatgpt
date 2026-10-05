import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test('popup caps its scroll area like Doubao, preserves reading position and keeps the compact controls visible', async () => {
  const bundle = await build({ stdin: { contents: `import {createContentController} from './src/content/controller.js';
    window.controller=createContentController({document,chrome:{runtime:{sendMessage:async message=>{
      if(message.type==='START_TASK')return {ok:true,sessionId:'session',requestId:'request'};
      if(message.type==='GET_CAPABILITIES')return {ok:true,capabilities:{modes:['instant','high']}};
      return {ok:true};
    }}}});`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife', platform: 'browser' });
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
    await page.route('**/*', route => route.abort());
    await page.setContent('<!doctype html><style>body{margin:0;background:#202328;color:#edf0f4}</style><main>Offline streaming fixture</main>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(() => window.controller.open({ action: 'translate', origin: 'selection', selectedText: 'pod' }, { left: 500, bottom: 740 }));
    await page.waitForFunction(() => window.controller.state.requestId === 'request');
    const popup = page.getByRole('dialog'), body = popup.locator('.cgp-body');
    async function stream(text, state = 'streaming') {
      await page.evaluate(async ({ text, state }) => {
        window.controller.acceptEvent({ channel: 'cgp', type: 'TASK_EVENT', sessionId: 'session', requestId: 'request', state, text, capabilities: { modes: ['instant', 'high'] } });
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      }, { text, state });
    }
    await stream('First visible chunk');
    assert.equal((await popup.locator('.cgp-result').textContent()).trimEnd(), 'First visible chunk');
    assert.equal(await popup.locator('.cgp-state').textContent(), '生成中');
    assert.equal(await popup.locator('.cgp-availability').isVisible(), false);
    assert.equal(await popup.getByLabel('思考程度').evaluate(select => select.selectedOptions[0].textContent), '即时');
    const long = Array.from({ length: 35 }, (_, i) => `Paragraph ${i + 1}: visible streamed content.`).join('\n\n');
    await stream(long);
    const geometry = await popup.evaluate(panel => {
      const body = panel.querySelector('.cgp-body'), footer = panel.querySelector('.cgp-footer');
      const composer = panel.querySelector('.cgp-composer'), operations = panel.querySelector('.cgp-operations');
      return { bodyHeight: body.clientHeight, shellOverflow: panel.scrollHeight - panel.clientHeight,
        scrollTop: body.scrollTop,
        operationsBeforeComposer: operations.getBoundingClientRect().bottom <= composer.getBoundingClientRect().top,
        operationsInComposer: composer.contains(operations), footerBottom: footer.getBoundingClientRect().bottom,
        bottom: panel.getBoundingClientRect().bottom, bodyPadding: getComputedStyle(body).paddingLeft };
    });
    assert.equal(geometry.bodyHeight, 400);
    assert.equal(geometry.shellOverflow, 0, 'Only the answer area should scroll');
    assert.equal(geometry.scrollTop, 0, 'Output stays at the top until the user scrolls');
    assert.equal(geometry.operationsBeforeComposer, true); assert.equal(geometry.operationsInComposer, false);
    assert.ok(geometry.bottom <= 788 && geometry.footerBottom <= geometry.bottom);
    assert.equal(geometry.bodyPadding, '16px');
    const modeBox = await popup.getByLabel('思考程度').boundingBox(), sendBox = await popup.getByRole('button', { name: '发送', exact: true }).boundingBox();
    const inputBox = await popup.getByLabel('问题或追问').boundingBox();
    assert.ok(inputBox.x + inputBox.width < modeBox.x);
    assert.ok(Math.abs(inputBox.y + inputBox.height / 2 - sendBox.y - sendBox.height / 2) <= 1);
    assert.ok((await popup.locator('.cgp-composer').boundingBox()).height <= 38, 'Initial input area stays compact');
    assert.ok(modeBox.x + modeBox.width < sendBox.x);
    assert.ok(Math.abs(modeBox.y + modeBox.height / 2 - sendBox.y - sendBox.height / 2) <= 1);
    const modeText = await popup.locator('.cgp-mode-value').boundingBox(), arrow = await popup.locator('.cgp-mode-chevron').boundingBox();
    const modeGap = arrow.x - modeText.x - modeText.width;
    assert.ok(modeGap >= 3 && modeGap <= 5, 'Mode text and dropdown arrow have only a small gap');
    await stream(long + '\n\nNext streamed chunk');
    assert.equal(await body.evaluate(el => el.scrollTop), 0);
    await body.evaluate(el => { el.scrollTop = 240; });
    await stream(long + '\n\nNext streamed chunk\n\nLast streamed chunk');
    assert.equal(await body.evaluate(el => el.scrollTop), 240, 'Updates preserve the user reading position');
    const previousBottom = await body.evaluate(el => { el.scrollTop = el.scrollHeight; return el.scrollTop; });
    await stream(long + '\n\nNext streamed chunk\n\nLast streamed chunk\n\nAnother chunk');
    assert.equal(await body.evaluate(el => el.scrollTop), previousBottom, 'Even reading at the bottom must not follow new output');
    await body.evaluate(el => { el.scrollTop = 0; });
    await stream(long, 'completed');
    assert.equal(await body.evaluate(el => el.scrollTop), 0, 'Completion also preserves the top position');
    assert.equal(await popup.getByRole('button', { name: '复制', exact: true }).isEnabled(), true);
    assert.equal(await popup.getByRole('button', { name: '重试', exact: true }).isEnabled(), true);
    assert.equal(await popup.getByRole('button', { name: '停止', exact: true }).isEnabled(), false);
    await popup.getByLabel('思考程度').focus();
    assert.equal(await popup.locator('.cgp-availability').isVisible(), false);
    for (const height of [420, 300]) {
      await page.setViewportSize({ width: 1000, height });
      await page.waitForFunction(() => {
        const box = window.controller.state.panel.getBoundingClientRect();
        return box.top >= 0 && box.bottom <= innerHeight - 12;
      });
      const box = await popup.boundingBox();
      assert.ok(box.y >= 0 && box.y + box.height <= height - 12, `Popup fits a ${height}px viewport`);
      assert.ok(await body.evaluate(el => el.clientHeight < 400 && el.scrollHeight > el.clientHeight));
      assert.equal(await popup.evaluate(el => el.scrollHeight - el.clientHeight), 0);
      const send = await popup.getByRole('button', { name: '发送', exact: true }).boundingBox();
      assert.ok(send.y + send.height <= height - 12);
    }
    await page.evaluate(() => window.controller.dispose());
  } finally { await browser.close(); }
});

test('toolbar and popup drag without losing selection, draft, or the active conversation', async () => {
  const bundle = await build({ stdin: { contents: `import {createContentController} from './src/content/controller.js';
    window.messages=[];
    window.controller=createContentController({document,chrome:{runtime:{sendMessage:async message=>{
      window.messages.push(message);
      if(message.type==='START_TASK')return {ok:true,sessionId:'session',requestId:'request'};
      return {ok:true};
    }}}});`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife', platform: 'browser' });
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
    await page.route('**/*', route => route.abort());
    await page.setContent('<!doctype html><style>body{margin:0;font:18px Arial}main{padding:140px 100px}</style><main><p id="target">A passage that must remain selected.</p></main>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(() => {
      const range = document.createRange(); range.selectNodeContents(document.querySelector('#target'));
      getSelection().removeAllRanges(); getSelection().addRange(range); window.controller.showSelection();
    });
    const toolbar = page.getByRole('toolbar'), grip = toolbar.locator('.cgp-drag-handle');
    const selection = await page.evaluate(() => getSelection().toString());
    const gripBox = await grip.boundingBox(), actionsBox = await toolbar.locator('.actions-pdxL43').boundingBox();
    assert.ok(gripBox.x >= actionsBox.x + actionsBox.width - 1, 'The handle belongs on the right');
    await grip.click();
    assert.equal(await page.evaluate(() => getSelection().toString()), selection);
    async function assertRetainedHighlight() {
      const ranges = await page.evaluate(() => [...CSS.highlights.get('cgp-page-selection') || []].map(range => range.toString()));
      assert.deepEqual(ranges, [selection]);
    }
    async function drag(handle, dx, dy, button = 'left') {
      const box = await handle.boundingBox(), x = box.x + box.width / 2, y = box.y + box.height / 2;
      await page.mouse.move(x, y); await page.mouse.down({ button });
      await page.mouse.move(x + dx, y + dy, { steps: 8 }); await page.mouse.up({ button });
    }
    const first = await toolbar.boundingBox();
    await drag(grip, 130, 90);
    const moved = await toolbar.boundingBox();
    assert.equal(Math.round(moved.x - first.x), 130); assert.equal(Math.round(moved.y - first.y), 90);
    assert.equal(await page.evaluate(() => getSelection().toString()), selection);
    assert.equal(await page.evaluate(() => window.messages.some(m => ['START_TASK', 'CLOSE_SESSION'].includes(m.type))), false);
    await page.evaluate(() => window.controller.handleMessage({ channel: 'cgp', type: 'SIDEPANEL_STATE_CHANGED', open: true }));
    const redrawn = await toolbar.boundingBox();
    assert.equal(redrawn.x, moved.x); assert.equal(redrawn.y, moved.y);
    await toolbar.getByRole('button', { name: '问AI', exact: true }).click();
    const popup = page.getByRole('dialog'), caption = popup.locator('.caption-ElsTYI'), popupGrip = popup.getByRole('img', { name: '拖动浮窗', exact: true });
    const initialPopup = await popup.boundingBox(), popupGripBox = await popupGrip.boundingBox();
    assert.equal(await toolbar.count(), 0, 'Popup replaces the toolbar');
    assert.equal(initialPopup.x, redrawn.x); assert.equal(initialPopup.y, redrawn.y, 'Popup opens at the toolbar position');
    assert.ok(Math.abs(popupGripBox.x + popupGripBox.width / 2 - initialPopup.x - initialPopup.width / 2) < 1, 'Popup handle is horizontally centered');
    const closeBox = await popup.getByRole('button', { name: '关闭', exact: true }).boundingBox();
    assert.ok(Math.abs(popupGripBox.y + popupGripBox.height / 2 - closeBox.y - closeBox.height / 2) < 1, 'Popup handle aligns with the title and close controls');
    await assertRetainedHighlight(); // Ask focuses its input immediately.
    await caption.click();
    await popup.locator('summary').click();
    assert.equal(await popup.locator('details').evaluate(element => element.open), true);
    await popup.locator('summary').click();
    await assertRetainedHighlight();
    await popup.getByRole('textbox').click();
    await page.keyboard.type('Draft stays while moving');
    assert.equal(await popup.getByRole('textbox').inputValue(), 'Draft stays while moving', 'Page highlighting must not steal the text field caret');
    await assertRetainedHighlight();
    await page.keyboard.press('Control+A');
    await assertRetainedHighlight();
    await page.screenshot({ path: 'docs/verification/selection-retained-input.png' });
    await page.evaluate(() => { window.originalState = window.controller.state; });
    const beforePopup = await popup.boundingBox();
    await drag(popup.getByRole('textbox'), 140, 80);
    assert.deepEqual(await popup.boundingBox(), beforePopup, 'Dragging inside the input must not move the popup');
    await drag(caption, 30, 20);
    assert.deepEqual(await popup.boundingBox(), beforePopup, 'The title is not a drag handle');
    await drag(popupGrip, 140, 80);
    const afterPopup = await popup.boundingBox();
    assert.equal(Math.round(afterPopup.x - beforePopup.x), 140); assert.equal(Math.round(afterPopup.y - beforePopup.y), 80);
    assert.equal(await popup.getByRole('textbox').inputValue(), 'Draft stays while moving');
    await assertRetainedHighlight();
    assert.equal(await page.evaluate(() => window.controller.state === window.originalState), true);
    assert.equal(await popup.getByRole('button', { name: '固定浮窗', exact: true }).getAttribute('aria-pressed'), 'false', 'Dragging must not silently pin the popup');
    assert.equal(await page.evaluate(() => window.messages.some(m => ['START_TASK', 'CLOSE_SESSION'].includes(m.type))), false);

    await popup.getByRole('button', { name: '发送', exact: true }).click();
    await page.waitForFunction(() => window.controller.state.sessionId === 'session');
    await page.evaluate(() => window.controller.acceptEvent({ channel: 'cgp', type: 'TASK_EVENT', sessionId: 'session', requestId: 'request', state: 'streaming', text: 'First part of the reply' }));
    await drag(popup.locator('.cgp-result'), -90, -50);
    const afterTextDrag = await popup.boundingBox();
    assert.equal(afterTextDrag.x, afterPopup.x, 'Dragging answer text must not move the popup horizontally');
    assert.equal(afterTextDrag.y, afterPopup.y, 'Dragging answer text must not move the popup vertically');
    await drag(popupGrip, -90, -50);
    await assertRetainedHighlight();
    const duringStream = await popup.boundingBox();
    assert.equal(Math.round(duringStream.x - afterPopup.x), -90); assert.equal(Math.round(duringStream.y - afterPopup.y), -50);
    assert.match(await popup.locator('.cgp-result').textContent(), /First part/);
    assert.equal(await page.evaluate(() => window.controller.state.sessionId), 'session');
    assert.equal(await page.evaluate(() => window.messages.filter(m => m.type === 'START_TASK').length), 1);
    assert.equal(await page.evaluate(() => window.messages.some(m => ['CLOSE_SESSION', 'STOP_TASK'].includes(m.type))), false);
    await page.evaluate(() => window.controller.acceptEvent({ channel: 'cgp', type: 'TASK_EVENT', sessionId: 'session', requestId: 'request', state: 'completed', text: 'Completed reply in the same session' }));
    assert.equal(await popup.locator('.cgp-state').textContent(), '完成');
    assert.equal((await popup.boundingBox()).x, duringStream.x);

    await drag(popupGrip, 80, 60, 'right');
    assert.equal((await popup.boundingBox()).x, duringStream.x);
    assert.equal((await popup.boundingBox()).y, duringStream.y);
    await popupGrip.evaluate(element => element.addEventListener('pointerdown', event => { window.dragPointer = event.pointerId; }, { once: true }));
    const handle = await popupGrip.boundingBox();
    await page.mouse.move(handle.x + 30, handle.y + 10); await page.mouse.down();
    await page.mouse.move(handle.x + 60, handle.y + 35);
    const beforeCancel = await popup.boundingBox();
    await popupGrip.evaluate(element => element.dispatchEvent(new PointerEvent('pointercancel', { pointerId: window.dragPointer, bubbles: true, composed: true })));
    await page.mouse.move(handle.x + 130, handle.y + 100); await page.mouse.up();
    assert.equal((await popup.boundingBox()).x, beforeCancel.x); assert.equal((await popup.boundingBox()).y, beforeCancel.y);
    assert.equal(await popupGrip.evaluate(element => element.classList.contains('cgp-dragging')), false);
    await drag(popupGrip, -1500, -1500);
    const edge = await popup.boundingBox();
    assert.equal(edge.x, 0); assert.equal(edge.y, 0);
    await page.mouse.move(900, 700);
    assert.equal((await popup.boundingBox()).x, 0); assert.equal((await popup.boundingBox()).y, 0);
    await drag(popupGrip, 420, 280);
    await page.evaluate(() => {
      const range = document.createRange(); range.selectNodeContents(document.querySelector('#target'));
      getSelection().removeAllRanges(); getSelection().addRange(range); window.controller.showSelection();
    });
    await caption.click();
    assert.equal(await page.evaluate(() => getSelection().toString()), selection, 'Clicking the popup must not collapse an existing native selection');
    await drag(popupGrip, 10, 10);
    assert.equal(await page.evaluate(() => getSelection().toString()), selection, 'Dragging the popup must not collapse an existing native selection');
    await page.screenshot({ path: 'docs/verification/floating-drag.png' });
    await popup.getByRole('button', { name: '关闭', exact: true }).click();
    assert.equal(await popup.count(), 0);
    assert.equal(await toolbar.count(), 1, 'X returns to the toolbar');
    const returned = await toolbar.boundingBox();
    assert.equal(returned.x, redrawn.x); assert.equal(returned.y, redrawn.y, 'Return restores the original toolbar position after popup dragging');
    assert.equal(await page.evaluate(() => window.messages.filter(m => m.type === 'CLOSE_SESSION').length), 1);
    assert.equal(await page.evaluate(() => getSelection().toString()), selection, 'Closing via the popup must not deselect the page');
    await assertRetainedHighlight();
    await page.mouse.click(1000, 800);
    assert.equal(await toolbar.count(), 0);
    assert.equal(await page.evaluate(() => getSelection().toString()), '', 'Outside click clears the actual page selection');
    assert.equal(await page.evaluate(() => CSS.highlights.has('cgp-page-selection')), false, 'A deliberate outside click releases the retained highlight');
    await page.evaluate(() => window.controller.open({ action: 'ask', origin: 'selection', selectedText: 'Another passage' }));
    await popup.getByRole('textbox').fill('Another question');
    await popup.getByRole('button', { name: '发送', exact: true }).click();
    await page.waitForFunction(() => window.controller.state.sessionId === 'session');
    await drag(popup.getByRole('img', { name: '拖动浮窗', exact: true }), 120, 80);
    await page.mouse.click(1000, 800);
    assert.equal(await popup.count(), 0, 'Outside click must close a dragged popup');
    assert.equal(await page.evaluate(() => window.messages.filter(m => m.type === 'CLOSE_SESSION').length), 2, 'Outside close must release the owned conversation');
  } finally { await browser.close(); }
});
