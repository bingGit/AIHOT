import { z } from "zod";
import type { AdminPreferenceFeedback, AdminPreferenceFeedbackBreakdown, AdminPreferenceFeedbackRow, AdminPreferenceFeedbackSuggestion, BeforeJson } from "@aihot/contracts/admin";
import { PERSONAL_FEEDBACK_KINDS, type PersonalFeedbackKind, type PersonalFeedbackResponse } from "@aihot/contracts/site";
import { sql, type Db } from "../db.ts";
import { displayTags, publicSourceName } from "../publication/rules.ts";

const Id = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const Kind = z.enum(PERSONAL_FEEDBACK_KINDS);

export class PreferenceFeedbackRejected extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function pageAddress(raw: unknown): string | null {
  if (raw !== undefined && raw !== null && typeof raw !== "string") throw new PreferenceFeedbackRejected(400, "页面地址格式不正确。");
  const page = typeof raw === "string" ? raw.trim().slice(0, 500) : "";
  if (!page) return null;
  if (page.startsWith("/")) {
    if (/^\/[\/\\]/.test(page)) throw new PreferenceFeedbackRejected(400, "页面地址格式不正确。");
    return page;
  }
  try {
    const url = new URL(page);
    if (url.protocol === "http:" || url.protocol === "https:") return page;
  } catch {
    // Fall through to the same client error for malformed absolute URLs.
  }
  throw new PreferenceFeedbackRejected(400, "页面地址格式不正确。");
}

export interface SubmitPreferenceFeedbackInput {
  articleId: unknown;
  kind: unknown;
  pageUrl?: unknown;
}

type ArticleSnapshot = {
  article_id: string;
  title: string;
  summary: string | null;
  source_name: string;
  author: string | null;
  category: string | null;
  tags: string[];
  channel: "news" | "x";
};

async function snapshot(articleId: string, db: Db = sql): Promise<ArticleSnapshot | null> {
  const [row] = await db<ArticleSnapshot[]>`
    SELECT p.article_id, p.title, p.summary, s.name AS source_name, a.author, p.category, p.tags,
           p.channel
    FROM publications p
    JOIN articles a ON a.id = p.article_id
    JOIN sources s ON s.id = p.source_id
    WHERE p.article_id = ${articleId}
      AND s.participation_mode = 'editorial'
      AND p.visibility <> 'withdrawn'
      AND (NOT p.selected OR p.visible_after <= now())`;
  return row ?? null;
}

export async function submitPreferenceFeedback(input: SubmitPreferenceFeedbackInput, db: Db = sql): Promise<PersonalFeedbackResponse> {
  const articleId = Id.safeParse(input.articleId);
  const kind = Kind.safeParse(input.kind);
  if (!articleId.success) throw new PreferenceFeedbackRejected(400, "文章标识不正确。");
  if (!kind.success) throw new PreferenceFeedbackRejected(400, "反馈类型不正确。");
  const row = await snapshot(articleId.data, db);
  if (!row) throw new PreferenceFeedbackRejected(404, "这篇内容已不可用。");
  const pageUrl = pageAddress(input.pageUrl);
  const [before] = await db<{ kind: PersonalFeedbackKind }[]>`
    SELECT kind FROM personal_content_feedback WHERE article_id = ${articleId.data}`;
  await db`
    INSERT INTO personal_content_feedback
      (article_id, kind, page_url, title, summary, source_name, author, category, tags, channel)
    VALUES
      (${row.article_id}, ${kind.data}, ${pageUrl}, ${row.title}, ${row.summary}, ${publicSourceName(row.source_name)}, ${row.author}, ${row.category}, ${sql.array(displayTags(row.tags))}, ${row.channel})
    ON CONFLICT (article_id) DO UPDATE SET
      kind = EXCLUDED.kind, page_url = EXCLUDED.page_url, title = EXCLUDED.title, summary = EXCLUDED.summary,
      source_name = EXCLUDED.source_name, author = EXCLUDED.author, category = EXCLUDED.category,
      tags = EXCLUDED.tags, channel = EXCLUDED.channel, updated_at = now()`;
  return { articleId: articleId.data, kind: kind.data, changed: before?.kind !== kind.data };
}

export async function getPreferenceFeedback(articleId: string): Promise<PersonalFeedbackResponse> {
  const id = Id.safeParse(articleId);
  if (!id.success) throw new PreferenceFeedbackRejected(400, "文章标识不正确。");
  const [row] = await sql<{ kind: PersonalFeedbackKind }[]>`
    SELECT kind FROM personal_content_feedback WHERE article_id = ${id.data}`;
  return { articleId: id.data, kind: row?.kind ?? null, changed: false };
}

export async function clearPreferenceFeedback(articleId: string): Promise<PersonalFeedbackResponse> {
  const id = Id.safeParse(articleId);
  if (!id.success) throw new PreferenceFeedbackRejected(400, "文章标识不正确。");
  const deleted = await sql`DELETE FROM personal_content_feedback WHERE article_id = ${id.data}`;
  return { articleId: id.data, kind: null, changed: deleted.count > 0 };
}

type RawBreakdown = { label: string; total: number; more: number; irrelevant: number; marketing: number; duplicate: number };

function breakdown(rows: RawBreakdown[]): AdminPreferenceFeedbackBreakdown[] {
  return rows.map((row) => ({ ...row, total: Number(row.total), more: Number(row.more), irrelevant: Number(row.irrelevant), marketing: Number(row.marketing), duplicate: Number(row.duplicate) }));
}

function suggestionForBreakdown(row: AdminPreferenceFeedbackBreakdown, dimension: "source" | "category" | "tag"): AdminPreferenceFeedbackSuggestion | null {
  if (row.more >= 3 && row.more > row.irrelevant + row.marketing + row.duplicate) {
    const name = dimension === "tag" ? `标签「${row.label}」` : `${dimension === "source" ? "来源" : "分类"}「${row.label}」`;
    return {
      key: `include:${dimension}:${row.label}`,
      kind: "include",
      title: `考虑增加 ${name} 的采集关注`,
      detail: `最近反馈中，${name}有 ${row.more} 条“想多看”，正向反馈明显高于负向反馈。`,
      evidence: [`想多看 ${row.more} 条`, `其他负向反馈 ${row.total - row.more} 条`],
      count: row.more,
    };
  }
  const negative = row.irrelevant + row.marketing + row.duplicate;
  if (negative >= 3 && negative > row.more) {
    const name = dimension === "tag" ? `标签「${row.label}」` : `${dimension === "source" ? "来源" : "分类"}「${row.label}」`;
    return {
      key: `exclude:${dimension}:${row.label}`,
      kind: dimension === "source" ? "review" : "exclude",
      title: `复核 ${name} 的采集范围或筛选规则`,
      detail: `最近反馈中，${name}有 ${negative} 条负向反馈，建议人工核对搜索词、噪声词或精选规则。`,
      evidence: [`不相关 ${row.irrelevant} 条`, `广告/营销 ${row.marketing} 条`, `重复或低价值 ${row.duplicate} 条`],
      count: negative,
    };
  }
  return null;
}

export async function preferenceFeedbackOverview(days = 30): Promise<BeforeJson<AdminPreferenceFeedback>> {
  const boundedDays = Math.min(Math.max(Math.trunc(days) || 30, 7), 180);
  const [counts, total, sources, categories, tags, recent] = await Promise.all([
    sql<{ kind: PersonalFeedbackKind; count: number }[]>`
      SELECT kind, count(*)::int AS count FROM personal_content_feedback
      WHERE updated_at >= now() - ${boundedDays} * interval '1 day' GROUP BY kind ORDER BY count DESC`,
    sql<{ total: number }[]>`SELECT count(*)::int AS total FROM personal_content_feedback WHERE updated_at >= now() - ${boundedDays} * interval '1 day'`,
    sql<RawBreakdown[]>`
      SELECT source_name AS label, count(*)::int AS total,
        count(*) FILTER (WHERE kind = 'more')::int AS more,
        count(*) FILTER (WHERE kind = 'irrelevant')::int AS irrelevant,
        count(*) FILTER (WHERE kind = 'marketing')::int AS marketing,
        count(*) FILTER (WHERE kind = 'duplicate')::int AS duplicate
      FROM personal_content_feedback WHERE updated_at >= now() - ${boundedDays} * interval '1 day'
      GROUP BY source_name ORDER BY total DESC, label LIMIT 30`,
    sql<RawBreakdown[]>`
      SELECT coalesce(category, '未分类') AS label, count(*)::int AS total,
        count(*) FILTER (WHERE kind = 'more')::int AS more,
        count(*) FILTER (WHERE kind = 'irrelevant')::int AS irrelevant,
        count(*) FILTER (WHERE kind = 'marketing')::int AS marketing,
        count(*) FILTER (WHERE kind = 'duplicate')::int AS duplicate
      FROM personal_content_feedback WHERE updated_at >= now() - ${boundedDays} * interval '1 day'
      GROUP BY category ORDER BY total DESC, label LIMIT 30`,
    sql<RawBreakdown[]>`
      SELECT tag AS label, count(*)::int AS total,
        count(*) FILTER (WHERE kind = 'more')::int AS more,
        count(*) FILTER (WHERE kind = 'irrelevant')::int AS irrelevant,
        count(*) FILTER (WHERE kind = 'marketing')::int AS marketing,
        count(*) FILTER (WHERE kind = 'duplicate')::int AS duplicate
      FROM personal_content_feedback, unnest(tags) AS tag
      WHERE updated_at >= now() - ${boundedDays} * interval '1 day'
      GROUP BY tag ORDER BY total DESC, label LIMIT 50`,
    sql<AdminPreferenceFeedbackRow[]>`
      SELECT article_id, kind, title, summary, source_name, author, category, tags, channel, page_url, created_at, updated_at
      FROM personal_content_feedback WHERE updated_at >= now() - ${boundedDays} * interval '1 day'
      ORDER BY updated_at DESC LIMIT 30`,
  ]);
  const sourceRows = breakdown(sources);
  const categoryRows = breakdown(categories);
  const tagRows = breakdown(tags);
  const suggestions = [...sourceRows.map((r) => suggestionForBreakdown(r, "source")), ...categoryRows.map((r) => suggestionForBreakdown(r, "category")), ...tagRows.map((r) => suggestionForBreakdown(r, "tag"))]
    .filter((r): r is AdminPreferenceFeedbackSuggestion => r !== null)
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);
  return {
    since: new Date(Date.now() - boundedDays * 86400_000),
    total: Number(total[0]?.total ?? 0),
    counts: counts.map((r) => ({ kind: r.kind, count: Number(r.count) })),
    sources: sourceRows,
    categories: categoryRows,
    tags: tagRows,
    recent,
    suggestions,
  };
}

export { PERSONAL_FEEDBACK_KINDS };
