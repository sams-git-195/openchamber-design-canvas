import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { request } from 'node:http';
const modulePath = '../service/viewer-server.ts';
const viewer = await import(modulePath).catch(() => null);
const config = { screens: [{ id: 'home', url: 'http://localhost:5173/', width: 1280, height: 800, title: 'Home' }], viewport: { width: 1280, height: 800 }, mode: 'edit' as const };
test('private viewer serves only its capability HTML with exact Host/method and restrictive headers', async () => {
  assert.ok(viewer, 'private viewer server must exist');
  const server = await viewer.startViewerServer(config);
  try {
    const response = await fetch(server.url), html = await response.text();
    assert.equal(response.status,200);
    assert.match(html, /data-screen="home"/);
    assert.doesNotMatch(html, /id="preview"/);
    assert.equal(response.headers.get('referrer-policy'),'no-referrer');
    assert.match(response.headers.get('content-security-policy') ?? '', /script-src 'sha256-/);
    assert.match(response.headers.get('content-security-policy') ?? '', /frame-src http: https:/);
    assert.equal(response.headers.get('access-control-allow-origin'),null);
    assert.doesNotMatch(html,/OPENCHAMBER_SERVICE_TOKEN/);
    assert.equal((await fetch(server.url,{method:'POST'})).status,405);
    assert.equal((await fetch(new URL('/config',server.url))).status,404);
    assert.equal((await fetch(server.url+'?x=1')).status,404);
    const wrong = await new Promise<number>((resolve,reject) => { const req=request(server.url,{headers:{host:'evil.invalid'}},res=>{res.resume();resolve(res.statusCode!)}); req.on('error',reject);req.end(); });
    assert.equal(wrong,403);
  } finally { await server.close(); }
  await assert.rejects(()=>fetch(server.url));
});

test('CSP script hashes equal sha256 of the LF-normalized served script text (CRLF-proof)', async () => {
  assert.ok(viewer, 'private viewer server must exist');
  const server = await viewer.startViewerServer(config);
  try {
    const response = await fetch(server.url), html = await response.text();
    const csp = response.headers.get('content-security-policy') ?? '';
    const allowed = new Set((csp.match(/script-src ([^;]+)/) ?? [,''])[1].split(' '));
    const bodies = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]!);
    assert.ok(bodies.length >= 1 && allowed.size === bodies.length, 'one CSP script entry per inline script');
    for (const body of bodies) {
      // Chrome normalizes CRLF/CR to LF in the input byte stream before parsing
      // any element, so the hash it verifies is over THIS text — a CRLF source
      // file checked out by git autocrlf must not change it.
      const normalized = body.replace(/\r\n?/g, '\n');
      const entry = `'sha256-${createHash('sha256').update(normalized).digest('base64')}'`;
      assert.ok(allowed.has(entry), 'CSP hash equals the LF-normalized served script text');
      // Regression control: hashing the raw CRLF bytes (the pre-fix behavior)
      // must never equal the entry Chrome verifies, so a CRLF regression
      // anywhere in the chain is caught by the pin above.
      const crlf = normalized.replace(/\n/g, '\r\n');
      assert.notEqual(crlf, normalized, 'script bodies contain line breaks for the CRLF control');
      assert.notEqual(`'sha256-${createHash('sha256').update(crlf).digest('base64')}'`, entry, 'raw CRLF hashing cannot match the CSP entry');
    }
  } finally { await server.close(); }
});
