"use client";

import { useLayoutEffect, useState, type ReactNode } from "react";

const scrollShell =
  "max-h-[min(22rem,50vh)] overflow-y-auto overscroll-y-contain rounded-xl border border-neutral-200/80 bg-neutral-50/40 p-1 dark:border-neutral-800 dark:bg-neutral-900/30";

const toggleBtn =
  "flex w-full items-center justify-between gap-3 rounded-lg border border-neutral-200 bg-neutral-50/80 px-3 py-2.5 text-left text-sm transition hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900/80 dark:hover:bg-neutral-800/80";

/**
 * 管理画面で長くなりがちな一覧用: 折りたたみ＋（開時）最大高さ内スクロール。
 * 開閉は `localStorage` に保存し、再訪時も維持する。
 */
export function AdminCollapsibleBlock({
  storageKey,
  summary,
  itemCount,
  startClosedWhenCountGte,
  children,
  scrollable = true,
}: {
  storageKey: string;
  summary: ReactNode;
  itemCount: number;
  /** localStorage 未設定のとき、件数がこの値以上なら最初は閉じる */
  startClosedWhenCountGte: number;
  children: ReactNode;
  scrollable?: boolean;
}) {
  const [open, setOpen] = useState(true);

  useLayoutEffect(() => {
    try {
      const v = localStorage.getItem(storageKey);
      if (v === "1") {
        setOpen(true);
        return;
      }
      if (v === "0") {
        setOpen(false);
        return;
      }
    } catch {
      /* private mode */
    }
    setOpen(itemCount < startClosedWhenCountGte);
  }, [storageKey, itemCount, startClosedWhenCountGte]);

  function toggle() {
    setOpen((o) => {
      const n = !o;
      try {
        localStorage.setItem(storageKey, n ? "1" : "0");
      } catch {
        /* ignore */
      }
      return n;
    });
  }

  if (itemCount === 0) {
    return <>{children}</>;
  }

  return (
    <div className="space-y-2">
      <button type="button" className={toggleBtn} onClick={toggle}>
        <span className="font-medium text-neutral-800 dark:text-neutral-200">{summary}</span>
        <span className="shrink-0 text-xs tabular-nums text-neutral-500 dark:text-neutral-400">
          {open ? "一覧を閉じる" : "一覧を開く"}
        </span>
      </button>
      {open ? (
        scrollable ? <div className={scrollShell}>{children}</div> : <div>{children}</div>
      ) : null}
    </div>
  );
}
