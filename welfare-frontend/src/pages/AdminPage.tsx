import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import '../admin.css';
import { Icon } from '../components/Icon';
import { AdminBlindboxPanel } from '../components/AdminBlindboxPanel';
import { AdminCheckinsPanel } from '../components/AdminCheckinsPanel';
import { AdminDashboardOverview } from '../components/AdminDashboardOverview';
import { AdminDistributionDetectionPanel } from '../components/AdminDistributionDetectionPanel';
import { AdminResetRecordsPanel } from '../components/AdminResetRecordsPanel';
import { AdminRedeemCodesPanel } from '../components/AdminRedeemCodesPanel';
import { AdminRedeemClaimsPanel } from '../components/AdminRedeemClaimsPanel';
import { AdminUserCleanupPanel } from '../components/AdminUserCleanupPanel';
import { AdminWhitelistPanel } from '../components/AdminWhitelistPanel';
import { useAuth } from '../lib/auth';
import { api, isUnauthorizedError } from '../lib/api';
import type {
  AdminCheckinItem,
  AdminCheckinList,
  AdminCheckinQuery,
  AdminRiskOverview,
  AdminRedeemClaimItem,
  AdminRedeemCodeItem,
  AdminSettings,
  AdminUserSearchItem,
  DailyStats,
  WhitelistItem
} from '../types';
import { motion } from 'framer-motion';
import { pageVariants } from '../lib/animations';

type AdminSection =
  | 'overview'
  | 'distributionDetection'
  | 'checkins'
  | 'resetRecords'
  | 'redeemCodes'
  | 'redeemClaims'
  | 'userCleanup'
  | 'whitelist';

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
    description: '先看状态、异常和趋势。',
    icon: 'grid'
  },
  {
    id: 'distributionDetection',
    label: '分发检测',
    title: '分发风控台',
    description: '巡检异常分发、查看证据并执行人工恢复。',
    icon: 'chart'
  },
  {
    id: 'checkins',
    label: '签到管理',
    title: '签到控制',
    description: '配置签到规则并处理失败流水。',
    icon: 'bolt'
  },
  {
    id: 'resetRecords',
    label: '额度重置',
    title: '重置控制台',
    description: '管理重置规则和补差流水。',
    icon: 'grid'
  },
  {
    id: 'redeemCodes',
    label: '兑换码',
    title: '兑换码资产池',
    description: '管理兑换码和活动额度。',
    icon: 'ticket'
  },
  {
    id: 'redeemClaims',
    label: '兑换记录',
    title: '兑换记录台',
    description: '处理兑换失败和补发异常。',
    icon: 'chart'
  },
  {
    id: 'userCleanup',
    label: '用户清理',
    title: '候选清理用户',
    description: '筛出可清理候选并执行删除。',
    icon: 'users'
  },
  {
    id: 'whitelist',
    label: '管理员',
    title: '权限白名单',
    description: '维护后台访问名单。',
    icon: 'users'
  }
];

export function AdminPage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [activeSection, setActiveSection] = useState<AdminSection>('overview');
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [dailyRewardMinInput, setDailyRewardMinInput] = useState('');
  const [dailyRewardMaxInput, setDailyRewardMaxInput] = useState('');
  const [stats, setStats] = useState<DailyStats | null>(null);
  const [riskOverview, setRiskOverview] = useState<AdminRiskOverview | null>(null);
  const [checkinList, setCheckinList] = useState<AdminCheckinList | null>(null);
  const [checkinFilters, setCheckinFilters] = useState<AdminCheckinQuery>(defaultCheckinFilters);
  const [checkinFilterForm, setCheckinFilterForm] = useState(defaultCheckinFilterForm);
  const [whitelist, setWhitelist] = useState<WhitelistItem[]>([]);
  const [adminSearchQuery, setAdminSearchQuery] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [adminSearchResults, setAdminSearchResults] = useState<AdminUserSearchItem[]>([]);
  const [adminSearchLoading, setAdminSearchLoading] = useState(false);
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

  function setMessage(msg: string) {
    if (msg) toast.success(msg);
  }

  function setError(msg: string) {
    if (msg) toast.error(msg);
  }

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
      const [overview, riskOverviewResp, redeemCodes, failedCheckinsResp, failedRedeemClaimsResp] = await Promise.all([
        api.getAdminOverview(),
        api.getAdminRiskOverview(),
        api.listAdminRedeemCodes(),
        api.listAdminCheckins({ page: 1, page_size: 4, grant_status: 'failed' }),
        api.listAdminRedeemClaims({ page: 1, page_size: 4, grant_status: 'failed' })
      ]);
      setSettings(overview.settings);
      setDailyRewardMinInput(String(overview.settings.daily_reward_min_balance));
      setDailyRewardMaxInput(String(overview.settings.daily_reward_max_balance));
      setStats(overview.stats);
      setWhitelist(overview.whitelist);
      setRiskOverview(riskOverviewResp);
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
    const parsedMinReward = Number(dailyRewardMinInput);
    const parsedMaxReward = Number(dailyRewardMaxInput);
    if (!Number.isFinite(parsedMinReward) || parsedMinReward <= 0) {
      setError('签到奖励最小值必须大于 0');
      setMessage('');
      return;
    }
    if (!Number.isFinite(parsedMaxReward) || parsedMaxReward <= 0) {
      setError('签到奖励最大值必须大于 0');
      setMessage('');
      return;
    }
    if (parsedMaxReward < parsedMinReward) {
      setError('签到奖励最大值不能小于最小值');
      setMessage('');
      return;
    }
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const updated = await api.updateAdminSettings({
        ...settings,
        daily_reward_min_balance: parsedMinReward,
        daily_reward_max_balance: parsedMaxReward
      });
      setSettings(updated);
      setDailyRewardMinInput(String(updated.daily_reward_min_balance));
      setDailyRewardMaxInput(String(updated.daily_reward_max_balance));
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

  async function searchAdminUsers() {
    setError('');
    setMessage('');
    if (!adminSearchQuery.trim()) {
      setAdminSearchResults([]);
      setError('请输入用户名或邮箱再搜索');
      return;
    }

    setAdminSearchLoading(true);
    try {
      const results = await api.searchAdminSub2apiUsers(adminSearchQuery.trim());
      setAdminSearchResults(results);
      setMessage(results.length > 0 ? `已找到 ${results.length} 个候选用户` : '未找到匹配用户');
    } catch (err) {
      if (isUnauthorizedError(err)) {
        await redirectToLogin();
        return;
      }
      setError(err instanceof Error ? err.message : '搜索失败');
    } finally {
      setAdminSearchLoading(false);
    }
  }

  async function addWhitelist(targetUser: AdminUserSearchItem) {
    setError('');
    setMessage('');
    try {
      const payload = {
        sub2api_user_id: targetUser.sub2api_user_id,
        email: targetUser.email,
        username: targetUser.username,
        notes: newNotes.trim() || undefined
      } as {
        sub2api_user_id: number;
        email: string;
        username: string;
        linuxdo_subject?: string | null;
        notes?: string;
      };
      if (targetUser.linuxdo_subject) {
        payload.linuxdo_subject = targetUser.linuxdo_subject;
      }

      const created = await api.addWhitelist(payload);
      setWhitelist((current) =>
        [...current.filter((item) => item.id !== created.id), created].sort((a, b) => a.id - b.id)
      );
      setNewNotes('');
      setMessage(`已添加管理员：${created.username || created.email}`);
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
      const identity = result.item.sub2apiUsername || result.item.sub2apiEmail;
      setMessage(`补发成功：${identity} / ${result.item.checkinDate}${result.new_balance !== null ? `，当前余额 ${result.new_balance}` : ''}`);
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
          <p className="alert error">当前账号不在管理员白名单中</p>
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
    <motion.div 
      className="admin-workspace"
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      <aside className="admin-sidebar-modern">
        <div className="admin-sidebar-header">
          <div className="admin-brand-logo">
            <div className="admin-logo-mark">WF</div>
            Control Room
          </div>
        </div>

        <nav className="admin-nav-menu">
          {sections.map((item) => (
            <button
              key={item.id}
              className={`admin-nav-item-modern ${activeSection === item.id ? 'active' : ''}`}
              onClick={() => setActiveSection(item.id)}
            >
              {activeSection === item.id && (
                <motion.div
                  layoutId="admin-nav-highlight"
                  className="admin-nav-highlight"
                  initial={false}
                  transition={{ type: "spring", stiffness: 400, damping: 30 }}
                />
              )}
              <Icon name={item.icon} size={16} />
              <span>{item.label}</span>
                <span className="admin-nav-badge">
                  {item.id === 'checkins'
                    ? stats?.total_checkins ?? 0
                  : item.id === 'distributionDetection'
                    ? (riskOverview?.open_event_count ?? 0) + (riskOverview?.observe_count_1h ?? 0)
                  : item.id === 'resetRecords'
                      ? settings?.reset_enabled ? 'ON' : 'OFF'
                  : item.id === 'redeemCodes'
                    ? overviewRedeemCodes.length
                    : item.id === 'redeemClaims'
                      ? urgentTotal
                      : item.id === 'userCleanup'
                        ? '🧹'
                      : item.id === 'whitelist'
                        ? whitelist.length
                        : '•'}
              </span>
            </button>
          ))}
        </nav>

        <div className="admin-sidebar-footer">
          <div className="admin-user-profile">
            {user.avatar_url ? (
              <img className="admin-user-avatar" src={user.avatar_url} alt={user.username} />
            ) : (
              <div className="admin-card-icon"><Icon name="users" size={16} /></div>
            )}
            <div className="admin-user-info">
              <span className="admin-user-name">{user.username}</span>
              <span className="admin-user-role">ID: {user.sub2api_user_id}</span>
            </div>
          </div>
          <Link to="/checkin" className="button ghost wide" style={{ height: '32px', fontSize: '13px', margin: 0 }}>
            ← 返回主站
          </Link>
          <div className="admin-system-status">
            <span className={`admin-status-dot ${settings?.checkin_enabled ? 'healthy' : 'error'}`} />
            {settings?.checkin_enabled ? '系统正常运行' : '签到已关闭'} • {settings?.timezone ?? 'UTC'}
          </div>
        </div>
      </aside>

      <main className="admin-main-content">
        <header className="admin-header-modern">
          <div className="admin-header-title">
            <h2>{currentSection.title}</h2>
            <p>{currentSection.description}</p>
          </div>
          <div className="admin-header-actions">
            <button className="button ghost" onClick={() => void loadOverview()}>
              <Icon name="bolt" size={16} /> 刷新
            </button>
          </div>
        </header>
        
        <div className="admin-page-body">

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

          {activeSection === 'distributionDetection' && (
            <AdminDistributionDetectionPanel
              overview={riskOverview}
              onOverviewChange={setRiskOverview}
              onUnauthorized={redirectToLogin}
              onError={setError}
              onSuccess={setMessage}
            />
          )}

          {activeSection === 'checkins' && (
            <>
              <AdminCheckinsPanel
                settings={settings}
                dailyRewardMinInput={dailyRewardMinInput}
                dailyRewardMaxInput={dailyRewardMaxInput}
                onDailyRewardMinInputChange={setDailyRewardMinInput}
                onDailyRewardMaxInputChange={setDailyRewardMaxInput}
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
              <AdminBlindboxPanel
                blindboxEnabled={settings?.blindbox_enabled ?? false}
                onUnauthorized={redirectToLogin}
                onError={setError}
                onSuccess={setMessage}
                onToggleBlindboxEnabled={async (next) => {
                  if (!settings) {
                    return;
                  }
                  setSaving(true);
                  setError('');
                  setMessage('');
                  try {
                    const updated = await api.updateAdminSettings({
                      ...settings,
                      blindbox_enabled: next
                    });
                    setSettings(updated);
                    setMessage(next ? '已开启盲盒签到' : '已关闭盲盒签到');
                  } catch (err) {
                    if (isUnauthorizedError(err)) {
                      await redirectToLogin();
                      return;
                    }
                    setError(err instanceof Error ? err.message : '盲盒签到开关更新失败');
                  } finally {
                    setSaving(false);
                  }
                }}
              />
            </>
          )}

          {activeSection === 'redeemCodes' && (
            <AdminRedeemCodesPanel
              onUnauthorized={redirectToLogin}
              onError={setError}
              onSuccess={setMessage}
              onCodesChanged={refreshDashboardSnapshot}
            />
          )}

          {activeSection === 'resetRecords' && (
            <AdminResetRecordsPanel
              settings={settings}
              onSettingsChange={setSettings}
              onUnauthorized={redirectToLogin}
              onError={setError}
              onSuccess={setMessage}
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
              currentUserId={user.sub2api_user_id}
              whitelist={whitelist}
              searchQuery={adminSearchQuery}
              newNotes={newNotes}
              searchResults={adminSearchResults}
              searching={adminSearchLoading}
              onSearchQueryChange={setAdminSearchQuery}
              onNotesChange={setNewNotes}
              onSearch={searchAdminUsers}
              onAdd={addWhitelist}
              onRemove={removeWhitelist}
            />
          )}

          {activeSection === 'userCleanup' && (
            <AdminUserCleanupPanel
              onUnauthorized={redirectToLogin}
              onError={setError}
              onSuccess={setMessage}
            />
          )}
        </div>
      </main>
    </motion.div>
  );
}
