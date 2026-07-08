#!/usr/bin/env node
/**
 * sync-directory-from-notion.mjs
 *
 * Pulls Status="approved" rows from the Notion "CPC Lab Submissions" and
 * "CPC Event Submissions" databases and materializes them as markdown files
 * in content/labs/ and content/events/.
 *
 * - Frontmatter matches src/content/config.ts (labs / events schemas)
 * - Filename: <slug>-<short-page-id>.md (stable across runs)
 * - Removes local files whose source row was deleted / un-approved —
 *   but ONLY files carrying the notion_synced: true marker; hand-curated
 *   entries are never touched (same safety rule as sync-papers).
 *
 * Env vars:
 *   NOTION_TOKEN
 *   NOTION_LABS_DB_ID
 *   NOTION_EVENTS_DB_ID
 *
 * Usage:
 *   npm run sync:directory
 */

import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@notionhq/client';

// --- minimal .env loader (mirrors scripts/fetch-youtube.mjs) ---
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const ENV_FILE = join(REPO_ROOT, '.env');
function loadEnv() {
  if (!existsSync(ENV_FILE)) return;
  const raw = readFileSync(ENV_FILE, 'utf8');
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (!m) continue;
    if (process.env[m[1]] === undefined) {
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      process.env[m[1]] = v;
    }
  }
}
loadEnv();

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const LABS_DB_ID = process.env.NOTION_LABS_DB_ID;
const EVENTS_DB_ID = process.env.NOTION_EVENTS_DB_ID;

if (!NOTION_TOKEN || !LABS_DB_ID || !EVENTS_DB_ID) {
  console.error(
    'Missing NOTION_TOKEN, NOTION_LABS_DB_ID or NOTION_EVENTS_DB_ID in environment.',
  );
  process.exit(1);
}

const notion = new Client({ auth: NOTION_TOKEN });

// Must match the enums in src/content/config.ts
const VALID_EVENT_TYPES = new Set(['Workshop', 'Conference', 'Seminar', 'Reading group']);
const VALID_LANGUAGES = new Set(['EN', 'JA', 'Mixed']);

// ---------- helpers (mirror sync-papers-from-notion.mjs) ----------

function slugify(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

function plain(prop) {
  if (!prop) return '';
  if (prop.type === 'title') return prop.title.map((t) => t.plain_text).join('').trim();
  if (prop.type === 'rich_text') return prop.rich_text.map((t) => t.plain_text).join('').trim();
  if (prop.type === 'url') return prop.url || '';
  if (prop.type === 'email') return prop.email || '';
  if (prop.type === 'select') return prop.select?.name ?? '';
  if (prop.type === 'multi_select') return prop.multi_select.map((o) => o.name);
  if (prop.type === 'date') return prop.date?.start || '';
  return '';
}

/** YAML-escape a single-line string for frontmatter scalars. */
function yamlString(s) {
  if (s == null) return '""';
  const str = String(s);
  const looksNumeric = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(str);
  const looksSpecial = /^(true|false|yes|no|on|off|null|~|\.inf|\.nan)$/i.test(str);
  const hasStructural = /[:\-#&*!|>'"%@`{}\[\],\n]/.test(str);
  const hasEdgeWS = str.trim() !== str;
  if (str === '' || looksNumeric || looksSpecial || hasStructural || hasEdgeWS) {
    return JSON.stringify(str);
  }
  return str;
}

/** Render a multiline block as YAML literal `|` scalar. */
function yamlBlock(s) {
  const text = String(s ?? '').trim();
  if (!text) return '""';
  const indented = text.split(/\r?\n/).map((l) => `  ${l}`).join('\n');
  return `|\n${indented}`;
}

function shortId(pageId) {
  return pageId.replace(/-/g, '').slice(0, 8);
}

// ---------- labs ----------

function extractLab(page) {
  const p = page.properties;
  const name_en = plain(p['Lab Name (EN)']);
  const homepage = plain(p.Homepage);
  const focus = plain(p['Focus Areas']) || [];
  if (!name_en || !homepage || focus.length === 0) return null;
  return {
    id: page.id,
    name_en,
    name_ja: plain(p['Lab Name (JA)']) || undefined,
    pi: plain(p.PI) || 'Unknown',
    institution: plain(p.Institution) || 'Unknown',
    country: plain(p.Country) || 'Unknown',
    homepage,
    description_en: plain(p['Description (EN)']) || name_en,
    description_ja: plain(p['Description (JA)']) || undefined,
    focus_areas: focus,
    date_added: plain(p['Date Added']) || new Date().toISOString().slice(0, 10),
  };
}

function renderLab(l) {
  const lines = ['---'];
  lines.push(`name_en: ${yamlString(l.name_en)}`);
  if (l.name_ja) lines.push(`name_ja: ${yamlString(l.name_ja)}`);
  lines.push(`pi: ${yamlString(l.pi)}`);
  lines.push(`institution: ${yamlString(l.institution)}`);
  lines.push(`country: ${yamlString(l.country)}`);
  lines.push(`homepage: ${yamlString(l.homepage)}`);
  lines.push(`description_en: ${yamlBlock(l.description_en)}`);
  if (l.description_ja) lines.push(`description_ja: ${yamlBlock(l.description_ja)}`);
  lines.push('focus_areas:');
  for (const a of l.focus_areas) lines.push(`  - ${yamlString(a)}`);
  lines.push(`date_added: ${l.date_added}`);
  lines.push('notion_synced: true');
  lines.push('---');
  lines.push('');
  return lines.join('\n');
}

// ---------- events ----------

function extractEvent(page) {
  const p = page.properties;
  const title_en = plain(p['Title (EN)']);
  const url = plain(p.URL);
  const type = plain(p.Type);
  const language = plain(p.Language);
  const date_start = plain(p['Date Start']);
  const date_end = plain(p['Date End']);
  if (!title_en || !url || !date_start || !date_end) return null;
  if (!VALID_EVENT_TYPES.has(type) || !VALID_LANGUAGES.has(language)) return null;
  return {
    id: page.id,
    title_en,
    title_ja: plain(p['Title (JA)']) || undefined,
    type,
    date_start,
    date_end,
    language,
    location: plain(p.Location) || 'Online',
    url,
    description_en: plain(p['Description (EN)']) || title_en,
    description_ja: plain(p['Description (JA)']) || undefined,
    date_added: plain(p['Date Added']) || new Date().toISOString().slice(0, 10),
  };
}

function renderEvent(e) {
  const lines = ['---'];
  lines.push(`title_en: ${yamlString(e.title_en)}`);
  if (e.title_ja) lines.push(`title_ja: ${yamlString(e.title_ja)}`);
  lines.push(`type: ${yamlString(e.type)}`);
  lines.push(`date_start: ${e.date_start}`);
  lines.push(`date_end: ${e.date_end}`);
  lines.push(`language: ${e.language}`);
  lines.push(`location: ${yamlString(e.location)}`);
  lines.push(`url: ${yamlString(e.url)}`);
  lines.push(`description_en: ${yamlBlock(e.description_en)}`);
  if (e.description_ja) lines.push(`description_ja: ${yamlBlock(e.description_ja)}`);
  lines.push(`date_added: ${e.date_added}`);
  lines.push('notion_synced: true');
  lines.push('---');
  lines.push('');
  return lines.join('\n');
}

// ---------- generic sync ----------

async function fetchApproved(dbId) {
  const out = [];
  let cursor;
  do {
    const res = await notion.databases.query({
      database_id: dbId,
      start_cursor: cursor,
      page_size: 100,
      filter: { property: 'Status', select: { equals: 'approved' } },
    });
    out.push(...res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return out;
}

async function syncKind({ label, dbId, dir, extract, render, nameOf }) {
  await mkdir(dir, { recursive: true });
  console.log(`[sync] ${label}: querying Notion for approved rows…`);
  const pages = await fetchApproved(dbId);

  const desiredFiles = new Set();
  let written = 0;
  let unchanged = 0;
  let skipped = 0;

  for (const page of pages) {
    const item = extract(page);
    if (!item) {
      console.warn(`  ! skipping ${page.id} — missing/invalid required fields`);
      skipped++;
      continue;
    }
    const filename = `${slugify(nameOf(item)) || label}-${shortId(item.id)}.md`;
    desiredFiles.add(filename);
    const fullPath = join(dir, filename);
    const content = render(item);

    const prev = await readFile(fullPath, 'utf8').catch(() => null);
    if (prev === content) {
      unchanged++;
      continue;
    }
    await writeFile(fullPath, content, 'utf8');
    console.log(`  ~ ${filename}`);
    written++;
  }

  // Prune files no longer approved — only ones this script wrote (marker).
  const existing = await readdir(dir);
  let removed = 0;
  for (const f of existing) {
    if (!f.endsWith('.md')) continue;
    if (desiredFiles.has(f)) continue;
    const full = join(dir, f);
    const body = await readFile(full, 'utf8').catch(() => '');
    const fm = body.match(/^---\n([\s\S]*?)\n---/);
    const isSynced = fm ? /^\s*notion_synced:\s*true\s*$/m.test(fm[1]) : false;
    if (!isSynced) continue;
    await unlink(full);
    console.log(`  - removed (no longer approved): ${f}`);
    removed++;
  }

  console.log(
    `[sync] ${label}: written=${written} unchanged=${unchanged} skipped=${skipped} removed=${removed}`,
  );
}

async function main() {
  await syncKind({
    label: 'labs',
    dbId: LABS_DB_ID,
    dir: join(REPO_ROOT, 'content', 'labs'),
    extract: extractLab,
    render: renderLab,
    nameOf: (l) => l.name_en,
  });
  await syncKind({
    label: 'events',
    dbId: EVENTS_DB_ID,
    dir: join(REPO_ROOT, 'content', 'events'),
    extract: extractEvent,
    render: renderEvent,
    nameOf: (e) => e.title_en,
  });
  console.log('[sync] done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
