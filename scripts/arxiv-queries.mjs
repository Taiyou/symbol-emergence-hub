/**
 * arXiv search queries used by scripts/fetch-arxiv.mjs.
 *
 * Each entry becomes one arXiv API call. Keep them focused — the script
 * de-duplicates across all queries by arXiv ID, so overlap is fine.
 *
 * Query syntax (arXiv API):
 *   ti:"..."   → title contains
 *   abs:"..."  → abstract contains
 *   all:"..."  → any field
 *   au:"..."   → author
 *   cat:cs.AI  → category
 *   AND / OR / ANDNOT / parentheses for grouping
 *
 * Docs: https://info.arxiv.org/help/api/user-manual.html#query_details
 *
 * EDIT THIS FILE to add / remove / refine search terms.
 * Commit changes — the GitHub Actions cron will pick them up automatically.
 */

/**
 * Each entry pairs an arXiv API query with a human-readable topic label
 * (ja/en) shown on the Papers page. Queries sharing a label are displayed
 * as one topic.
 */
export const ARXIV_QUERY_DEFS = [
  // Core CPC terminology
  {
    label: { ja: '集合的予測符号化（CPC）', en: 'Collective predictive coding (CPC)' },
    query: 'ti:"collective predictive coding" OR abs:"collective predictive coding"',
  },
  {
    label: { ja: 'CPC 仮説', en: 'CPC hypothesis' },
    query: 'ti:"CPC hypothesis" OR abs:"CPC hypothesis"',
  },

  // Symbol emergence
  {
    label: { ja: '記号創発', en: 'Symbol emergence' },
    query: 'ti:"symbol emergence" OR abs:"symbol emergence"',
  },
  {
    label: { ja: '記号創発', en: 'Symbol emergence' },
    query: 'ti:"記号創発" OR abs:"記号創発"',
  },

  // MHNG / naming game
  {
    label: {
      ja: 'メトロポリス・ヘイスティングス命名ゲーム（MHNG）',
      en: 'Metropolis–Hastings naming game (MHNG)',
    },
    query: 'ti:"Metropolis-Hastings naming game" OR abs:"Metropolis-Hastings naming game"',
  },
  {
    label: {
      ja: 'メトロポリス・ヘイスティングス命名ゲーム（MHNG）',
      en: 'Metropolis–Hastings naming game (MHNG)',
    },
    query: 'ti:"MHNG" AND (abs:"naming game" OR abs:"symbol emergence")',
  },

  // Active inference + language / emergence
  {
    label: { ja: '能動的推論 × 言語創発', en: 'Active inference × language emergence' },
    query:
      '(ti:"active inference" OR abs:"active inference") AND (abs:"language emergence" OR abs:"symbol emergence" OR abs:"naming game")',
  },

  // Emergent communication (filtered to multi-agent)
  {
    label: {
      ja: '創発コミュニケーション（マルチエージェント）',
      en: 'Emergent communication (multi-agent)',
    },
    query:
      '(ti:"emergent communication" OR abs:"emergent communication") AND (abs:"multi-agent" OR abs:"reinforcement learning" OR abs:"language emergence")',
  },

  // World models + multi-agent
  {
    label: { ja: '世界モデル × マルチエージェント', en: 'World models × multi-agent' },
    query:
      '(ti:"world model" OR abs:"world model") AND (abs:"multi-agent" OR abs:"decentralized" OR abs:"collective")',
  },
];

export const ARXIV_QUERIES = ARXIV_QUERY_DEFS.map((d) => d.query);

/**
 * Filter results by these arXiv categories (whitelist).
 * Empty array = no category filter.
 */
export const ARXIV_CATEGORIES = [
  'cs.AI',
  'cs.CL',
  'cs.LG',
  'cs.MA',  // multi-agent systems
  'cs.NE',
  'cs.RO',
  'q-bio.NC',
  'stat.ML',
];

/**
 * How far back to look for *new* entries on each run (days).
 * Anything older is ignored even if it matches a query.
 * Set generously for the initial backfill, then lower for the daily cron.
 */
export const LOOKBACK_DAYS = 14;

/**
 * Maximum results to request per query (arXiv API max is 2000).
 * 50 is plenty for daily runs.
 */
export const MAX_RESULTS_PER_QUERY = 50;
