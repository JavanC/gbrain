/**
 * Source write-policy validator + normalizer.
 *
 * This is the single implementation `validate_page` (preflight) and `put_page`
 * (the gate) both run, so these tests are the contract for both surfaces.
 */

import { describe, test, expect } from 'bun:test';
import matter from 'gray-matter';
import { parseWritePolicy, type WritePolicyV1 } from '../src/core/write-policy/policy-v1.ts';
import { validatePageAgainstPolicy } from '../src/core/write-policy/validate.ts';

const POLICY: WritePolicyV1 = parseWritePolicy({
  contract_version: '1',
  required_fields: ['title', 'type', 'tags', 'created'],
  non_empty_list_fields: ['tags'],
  server_managed: {
    created: { mode: 'set_on_create_preserve_on_update', value: 'date', timezone: 'Asia/Taipei' },
  },
  type_path_rules: [
    { prefix: 'concepts/', types: ['concept', 'pattern', 'principle'] },
    { prefix: 'people/', types: ['person'] },
    { prefix: 'inbox/', types: 'any' },
  ],
  connection_rules: { id_style: 'slug_only', slug_pattern: 'kebab', require_resolvable: 'warn' },
  slug_rules: { require_known_prefix: true },
}, 'test')!;

/** 2026-08-13T17:30Z is 2026-08-14 01:30 in Asia/Taipei — pins the zone, not the clock. */
const ACROSS_MIDNIGHT_TPE = new Date('2026-08-13T17:30:00Z');

function page(front: string, body = 'Body.'): string {
  return `---\n${front}\n---\n\n${body}\n`;
}

const GOOD = page('title: A Concept\ntype: concept\ntags:\n  - topic');

function run(content: string, opts: {
  slug?: string;
  existing?: Record<string, unknown> | null;
  now?: Date;
  known?: string[];
} = {}) {
  return validatePageAgainstPolicy({
    policy: POLICY,
    slug: opts.slug ?? 'concepts/a-concept',
    content,
    existingFrontmatter: opts.existing ?? null,
    now: opts.now ?? ACROSS_MIDNIGHT_TPE,
    ...(opts.known
      ? { resolveKnownSlugs: async (ids: string[]) => new Set(ids.filter((id) => opts.known!.includes(id))) }
      : {}),
  });
}

function codes(violations: Array<{ code: string }>): string[] {
  return violations.map((v) => v.code).sort();
}

describe('server-managed fields', () => {
  test('create: `created` is filled in the policy timezone, not UTC', async () => {
    const res = await run(GOOD);
    expect(res.valid).toBe(true);
    expect(res.normalized).toBe(true);
    expect(res.normalized_frontmatter.created).toBe('2026-08-14');
    expect(matter(res.normalized_content).data.created).toBe('2026-08-14');
  });

  test('create: an agent-supplied `created` is left alone', async () => {
    const res = await run(page('title: A\ntype: concept\ntags: [t]\ncreated: "2020-01-01"'));
    expect(res.valid).toBe(true);
    expect(res.normalized).toBe(false);
    expect(res.normalized_content).toContain('2020-01-01');
  });

  test('update: a payload that omits `created` inherits the stored value', async () => {
    const res = await run(GOOD, { existing: { created: '2019-05-05' } });
    expect(res.valid).toBe(true);
    expect(res.is_update).toBe(true);
    expect(res.normalized_frontmatter.created).toBe('2019-05-05');
    // The whole point: a full-content replace can no longer silently drop it.
    expect(matter(res.normalized_content).data.created).toBe('2019-05-05');
  });

  test('update: a payload that CHANGES `created` keeps the stored value and warns', async () => {
    const res = await run(page('title: A\ntype: concept\ntags: [t]\ncreated: "2099-12-31"'), {
      existing: { created: '2019-05-05' },
    });
    expect(res.valid).toBe(true);
    expect(res.normalized_frontmatter.created).toBe('2019-05-05');
    const warn = res.violations.find((v) => v.code === 'server_managed_field_ignored');
    expect(warn?.severity).toBe('warning');
  });

  test('update of a page that never had `created` still gets one filled', async () => {
    const res = await run(GOOD, { existing: { title: 'A' } });
    expect(res.normalized_frontmatter.created).toBe('2026-08-14');
  });

  test('unknown timezone degrades to UTC instead of throwing mid-write', async () => {
    const policy = parseWritePolicy({
      required_fields: ['created'],
      server_managed: { created: { mode: 'set_on_create_preserve_on_update', value: 'date', timezone: 'Mars/Olympus' } },
    }, 'test')!;
    const res = await validatePageAgainstPolicy({
      policy,
      slug: 'x/y',
      content: page('title: A'),
      existingFrontmatter: null,
      now: ACROSS_MIDNIGHT_TPE,
    });
    expect(res.normalized_frontmatter.created).toBe('2026-08-13');
  });

  test('datetime mode writes an ISO timestamp', async () => {
    const policy = parseWritePolicy({
      server_managed: { captured_at: { mode: 'set_on_create_preserve_on_update', value: 'datetime' } },
    }, 'test')!;
    const res = await validatePageAgainstPolicy({
      policy, slug: 'x/y', content: page('title: A'), existingFrontmatter: null, now: ACROSS_MIDNIGHT_TPE,
    });
    expect(res.normalized_frontmatter.captured_at).toBe('2026-08-13T17:30:00.000Z');
  });
});

describe('required fields', () => {
  test('missing title / type / tags are three distinct errors', async () => {
    const res = await run(page('summary: nothing useful'));
    expect(res.valid).toBe(false);
    const missing = res.violations.filter((v) => v.code === 'missing_required_field').map((v) => v.field);
    expect(missing.sort()).toEqual(['tags', 'title', 'type']);
    // `created` is required AND server-managed, so it is never reported missing.
    expect(missing).not.toContain('created');
  });

  test('empty tags list fails the same way a missing one does', async () => {
    const res = await run(page('title: A\ntype: concept\ntags: []'));
    expect(res.valid).toBe(false);
    expect(codes(res.violations)).toContain('missing_required_field');
  });

  test('a scalar in a list-typed field is rejected', async () => {
    const res = await run(page('title: A\ntype: concept\ntags: topic'));
    expect(res.valid).toBe(false);
    expect(codes(res.violations)).toContain('empty_required_list');
  });

  test('whitespace-only title counts as missing', async () => {
    const res = await run(page('title: "   "\ntype: concept\ntags: [t]'));
    expect(res.valid).toBe(false);
    expect(res.violations.some((v) => v.field === 'title')).toBe(true);
  });

  test('every error carries a machine-readable code and an agent-actionable fix', async () => {
    const res = await run(page('summary: nothing'));
    for (const v of res.violations.filter((x) => x.severity === 'error')) {
      expect(v.code).toBeTruthy();
      expect(v.message).toBeTruthy();
      expect(v.fix).toBeTruthy();
    }
  });
});

describe('directory / type agreement', () => {
  test('a type the directory does not accept is rejected with the allowed list', async () => {
    const res = await run(page('title: A\ntype: person\ntags: [t]'), { slug: 'concepts/a' });
    expect(res.valid).toBe(false);
    const v = res.violations.find((x) => x.code === 'type_not_allowed_in_path')!;
    expect(v.fix).toContain('concept');
  });

  test('`types: any` waives the check', async () => {
    const res = await run(page('title: A\ntype: whatever\ntags: [t]'), { slug: 'inbox/a' });
    expect(res.valid).toBe(true);
  });

  test('a slug outside every known prefix is rejected', async () => {
    const res = await run(GOOD, { slug: 'scratch/a' });
    expect(res.valid).toBe(false);
    expect(codes(res.violations)).toContain('slug_outside_known_prefix');
  });

  test('scope: known_prefixes IGNORES an out-of-prefix slug instead of refusing it', async () => {
    // The distinction that matters in production: a repo lint that walks a
    // fixed set of knowledge directories has no opinion about `tools/notes`.
    // A gate that rejected it would be stricter than the repo has ever been.
    const policy = parseWritePolicy({
      required_fields: ['title', 'type', 'tags'],
      type_path_rules: [{ prefix: 'concepts/', types: ['concept'] }],
      slug_rules: { scope: 'known_prefixes' },
    }, 'test')!;
    const content = '---\nwhatever: true\n---\n\nNot a knowledge page.\n';
    const res = await validatePageAgainstPolicy({
      policy, slug: 'tools/notes', content, existingFrontmatter: null,
    });
    expect(res.valid).toBe(true);
    expect(res.out_of_scope).toBe(true);
    expect(res.violations).toEqual([]);
    expect(res.normalized_content).toBe(content);
  });

  test('scope: known_prefixes still governs anything INSIDE a prefix', async () => {
    const policy = parseWritePolicy({
      required_fields: ['title'],
      type_path_rules: [{ prefix: 'concepts/', types: ['concept'] }],
      slug_rules: { scope: 'known_prefixes' },
    }, 'test')!;
    const res = await validatePageAgainstPolicy({
      policy, slug: 'concepts/x', content: '---\ntype: concept\n---\n\nBody.\n', existingFrontmatter: null,
    });
    expect(res.out_of_scope).toBe(false);
    expect(res.valid).toBe(false);
  });

  test('exempt_basenames skips the page even inside a governed prefix', async () => {
    const policy = parseWritePolicy({
      required_fields: ['title', 'type', 'tags'],
      type_path_rules: [{ prefix: 'concepts/', types: ['concept'] }],
      slug_rules: { exempt_basenames: ['readme'] },
    }, 'test')!;
    const res = await validatePageAgainstPolicy({
      policy, slug: 'concepts/README', content: '# Directory index\n', existingFrontmatter: null,
    });
    expect(res.valid).toBe(true);
    expect(res.out_of_scope).toBe(true);
  });

  test('an out-of-scope page with unparseable frontmatter is left alone, not rejected', async () => {
    const policy = parseWritePolicy({
      required_fields: ['title'],
      type_path_rules: [{ prefix: 'concepts/', types: ['concept'] }],
      slug_rules: { scope: 'known_prefixes' },
    }, 'test')!;
    const res = await validatePageAgainstPolicy({
      policy, slug: 'tools/x', content: '---\ntitle: "unterminated\n---\n\nbody\n', existingFrontmatter: null,
    });
    expect(res.valid).toBe(true);
    expect(res.out_of_scope).toBe(true);
  });

  test('longest matching prefix wins', async () => {
    const policy = parseWritePolicy({
      type_path_rules: [
        { prefix: 'meetings/', types: ['meeting'] },
        { prefix: 'meetings/transcripts/', types: ['transcript'] },
      ],
    }, 'test')!;
    const res = await validatePageAgainstPolicy({
      policy,
      slug: 'meetings/transcripts/2026-01-01',
      content: page('title: A\ntype: meeting'),
      existingFrontmatter: null,
    });
    expect(res.valid).toBe(false);
    expect(res.violations[0].fix).toContain('transcript');
  });
});

describe('connections', () => {
  test('a path-qualified id is rejected with the slug-only fix', async () => {
    const res = await run(page('title: A\ntype: concept\ntags: [t]\nconnections:\n  - id: concepts/other\n    why: x'));
    expect(res.valid).toBe(false);
    const v = res.violations.find((x) => x.code === 'connection_id_not_slug_only')!;
    expect(v.fix).toContain('id: other');
  });

  test('a non-kebab id is rejected', async () => {
    const res = await run(page('title: A\ntype: concept\ntags: [t]\nconnections:\n  - id: Not_Kebab'));
    expect(res.valid).toBe(false);
    expect(codes(res.violations)).toContain('connection_id_not_kebab');
  });

  test('bare-string connections are checked the same as mappings', async () => {
    const res = await run(page('title: A\ntype: concept\ntags: [t]\nconnections:\n  - concepts/other'));
    expect(codes(res.violations)).toContain('connection_id_not_slug_only');
  });

  test('require_resolvable: warn reports a dangling id without blocking the write', async () => {
    const res = await run(page('title: A\ntype: concept\ntags: [t]\nconnections:\n  - id: not-yet-written'), {
      known: [],
    });
    expect(res.valid).toBe(true);
    const v = res.violations.find((x) => x.code === 'connection_unresolved')!;
    expect(v.severity).toBe('warning');
  });

  test('require_resolvable: error blocks it', async () => {
    const policy = parseWritePolicy({
      connection_rules: { id_style: 'slug_only', slug_pattern: 'kebab', require_resolvable: 'error' },
    }, 'test')!;
    const res = await validatePageAgainstPolicy({
      policy,
      slug: 'concepts/a',
      content: page('title: A\nconnections:\n  - id: missing-page'),
      existingFrontmatter: null,
      resolveKnownSlugs: async () => new Set<string>(),
    });
    expect(res.valid).toBe(false);
  });

  test('a resolvable id produces no finding', async () => {
    const res = await run(page('title: A\ntype: concept\ntags: [t]\nconnections:\n  - id: known-page'), {
      known: ['known-page'],
    });
    expect(res.violations.filter((v) => v.code === 'connection_unresolved')).toEqual([]);
  });

  test('a resolver failure never manufactures a violation', async () => {
    const res = await validatePageAgainstPolicy({
      policy: POLICY,
      slug: 'concepts/a',
      content: page('title: A\ntype: concept\ntags: [t]\nconnections:\n  - id: whatever'),
      existingFrontmatter: null,
      now: ACROSS_MIDNIGHT_TPE,
      resolveKnownSlugs: async () => { throw new Error('db down'); },
    });
    expect(res.violations.filter((v) => v.code === 'connection_unresolved')).toEqual([]);
  });
});

describe('normalization output', () => {
  test('a conforming page that needs no fill is returned byte-identical', async () => {
    const content = page('title: A\ntype: concept\ntags: [t]\ncreated: "2020-01-01"');
    const res = await run(content);
    expect(res.normalized).toBe(false);
    expect(res.normalized_content).toBe(content);
  });

  test('normalization preserves the body, including the timeline sentinel', async () => {
    const content = page('title: A\ntype: concept\ntags: [t]', 'Compiled truth.\n\n<!-- timeline -->\n\n- 2026-01-01 — thing');
    const res = await run(content);
    expect(res.normalized_content).toContain('<!-- timeline -->');
    expect(res.normalized_content).toContain('- 2026-01-01 — thing');
  });

  test('unparseable frontmatter is a violation, not a crash', async () => {
    const res = await run('---\ntitle: "unterminated\n---\n\nbody\n');
    expect(res.valid).toBe(false);
    expect(codes(res.violations)).toContain('frontmatter_unparseable');
    expect(res.normalized).toBe(false);
  });
});

/**
 * Body language rule (English-first compiled truth).
 *
 * The rule exists because a documented convention nothing enforces is not a
 * convention: javan-brain's SCHEMA.md has demanded English-first compiled
 * truth since the repo was created, and one agent session still wrote six
 * Chinese pages through a fully contract-compliant put_page, because the
 * contract it fetched said nothing about language.
 *
 * The load-bearing case is the LAST one: the same convention deliberately
 * keeps the other language in aliases, search phrases and the timeline, so a
 * whole-body count would refuse pages the convention calls conforming.
 */
describe('body language: english_first', () => {
  const LANG = parseWritePolicy({
    contract_version: '1',
    required_fields: ['title', 'type'],
    type_path_rules: [{ prefix: 'concepts/', types: 'any' }, { prefix: 'inbox/', types: 'any' }],
    language_rules: { body: 'english_first', exempt_slugs: ['*/readme'] },
  }, 'test')!;

  const runLang = (content: string, slug = 'concepts/x') => validatePageAgainstPolicy({
    policy: LANG, slug, content, existingFrontmatter: null, now: ACROSS_MIDNIGHT_TPE,
  });

  const front = 'title: X\ntype: concept';

  test('an English body passes', async () => {
    const res = await runLang(page(front, 'Goals stay stable while mechanisms are replaceable.'));
    expect(codes(res.violations)).not.toContain('body_language_not_english_first');
    expect(res.valid).toBe(true);
  });

  test('a Chinese body is refused, and the message names the measured ratio', async () => {
    const res = await runLang(page(front, '目標應該保持穩定，實作機制則是可替換的。這是核心原則。'));
    expect(codes(res.violations)).toContain('body_language_not_english_first');
    expect(res.valid).toBe(false);
    const v = res.violations.find((x) => x.code === 'body_language_not_english_first')!;
    expect(v.message).toMatch(/\d+% CJK/);
  });

  test('an English body quoting a Chinese term stays under the limit', async () => {
    const res = await runLang(page(front,
      'The rule is called 目標樹 in conversation, but the compiled truth is written in English '
      + 'so retrieval, reranking and cross-agent exchange all operate on one language.'));
    expect(res.valid).toBe(true);
  });

  test('exempt slugs are ignored — directory signage is not promoted knowledge', async () => {
    const res = await runLang(page(front, '可複用的心智模型、技術、洞察、pattern、原則。'), 'concepts/readme');
    expect(codes(res.violations)).not.toContain('body_language_not_english_first');
  });

  test('severity: warn reports without refusing the write', async () => {
    const warnPolicy = parseWritePolicy({
      contract_version: '1',
      required_fields: ['title', 'type'],
      type_path_rules: [{ prefix: 'concepts/', types: 'any' }],
      language_rules: { body: 'english_first', severity: 'warn' },
    }, 'test')!;
    const res = await validatePageAgainstPolicy({
      policy: warnPolicy, slug: 'concepts/x', content: page(front, '這一整段都是中文內容。'),
      existingFrontmatter: null, now: ACROSS_MIDNIGHT_TPE,
    });
    expect(codes(res.violations)).toContain('body_language_not_english_first');
    expect(res.valid).toBe(true);
  });

  test('a Chinese TIMELINE under an English body is conforming', async () => {
    // The convention puts the other language here on purpose. A naive
    // whole-body count would make this page unwritable.
    const res = await runLang(page(front,
      'Goals stay stable while mechanisms are replaceable.\n\n'
      + '## Timeline\n'
      + '- **2026-08-12** | 某個 agent session 一次寫進六頁中文，因為契約沒說不行。\n'
      + '- **2026-09-10** | 補上語言規則，讓契約說得出來、gate 擋得住。\n'));
    expect(codes(res.violations)).not.toContain('body_language_not_english_first');
    expect(res.valid).toBe(true);
  });

  test('the rule is off unless the source asks for it', async () => {
    const res = await run(page('title: A Concept\ntype: concept\ntags:\n  - topic',
      '這一整段都是中文，但這個 source 沒有宣告語言規則。'));
    expect(codes(res.violations)).not.toContain('body_language_not_english_first');
  });
});
