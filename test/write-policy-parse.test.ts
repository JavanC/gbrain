/**
 * Source write-policy parser (v1).
 *
 * The parser is fail-LOUD by design: a policy that silently degraded to "no
 * rules" would hand an agent a green light for pages the source repo will later
 * refuse — the exact failure the feature removes. These tests pin that.
 */

import { describe, test, expect } from 'bun:test';
import { parseWritePolicy, WritePolicyParseError } from '../src/core/write-policy/policy-v1.ts';
import { resolveWritePolicyFromYaml } from '../src/core/write-policy/load.ts';

const P = 'gbrain.yml';

describe('parseWritePolicy', () => {
  test('absent policy is null, not an error', () => {
    expect(parseWritePolicy(undefined, P)).toBeNull();
    expect(parseWritePolicy(null, P)).toBeNull();
  });

  test('minimal policy fills defaults', () => {
    const policy = parseWritePolicy({ required_fields: ['title'] }, P)!;
    expect(policy.version).toBe(1);
    expect(policy.enabled).toBe(true);
    expect(policy.contract_version).toBe('1');
    expect(policy.required_fields).toEqual(['title']);
    expect(policy.non_empty_list_fields).toEqual([]);
    expect(policy.server_managed).toEqual([]);
    expect(policy.connection_rules).toEqual({
      id_style: 'any',
      slug_pattern: 'any',
      require_resolvable: 'off',
    });
    expect(policy.slug_rules).toEqual({
      scope: 'all',
      require_known_prefix: false,
      exempt_basenames: [],
    });
  });

  test('slug_rules.scope + exempt_basenames parse, basenames lowercased', () => {
    const policy = parseWritePolicy({
      slug_rules: { scope: 'known_prefixes', exempt_basenames: ['README', 'Index'] },
    }, P)!;
    expect(policy.slug_rules.scope).toBe('known_prefixes');
    expect(policy.slug_rules.exempt_basenames).toEqual(['readme', 'index']);
  });

  test('an unknown scope is rejected', () => {
    expect(() => parseWritePolicy({ slug_rules: { scope: 'some_dirs' } }, P)).toThrow(/scope must be/);
  });

  test('scope=known_prefixes with require_known_prefix is rejected — they mean opposite things', () => {
    expect(() => parseWritePolicy({
      slug_rules: { scope: 'known_prefixes', require_known_prefix: true },
    }, P)).toThrow(/pick one/);
  });

  test('enabled: false is preserved (caller decides what inactive means)', () => {
    expect(parseWritePolicy({ enabled: false }, P)!.enabled).toBe(false);
  });

  test('numeric contract_version is stringified', () => {
    expect(parseWritePolicy({ contract_version: 3 }, P)!.contract_version).toBe('3');
  });

  test('unsupported version is rejected rather than best-efforted', () => {
    expect(() => parseWritePolicy({ version: 2 }, P)).toThrow(WritePolicyParseError);
  });

  test('type_path_rules sort longest-prefix-first', () => {
    const policy = parseWritePolicy({
      type_path_rules: [
        { prefix: 'meetings/', types: ['meeting'] },
        { prefix: 'meetings/transcripts/', types: ['transcript'] },
      ],
    }, P)!;
    expect(policy.type_path_rules.map((r) => r.prefix)).toEqual([
      'meetings/transcripts/',
      'meetings/',
    ]);
  });

  test('types: any is preserved as a waiver', () => {
    const policy = parseWritePolicy({ type_path_rules: [{ prefix: 'inbox/', types: 'any' }] }, P)!;
    expect(policy.type_path_rules[0].types).toBe('any');
  });

  test('empty types list is a policy error (use `any` to waive)', () => {
    expect(() => parseWritePolicy({ type_path_rules: [{ prefix: 'inbox/', types: [] }] }, P))
      .toThrow(/use `types: any`/);
  });

  test('rule without a prefix is rejected', () => {
    expect(() => parseWritePolicy({ type_path_rules: [{ types: ['concept'] }] }, P))
      .toThrow(/needs a `prefix`/);
  });

  test('server_managed accepts the full spec and sorts by field', () => {
    const policy = parseWritePolicy({
      server_managed: {
        created: { mode: 'set_on_create_preserve_on_update', value: 'date', timezone: 'Asia/Taipei' },
        author: { mode: 'preserve_on_update' },
      },
    }, P)!;
    expect(policy.server_managed).toEqual([
      { field: 'author', mode: 'preserve_on_update' },
      { field: 'created', mode: 'set_on_create_preserve_on_update', value: 'date', timezone: 'Asia/Taipei' },
    ]);
  });

  test('set_on_create without a value is rejected — the server would have nothing to fill', () => {
    expect(() => parseWritePolicy({
      server_managed: { created: { mode: 'set_on_create_preserve_on_update' } },
    }, P)).toThrow(/declares no `value`/);
  });

  test('unknown server_managed mode is rejected', () => {
    expect(() => parseWritePolicy({ server_managed: { created: { mode: 'whatever' } } }, P))
      .toThrow(/mode must be/);
  });

  test('unknown connection_rules values are rejected', () => {
    expect(() => parseWritePolicy({ connection_rules: { id_style: 'paths' } }, P)).toThrow(/id_style/);
    expect(() => parseWritePolicy({ connection_rules: { slug_pattern: 'snake' } }, P)).toThrow(/slug_pattern/);
    expect(() => parseWritePolicy({ connection_rules: { require_resolvable: 'maybe' } }, P))
      .toThrow(/require_resolvable/);
  });

  test('non-mapping policy is rejected', () => {
    expect(() => parseWritePolicy('enabled', P)).toThrow(/must be a mapping/);
    expect(() => parseWritePolicy([1, 2], P)).toThrow(/must be a mapping/);
  });
});

describe('resolveWritePolicyFromYaml', () => {
  test('gbrain.yml with no write_policy block is inactive, not an error', () => {
    const res = resolveWritePolicyFromYaml('storage:\n  db_tracked:\n    - concepts/\n', P);
    expect(res).toMatchObject({ status: 'inactive', reason: 'no_write_policy_block' });
  });

  test('enabled: false resolves to inactive with the disabled reason', () => {
    const res = resolveWritePolicyFromYaml('write_policy:\n  enabled: false\n', P);
    expect(res).toMatchObject({ status: 'inactive', reason: 'disabled' });
  });

  test('a real policy resolves to active', () => {
    const res = resolveWritePolicyFromYaml(
      'write_policy:\n  required_fields: [title, type]\n  contract_version: "7"\n',
      P,
    );
    expect(res.status).toBe('active');
    if (res.status !== 'active') throw new Error('unreachable');
    expect(res.policy.contract_version).toBe('7');
    expect(res.policy.required_fields).toEqual(['title', 'type']);
  });

  test('malformed YAML surfaces as an error, never as "no rules"', () => {
    const res = resolveWritePolicyFromYaml('write_policy:\n  required_fields: [title\n', P);
    expect(res.status).toBe('error');
  });

  test('a structurally invalid policy surfaces as an error, never as "no rules"', () => {
    const res = resolveWritePolicyFromYaml('write_policy:\n  version: 9\n', P);
    expect(res.status).toBe('error');
    if (res.status !== 'error') throw new Error('unreachable');
    expect(res.error).toMatch(/version/);
  });
});
