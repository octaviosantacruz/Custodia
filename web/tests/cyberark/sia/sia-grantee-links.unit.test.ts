import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier) && context.parentURL?.includes('/src/')) {
      for (const suffix of ['.ts', '/index.ts']) {
        const url = new URL(`${specifier}${suffix}`, context.parentURL);
        if (existsSync(fileURLToPath(url))) return { url: url.href, shortCircuit: true };
      }
    }
    return nextResolve(specifier);
  },
  load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    if (url.endsWith('/src/cross/lib/api.ts')) {
      const text = typeof result.source === 'string'
        ? result.source
        : Buffer.from(result.source as ArrayBuffer).toString('utf8');
      return { ...result, source: text.replaceAll('import.meta.env.VITE_API_URL', "''") };
    }
    return result;
  },
});

import { describeSiaGranteeLink, filterSiaGranteeLinks, summarizeSiaGranteeLinks } from '../../../src/cyberark/sia/lib/sia-grantee-links.ts';
const { fetchSiaPolicies } = await import('../../../src/cyberark/sia/lib/sia-api.ts');
const originalFetch = globalThis.fetch;

afterEach(() => { globalThis.fetch = originalFetch; });

test('SIA policy presentation labels exact links and preserves ambiguous/unmatched states per side', () => {
  assert.deepEqual(describeSiaGranteeLink({
    value: 'ada@example.test',
    identity: { status: 'matched', match: { object_id: 71, display_name: 'Ada Identity' } },
    pam: { status: 'ambiguous' },
  }), {
    value: 'ada@example.test',
    sides: [
      { source: 'identity', sourceLabel: 'Identity Administration', status: 'matched', statusLabel: 'Vinculado por correo', displayName: 'Ada Identity' },
      { source: 'pam', sourceLabel: 'PAM', status: 'ambiguous', statusLabel: 'Ambiguo: más de un candidato' },
    ],
  });
  assert.deepEqual(describeSiaGranteeLink({
    value: 'person@example.test', identity: { status: 'unmatched' },
  }).sides, [{
    source: 'identity', sourceLabel: 'Identity Administration', status: 'unmatched', statusLabel: 'Sin coincidencia',
  }], 'a missing source remains absent rather than appearing as an unmatched side');
});

test('SIA link summaries count each supplied side independently and retain the recipient denominator', () => {
  const summary = summarizeSiaGranteeLinks([
    { value: 'both@example.test', identity: { status: 'matched' }, pam: { status: 'ambiguous' } },
    { value: 'identity@example.test', identity: { status: 'unmatched' } },
    { value: 'pam@example.test', pam: { status: 'matched' } },
  ]);
  assert.deepEqual(summary, {
    recipients: 3,
    sources: [
      { source: 'identity', sourceLabel: 'Identity Administration', matched: 1, ambiguous: 0, unmatched: 1 },
      { source: 'pam', sourceLabel: 'PAM', matched: 1, ambiguous: 1, unmatched: 0 },
    ],
  });
});

test('SIA summary omits absent sources and produces no source rows for empty or unresolved links', () => {
  assert.deepEqual(summarizeSiaGranteeLinks([
    { value: 'identity@example.test', identity: { status: 'ambiguous' } },
  ]), {
    recipients: 1,
    sources: [{ source: 'identity', sourceLabel: 'Identity Administration', matched: 0, ambiguous: 1, unmatched: 0 }],
  });
  assert.deepEqual(summarizeSiaGranteeLinks([
    { value: 'pam@example.test', pam: { status: 'unmatched' } },
  ]), {
    recipients: 1,
    sources: [{ source: 'pam', sourceLabel: 'PAM', matched: 0, ambiguous: 0, unmatched: 1 }],
  });
  assert.deepEqual(summarizeSiaGranteeLinks([{ value: 'unresolved@example.test' }]), { recipients: 1, sources: [] });
  assert.deepEqual(summarizeSiaGranteeLinks([]), { recipients: 0, sources: [] });
});

test('SIA local filters match text case-insensitively, any present status side, and only the selected source', () => {
  const links = [
    { value: 'Ada-User@example.test', identity: { status: 'matched' as const }, pam: { status: 'ambiguous' as const } },
    { value: 'bea-user@example.test', identity: { status: 'unmatched' as const } },
    { value: 'cy-user@example.test', pam: { status: 'matched' as const } },
    { value: 'no-side@example.test' },
  ];
  const noFilters = { text: '', status: '', source: '' } as const;
  assert.deepEqual(filterSiaGranteeLinks(links, { ...noFilters, text: 'ADA-USER' }), [links[0]]);
  assert.deepEqual(filterSiaGranteeLinks(links, { ...noFilters, status: 'ambiguous' }), [links[0]]);
  assert.deepEqual(filterSiaGranteeLinks(links, { ...noFilters, source: 'pam' }), [links[0], links[2]]);
  assert.deepEqual(filterSiaGranteeLinks(links, { ...noFilters, source: 'identity' }), [links[0], links[1]]);
  assert.deepEqual(filterSiaGranteeLinks(links, { ...noFilters, text: 'ada', status: 'matched', source: 'identity' }), [links[0]]);
  assert.deepEqual(filterSiaGranteeLinks(links, { ...noFilters, text: 'absent' }), []);

  const sourceAndStatusLinks = [
    { value: 'other-side@example.test', identity: { status: 'matched' as const }, pam: { status: 'unmatched' as const } },
    { value: 'selected-side@example.test', identity: { status: 'unmatched' as const }, pam: { status: 'matched' as const } },
  ];
  assert.deepEqual(
    filterSiaGranteeLinks(sourceAndStatusLinks, { ...noFilters, source: 'pam', status: 'matched' }),
    [sourceAndStatusLinks[1]],
    'a status from the other source cannot satisfy a source-specific filter',
  );
  assert.deepEqual(
    filterSiaGranteeLinks(sourceAndStatusLinks, { ...noFilters, source: 'pam', status: 'unmatched' }),
    [sourceAndStatusLinks[0]],
    'a source-specific status matches when that source itself has the status',
  );
  assert.deepEqual(
    filterSiaGranteeLinks(sourceAndStatusLinks, { ...noFilters, status: 'matched' }),
    sourceAndStatusLinks,
    'without a source filter, either present side can satisfy the status',
  );
});

test('SIA summary and filters handle long recipient lists without dropping source-absent entries from N', () => {
  const links = Array.from({ length: 120 }, (_, index) => ({
    value: `recipient-${index}@example.test`,
    ...(index % 2 === 0 ? { identity: { status: 'matched' as const } } : { pam: { status: 'unmatched' as const } }),
  }));
  const summary = summarizeSiaGranteeLinks(links);
  assert.equal(summary.recipients, 120);
  assert.deepEqual(summary.sources.map(({ source, matched, unmatched }) => ({ source, matched, unmatched })), [
    { source: 'identity', matched: 60, unmatched: 0 },
    { source: 'pam', matched: 0, unmatched: 60 },
  ]);
  assert.equal(filterSiaGranteeLinks(links, { text: 'RECIPIENT-119', status: 'unmatched', source: 'pam' }).length, 1);
});

test('SIA policy client returns per-grantee link data from the existing read-only page route', async () => {
  const payload = {
    rows: [{
      object_id: 50, display_name: 'Policy', source_id: 'p-50', attributes: { granted_users: ['ada@example.test'] },
      grantee_links: [{ value: 'ada@example.test', pam: { status: 'matched', match: { object_id: 72, display_name: 'Ada PAM' } } }],
      linked_safes: [], linked_ip_count: 0, linkage_status: 'unlinked',
    }],
    total: 1, limit: 50, offset: 50, search: 'policy', status_filter: '', linkage_status: '',
  };
  let requested = '';
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    requested = String(input);
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  const result = await fetchSiaPolicies('policy', 1, '', '');

  assert.match(requested, /\/api\/cmdb\/sia-policies\?/);
  assert.equal(result.rows[0].grantee_links?.[0].pam?.match?.display_name, 'Ada PAM');
  assert.equal(result.rows[0].grantee_links?.[0].identity, undefined);
});
