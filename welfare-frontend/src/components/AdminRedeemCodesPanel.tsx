import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { api, isUnauthorizedError } from '../lib/api';
import type { AdminRedeemCodeItem } from '../types';

interface AdminRedeemCodesPanelProps {
  onUnauthorized: () => Promise<void>;
  onError: (message: string) => void;
  onSuccess: (message: string) => void;
}

const initialForm = {
  code: '',
  title: '',
  reward_balance: '100',
  max_claims: '10',
  enabled: true,
  expires_at: '',
  notes: ''
};

function toIsoDateTime(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return '长期有效';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString();
}

export function AdminRedeemCodesPanel({
  onUnauthorized,
  onError,
  onSuccess
}: AdminRedeemCodesPanelProps) {
  const [codes, setCodes] = useState<AdminRedeemCodeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [form, setForm] = useState(initialForm);

  async function loadCodes() {
    setLoading(true);
    try {
      onError('');
      const result = await api.listAdminRedeemCodes();
      setCodes(result);
    } catch (err) {
      if (isUnauthorizedError(err)) {
        await onUnauthorized();
        return;
      }
      onSuccess('');
      onError(err instanceof Error ? err.message : '兑换码列表加载失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadCodes();
  }, []);

  async function handleCreateCode() {
    const rewardBalance = Number(form.reward_balance);
    const maxClaims = Number(form.max_claims);
    if (!form.code.trim() || !form.title.trim()) {
      onError('兑换码和标题不能为空');
      return;
    }
    if (!Number.isFinite(rewardBalance) || rewardBalance <= 0) {
      onError('发放额度必须大于 0');
      return;
    }
    if (!Number.isInteger(maxClaims) || maxClaims <= 0) {
      onError('领取人数必须是正整数');
      return;
    }
    if (form.expires_at && !toIsoDateTime(form.expires_at)) {
      onError('过期时间格式非法');
      return;
    }

    setSaving(true);
    try {
      const created = await api.createAdminRedeemCode({
        code: form.code.trim(),
        title: form.title.trim(),
        reward_balance: rewardBalance,
        max_claims: maxClaims,
        enabled: form.enabled,
        expires_at: toIsoDateTime(form.expires_at),
        notes: form.notes.trim() || undefined
      });
      setCodes((current) => [created, ...current]);
      setForm(initialForm);
      onError('');
      onSuccess(`已创建兑换码 ${created.code}`);
    } catch (err) {
      if (isUnauthorizedError(err)) {
        await onUnauthorized();
        return;
      }
      onSuccess('');
      onError(err instanceof Error ? err.message : '兑换码创建失败');
    } finally {
      setSaving(false);
    }
  }

  async function toggleCode(item: AdminRedeemCodeItem) {
    setTogglingId(item.id);
    try {
      const updated = await api.updateAdminRedeemCode(item.id, {
        enabled: !item.enabled
      });
      setCodes((current) =>
        current.map((code) => (code.id === updated.id ? updated : code))
      );
      onError('');
      onSuccess(`${updated.code} 已${updated.enabled ? '启用' : '停用'}`);
    } catch (err) {
      if (isUnauthorizedError(err)) {
        await onUnauthorized();
        return;
      }
      onSuccess('');
      onError(err instanceof Error ? err.message : '兑换码状态更新失败');
    } finally {
      setTogglingId(null);
    }
  }

  return (
    <>
      <h2 className="section-title">
        <span className="section-title-content">
          <Icon name="gift" className="icon icon-accent" />
          <span>兑换码管理</span>
        </span>
      </h2>

      <div className="panel">
        <div className="form-grid">
          <label className="field">
            <span>兑换码</span>
            <input
              type="text"
              value={form.code}
              maxLength={64}
              placeholder="例如 WELFARE100"
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  code: event.target.value
                }))
              }
            />
          </label>
          <label className="field">
            <span>展示标题</span>
            <input
              type="text"
              value={form.title}
              maxLength={120}
              placeholder="例如 福利100刀兑换"
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  title: event.target.value
                }))
              }
            />
          </label>
          <label className="field">
            <span>单次发放额度</span>
            <input
              type="number"
              step="0.01"
              min="0.01"
              value={form.reward_balance}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  reward_balance: event.target.value
                }))
              }
            />
          </label>
          <label className="field">
            <span>最多领取人数</span>
            <input
              type="number"
              step="1"
              min="1"
              value={form.max_claims}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  max_claims: event.target.value
                }))
              }
            />
          </label>
          <label className="field">
            <span>过期时间</span>
            <input
              type="datetime-local"
              value={form.expires_at}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  expires_at: event.target.value
                }))
              }
            />
          </label>
          <label className="field">
            <span>备注</span>
            <input
              type="text"
              value={form.notes}
              maxLength={500}
              placeholder="可选"
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  notes: event.target.value
                }))
              }
            />
          </label>
          <label className="field">
            <span>启用状态</span>
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  enabled: event.target.checked
                }))
              }
            />
          </label>
        </div>

        <div className="form-actions">
          <button className="button primary" onClick={handleCreateCode} disabled={saving}>
            {saving ? '创建中...' : '创建兑换码'}
          </button>
        </div>
      </div>

      <div className="panel">
        {loading ? (
          <p className="loading-text">正在加载兑换码...</p>
        ) : codes.length === 0 ? (
          <div className="empty-state">暂无兑换码</div>
        ) : (
          <div className="list">
            {codes.map((item) => (
              <div key={item.id} className="list-item admin-redeem-code-item">
                <div className="stack">
                  <strong>{item.title}</strong>
                  <span className="muted admin-redeem-meta">{item.code}</span>
                  <span className="muted admin-redeem-meta">
                    创建于 {new Date(item.createdAt).toLocaleString()}
                  </span>
                </div>

                <div className="stack">
                  <strong>{item.rewardBalance}</strong>
                  <span className="muted admin-redeem-meta">单次发放额度</span>
                </div>

                <div className="stack">
                  <strong>
                    {item.claimedCount} / {item.maxClaims}
                  </strong>
                  <span className="muted admin-redeem-meta">
                    剩余 {item.remainingClaims}
                  </span>
                </div>

                <div className="stack">
                  <span className={`status-tag ${item.enabled ? 'success' : 'failed'}`}>
                    {item.enabled ? '已启用' : '已停用'}
                  </span>
                  {item.isExpired && <span className="status-tag failed">已过期</span>}
                </div>

                <div className="stack">
                  <span className="muted admin-redeem-meta">
                    {formatDateTime(item.expiresAt)}
                  </span>
                  <span className="muted admin-redeem-meta">{item.notes || '无备注'}</span>
                </div>

                <div className="actions admin-checkin-actions">
                  <button
                    className={`button ${item.enabled ? 'danger' : 'primary'}`}
                    onClick={() => toggleCode(item)}
                    disabled={togglingId === item.id}
                  >
                    {togglingId === item.id
                      ? '处理中...'
                      : item.enabled
                        ? '停用'
                        : '启用'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
