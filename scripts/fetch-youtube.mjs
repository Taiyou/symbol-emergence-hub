#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUTPUT = resolve(ROOT, 'src/data/videos.json');
const ENV_FILE = resolve(ROOT, '.env');

const QUERIES = [
  '記号創発システム論',
  'Collective Predictive Coding',
  '集合的予測符号化',
  '記号創発',
  'CPC仮説',
];
const PER_QUERY = 25;
const TOP_N = 10;

function loadEnv() {
  if (!existsSync(ENV_FILE)) return;
  const raw = readFileSync(ENV_FILE, 'utf8');
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (!m) continue;
    if (process.env[m[1]] === undefined) {
      let value = m[2];
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[m[1]] = value;
    }
  }
}

async function searchOne(apiKey, query) {
  const params = new URLSearchParams({
    part: 'snippet',
    q: query,
    type: 'video',
    order: 'date',
    maxResults: String(PER_QUERY),
    // Bias toward Japanese results so CI (US-region runners) surfaces the
    // same videos as a JP client; without this, JP-only videos are dropped.
    relevanceLanguage: 'ja',
    key: apiKey,
  });
  const url = `https://www.googleapis.com/youtube/v3/search?${params}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `YouTube API ${res.status} for query "${query}": ${body.slice(0, 400)}`,
    );
  }
  const data = await res.json();
  return (data.items ?? []).map((item) => ({
    videoId: item.id.videoId,
    title: item.snippet.title,
    description: item.snippet.description ?? '',
    channelTitle: item.snippet.channelTitle,
    channelId: item.snippet.channelId,
    publishedAt: item.snippet.publishedAt,
    thumbnail:
      item.snippet.thumbnails?.medium?.url ??
      item.snippet.thumbnails?.default?.url ??
      null,
    matchedQuery: query,
  }));
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

async function main() {
  loadEnv();
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    console.error(
      'YOUTUBE_API_KEY not set. Add it to .env or export it before running.',
    );
    process.exit(1);
  }

  const all = [];
  for (const q of QUERIES) {
    try {
      const items = await searchOne(apiKey, q);
      console.log(`  "${q}" → ${items.length} items`);
      all.push(...items);
    } catch (err) {
      console.error(`  "${q}" failed: ${err.message}`);
    }
  }

  const byId = new Map();
  for (const v of all) {
    if (!v.videoId) continue;
    const existing = byId.get(v.videoId);
    if (!existing) {
      byId.set(v.videoId, { ...v, matchedQueries: [v.matchedQuery] });
    } else if (!existing.matchedQueries.includes(v.matchedQuery)) {
      existing.matchedQueries.push(v.matchedQuery);
    }
  }

  const merged = [...byId.values()]
    .map(({ matchedQuery, ...rest }) => ({
      ...rest,
      title: decodeEntities(rest.title),
      description: decodeEntities(rest.description),
    }))
    .sort((a, b) => +new Date(b.publishedAt) - +new Date(a.publishedAt))
    .slice(0, TOP_N);

  const payload = {
    fetchedAt: new Date().toISOString(),
    queries: QUERIES,
    items: merged,
  };

  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  console.log(`Wrote ${merged.length} videos → ${OUTPUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
