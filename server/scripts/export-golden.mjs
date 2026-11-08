// Exports the demo's People responses (web/src/demo/acme-api.ts) as the
// contract the Go server must match. Run from the repository root:
//   node server/scripts/export-golden.mjs
// Dates are the fixture's own (no shift), so the server is compared at the
// fixture's asOf time.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acmeResponse } from '../../web/src/demo/acme-api.ts';
import { people } from '../../web/src/demo/model/company.ts';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'testdata', 'golden');
mkdirSync(out, { recursive: true });
const get = (path) => acmeResponse(new URL(path, 'http://custodia.local'), 'GET');
const files = {
  'coverage.json': get('/api/chains/person/coverage'),
  'search-empty.json': get('/api/chains/person/search?q='),
  'search-bob.json': get('/api/chains/person/search?q=BOB'),
  'search-acme.json': get('/api/chains/person/search?q=acme.example'),
  'person-unknown.json': get('/api/chains/person?email=nobody@acme.example'),
};
for (const person of people) {
  const key = person.email.split('@')[0];
  files[`person-${key}.json`] = get(`/api/chains/person?email=${encodeURIComponent(person.email)}`);
  files[`coverage-${key}.json`] = get(`/api/chains/person/coverage/detail?email=${encodeURIComponent(person.email)}`);
}
for (const [name, body] of Object.entries(files)) writeFileSync(join(out, name), JSON.stringify(body, null, 2) + '\n');
console.log(`wrote ${Object.keys(files).length} golden files to ${out}`);
