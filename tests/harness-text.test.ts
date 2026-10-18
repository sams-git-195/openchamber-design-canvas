import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CANVAS_PROTOCOL, CANVAS_PROTOCOL_CHIP, CRAFT_RULES, DESIGN_AUTHORITY, DESIGN_WORKSPACE_NOTE, WORKING_AGREEMENT_CHIP, workingAgreement, workingAgreementChip } from '../shared/harness-text.ts';

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

test('questions off: nothing in the agreement asks or waits for approval', () => {
  const text = workingAgreement({ questions: false });
  assert.doesNotMatch(text, /\bask\b|get a yes|approve/i);
  assert.match(text, /3\. Devices: state the sizes you chose in the Assumptions list \(phone 390×844, tablet 768×1024, desktop 1440×900\)\./);
  assert.match(text, /4\. Options: the user wants one direction\./, 'options default to 1 with questions off');
  assert.match(text, /in the Assumptions list and build; the style artboard is optional/);
  assert.match(workingAgreement({ questions: false, options: 'ask' }), /4\. Options: one direction — the Assumptions list names it\./);
  assert.doesNotMatch(workingAgreement({ questions: false, options: 'ask' }), /For options:/);
  assert.doesNotMatch(workingAgreement({ questions: false, options: 2 }), /\bask\b/i);
});

test('the agreement chip follows the questions and options choices', () => {
  assert.equal(workingAgreementChip(), WORKING_AGREEMENT_CHIP);
  const off = workingAgreementChip({ questions: false });
  assert.match(off, /turned questions off/);
  assert.doesNotMatch(off, /numbered questions|\bask\b/i);
  assert.match(workingAgreementChip({ options: 2 }), /the user wants 2 directions/);
});

test('honesty: only failed writes or edits stop the work; a failed read means absent', () => {
  assert.match(workingAgreement(), /if a WRITE or EDIT call was refused or failed, say so and stop; a failed read just means that file is absent\./);
});

test('approval stall: directions replace the palette proposal and the style artboard', () => {
  assert.match(workingAgreement(), /the direction descriptions replace the palette proposal and the key screens replace the style artboard\. Never ask for more than one approval before the first screen exists\./);
});

test('the DESIGN.md status line and BRIEF.md work before the scaffold writes them', () => {
  const text = workingAgreement();
  assert.match(text, /add or update a `Status:` line in DESIGN\.md: "Status: confirmed — source: <the project file you copied from, e.g\. tailwind\.config\.ts>"/);
  assert.match(text, /9\. Create BRIEF\.md if missing and keep it current \(devices, look source, chosen option, open questions\)\./);
});

test('custom sizes, the conditional DS_SCREENS step and the precedence list', () => {
  assert.match(DESIGN_WORKSPACE_NOTE, /prefer the size presets/);
  assert.match(DESIGN_WORKSPACE_NOTE, /when app\.js has a DS_SCREENS array, add the same entry there/);
  assert.match(CANVAS_PROTOCOL.split('\n')[4]!, /Other sizes are allowed within 200–8192\.$/);
  assert.match(CANVAS_PROTOCOL_CHIP.split('\n')[3]!, /Other sizes are allowed within 200–8192\.$/);
  assert.match(DESIGN_AUTHORITY, /once confirmed; \(5\) the visual direction\. A file marked "Status: placeholder" holds scaffold defaults, not decisions\./);
});

test('craft rules agree: 8pt at breakpoint endpoints, one hierarchy order, one spelling', () => {
  assert.match(CRAFT_RULES.layout, /multiple of 8 at each breakpoint's endpoints/);
  assert.match(CRAFT_RULES.layout, /position, then size, then weight, then color/);
  assert.match(CRAFT_RULES.typography, /Let position, size, weight and color carry hierarchy, in that order/);
  assert.doesNotMatch(workingAgreement() + DESIGN_AUTHORITY + CRAFT_RULES.layout, /colour/);
});
