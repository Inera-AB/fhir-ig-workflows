'use strict';

const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = 'output';
const BUILD_LOG = 'build.log';
const MAX_ROWS = 15;

/**
 * Read the publisher's own summary line from build.log.
 *
 * This is the source of truth for the headline counts. Deriving them from
 * qa.json instead is what made this comment report a clean build while the
 * log showed six warnings: the file parsed fine but its `messages` array was
 * empty, so "nothing found" was indistinguishable from "nothing wrong".
 *
 * @returns {{errors:number, warnings:number, hints:number, broken:number|null}|null}
 *          null when the line cannot be read at all.
 */
function readCounts(logFile = BUILD_LOG) {
  let log;
  try {
    log = fs.readFileSync(logFile, 'utf8');
  } catch (e) {
    return null;
  }
  const m = [
    ...log.matchAll(
      /Errors:\s*(\d+),\s*Warnings:\s*(\d+),\s*Info:\s*(\d+)(?:,\s*Broken Links:\s*(\d+))?/g
    ),
  ].pop();
  if (!m) return null;
  return {
    errors: +m[1],
    warnings: +m[2],
    hints: +m[3],
    broken: m[4] === undefined ? null : +m[4],
  };
}

/**
 * Locate a qa.json that actually carries messages.
 *
 * fhir2.base.template writes pages into a language directory, so check the
 * output root first and then each subdirectory. A file with an empty
 * `messages` array is treated as "not found" on purpose — reporting it as
 * zero problems would be the exact failure this module exists to prevent.
 *
 * @returns {{file:string, msgs:Array}|null}
 */
function findQa(outputDir = OUTPUT_DIR) {
  const candidates = [path.join(outputDir, 'qa.json')];
  try {
    for (const d of fs.readdirSync(outputDir, { withFileTypes: true })) {
      if (d.isDirectory()) candidates.push(path.join(outputDir, d.name, 'qa.json'));
    }
  } catch (e) {
    /* no output directory — fall through and return null */
  }
  for (const file of candidates) {
    try {
      const msgs = JSON.parse(fs.readFileSync(file, 'utf8')).messages || [];
      if (msgs.length) return { file, msgs };
    } catch (e) {
      /* unreadable or unparseable — try the next candidate */
    }
  }
  return null;
}

const LEVEL_BY_KEYWORD = {
  FATAL: 'error',
  ERROR: 'error',
  WARNING: 'warning',
  INFORMATION: 'information',
};

/**
 * Parse the publisher's plain-text validation report.
 *
 * fhir2.base.template leaves qa.json with an empty `messages` array and writes
 * the detail to qa.txt instead, in the shape:
 *
 *     == fsh-generated/resources/Patient-Example.json ==
 *     WARNING: Patient/Example: Patient.identifier[0].system: Ingen definition ...
 *     ERROR: sv/downloads.html#... at Line 212, column 8: The link '...' cannot be resolved
 *
 * @returns {{file:string, msgs:Array}|null}
 */
function findQaText(outputDir = OUTPUT_DIR) {
  const candidates = [path.join(outputDir, 'qa.txt')];
  try {
    for (const d of fs.readdirSync(outputDir, { withFileTypes: true })) {
      if (d.isDirectory()) candidates.push(path.join(outputDir, d.name, 'qa.txt'));
    }
  } catch (e) {
    /* no output directory */
  }

  for (const file of candidates) {
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch (e) {
      continue;
    }
    const msgs = [];
    for (const line of text.split(/\r?\n/)) {
      const m = /^(FATAL|ERROR|WARNING|INFORMATION):\s*(.*)$/.exec(line.trim());
      if (!m) continue;
      const level = LEVEL_BY_KEYWORD[m[1]];
      const rest = m[2];
      // Most lines read "location: message". Only treat the head as a location
      // when it is short enough to plausibly be one, so long prose stays intact.
      const split = rest.indexOf(': ');
      let location = null;
      let message = rest;
      if (split > 0 && split <= 160) {
        location = rest.slice(0, split);
        message = rest.slice(split + 2);
      }
      msgs.push({ level, location, message });
    }
    if (msgs.length) return { file, msgs };
  }
  return null;
}

/**
 * Detail source for the issue table: qa.txt first (what the current publisher
 * writes), falling back to qa.json for older templates.
 */
function findDetail(outputDir = OUTPUT_DIR) {
  return findQaText(outputDir) || findQa(outputDir);
}

function toRow(m) {
  const icon = m.level === 'error' ? '🔴' : '🟡';
  const msg = (m.message || '').replace(/\|/g, '\\|').substring(0, 150);
  const loc = m.location ? `\`${m.location}\`` : '-';
  return `| ${icon} | ${loc} | ${msg} |`;
}

/**
 * Build the comment body.
 *
 * Exported separately from the posting logic so it can be unit-tested against
 * fixture directories without touching the GitHub API.
 */
function buildBody({ counts, qa, buildFailed, sha }) {
  const notes = [];
  let rows = [];

  if (qa) {
    const relevant = qa.msgs.filter((m) => m.level === 'error' || m.level === 'warning');
    rows = relevant.slice(0, MAX_ROWS).map(toRow);
    // Cross-check detail against the headline so a future layout change
    // surfaces as a visible note rather than a silent undercount.
    //
    // The two sources count differently: the summary line reports broken links
    // in their own column, while qa.txt writes each one as an ERROR line. So
    // the detail may legitimately exceed errors+warnings by up to the number of
    // broken links. Anything below that floor means messages went missing,
    // which is the direction that actually misleads.
    if (counts) {
      const floor = counts.errors + counts.warnings;
      const ceiling = floor + (counts.broken || 0);
      if (relevant.length < floor || relevant.length > ceiling) {
        notes.push(
          `⚠️ \`${qa.file}\` lists ${relevant.length} error/warning message(s), but the build reported ${floor}${ceiling !== floor ? `–${ceiling}` : ''}. Details below may be incomplete.`
        );
      }
    }
  } else {
    notes.push(
      '⚠️ No `qa.txt` or `qa.json` with messages found under `output/` — details unavailable. Counts below come from the build log.'
    );
  }

  if (!counts) {
    notes.push('⚠️ Could not read the summary line from `build.log` — counts unknown.');
  }

  const n = (v) => (v === null || v === undefined ? '?' : v);
  // Broken links count as red: the publisher lists them as ERROR lines, so a
  // yellow heading above a table of red rows would contradict itself.
  const failing = counts ? counts.errors + (counts.broken || 0) : 0;
  const icon = buildFailed || !counts
    ? '❌'
    : failing > 0
      ? '🔴'
      : counts.warnings > 0
        ? '🟡'
        : '✅';

  const lines = [
    `## ${icon} IG Publisher QA`,
    '',
    buildFailed ? '> ❌ **Build failed** — see workflow logs for details.' : '',
    ...notes,
    '',
    '| | Count |',
    '|---|---|',
    `| 🔴 Errors | **${n(counts && counts.errors)}** |`,
    `| 🟡 Warnings | ${n(counts && counts.warnings)} |`,
    `| 💡 Hints | ${n(counts && counts.hints)} |`,
  ];

  if (counts && counts.broken !== null) {
    lines.push(`| 🔗 Broken links | ${counts.broken} |`);
  }

  if (rows.length) {
    lines.push('', '### Issues', '', '| | Location | Message |', '|---|---|---|', ...rows);
  }

  if (qa && qa.msgs.filter((m) => m.level === 'error' || m.level === 'warning').length > MAX_ROWS) {
    lines.push('', `<sub>Showing the first ${MAX_ROWS} issues.</sub>`);
  }

  lines.push('', `<sub>Commit ${sha.substring(0, 7)}</sub>`);
  return lines.join('\n');
}

/** Entry point used by actions/github-script. */
async function run({ github, context }) {
  const body = buildBody({
    counts: readCounts(),
    qa: findDetail(),
    buildFailed: process.env.BUILD_OUTCOME === 'failure',
    sha: context.payload.pull_request.head.sha,
  });

  const { data: comments } = await github.rest.issues.listComments({
    owner: context.repo.owner,
    repo: context.repo.repo,
    issue_number: context.issue.number,
  });
  const existing = comments.find(
    (c) => c.user.type === 'Bot' && c.body.includes('IG Publisher QA')
  );

  if (existing) {
    await github.rest.issues.updateComment({
      owner: context.repo.owner,
      repo: context.repo.repo,
      comment_id: existing.id,
      body,
    });
  } else {
    await github.rest.issues.createComment({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: context.issue.number,
      body,
    });
  }
}

module.exports = run;
module.exports.buildBody = buildBody;
module.exports.readCounts = readCounts;
module.exports.findQa = findQa;
module.exports.findQaText = findQaText;
module.exports.findDetail = findDetail;
