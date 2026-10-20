'use strict';

// Run with:  node --test actions/qa-comment/*.test.js
//
// These tests exist because this comment once reported "0 errors, 0 warnings"
// for a build that had six warnings: qa.json parsed fine but its messages
// array was empty, so a missing detail source was indistinguishable from a
// clean build. The cases below pin down that distinction.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const qa = require('./qa-comment.js');

const SHA = 'abcdef1234567890';
const LOG_LINE =
  'Errors: 0, Warnings: 6, Info: 3, Broken Links: 4 (00:00.097 / 00:50.445, 742Mb)\n';

/** Build a throwaway output/ tree and run `fn` with it as the cwd. */
function withFixture(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-fixture-'));
  const cwd = process.cwd();
  try {
    fs.mkdirSync(path.join(dir, 'output', 'sv'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'build.log'), LOG_LINE);
    // What fhir2.base.template actually produces: a root qa.json that parses
    // but carries no messages.
    fs.writeFileSync(path.join(dir, 'output', 'qa.json'), '{"messages":[]}');
    const warnings = Array.from({ length: 6 }, (_, i) => ({
      level: 'warning',
      location: `page${i}.html`,
      message: `warning ${i}`,
    }));
    fs.writeFileSync(
      path.join(dir, 'output', 'sv', 'qa.json'),
      JSON.stringify({
        messages: [...warnings, { level: 'information', location: 'x.html', message: 'hint' }],
      })
    );
    process.chdir(dir);
    return fn(dir);
  } finally {
    process.chdir(cwd);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Verbatim excerpt of what IG Publisher 2.3.3 wrote with fhir2.base.template.
const QA_TXT = [
  'IneraCoreTemplate : Validation Results',
  '=========================================',
  '',
  'err = 0, warn = 5, info = 3',
  'IG Publisher Version: 2.3.3',
  ' Build Errors : 4 / 0 / 0',
  '</table>',
  '== n/a ==',
  "ERROR: sv/downloads.html#/html/body/div/div at Line 212, column 8: The link 'package.tgz' for \"Paket (tgz)\" cannot be resolved",
  "ERROR: sv/mappings.html#/html/body/div at Line 256, column 16: The link 'StructureDefinition-[Profil].html' for \"Profil.element\" cannot be resolved",
  '== fsh-generated/resources/ImplementationGuide-inera.core.template.json ==',
  "WARNING: ImplementationGuide/inera.core.template: ImplementationGuide.language.system: En definition för CodeSystem 'urn:ietf:bcp:47' kunde inte hittas, så koden kan inte valideras",
  'INFORMATION: Resource: The resource could usefully have an OID assigned',
  '== fsh-generated/resources/Patient-IneraPatientExample.json ==',
  "WARNING: Patient/IneraPatientExample: Patient.identifier[0].system: Ingen definition kunde hittas för URL-värdet 'http://electronichealth.se/identifier/personnummer'",
].join('\n');

test('findQaText parses the real publisher qa.txt', () => {
  withFixture((dir) => {
    fs.writeFileSync(path.join(dir, 'output', 'qa.txt'), QA_TXT);
    const found = qa.findQaText();
    assert.ok(found, 'expected qa.txt to be parsed');
    assert.strictEqual(found.msgs.length, 5);
    assert.deepStrictEqual(
      found.msgs.map((m) => m.level),
      ['error', 'error', 'warning', 'information', 'warning']
    );
    const first = found.msgs[0];
    assert.match(first.location, /^sv\/downloads\.html/);
    assert.match(first.message, /The link 'package\.tgz'/);
    // Section headers and the summary block must not leak in as messages.
    assert.ok(!found.msgs.some((m) => /^=/.test(m.message)));
    assert.ok(!found.msgs.some((m) => /^err = /.test(m.message)));
  });
});

test('findDetail prefers qa.txt over an empty qa.json', () => {
  withFixture((dir) => {
    fs.writeFileSync(path.join(dir, 'output', 'qa.txt'), QA_TXT);
    const found = qa.findDetail();
    assert.match(found.file, /qa\.txt$/);
  });
});

test('findDetail falls back to qa.json when there is no qa.txt', () => {
  withFixture(() => {
    const found = qa.findDetail();
    assert.match(found.file, /qa\.json$/);
  });
});

test('qa.txt detail feeds the issue table', () => {
  withFixture((dir) => {
    fs.writeFileSync(path.join(dir, 'output', 'qa.txt'), QA_TXT);
    const body = qa.buildBody({
      counts: { errors: 0, warnings: 5, hints: 3, broken: 4 },
      qa: qa.findDetail(),
      buildFailed: false,
      sha: SHA,
    });
    assert.match(body, /### Issues/);
    assert.match(body, /The link 'package\.tgz'/);
  });
});

test('readCounts parses the publisher summary line', () => {
  withFixture(() => {
    assert.deepStrictEqual(qa.readCounts(), {
      errors: 0,
      warnings: 6,
      hints: 3,
      broken: 4,
    });
  });
});

test('readCounts returns null when build.log is unreadable', () => {
  withFixture(() => {
    assert.strictEqual(qa.readCounts('no-such-file.log'), null);
  });
});

test('findQa skips an empty root qa.json and finds the language one', () => {
  withFixture(() => {
    const found = qa.findQa();
    assert.ok(found, 'expected a qa.json carrying messages');
    assert.strictEqual(found.file.split(path.sep).join('/'), 'output/sv/qa.json');
    assert.strictEqual(found.msgs.length, 7);
  });
});

test('findQa returns null when no file carries messages', () => {
  withFixture(() => {
    assert.strictEqual(qa.findQa('missing-dir'), null);
  });
});

test('headline counts come from the log, not from the message array', () => {
  withFixture(() => {
    const body = qa.buildBody({
      counts: qa.readCounts(),
      qa: qa.findQa(),
      buildFailed: false,
      sha: SHA,
    });
    assert.match(body, /🟡 Warnings \| 6/);
    assert.match(body, /💡 Hints \| 3/);
    assert.match(body, /🔗 Broken links \| 4/);
    assert.match(body, /### Issues/);
  });
});

test('a missing detail source is stated outright, and counts are still reported', () => {
  withFixture(() => {
    const body = qa.buildBody({
      counts: qa.readCounts(),
      qa: null,
      buildFailed: false,
      sha: SHA,
    });
    assert.match(body, /No `qa\.txt` or `qa\.json` with messages found/);
    assert.match(body, /🟡 Warnings \| 6/);
    assert.doesNotMatch(body, /### Issues/);
  });
});

test('unreadable counts never produce a green tick', () => {
  const body = qa.buildBody({ counts: null, qa: null, buildFailed: false, sha: SHA });
  assert.match(body, /^## ❌/m);
  assert.match(body, /Errors \| \*\*\?\*\*/);
  assert.doesNotMatch(body, /✅/);
});

test('a detail/headline mismatch is flagged rather than silently undercounted', () => {
  withFixture(() => {
    const body = qa.buildBody({
      counts: qa.readCounts(),
      qa: { file: 'output/sv/qa.json', msgs: [{ level: 'warning', location: 'a', message: 'one' }] },
      buildFailed: false,
      sha: SHA,
    });
    assert.match(body, /lists 1 error\/warning message\(s\), but the build reported 6/);
  });
});

test('a genuinely clean build gets a green tick', () => {
  const body = qa.buildBody({
    counts: { errors: 0, warnings: 0, hints: 0, broken: 0 },
    qa: null,
    buildFailed: false,
    sha: SHA,
  });
  assert.match(body, /^## ✅/m);
});

test('errors outrank warnings in the status icon', () => {
  const body = qa.buildBody({
    counts: { errors: 2, warnings: 9, hints: 0, broken: null },
    qa: null,
    buildFailed: false,
    sha: SHA,
  });
  assert.match(body, /^## 🔴/m);
  assert.doesNotMatch(body, /Broken links/);
});

test('a failed build overrides an otherwise clean result', () => {
  const body = qa.buildBody({
    counts: { errors: 0, warnings: 0, hints: 0, broken: 0 },
    qa: null,
    buildFailed: true,
    sha: SHA,
  });
  assert.match(body, /^## ❌/m);
  assert.match(body, /Build failed/);
});

test('the issue table is capped and says that it is', () => {
  const msgs = Array.from({ length: 20 }, (_, i) => ({
    level: 'error',
    location: `f${i}.html`,
    message: `m${i}`,
  }));
  const body = qa.buildBody({
    counts: { errors: 20, warnings: 0, hints: 0, broken: null },
    qa: { file: 'q', msgs },
    buildFailed: false,
    sha: SHA,
  });
  assert.strictEqual((body.match(/^\| 🔴 \|/gm) || []).length, 15);
  assert.match(body, /Showing the first 15 issues/);
});

test('pipes in a message are escaped so the table survives', () => {
  const body = qa.buildBody({
    counts: { errors: 1, warnings: 0, hints: 0, broken: null },
    qa: { file: 'q', msgs: [{ level: 'error', location: 'a', message: 'x | y | z' }] },
    buildFailed: false,
    sha: SHA,
  });
  assert.match(body, /x \\\| y \\\| z/);
});

// --- cross-check tolerance -------------------------------------------------
// The summary line counts broken links in their own column; qa.txt writes each
// as an ERROR line. The detail may exceed errors+warnings by up to that many
// without anything being wrong.

test('detail exceeding the headline by the broken-link count is not flagged', () => {
  const msgs = [
    ...Array.from({ length: 4 }, (_, i) => ({ level: 'error', location: `l${i}`, message: 'link' })),
    ...Array.from({ length: 5 }, (_, i) => ({ level: 'warning', location: `w${i}`, message: 'w' })),
  ];
  const body = qa.buildBody({
    counts: { errors: 0, warnings: 5, hints: 3, broken: 4 },
    qa: { file: 'output/qa.txt', msgs },
    buildFailed: false,
    sha: SHA,
  });
  assert.doesNotMatch(body, /Details below may be incomplete/);
});

test('detail below the headline is still flagged', () => {
  const body = qa.buildBody({
    counts: { errors: 0, warnings: 5, hints: 3, broken: 4 },
    qa: { file: 'output/qa.txt', msgs: [{ level: 'warning', location: 'a', message: 'one' }] },
    buildFailed: false,
    sha: SHA,
  });
  assert.match(body, /lists 1 error\/warning message\(s\), but the build reported 5–9/);
});

test('unexplained excess above the broken-link ceiling is flagged', () => {
  const msgs = Array.from({ length: 20 }, (_, i) => ({
    level: 'error',
    location: `l${i}`,
    message: 'x',
  }));
  const body = qa.buildBody({
    counts: { errors: 0, warnings: 5, hints: 3, broken: 4 },
    qa: { file: 'output/qa.txt', msgs },
    buildFailed: false,
    sha: SHA,
  });
  assert.match(body, /lists 20 error\/warning message\(s\), but the build reported 5–9/);
});

// --- status icon -----------------------------------------------------------

test('broken links make the status red even with zero errors', () => {
  const body = qa.buildBody({
    counts: { errors: 0, warnings: 0, hints: 0, broken: 4 },
    qa: null,
    buildFailed: false,
    sha: SHA,
  });
  assert.match(body, /^## 🔴/m);
});

test('warnings alone stay yellow', () => {
  const body = qa.buildBody({
    counts: { errors: 0, warnings: 3, hints: 0, broken: 0 },
    qa: null,
    buildFailed: false,
    sha: SHA,
  });
  assert.match(body, /^## 🟡/m);
});

test('notes render without a blockquote marker', () => {
  const body = qa.buildBody({ counts: null, qa: null, buildFailed: false, sha: SHA });
  assert.doesNotMatch(body, /^> ⚠️/m);
  assert.match(body, /^⚠️ /m);
});
