/**
 * Parity between a brain repo's staged-page lint and the MCP write gate.
 *
 * The gate only earns its keep if a page it accepts is a page the repo will
 * commit. Two halves:
 *
 *   1. RULE TABLE — the directory→type map, required fields, and connection
 *      rules the repo lint enforces are asserted equal to what the shipped
 *      policy fixture declares. A change on either side fails here instead of
 *      silently reopening the gap that stalled a commit backlog.
 *   2. VERDICTS — a table of pages, each labeled with the repo lint's verdict,
 *      run through the gate.
 *
 * ONE DELIBERATE DIVERGENCE, pinned at the bottom: connection resolvability.
 * The lint sees the whole tree at commit time; the gate sees one page mid-write
 * and cannot know a referenced page is about to be created. The gate warns, the
 * lint decides.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveWritePolicyFromYaml } from '../src/core/write-policy/load.ts';
import { validatePageAgainstPolicy } from '../src/core/write-policy/validate.ts';
import type { WritePolicyV1 } from '../src/core/write-policy/policy-v1.ts';

/**
 * The repo lint's rule table, transcribed from a brain repo's
 * `scripts/lint-staged-brain-pages.js`. This is the authority side of the
 * parity check — update it only when that lint changes.
 */
const LINT_REQUIRED_FIELDS = ['title', 'type', 'tags', 'created'];
const LINT_NON_EMPTY_LIST_FIELDS = ['tags'];
const LINT_DIR_ALLOWED_TYPES: Record<string, string[] | 'any'> = {
  'concepts/': [
    'concept', 'pattern', 'principle', 'insight', 'technique', 'pain-point',
    'market-gap', 'capability', 'architecture', 'architectural-pattern',
    'case-study', 'resource', 'trend', 'tool', 'tool-pattern', 'research', 'idea',
    'reference', 'experience', 'preference',
  ],
  'people/': ['person'],
  'companies/': ['company'],
  'projects/': ['project'],
  'writing/': ['structure-note', 'essay', 'synthesis'],
  'meetings/': ['meeting'],
  'sources/': ['source'],
  'inbox/': 'any',
  'archive/': 'any',
};

const POLICY: WritePolicyV1 = (() => {
  const path = join(import.meta.dir, 'fixtures/write-policy/knowledge-brain.gbrain.yml');
  const res = resolveWritePolicyFromYaml(readFileSync(path, 'utf-8'), path);
  if (res.status !== 'active') throw new Error(`fixture policy is not active: ${JSON.stringify(res)}`);
  return res.policy;
})();

const NOW = new Date('2026-08-13T17:30:00Z');

async function verdict(slug: string, content: string, known: string[] = []) {
  const res = await validatePageAgainstPolicy({
    policy: POLICY,
    slug,
    content,
    existingFrontmatter: null,
    now: NOW,
    resolveKnownSlugs: async (ids) => new Set(ids.filter((id) => known.includes(id))),
  });
  return res;
}

describe('rule table parity with the repo lint', () => {
  test('required fields match', () => {
    expect([...POLICY.required_fields].sort()).toEqual([...LINT_REQUIRED_FIELDS].sort());
  });

  test('non-empty list fields match', () => {
    expect([...POLICY.non_empty_list_fields].sort()).toEqual([...LINT_NON_EMPTY_LIST_FIELDS].sort());
  });

  test('every linted directory has a policy rule, and no extras', () => {
    const policyPrefixes = POLICY.type_path_rules.map((r) => r.prefix).sort();
    expect(policyPrefixes).toEqual(Object.keys(LINT_DIR_ALLOWED_TYPES).sort());
  });

  test('each directory allows exactly the types the lint allows', () => {
    for (const rule of POLICY.type_path_rules) {
      const expected = LINT_DIR_ALLOWED_TYPES[rule.prefix];
      if (expected === 'any') {
        expect(rule.types).toBe('any');
        continue;
      }
      expect(rule.types).not.toBe('any');
      expect([...(rule.types as string[])].sort()).toEqual([...expected].sort());
    }
  });

  test('connection id rules match the lint (slug-only, kebab-case)', () => {
    expect(POLICY.connection_rules.id_style).toBe('slug_only');
    expect(POLICY.connection_rules.slug_pattern).toBe('kebab');
  });

  test('the server supplies `created`, so the lint\'s hardest requirement cannot be missed', () => {
    const created = POLICY.server_managed.find((f) => f.field === 'created');
    expect(created).toMatchObject({ mode: 'set_on_create_preserve_on_update', value: 'date' });
    expect(LINT_REQUIRED_FIELDS).toContain('created');
  });
});

describe('verdict parity', () => {
  const ACCEPTED: Array<[label: string, slug: string, content: string]> = [
    [
      'a well-formed concept',
      'concepts/a-thing',
      '---\ntitle: A Thing\ntype: concept\ntags:\n  - topic\n---\n\nBody.\n',
    ],
    [
      'a person page',
      'people/a-founder',
      '---\ntitle: A Founder\ntype: person\ntags: [network]\n---\n\nBody.\n',
    ],
    [
      'an inbox page with an unpromoted type',
      'inbox/unsorted-thought',
      '---\ntitle: Unsorted\ntype: whatever\ntags: [raw]\n---\n\nBody.\n',
    ],
    [
      'an archived page keeping its historical type',
      'archive/old-note',
      '---\ntitle: Old\ntype: legacy-card\ntags: [history]\n---\n\nBody.\n',
    ],
    [
      'slug-only kebab connections',
      'concepts/connected',
      '---\ntitle: C\ntype: concept\ntags: [t]\nconnections:\n  - id: a-thing\n    why: related\n---\n\nBody.\n',
    ],
  ];

  const REJECTED: Array<[label: string, slug: string, content: string, code: string]> = [
    [
      'missing title',
      'concepts/no-title',
      '---\ntype: concept\ntags: [t]\n---\n\nBody.\n',
      'missing_required_field',
    ],
    [
      'missing type',
      'concepts/no-type',
      '---\ntitle: T\ntags: [t]\n---\n\nBody.\n',
      'missing_required_field',
    ],
    [
      'empty tags',
      'concepts/no-tags',
      '---\ntitle: T\ntype: concept\ntags: []\n---\n\nBody.\n',
      'missing_required_field',
    ],
    [
      'a type the directory does not allow',
      'people/mistyped',
      '---\ntitle: T\ntype: concept\ntags: [t]\n---\n\nBody.\n',
      'type_not_allowed_in_path',
    ],
    [
      'a path-qualified connection id',
      'concepts/pathful',
      '---\ntitle: T\ntype: concept\ntags: [t]\nconnections:\n  - id: concepts/other\n---\n\nBody.\n',
      'connection_id_not_slug_only',
    ],
    [
      'a non-kebab connection id',
      'concepts/shouty',
      '---\ntitle: T\ntype: concept\ntags: [t]\nconnections:\n  - id: Not_Kebab\n---\n\nBody.\n',
      'connection_id_not_kebab',
    ],
  ];

  for (const [label, slug, content] of ACCEPTED) {
    test(`lint accepts, gate accepts: ${label}`, async () => {
      const res = await verdict(slug, content, ['a-thing']);
      expect(res.violations.filter((v) => v.severity === 'error')).toEqual([]);
      expect(res.valid).toBe(true);
    });
  }

  for (const [label, slug, content, code] of REJECTED) {
    test(`lint rejects, gate rejects: ${label}`, async () => {
      const res = await verdict(slug, content);
      expect(res.valid).toBe(false);
      expect(res.violations.map((v) => String(v.code))).toContain(code);
    });
  }

  test('the case that stalled the backlog: a page with everything BUT `created`', async () => {
    // The repo lint rejects this; the gate accepts it because the server fills
    // the field. That is the fix, not a parity break — the page the gate WRITES
    // is one the lint accepts.
    const res = await verdict(
      'concepts/html-deck-fixed-canvas',
      '---\ntitle: Fixed Canvas\ntype: technique\ntags: [html]\neffective_date: "2026-08-01"\n---\n\nBody.\n',
    );
    expect(res.valid).toBe(true);
    expect(res.normalized_frontmatter.created).toBe('2026-08-14');
    for (const field of LINT_REQUIRED_FIELDS) {
      expect(res.normalized_frontmatter[field]).toBeDefined();
    }
  });
});

describe('scope parity — the lint IGNORES what it does not walk', () => {
  // lint-staged-brain-pages.js iterates KNOWLEDGE_DIRS and `continue`s on
  // everything else. The gate must decline those writes the same way. Getting
  // this wrong (refusing instead of ignoring) would have rejected 17% of a real
  // brain's pages on rewrite — every page under ai-workflow/, evals/, skills/,
  // tools/, plus root-level notes and directory READMEs.
  const OUT_OF_SCOPE = [
    'agents',
    'ai-workflow/loop-engineering-decision-guide',
    'tools/some-tool-note',
    'coralline-statusline-setup',
  ];

  for (const slug of OUT_OF_SCOPE) {
    test(`ignored, not refused: ${slug}`, async () => {
      const res = await verdict(slug, '---\nnothing: useful\n---\n\nBody.\n');
      expect(res.out_of_scope).toBe(true);
      expect(res.valid).toBe(true);
      expect(res.violations).toEqual([]);
    });
  }

  test('directory READMEs are exempt the way the lint skips README.md', async () => {
    const res = await verdict('concepts/README', '# Concepts\n\nIndex of this directory.\n');
    expect(res.out_of_scope).toBe(true);
    expect(res.valid).toBe(true);
  });

  test('the policy declines rather than refuses — require_known_prefix stays off', () => {
    expect(POLICY.slug_rules.scope).toBe('known_prefixes');
    expect(POLICY.slug_rules.require_known_prefix).toBe(false);
  });
});

describe('the one deliberate divergence', () => {
  test('an unresolved connection warns at write time and is left for the commit gate', async () => {
    const res = await verdict(
      'concepts/forward-ref',
      '---\ntitle: T\ntype: concept\ntags: [t]\nconnections:\n  - id: not-yet-written\n---\n\nBody.\n',
      [],
    );
    // The repo lint would reject this at commit time. The gate cannot: page
    // `not-yet-written` may be the caller's very next write.
    expect(res.valid).toBe(true);
    const finding = res.violations.find((v) => v.code === 'connection_unresolved')!;
    expect(finding.severity).toBe('warning');
    expect(finding.fix).toContain('commit time');
    // A source that wants the strict behavior flips one knob.
    expect(POLICY.connection_rules.require_resolvable).toBe('warn');
  });
});
