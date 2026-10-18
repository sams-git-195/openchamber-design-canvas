import { test } from 'node:test';
import assert from 'node:assert/strict';

import { contrastRatio } from '../service/lint.ts';

test('contrastRatio computes WCAG ratios and rejects unparseable colours', () => {
  assert.equal(contrastRatio('#000', '#fff'), 21);
  assert.equal(contrastRatio('#fff', '#fff'), 1);
  assert.equal(contrastRatio('rgb(0,0,0)', 'white'), 21);
  assert.equal(contrastRatio('not-a-colour', '#fff'), null);
});
