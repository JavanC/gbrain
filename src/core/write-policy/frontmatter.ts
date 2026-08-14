// Fork-owned frontmatter split/join for the write-policy validator.
//
// Mirrors the subset of gray-matter the validator relied on (parse a leading
// `---` YAML block; re-serialize data + body) on top of js-yaml, which upstream
// already depends on — so the fork carries no extra package.json / bun.lock row.

import { load, dump } from 'js-yaml';

const FENCE = /^﻿?---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/;

export interface SplitFrontmatter {
  data: Record<string, unknown>;
  /** Everything after the closing fence (or the whole input when there is none). */
  content: string;
}

/** Throws on malformed YAML inside a present fence, like gray-matter did. */
export function splitFrontmatter(input: string): SplitFrontmatter {
  const m = FENCE.exec(input);
  if (!m) return { data: {}, content: input };
  const raw = m[1] ?? '';
  const doc = raw.trim() === '' ? {} : load(raw);
  const data = doc && typeof doc === 'object' && !Array.isArray(doc) ? { ...(doc as Record<string, unknown>) } : {};
  return { data, content: input.slice(m[0].length) };
}

function withNewline(s: string): string {
  return s.endsWith('\n') ? s : `${s}\n`;
}

/** `---\n<yaml>---\n<body>` — the shape gray-matter's stringify produced. */
export function joinFrontmatter(body: string, data: Record<string, unknown>): string {
  const yaml = dump(data).trim();
  const head = yaml === '{}' ? '' : `---\n${withNewline(yaml)}---\n`;
  return head + withNewline(body);
}
