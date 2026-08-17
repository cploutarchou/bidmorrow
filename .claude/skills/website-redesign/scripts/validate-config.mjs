#!/usr/bin/env node
// Validates .claude/agents/*.md and .claude/skills/*/SKILL.md frontmatter:
// well-formed YAML-ish frontmatter block, required fields present, and (for
// agents) tools drawn from the known tool vocabulary. Dependency-free on
// purpose — runs anywhere `node` runs.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const { console, process } = globalThis;

const root = process.cwd();
const agentsDir = join(root, '.claude', 'agents');
const skillsDir = join(root, '.claude', 'skills');
const problems = [];

function frontmatter(file) {
  const text = readFileSync(file, 'utf8');
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) return null;
  const fields = {};
  for (const line of match[1].split('\n')) {
    const m = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (m) fields[m[1]] = m[2].trim();
  }
  return fields;
}

const KNOWN_TOOLS = new Set([
  'Read',
  'Grep',
  'Glob',
  'Write',
  'Edit',
  'Bash',
  'WebFetch',
  'WebSearch',
  '*',
]);

for (const entry of readdirSync(agentsDir)) {
  if (!entry.endsWith('.md')) continue;
  const file = join(agentsDir, entry);
  const fields = frontmatter(file);
  if (!fields) {
    problems.push(`${entry}: missing or malformed frontmatter block`);
    continue;
  }
  if (!fields.name) problems.push(`${entry}: missing "name"`);
  if (fields.name && fields.name !== entry.replace(/\.md$/, ''))
    problems.push(`${entry}: name "${fields.name}" != filename`);
  if (!fields.description || fields.description.length < 20)
    problems.push(`${entry}: missing/too-short "description"`);
  if (fields.tools) {
    for (const tool of fields.tools.split(',').map((t) => t.trim())) {
      if (!KNOWN_TOOLS.has(tool)) problems.push(`${entry}: unknown tool "${tool}"`);
    }
  }
  if (fields.skills) {
    for (const skill of fields.skills.split(',').map((s) => s.trim())) {
      if (!existsSync(join(skillsDir, skill, 'SKILL.md')))
        problems.push(`${entry}: references missing skill "${skill}"`);
    }
  }
}

for (const entry of readdirSync(skillsDir)) {
  const file = join(skillsDir, entry, 'SKILL.md');
  if (!existsSync(file)) continue;
  const fields = frontmatter(file);
  if (!fields) {
    problems.push(`skills/${entry}: missing or malformed frontmatter`);
    continue;
  }
  if (fields.name !== entry) problems.push(`skills/${entry}: name "${fields.name}" != directory`);
  if (!fields.description || fields.description.length < 20)
    problems.push(`skills/${entry}: missing/too-short "description"`);
}

if (problems.length) {
  console.error(`INVALID (${problems.length}):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
process.stdout.write('All .claude agent and skill files are valid.\n');
