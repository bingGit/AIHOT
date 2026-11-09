import "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import {
  PreferenceFeedbackRejected,
  clearPreferenceFeedback,
  getPreferenceFeedback,
  preferenceFeedbackOverview,
  submitPreferenceFeedback,
} from "@aihot/backend/operations/preference-feedback";
import { buildApp } from "../apps/api/src/app.ts";

const suffix = Math.random().toString(36).slice(2, 10);
const EDITORIAL = `preference-editorial-${suffix}`;
const SIGNAL = `preference-signal-${suffix}`;
const app = await buildApp();

after(async () => {
  await app.close();
  await closeDb();
});

async function source(id: string, name: string, participationMode = "editorial") {
  await sql`
    INSERT INTO sources (id, name, kind, tier, participation_mode, next_fetch_at)
    VALUES (${id}, ${name}, 'rss', 'T1', ${participationMode}, '2100-01-01')`;
}

async function article(id: string, sourceId: string, options: { category?: string; tags?: string[]; selected?: boolean; visibleAfter?: Date | null; visibility?: string } = {}) {
  const at = new Date(Date.now() - 60_000);
  await sql`
    INSERT INTO articles (id, source_id, identity_key, url, title, author, discovered_at, timeline_at)
    VALUES (${id}, ${sourceId}, ${id}, ${`https://example.test/${id}`}, ${`Article ${id}`}, 'Author', ${at}, ${at})`;
  await sql`
    INSERT INTO publications
      (article_id, source_id, title, summary, category, tags, url, channel, discovered_at, timeline_at, sort_at,
       eligible, selected, visible_after, visibility)
    VALUES
      (${id}, ${sourceId}, ${`Article ${id}`}, ${`Summary ${id}`}, ${options.category ?? "ai-models"},
       ${sql.array(options.tags ?? ["model", "entity:internal"])}, ${`https://example.test/${id}`}, 'news', ${at}, ${at}, ${at},
       true, ${options.selected ?? false}, ${options.visibleAfter === undefined ? at : options.visibleAfter}, ${options.visibility ?? "public"})`;
}

test("preference feedback replaces and clears one current label, while public scope and input validation hold", async () => {
  await source(EDITORIAL, "Editorial（内部说明）");
  await source(SIGNAL, "Signal source", "hot_signal");
  await article(`${EDITORIAL}-one`, EDITORIAL);
  await article(`${SIGNAL}-one`, SIGNAL);
  await article(`${EDITORIAL}-withdrawn`, EDITORIAL, { visibility: "withdrawn" });
  await article(`${EDITORIAL}-future`, EDITORIAL, { selected: true, visibleAfter: new Date(Date.now() + 60_000) });

  const id = `${EDITORIAL}-one`;
  assert.deepEqual(await submitPreferenceFeedback({ articleId: id, kind: "more", pageUrl: "/items/one" }), { articleId: id, kind: "more", changed: true });
  const stored = await sql<{ kind: string; source_name: string; tags: string[] }[]>`
    SELECT kind, source_name, tags FROM personal_content_feedback WHERE article_id = ${id}`;
  assert.deepEqual([...stored], [{ kind: "more", source_name: "Editorial", tags: ["model"] }]);

  assert.deepEqual(await submitPreferenceFeedback({ articleId: id, kind: "irrelevant", pageUrl: "/all" }), { articleId: id, kind: "irrelevant", changed: true });
  assert.equal(Number((await sql`SELECT count(*) AS n FROM personal_content_feedback WHERE article_id = ${id}`)[0]!.n), 1);
  assert.deepEqual(await getPreferenceFeedback(id), { articleId: id, kind: "irrelevant", changed: false });

  assert.deepEqual(await clearPreferenceFeedback(id), { articleId: id, kind: null, changed: true });
  assert.deepEqual(await clearPreferenceFeedback(id), { articleId: id, kind: null, changed: false });

  await assert.rejects(() => submitPreferenceFeedback({ articleId: id, kind: "unknown" }), (error) => error instanceof PreferenceFeedbackRejected && error.status === 400);
  await assert.rejects(() => submitPreferenceFeedback({ articleId: id, kind: "more", pageUrl: "//evil.example" }), (error) => error instanceof PreferenceFeedbackRejected && error.status === 400);
  for (const unavailable of [`${SIGNAL}-one`, `${EDITORIAL}-withdrawn`, `${EDITORIAL}-future`, "missing-preference-article"]) {
    await assert.rejects(() => submitPreferenceFeedback({ articleId: unavailable, kind: "more" }), (error) => error instanceof PreferenceFeedbackRejected && error.status === 404);
  }
});

test("preference overview exposes explainable thresholds and keeps the admin endpoint private", async () => {
  // Keep this test independent if the preceding test stops at an assertion before clearing its row.
  await sql`DELETE FROM personal_content_feedback`;
  const positiveIds = [`${EDITORIAL}-positive-a`, `${EDITORIAL}-positive-b`, `${EDITORIAL}-positive-c`];
  const negativeIds = [`${EDITORIAL}-negative-a`, `${EDITORIAL}-negative-b`, `${EDITORIAL}-negative-c`];
  for (const id of positiveIds) await article(id, EDITORIAL, { category: "ai-models", tags: ["favored"] });
  for (const id of negativeIds) await article(id, EDITORIAL, { category: "noise", tags: ["noisy"] });
  for (const id of positiveIds) await submitPreferenceFeedback({ articleId: id, kind: "more" });
  for (const id of negativeIds) await submitPreferenceFeedback({ articleId: id, kind: "marketing" });

  const overview = await preferenceFeedbackOverview(30);
  assert.equal(overview.total, 6);
  assert.equal(overview.counts.find((row) => row.kind === "more")?.count, 3);
  assert.equal(overview.counts.find((row) => row.kind === "marketing")?.count, 3);
  assert.ok(overview.sources.some((row) => row.label === "Editorial" && row.more === 3));
  assert.ok(overview.tags.some((row) => row.label === "favored" && row.more === 3));
  assert.ok(overview.suggestions.some((row) => row.key === "include:tag:favored" && row.kind === "include"));
  assert.ok(overview.suggestions.some((row) => row.key === "exclude:tag:noisy" && row.kind === "exclude"));

  const unauthenticated = await app.inject({ method: "GET", url: "/api/admin/preference-feedback" });
  assert.equal(unauthenticated.statusCode, 401);
});
