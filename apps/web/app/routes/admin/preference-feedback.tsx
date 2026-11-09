import { SITE } from "@aihot/site";
import { Link } from "react-router";
import type { Route } from "./+types/preference-feedback";
import type { AdminPreferenceFeedback, AdminPreferenceFeedbackBreakdown, AdminPreferenceFeedbackSuggestion } from "@aihot/contracts/admin";
import { PERSONAL_FEEDBACK_LABELS, type PersonalFeedbackKind } from "@aihot/contracts/site";
import { adminGet } from "../../lib/admin.server";
import { bj, num } from "../../features/admin/format";
import { AdminPage, Badge, Card, DataTable, Empty, FilterChips, Stat } from "../../features/admin/ui";

export async function loader({ request }: Route.LoaderArgs) {
  const days = new URL(request.url).searchParams.get("days") ?? "30";
  return adminGet<AdminPreferenceFeedback>(request, `/api/admin/preference-feedback?days=${encodeURIComponent(days)}`);
}

export const meta: Route.MetaFunction = () => [{ title: `内容偏好 · ${SITE.name} 后台` }];

const feedbackTone: Record<PersonalFeedbackKind, "ok" | "warn" | "bad" | "muted"> = {
  more: "ok",
  irrelevant: "muted",
  marketing: "warn",
  duplicate: "bad",
};

const statTone: Record<PersonalFeedbackKind, "ok" | "warn" | "bad" | undefined> = {
  more: "ok",
  irrelevant: undefined,
  marketing: "warn",
  duplicate: "bad",
};

function Breakdown({ title, rows }: { title: string; rows: AdminPreferenceFeedbackBreakdown[] }) {
  return (
    <Card title={title} pad={false}>
      <DataTable
        dense
        rows={rows}
        rowKey={(row) => row.label}
        empty="暂时没有足够的反馈"
        columns={[
          { key: "label", label: "对象", render: (row) => <span className="font-medium text-ink">{row.label}</span> },
          { key: "total", label: "合计", align: "right", render: (row) => num(row.total) },
          { key: "more", label: PERSONAL_FEEDBACK_LABELS.more, align: "right", render: (row) => <span className="text-ok">{num(row.more)}</span> },
          { key: "irrelevant", label: PERSONAL_FEEDBACK_LABELS.irrelevant, align: "right", render: (row) => num(row.irrelevant) },
          { key: "marketing", label: PERSONAL_FEEDBACK_LABELS.marketing, align: "right", render: (row) => <span className="text-amber">{num(row.marketing)}</span> },
          { key: "duplicate", label: PERSONAL_FEEDBACK_LABELS.duplicate, align: "right", render: (row) => <span className="text-hot">{num(row.duplicate)}</span> },
        ]}
      />
    </Card>
  );
}

function Suggestion({ suggestion }: { suggestion: AdminPreferenceFeedbackSuggestion }) {
  const tone = suggestion.kind === "include" ? "ok" : suggestion.kind === "exclude" ? "bad" : "warn";
  const label = suggestion.kind === "include" ? "倾向增加" : suggestion.kind === "exclude" ? "倾向减少" : "人工复核";
  return (
    <article className="rounded-panel bg-surface p-4 ring-1 ring-line">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={tone}>{label}</Badge>
        <span className="num text-[12px] text-ink-4">{suggestion.count} 条证据</span>
      </div>
      <h3 className="mt-2 text-[14px] font-semibold text-ink">{suggestion.title}</h3>
      <p className="mt-1 text-[13px] leading-relaxed text-ink-3">{suggestion.detail}</p>
      <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-ink-4">
        {suggestion.evidence.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </article>
  );
}

export default function PreferenceFeedbackAdmin({ loaderData }: Route.ComponentProps) {
  const { total, counts, sources, categories, tags, recent, suggestions, since } = loaderData;
  const countMap = Object.fromEntries(counts.map((item) => [item.kind, item.count])) as Partial<Record<PersonalFeedbackKind, number>>;
  return (
    <AdminPage
      title="内容偏好"
      subtitle={`记录展示端对内容的偏好反馈，按最近时间窗口汇总；建议只供人工审阅，不会自动修改信源、搜索词或筛选规则。统计起点：${bj(since, true)}`}
      actions={<FilterChips param="days" options={[{ value: "7", label: "7 天" }, { value: "", label: "30 天" }, { value: "90", label: "90 天" }, { value: "180", label: "180 天" }]} />}
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="反馈总数" value={num(total)} hint="同一篇内容只保留当前标签" />
        {(Object.keys(PERSONAL_FEEDBACK_LABELS) as PersonalFeedbackKind[]).map((kind) => (
          <Stat key={kind} label={PERSONAL_FEEDBACK_LABELS[kind]} value={num(countMap[kind] ?? 0)} tone={statTone[kind]} />
        ))}
      </div>

      <section className="mt-5 grid gap-5 xl:grid-cols-2">
        <Breakdown title="按来源" rows={sources} />
        <Breakdown title="按分类" rows={categories} />
      </section>
      <div className="mt-5">
        <Breakdown title="按标签" rows={tags} />
      </div>

      <section className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <Card title="待审阅建议">
          <div className="space-y-3">
            {suggestions.length ? suggestions.map((suggestion) => <Suggestion key={suggestion.key} suggestion={suggestion} />) : <Empty>样本还不足，暂不生成建议。</Empty>}
          </div>
        </Card>
        <Card title="最近反馈" pad={false}>
          <DataTable
            dense
            rows={recent}
            rowKey={(row) => row.article_id}
            empty="这个时间窗口还没有反馈"
            columns={[
              { key: "article", label: "文章", render: (row) => <Link to={`/items/${row.article_id}`} target="_blank" className="line-clamp-2 font-medium text-ink hover:text-accent">{row.title}</Link> },
              { key: "kind", label: "反馈", render: (row) => <Badge tone={feedbackTone[row.kind]}>{PERSONAL_FEEDBACK_LABELS[row.kind]}</Badge> },
              { key: "source", label: "来源", render: (row) => <span className="whitespace-nowrap text-ink-3">{row.source_name}</span> },
              { key: "time", label: "时间", render: (row) => <span className="whitespace-nowrap"><span className="num">{bj(row.updated_at)}</span></span> },
            ]}
          />
        </Card>
      </section>
    </AdminPage>
  );
}
