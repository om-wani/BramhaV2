/**
 * Web search for the retrieve node — returns results shaped as KnowledgeChunk
 * so they flow through the same <untrusted_context> wrapper + citation path as
 * document RAG (filename = source domain, cite as [Source: domain #n]).
 *
 * Backend selection:
 *   - SEARXNG_URL set → self-hosted SearXNG JSON API (open-source, free forever)
 *   - otherwise      → DuckDuckGo (no key, no host) as a zero-config fallback
 *
 * Never throws — a failed search returns [] so the turn continues.
 */

import { search as ddgSearch, SafeSearchType } from 'duck-duck-scrape';
import type { KnowledgeChunk } from '@bramha/shared';

interface RawResult {
  title: string;
  url: string;
  snippet: string;
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url.slice(0, 40);
  }
}

async function searxng(base: string, query: string, k: number): Promise<RawResult[]> {
  const u = `${base.replace(/\/$/, '')}/search?q=${encodeURIComponent(query)}&format=json`;
  const res = await fetch(u, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`searxng ${res.status}`);
  const data = (await res.json()) as { results?: Array<{ title?: string; url?: string; content?: string }> };
  return (data.results ?? [])
    .slice(0, k)
    .map((r) => ({ title: r.title ?? '', url: r.url ?? '', snippet: r.content ?? '' }));
}

async function duckduckgo(query: string, k: number): Promise<RawResult[]> {
  const out = await ddgSearch(query, { safeSearch: SafeSearchType.MODERATE });
  return (out.results ?? [])
    .slice(0, k)
    .map((r) => ({ title: r.title ?? '', url: r.url ?? '', snippet: r.description ?? '' }));
}

/** Search the web; returns KnowledgeChunk-shaped results (empty on any error). */
export async function webSearch(query: string, k = 4): Promise<KnowledgeChunk[]> {
  const searxUrl = process.env['SEARXNG_URL'];
  try {
    const raw = searxUrl ? await searxng(searxUrl, query, k) : await duckduckgo(query, k);
    return raw
      .filter((r) => r.url)
      .map((r, i) => ({
        id: `web-${i}`,
        fileId: 'web',
        chunkIndex: i + 1,
        filename: hostname(r.url),
        content: `${r.title}\n${r.snippet}\nURL: ${r.url}`.trim(),
        score: 1 - i * 0.05,
      }));
  } catch {
    return [];
  }
}
