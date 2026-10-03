#!/usr/bin/env node
/**
 * Repository-wide guard against the names of the third-party coding-assistant
 * tooling the owner has ruled out of this repository, its vendor, and the
 * vendor's four model families (decision of 2026-10-03, see the ledger).
 *
 * Fails when any of them appears, case-insensitively, in any tracked path, in
 * the content of any tracked file (binary files included), in any commit
 * message, author or committer reachable from HEAD, or in the branch name CI
 * is running for. The tool and vendor names match as substrings; the model
 * families match as whole words only, so ordinary prose ("fabled", "sonnets")
 * passes. All terms are assembled from fragments so that this file never
 * contains them itself; a self-test below proves the assembled pattern before
 * anything is scanned.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const TERMS = ['cl' + 'aude', 'anthr' + 'opic'];
const MODEL_FAMILIES = ['son' + 'net', 'op' + 'us', 'hai' + 'ku', 'fa' + 'ble'];
const PATTERN = new RegExp(`${TERMS.join('|')}|\\b(?:${MODEL_FAMILIES.join('|')})\\b`, 'i');

const selfTest = [
  String.fromCharCode(67, 108, 97, 117, 100, 101),
  String.fromCharCode(65, 78, 84, 72, 82, 79, 80, 73, 67),
  'x.' + TERMS[0] + '.ai/path',
  'model: ' + String.fromCharCode(83, 111, 110, 110, 101, 116),
  'model: ' + String.fromCharCode(102, 97, 98, 108, 101),
];
for (const sample of selfTest) {
  if (!PATTERN.test(sample)) {
    console.error('forbidden-terms: self-test failed, the pattern does not match its own samples');
    process.exit(2);
  }
}
if (PATTERN.test('clause anthropology fabled opuses haikus sonnets')) {
  console.error('forbidden-terms: self-test failed, the pattern matches unrelated words');
  process.exit(2);
}

function git(args, options = {}) {
  return execFileSync('git', args, { encoding: options.encoding ?? 'utf8', maxBuffer: 1 << 28 });
}

const failures = [];

const trackedPaths = git(['ls-files', '-z']).split('\0').filter(Boolean);

for (const path of trackedPaths) {
  if (PATTERN.test(path)) failures.push(`path: ${path}`);
}

for (const path of trackedPaths) {
  let buffer;
  try {
    buffer = readFileSync(path);
  } catch {
    continue; // a tracked path that is a directory entry (submodule) or was removed in the worktree
  }
  const text = buffer.toString('latin1');
  if (!PATTERN.test(text)) continue;
  const lines = text.split('\n');
  lines.forEach((line, index) => {
    if (PATTERN.test(line)) failures.push(`${path}:${index + 1}: ${line.trim().slice(0, 160)}`);
  });
}

const SEP = '\u001e';
const history = git(['log', 'HEAD', `--format=%H${SEP}%an <%ae>${SEP}%cn <%ce>${SEP}%B${SEP}`]);
for (const record of history.split(`${SEP}\n`)) {
  const [sha, author, committer, body] = record.split(SEP);
  if (!sha) continue;
  if (author && PATTERN.test(author)) failures.push(`commit ${sha.slice(0, 7)} author: ${author}`);
  if (committer && PATTERN.test(committer))
    failures.push(`commit ${sha.slice(0, 7)} committer: ${committer}`);
  if (body && PATTERN.test(body)) {
    for (const line of body.split('\n')) {
      if (PATTERN.test(line))
        failures.push(`commit ${sha.slice(0, 7)} message: ${line.trim().slice(0, 160)}`);
    }
  }
}

for (const name of [process.env.GITHUB_HEAD_REF, process.env.GITHUB_REF_NAME]) {
  if (name && PATTERN.test(name)) failures.push(`branch: ${name}`);
}

if (failures.length > 0) {
  console.error(`forbidden-terms: ${failures.length} occurrence(s) of a ruled-out name:`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}

console.log(
  `forbidden-terms: clean (${trackedPaths.length} tracked files, ${history.split(`${SEP}\n`).filter(Boolean).length} commits)`,
);
