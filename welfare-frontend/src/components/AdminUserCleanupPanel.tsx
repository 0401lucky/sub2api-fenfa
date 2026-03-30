import { useEffect, useMemo, useState } from 'react';
import { api, isUnauthorizedError } from '../lib/api';
import type { AdminCleanupCandidateList } from '../types';

interface AdminUserCleanupPanelProps {
  onUnauthorized: () => Promise<void>;
  onError: (message: string) => void;
  onSuccess: (message: string) => void;
}

function formatBalance(value: number | null): string {
  if (value == null || !Number.isFinite(value)) {
    return '--';
  }

  return value.toFixed(2);
}

export function AdminUserCleanupPanel({
  onUnauthorized,
  onError,
  onSuccess
}: AdminUserCleanupPanelProps) {
  const [searchInput, setSearchInput] = useState('');
  const [query, setQuery] = useState({
    page: 1,
    page_size: 20,
    search: ''
  });
  const [list, setList] = useState<AdminCleanupCandidateList | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  useEffect(() => {
    void loadCandidates(query);
  }, [query]);

  const allVisibleSelected = useMemo(() => {
    if (!list || list.items.length === 0) {
      return false;
    }

    return list.items.every((item) => selectedIds.includes(item.sub2api_user_id));
  }, [list, selectedIds]);

  async function loadCandidates(nextQuery: typeof query) {
    setLoading(true);
    try {
      const result = await api.listAdminCleanupCandidates(nextQuery);
      setList(result);
      setSelectedIds((current) =>
        current.filter((id) => result.items.some((item) => item.sub2api_user_id === id))
      );
    } catch (err) {
      if (isUnauthorizedError(err)) {
        await onUnauthorized();
        return;
      }

      onError(err instanceof Error ? err.message : '候选用户加载失败');
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(userIds: number[]) {
    if (userIds.length === 0 || deleting) {
      return;
    }

    const confirmed = window.confirm(`确认删除这 ${userIds.length} 个候选用户吗？`);
    if (!confirmed) {
      return;
    }

    setDeleting(true);
    try {
      const result = await api.deleteAdminCleanupCandidates(userIds);
      onSuccess(`清理完成：成功 ${result.success_count}，失败 ${result.fail_count}`);
      await loadCandidates(query);
    } catch (err) {
      if (isUnauthorizedError(err)) {
        await onUnauthorized();
        return;
      }

      onError(err instanceof Error ? err.message : '清理失败');
    } finally {
      setDeleting(false);
      setSelectedIds([]);
    }
  }

  return (
    <div className="admin-section-stack">
      <div className="panel">
        <h2 className="section-title">候选清理用户</h2>
        <p className="muted admin-note">
          仅展示非 LinuxDo、非福利站管理员、且在福利站无使用流水的 sub2api 用户。
        </p>

        <div className="form-grid">
          <label className="field">
            <span>搜索关键字</span>
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="用户名或邮箱"
            />
          </label>
        </div>

        <div className="form-actions actions">
          <button
            className="button primary"
            onClick={() =>
              setQuery((current) => ({
                ...current,
                page: 1,
                search: searchInput.trim()
              }))
            }
          >
            查询候选
          </button>
          <button
            className="button ghost"
            onClick={() => {
              setSearchInput('');
              setSelectedIds([]);
              setQuery({
                page: 1,
                page_size: 20,
                search: ''
              });
            }}
          >
            重置
          </button>
          <button
            className="button danger"
            disabled={selectedIds.length === 0 || deleting}
            onClick={() => void handleDelete(selectedIds)}
          >
            {deleting ? '删除中...' : `批量删除 (${selectedIds.length})`}
          </button>
        </div>

        {list && (
          <div className="admin-stats-summary" style={{ marginTop: 16 }}>
            <span className="chip">候选总数：{list.total}</span>
            <span className="chip">当前页：{list.page} / {list.pages}</span>
            <span className="chip">已选中：{selectedIds.length}</span>
          </div>
        )}

        {loading ? (
          <p className="loading-text">正在加载候选用户...</p>
        ) : list && list.items.length > 0 ? (
          <>
            <div className="form-actions actions" style={{ marginTop: 16 }}>
              <button
                className="button ghost"
                onClick={() => {
                  if (!list) {
                    return;
                  }

                  setSelectedIds(
                    allVisibleSelected ? [] : list.items.map((item) => item.sub2api_user_id)
                  );
                }}
              >
                {allVisibleSelected ? '取消全选' : '全选当前页'}
              </button>
            </div>

            <div className="list" style={{ marginTop: 16 }}>
              {list.items.map((item) => {
                const checked = selectedIds.includes(item.sub2api_user_id);
                return (
                  <div key={item.sub2api_user_id} className="list-item admin-cleanup-item">
                    <label className="admin-cleanup-check">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) => {
                          setSelectedIds((current) =>
                            event.target.checked
                              ? [...current, item.sub2api_user_id]
                              : current.filter((id) => id !== item.sub2api_user_id)
                          );
                        }}
                      />
                    </label>
                    <div className="stack">
                      <strong>{item.username || item.email}</strong>
                      <span className="muted admin-checkin-meta">{item.email}</span>
                      <span className="muted admin-checkin-meta">{item.cleanup_reason}</span>
                    </div>
                    <div className="stack">
                      <strong>#{item.sub2api_user_id}</strong>
                      <span className="muted admin-checkin-meta">
                        余额 {formatBalance(item.balance)}
                      </span>
                    </div>
                    <div className="stack">
                      <strong>流水</strong>
                      <span className="muted admin-checkin-meta">
                        签到 {item.welfare_activity.checkin_count}
                      </span>
                      <span className="muted admin-checkin-meta">
                        兑换 {item.welfare_activity.redeem_count}
                      </span>
                      <span className="muted admin-checkin-meta">
                        重置 {item.welfare_activity.reset_count}
                      </span>
                    </div>
                    <div className="actions">
                      <button
                        className="button danger"
                        disabled={deleting}
                        onClick={() => void handleDelete([item.sub2api_user_id])}
                      >
                        删除
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="pagination-bar">
              <span className="muted admin-checkin-meta">
                共 {list.total} 条候选
              </span>
              <div className="actions">
                <button
                  className="button ghost"
                  disabled={list.page <= 1}
                  onClick={() =>
                    setQuery((current) => ({ ...current, page: Math.max(1, current.page - 1) }))
                  }
                >
                  上一页
                </button>
                <button
                  className="button ghost"
                  disabled={list.page >= list.pages}
                  onClick={() =>
                    setQuery((current) => ({
                      ...current,
                      page: Math.min(list.pages, current.page + 1)
                    }))
                  }
                >
                  下一页
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="empty-state" style={{ marginTop: 16 }}>
            当前没有可清理候选用户。
          </div>
        )}
      </div>
    </div>
  );
}
