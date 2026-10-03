import test from 'node:test';
import assert from 'node:assert/strict';
import { rebindChatGPTFrame } from '../src/shared/frame-rebind.js';

test('rebind skips an initial readable document even when iframe src already names ChatGPT', () => {
  const calls = [];
  const frame = { src: 'https://chatgpt.com/#cgp-frame=token', contentWindow: {
    location: { origin: 'chrome-extension://extension-id' },
    postMessage: (...args) => calls.push(args),
  } };
  assert.equal(rebindChatGPTFrame(frame, 'token'), false);
  frame.contentWindow.location.origin = 'null';
  assert.equal(rebindChatGPTFrame(frame, 'token'), false);
  frame.contentWindow = null;
  assert.equal(rebindChatGPTFrame(frame, 'token'), false);
  assert.deepEqual(calls, []);
});

test('a committed cross-origin frame receives only the original token and exact ChatGPT target origin', () => {
  const calls = [];
  const frame = { contentWindow: {
    get location() { throw new DOMException('Blocked cross-origin access', 'SecurityError'); },
    postMessage: (...args) => calls.push(args),
  } };
  assert.equal(rebindChatGPTFrame(frame, 'original-token'), true);
  assert.deepEqual(calls, [[{ type: 'CGP_REBIND', token: 'original-token' }, 'https://chatgpt.com']]);
});
