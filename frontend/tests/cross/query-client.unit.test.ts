import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { createQueryClient, QUERY_STALE_TIME_MS } from '../../src/cross/lib/query-client.ts';

describe('Custodia query client', () => {
  it('keeps shared read data fresh briefly and leaves retries to the explicit UI action', async () => {
    const client = createQueryClient();
    assert.equal(client.defaultQueryOptions({ queryKey: ['netskope', 'devices'] }).staleTime, QUERY_STALE_TIME_MS);
    let attempts = 0;
    await assert.rejects(client.fetchQuery({
      queryKey: ['netskope', 'unauthorized'],
      queryFn: async () => {
        attempts += 1;
        throw { status: 401 };
      },
    }));
    assert.equal(attempts, 1);
    client.clear();
  });
});
