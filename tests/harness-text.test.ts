import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CRAFT_RULES, DESIGN_AUTHORITY, workingAgreement } from '../shared/harness-text.ts';

test('the working agreement carries the senior-practice contract', () => {
  const text = workingAgreement();
  assert.match(text, /3–6 short numbered questions/);
  assert.match(text, /recommended default in bold/);
  assert.match(text, /If the project is responsive, say so/);
  assert.match(text, /sibling artboards \(home-a, home-b/);
  assert.match(text, /Never say you created or changed a file unless/);
  assert.match(text, /Picks are edits/);
});

test('questions off swaps the clarify step for an assumptions list', () => {
  const text = workingAgreement({ questions: false });
  assert.match(text, /turned questions off/);
  assert.doesNotMatch(text, /numbered questions/);
});

test('a single-direction choice drops the options protocol', () => {
  assert.doesNotMatch(workingAgreement({ options: 1 }), /For options:/);
});

test('the design authority states precedence and the placeholder status', () => {
  assert.match(DESIGN_AUTHORITY, /Status: placeholder/);
});

test('the layout and content craft rules are present', () => {
  assert.match(CRAFT_RULES.layout, /8pt grid/);
  assert.match(CRAFT_RULES.content, /never lorem ipsum/);
});
