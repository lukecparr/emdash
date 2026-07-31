import { openFixture } from '@tooling/utils/db';
import { afterEach, describe, expect, it } from 'vitest';
import { pullRequestViewerFlags } from '@main/db/schema';

const PR_URL = 'https://github.com/acme/repo/pull/1';

function insertPr(fixture: Awaited<ReturnType<typeof openFixture>>, url: string): void {
  fixture.sqlite
    .prepare(
      `INSERT INTO pull_requests
         (url, repository_url, base_ref_name, base_ref_oid,
          head_repository_url, head_ref_name, head_ref_oid, title, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      url,
      'https://github.com/acme/repo',
      'main',
      'base-oid',
      'https://github.com/acme/repo',
      'feature-x',
      'head-oid',
      'A PR',
      'open'
    );
}

function insertFlag(
  fixture: Awaited<ReturnType<typeof openFixture>>,
  url: string,
  accountId: string
): void {
  fixture.sqlite
    .prepare(
      `INSERT INTO pull_request_viewer_flags
         (pull_request_url, provider_account_id, review_requested, authored, synced_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(url, accountId, 1, 0, '2026-07-29T00:00:00.000Z');
}

describe('0020_pull_request_viewer_flags', () => {
  let fixture: Awaited<ReturnType<typeof openFixture>>;

  afterEach(() => {
    fixture?.close();
  });

  it('creates the pull_request_viewer_flags table on top of the pre-0020 fixture', async () => {
    fixture = await openFixture('pre-0020');

    const tables = fixture.sqlite
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='pull_request_viewer_flags'`
      )
      .all() as { name: string }[];
    expect(tables).toHaveLength(1);

    const rows = await fixture.db.select().from(pullRequestViewerFlags);
    expect(rows).toHaveLength(0);
  });

  it('enforces one row per (pull_request_url, provider_account_id) but allows multiple accounts', async () => {
    fixture = await openFixture('pre-0020');
    insertPr(fixture, PR_URL);

    insertFlag(fixture, PR_URL, 'github.com:1');
    insertFlag(fixture, PR_URL, 'github.com:2');
    expect(() => insertFlag(fixture, PR_URL, 'github.com:1')).toThrow(/UNIQUE constraint failed/);
  });

  it('cascades flag deletion when the pull request row is deleted', async () => {
    fixture = await openFixture('pre-0020');
    insertPr(fixture, PR_URL);
    insertFlag(fixture, PR_URL, 'github.com:1');

    fixture.sqlite.prepare(`DELETE FROM pull_requests WHERE url = ?`).run(PR_URL);

    const rows = await fixture.db.select().from(pullRequestViewerFlags);
    expect(rows).toHaveLength(0);
  });
});
