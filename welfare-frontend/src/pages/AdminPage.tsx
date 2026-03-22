import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { AdminCheckinsPanel } from '../components/AdminCheckinsPanel';
import { AdminDashboardOverview } from '../components/AdminDashboardOverview';
import { AdminRedeemCodesPanel } from '../components/AdminRedeemCodesPanel';
import { AdminRedeemClaimsPanel } from '../components/AdminRedeemClaimsPanel';
import { AdminWhitelistPanel } from '../components/AdminWhitelistPanel';
import { useAuth } from '../lib/auth';
import { api, isUnauthorizedError } from '../lib/api';
import type {
  AdminCheckinItem,
  AdminCheckinList,
  AdminCheckinQuery,
  AdminRedeemClaimItem,
  AdminRedeemCodeItem,
  AdminSettings,
  DailyStats,
  WhitelistItem
} from '../types';

type AdminSection = 'overview' | 'checkins' | 'redeemCodes' | 'redeemClaims' | 'whitelist';

const defaultCheckinFilters: AdminCheckinQuery = {
  page: 1,
  page_size: 10
};

const defaultCheckinFilterForm = {
  subject: '',
  grant_status: '' as '' | 'pending' | 'success' | 'failed',
  date_from: '',
  date_to: ''
};

const sections: Array<{
  id: AdminSection;
  label: string;
  title: string;
  description: string;
  icon: 'bolt' | 'chart' | 'grid' | 'ticket' | 'users';
}> = [
  {
    id: 'overview',
    label: '总览',
    title: '运营总览',
    description: '先看状态、问题和近期趋势，再决定要进入哪条业务线。',
    icon: 'grid'
  },
  {
    id: 'checkins',
    label: '签到管理',
    title: '签到控制',
    description: '维护签到配置、观察趋势并处理失败流水。',
    icon: 'bolt'
  },
  {
    id: 'redeemCodes',
    label: '兑换码',
    title: '兑换码资产池',
    description: '创建活动码、调整启停状态，控制活动额度与人数上限。',
    icon: 'ticket'
  },
  {
    id: 'redeemClaims',
    label: '兑换记录',
    title: '兑换记录台',
    description: '排查兑换失败、补发异常和重复请求。',
    icon: 'chart'
  },
  {
    id: 'whitelist',
    label: '管理员',
    title: '权限白名单',
    description: '维护后台访问名单，确保只有运营账号可进入控制台。',
    icon: 'users'
  }
];

export function AdminPage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [activeSection, setActiveSection] = useState<AdminSection>('overview');
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [dailyRewardInput, setDailyRewardInput] = useState('');
  const [stats, setStats] = useState<DailyStats | null>(null);
  const [checkinList, setCheckinList] = useState<AdminCheckinList | null>(null);
  const [checkinFilters, setCheckinFilters] = useState<AdminCheckinQuery>(defaultCheckinFilters);
  const [checkinFilterForm, setCheckinFilterForm] = useState(defaultCheckinFilterForm);
  const [whitelist, setWhitelist] = useState<WhitelistItem[]>([]);
  const [newSubject, setNewSubject] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [overviewRedeemCodes, setOverviewRedeemCodes] = useState<AdminRedeemCodeItem[]>([]);
  const [overviewFailedCheckins, setOverviewFailedCheckins] = useState<AdminCheckinItem[]>([]);
  const [overviewFailedCheckinsTotal, setOverviewFailedCheckinsTotal] = useState(0);
  const [overviewFailedRedeemClaims, setOverviewFailedRedeemClaims] = useState<AdminRedeemClaimItem[]>([]);
  const [overviewFailedRedeemClaimsTotal, setOverviewFailedRedeemClaimsTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [checkinsLoading, setCheckinsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [retryingId, setRetryingId] = useState<number | null>(null);
  const [batchRetrying, setBatchRetrying] = useState(false);
  const [batchRetryProgress, setBatchRetryProgress] = useState({ done: 0, total: 0, successCount: 0, failCount: 0 });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function redirectToLogin() {
    await logout();
    navigate('/login', { replace: true });
  }

  async function refreshDashboardSnapshot() {
    try {
      const [redeemCodes, failedCheckinsResp, failedRedeemClaimsResp] = await Promise.all([
        api.listAdminRedeemCodes(),
        api.listAdminCheckins({ page: 1, page_size: 4, grant_status: 'failed' }),
        api.listAdminRedeemClaims({ page: 1, page_size: 4, grant_status: 'failed' })
      ]);
      setOverviewRedeemCodes(redeemCodes);
      setOverviewFailedCheckins(failedCheckinsResp.items);
      setOverviewFailedCheckinsTotal(failedCheckinsResp.total);
      setOverviewFailedRedeemClaims(failedRedeemClaimsResp.items);
      setOverviewFailedRedeemClaimsTotal(failedRedeemClaimsResp.total);
    } catch (err) {
      if (isUnauthorizedError(err)) {
        await redirectToLogin();
        return;
      }
      setError(err instanceof Error ? err.message : '总览数据加载失败');
    }
  }

  async function loadOverview() {
    setLoading(true);
    setError('');
    try {
      const [overview, redeemCodes, failedCheckinsResp, failedRedeemClaimsResp] = await Promise.all([
        api.getAdminOverview(),
        api.listAdminRedeemCodes(),
        api.listAdminCheckins({ page: 1, page_size: 4, grant_status: 'failed' }),
        api.listAdminRedeemClaims({ page: 1, page_size: 4, grant_status: 'failed' })
      ]);
      setSettings(overview.settings);
      setDailyRewardInput(String(overview.settings.daily_reward_balance));
      setStats(overview.stats);
      setWhitelist(overview.whitelist);
      setOverviewRedeemCodes(redeemCodes);
      setOverviewFailedCheckins(failedCheckinsResp.items);
      setOverviewFailedCheckinsTotal(failedCheckinsResp.total);
      setOverviewFailedRedeemClaims(failedRedeemClaimsResp.items);
      setOverviewFailedRedeemClaimsTotal(failedRedeemClaimsResp.total);
    } catch (err) {
      if (isUnauthorizedError(err)) {
        await redirectToLogin();
        return;
      }
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }

  async function loadCheckins(filters: AdminCheckinQuery = checkinFilters) {
    setCheckinsLoading(true);
    setError('');
    try {
      const result = await api.listAdminCheckins(filters);
      setCheckinList(result);
    } catch (err) {
      if (isUnauthorizedError(err)) {
        await redirectToLogin();
        return;
      }
      setError(err instanceof Error ? err.message : '签到明细加载失败');
    } finally {
      setCheckinsLoading(false);
    }
  }

  useEffect(() => {
    if (user?.is_admin) {
      void loadOverview();
    }
  }, [user?.is_admin]);

  useEffect(() => {
    if (user?.is_admin) {
      void loadCheckins(checkinFilters);
    }
  }, [checkinFilters, user?.is_admin]);

  async function saveSettings() {
    if (!settings) return;
    const parsedReward = Number(dailyRewardInput);
    if (!Number.isFinite(parsedReward) || parsedReward <= 0) {
      setError('每日奖励余额必须大于 0');
      setMessage('');
      return;
    }
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const updated = await api.updateAdminSettings({
        ...settings,
        daily_reward_balance: parsedReward
      });
      setSettings(updated);
      setDailyRewardInput(String(updated.daily_reward_balance));
      setMessage('设置保存成功');
    } catch (err) {
      if (isUnauthorizedError(err)) {
        await redirectToLogin();
        return;
      }
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function addWhitelist() {
    if (!newSubject.trim()) return;
    setError('');
    setMessage('');
    try {
      const created = await api.addWhitelist({
        linuxdo_subject: newSubject.trim(),
        notes: newNotes.trim() || undefined
      });
      setNewSubject('');
      setNewNotes('');
      setWhitelist((current) => [...current.filter((item) => item.id !== created.id), created].sort((a, b) => a.id - b.id));
      setMessage('已添加管理员白名单');
    } catch (err) {
      if (isUnauthorizedError(err)) {
        await redirectToLogin();
        return;
      }
      setError(err instanceof Error ? err.message : '新增失败');
    }
  }

  async function removeWhitelist(id: number) {
    setError('');
    setMessage('');
    try {
      await api.removeWhitelist(id);
      setWhitelist((current) => current.filter((item) => item.id !== id));
      setMessage('已删除白名单');
    } catch (err) {
      if (isUnauthorizedError(err)) {
        await redirectToLogin();
        return;
      }
      setError(err instanceof Error ? err.message : '删除失败');
    }
  }

  function applyCheckinFilters() {
    if (
      checkinFilterForm.date_from &&
      checkinFilterForm.date_to &&
      checkinFilterForm.date_from > checkinFilterForm.date_to
    ) {
      setError('开始日期不能晚于结束日期');
      return;
    }
    setCheckinFilters({
      page: 1,
      page_size: checkinFilters.page_size ?? defaultCheckinFilters.page_size,
      subject: checkinFilterForm.subject.trim() || undefined,
      grant_status: checkinFilterForm.grant_status || undefined,
      date_from: checkinFilterForm.date_from || undefined,
      date_to: checkinFilterForm.date_to || undefined
    });
  }

  async function retryCheckin(id: number) {
    setRetryingId(id);
    setError('');
    setMessage('');
    try {
      const result = await api.retryAdminCheckin(id);
      const [statsResp] = await Promise.all([
        api.getDailyStats(30),
        loadCheckins(checkinFilters),
        refreshDashboardSnapshot()
      ]);
      setStats(statsResp);
      setMessage(`补发成功：${result.item.linuxdoSubject} / ${result.item.checkinDate}${result.new_balance !== null ? `，当前余额 ${result.new_balance}` : ''}`);
    } catch (err) {
      if (isUnauthorizedError(err)) {
        await redirectToLogin();
        return;
      }
      setError(err instanceof Error ? err.message : '补发失败');
    } finally {
      setRetryingId(null);
    }
  }

  async function retryAllFailed() {
    setBatchRetrying(true);
    setError('');
    setMessage('');
    setBatchRetryProgress({ done: 0, total: 0, successCount: 0, failCount: 0 });

    try {
      // 递归拉取所有失败签到记录（最多 200 条/页）
      const allFailed: AdminCheckinItem[] = [];
      let page = 1;
      while (true) {
        const resp = await api.listAdminCheckins({ page, page_size: 200, grant_status: 'failed' });
        allFailed.push(...resp.items);
        if (page >= resp.pages) break;
        page++;
      }

      if (allFailed.length === 0) {
        setMessage('当前没有需要补发的失败签到记录');
        setBatchRetrying(false);
        return;
      }

      setBatchRetryProgress({ done: 0, total: allFailed.length, successCount: 0, failCount: 0 });

      let successCount = 0;
      let failCount = 0;

      // 串行逐条补发，避免并发压垮后端
      for (let i = 0; i < allFailed.length; i++) {
        const item = allFailed[i];
        setRetryingId(item.id);
        try {
          await api.retryAdminCheckin(item.id);
          successCount++;
        } catch (err) {
          if (isUnauthorizedError(err)) {
            await redirectToLogin();
            return;
          }
          failCount++;
        }
        setBatchRetryProgress({ done: i + 1, total: allFailed.length, successCount, failCount });
      }

      // 全部完成后刷新数据
      setRetryingId(null);
      const [statsResp] = await Promise.all([
        api.getDailyStats(30),
        loadCheckins(checkinFilters),
        refreshDashboardSnapshot()
      ]);
      setStats(statsResp);
      setMessage(`一键补发完成：共 ${allFailed.length} 条，成功 ${successCount} 条，失败 ${failCount} 条`);
    } catch (err) {
      if (isUnauthorizedError(err)) {
        await redirectToLogin();
        return;
      }
      setError(err instanceof Error ? err.message : '一键补发出错');
    } finally {
      setRetryingId(null);
      setBatchRetrying(false);
    }
  }

  if (loading) {
    return (
      <div className="page page-center">
        <div className="card auth-card">
          <span className="eyebrow">管理后台</span>
          <h1 className="hero-title">福利后台</h1>
          <p className="loading-text">加载中...</p>
        </div>
      </div>
    );
  }

  if (!user?.is_admin) {
    return (
      <div className="page page-center">
        <div className="card auth-card">
          <span className="eyebrow">无权限</span>
          <h1 className="hero-title">无权限访问</h1>
          <p className="alert error">{error || '当前账号不在管理员白名单中'}</p>
          <Link to="/checkin" className="button" style={{ marginTop: 12 }}>
            → 返回签到页
          </Link>
        </div>
      </div>
    );
  }

  const currentSection = sections.find((item) => item.id === activeSection) ?? sections[0];
  const urgentTotal = overviewFailedCheckinsTotal + overviewFailedRedeemClaimsTotal;

  return (
    <div className="page admin-dashboard-page">
      <div className="admin-dashboard-shell">
        <aside className="admin-dashboard-sidebar">
          <div className="admin-brand">
            <div className="admin-brand-mark">WF</div>
            <div>
              <span className="admin-sidebar-kicker">Welfare Station</span>
              <h1>CONTROL ROOM</h1>
              <p>把签到、兑换码与权限操作收进一个值守界面。</p>
            </div>
          </div>

          <nav className="admin-nav">
            {sections.map((item) => (
              <button
                key={item.id}
                className={`admin-nav-item ${activeSection === item.id ? 'active' : ''}`}
                onClick={() => setActiveSection(item.id)}
              >
                <span className="admin-nav-icon">
                  <Icon name={item.icon} size={16} />
                </span>
                <span className="admin-nav-copy">
                  <strong>{item.label}</strong>
                  <small>{item.description}</small>
                </span>
                <span className="admin-nav-count">
                  {item.id === 'checkins'
                    ? stats?.total_checkins ?? 0
                    : item.id === 'redeemCodes'
                      ? overviewRedeemCodes.length
                      : item.id === 'redeemClaims'
                        ? urgentTotal
                        : item.id === 'whitelist'
                          ? whitelist.length
                          : '•'}
                </span>
              </button>
            ))}
          </nav>

          <div className="admin-sidebar-foot">
            <div className="admin-sidebar-foot-card">
              <span className="admin-sidebar-kicker">当前值守</span>
              <div className="admin-identity" style={{ padding: 0, border: 'none', background: 'transparent', margin: '12px 0' }}>
                {user.avatar_url && <img className="user-avatar user-avatar-sm" src={user.avatar_url} alt={user.username} />}
                <div className="stack">
                  <strong>{user.username}</strong>
                  <span className="muted" style={{ fontSize: 12 }}>sub2api #{user.sub2api_user_id}</span>
                </div>
              </div>
              <p style={{ fontSize: 12, marginTop: 12, borderTop: '1px solid rgba(0,0,0,0.06)', paddingTop: 12 }}>
                {settings?.checkin_enabled ? '🟢 签到运行中' : '🔴 签到已关闭'}<br />业务时区 {settings?.timezone ?? '-'}
              </p>
            </div>
            <Link to="/checkin" className="button ghost admin-sidebar-link" style={{ marginTop: 8 }}>
              ← 返回主站
            </Link>
          </div>
        </aside>

        <main className="admin-dashboard-main">
          <header className="admin-dashboard-header">
            <div>
              <span className="admin-surface-kicker" style={{ color: 'var(--ink-2)' }}>Welfare Control Room</span>
              <h2>{currentSection.title}</h2>
              <p>{currentSection.description}</p>
            </div>
            <div className="admin-header-actions">
              <button className="button" onClick={() => void loadOverview()}>
                <Icon name="bolt" size={16} /> 刷新数据
              </button>
            </div>
          </header>

          {error && <p className="alert error admin-dashboard-alert">{error}</p>}
          {message && <p className="alert success admin-dashboard-alert">{message}</p>}

          {activeSection === 'overview' && (
            <AdminDashboardOverview
              settings={settings}
              stats={stats}
              whitelist={whitelist}
              redeemCodes={overviewRedeemCodes}
              failedCheckins={overviewFailedCheckins}
              failedCheckinsTotal={overviewFailedCheckinsTotal}
              failedRedeemClaims={overviewFailedRedeemClaims}
              failedRedeemClaimsTotal={overviewFailedRedeemClaimsTotal}
              onOpenCheckins={() => setActiveSection('checkins')}
              onOpenRedeemCodes={() => setActiveSection('redeemCodes')}
              onOpenRedeemClaims={() => setActiveSection('redeemClaims')}
            />
          )}

          {activeSection === 'checkins' && (
            <AdminCheckinsPanel
              settings={settings}
              dailyRewardInput={dailyRewardInput}
              onDailyRewardInputChange={setDailyRewardInput}
              onSettingsChange={setSettings}
              stats={stats}
              saving={saving}
              onSaveSettings={saveSettings}
              checkinList={checkinList}
              checkinsLoading={checkinsLoading}
              checkinFilters={checkinFilters}
              checkinFilterForm={checkinFilterForm}
              onCheckinFilterFormChange={(updater) => setCheckinFilterForm((current) => updater(current))}
              onApplyFilters={applyCheckinFilters}
              onResetFilters={() => {
                setCheckinFilterForm(defaultCheckinFilterForm);
                setCheckinFilters(defaultCheckinFilters);
              }}
              retryingId={retryingId}
              onRetryCheckin={retryCheckin}
              batchRetrying={batchRetrying}
              batchRetryProgress={batchRetryProgress}
              onRetryAllFailed={retryAllFailed}
              onChangePage={(nextPage) => {
                if (!checkinList || nextPage < 1 || nextPage > checkinList.pages || nextPage === checkinList.page) {
                  return;
                }
                setCheckinFilters((current) => ({ ...current, page: nextPage }));
              }}
            />
          )}

          {activeSection === 'redeemCodes' && (
            <AdminRedeemCodesPanel
              onUnauthorized={redirectToLogin}
              onError={setError}
              onSuccess={setMessage}
              onCodesChanged={refreshDashboardSnapshot}
            />
          )}

          {activeSection === 'redeemClaims' && (
            <AdminRedeemClaimsPanel
              onUnauthorized={redirectToLogin}
              onError={setError}
              onSuccess={setMessage}
              onClaimsChanged={refreshDashboardSnapshot}
            />
          )}

          {activeSection === 'whitelist' && (
            <AdminWhitelistPanel
              userName={user.username}
              whitelist={whitelist}
              newSubject={newSubject}
              newNotes={newNotes}
              onSubjectChange={setNewSubject}
              onNotesChange={setNewNotes}
              onAdd={addWhitelist}
              onRemove={removeWhitelist}
            />
          )}
        </main>
      </div>
    </div>
  );
}
