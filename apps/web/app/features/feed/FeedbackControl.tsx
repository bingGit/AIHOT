import { useEffect, useState } from "react";
import { PERSONAL_FEEDBACK_KINDS, PERSONAL_FEEDBACK_LABELS, type PersonalFeedbackKind } from "@aihot/contracts/site";
import { IconMessage } from "../../components/icons";

const kindTone: Record<PersonalFeedbackKind, string> = {
  more: "text-ok",
  irrelevant: "text-ink-2",
  marketing: "text-amber",
  duplicate: "text-hot",
};

function pageUrl() {
  return typeof window === "undefined" ? undefined : `${window.location.pathname}${window.location.search}`;
}

/** A small, persistent preference menu. It is separate from the browser-only 收藏 control. */
export function FeedbackControl({ articleId, compact = false }: { articleId: string; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<PersonalFeedbackKind | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<PersonalFeedbackKind | "clear" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open || loaded) return;
    const controller = new AbortController();
    void fetch(`api/site/items/${encodeURIComponent(articleId)}/preference-feedback`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() as Promise<{ kind: PersonalFeedbackKind | null }> : Promise.reject(new Error(String(res.status)))))
      .then((body) => setKind(body.kind))
      .catch(() => undefined)
      .finally(() => {
        if (!controller.signal.aborted) setLoaded(true);
      });
    return () => controller.abort();
  }, [articleId, loaded, open]);

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), 2200);
    return () => clearTimeout(timer);
  }, [message]);

  async function choose(next: PersonalFeedbackKind) {
    setBusy(next);
    try {
      const res = await fetch(`api/site/items/${encodeURIComponent(articleId)}/preference-feedback`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: next, pageUrl: pageUrl() }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setKind(next);
      setLoaded(true);
      setOpen(false);
      setMessage(`已记录：${PERSONAL_FEEDBACK_LABELS[next]}`);
    } catch {
      setMessage("记录失败，请稍后再试");
    } finally {
      setBusy(null);
    }
  }

  async function clear() {
    setBusy("clear");
    try {
      const res = await fetch(`api/site/items/${encodeURIComponent(articleId)}/preference-feedback`, { method: "DELETE" });
      if (!res.ok) throw new Error(String(res.status));
      setKind(null);
      setLoaded(true);
      setOpen(false);
      setMessage("已清除这条反馈");
    } catch {
      setMessage("清除失败，请稍后再试");
    } finally {
      setBusy(null);
    }
  }

  const label = kind ? `已标记：${PERSONAL_FEEDBACK_LABELS[kind]}` : "反馈这篇内容";
  return (
    <span className="relative z-20 inline-flex">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={label}
        title={label}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        className={`inline-flex items-center justify-center gap-1 rounded-control transition-colors ${kind ? "text-accent" : "text-ink-4 hover:bg-bg-sunk hover:text-ink-2"} ${compact ? "size-[26px]" : "h-8 px-2.5 text-[12.5px]"}`}
      >
        <IconMessage size={compact ? 15 : 16} />
        {!compact && <span>反馈</span>}
      </button>
      {open && (
        <div role="menu" aria-label="内容偏好反馈" className="absolute right-0 top-full mt-1.5 w-40 rounded-card bg-raised p-1.5 shadow-[var(--shadow-pop)] ring-1 ring-line-strong">
          <div className="px-2 py-1 text-[11.5px] text-ink-4">这篇内容对你来说</div>
          {PERSONAL_FEEDBACK_KINDS.map((option) => (
            <button
              key={option}
              type="button"
              role="menuitem"
              disabled={busy !== null}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void choose(option);
              }}
              className={`flex w-full items-center justify-between rounded-control px-2 py-1.5 text-left text-[12.5px] transition-colors hover:bg-bg-sunk disabled:opacity-50 ${kindTone[option]}`}
            >
              <span>{PERSONAL_FEEDBACK_LABELS[option]}</span>
              {kind === option && <span aria-hidden="true">✓</span>}
            </button>
          ))}
          {kind && (
            <button
              type="button"
              role="menuitem"
              disabled={busy !== null}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void clear();
              }}
              className="mt-1 w-full border-t border-line px-2 pt-1.5 text-left text-[12px] text-ink-4 hover:text-ink-2 disabled:opacity-50"
            >
              清除反馈
            </button>
          )}
        </div>
      )}
      {message && <span role="status" className="absolute right-0 top-full mt-2 whitespace-nowrap rounded-full bg-ink px-3 py-1.5 text-[12px] text-bg shadow-lg">{message}</span>}
    </span>
  );
}
