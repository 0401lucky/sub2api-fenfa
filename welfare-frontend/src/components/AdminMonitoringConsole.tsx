import { useEffect, useMemo, useState } from 'react';
import { Icon } from './Icon';
import { formatAdminDateTime } from '../lib/admin-format';
import { api, isUnauthorizedError } from '../lib/api';
import type {
  AdminMonitoringActionItem,
  AdminMonitoringActionList,
  AdminMonitoringActionType,
  AdminMonitoringIpCloudflareStatus,
  AdminMonitoringIpDetailResponse,
  AdminMonitoringIpList,
  AdminMonitoringIpUserItem,
  AdminMonitoringOverview,
  AdminMonitoringUserDetailResponse,
  AdminMonitoringUserItem,
  AdminMonitoringUserList,
  AdminRiskEvent,
  AdminRiskEventList,
  AdminRiskEventQuery,
  AdminRiskObservation,
  AdminRiskObservationList,
  AdminRiskOverview,
  AdminRiskRuleHit,
  AdminRiskScanResult
} from '../types';

interface AdminMonitoringConsoleProps {
  onUnauthorized: () => Promise<void>;
  onError: (message: string) => void;
  onSuccess: (message: string) => void;
  refreshSignal?: number;
}

type Workspace = 'ip' | 'users' | 'risk' | 'audit';
type DrawerState =
  | {
      type: 'ip';
      ipAddress: string;
    }
  | {
      type: 'user';
      userId: number;
    }
  | null;

const compactNumberFormatter = new Intl.NumberFormat('zh-CN');

const defaultIpFilters = {
  page: 1,
  page_size: 8,
  search: ''
};

const defaultUserFilters = {
  page: 1,
  page_size: 8
};

const defaultActionFilters = {
  page: 1,
  page_size: 12
};

const defaultRiskEventFilters: AdminRiskEventQuery = {
  page: 1,
  page_size: 12
};

function formatCompactCount(value: number): string {
  return compactNumberFormatter.format(value);
}

function buildIdentityMark(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    return 'NA';
  }

  return normalized.slice(0, 2).toUpperCase();
}

function getUserPrimaryLabel(item: {
  sub2api_username: string;
  sub2api_email: string;
}): string {
  return item.sub2api_username || item.sub2api_email;
}

function isDisabledStatus(status: string): boolean {
  return status.trim().toLowerCase() === 'disabled';
}

function describeRiskBand(
  band: 'normal' | 'observe' | 'block'
): { label: string; className: 'success' | 'pending' | 'failed' } {
  if (band === 'block') {
    return { label: '高危', className: 'failed' };
  }
  if (band === 'observe') {
    return { label: '观察', className: 'pending' };
  }
  return { label: '正常', className: 'success' };
}

function describeRiskStatus(item: {
  risk_status: AdminRiskEvent['status'] | null;
  is_admin_protected: boolean;
  sub2api_status: string;
}) {
  if (item.risk_status === 'active') {
    return { label: '封禁中', className: 'failed' as const };
  }
  if (item.risk_status === 'pending_release') {
    return { label: '待恢复', className: 'pending' as const };
  }
  if (item.is_admin_protected) {
    return { label: '管理员保护', className: 'success' as const };
  }
  if (isDisabledStatus(item.sub2api_status)) {
    return { label: '已禁用', className: 'failed' as const };
  }
  return { label: '正常', className: 'success' as const };
}

function describeCloudflareMode(
  mode: NonNullable<AdminMonitoringIpCloudflareStatus['rule']>['mode']
): string {
  switch (mode) {
    case 'managed_challenge':
      return '托管质询';
    case 'block':
      return '直接封禁';
    case 'challenge':
      return '传统质询';
    case 'js_challenge':
      return 'JS 质询';
    case 'whitelist':
      return '放行';
    default:
      return mode;
  }
}

function describeActionType(type: AdminMonitoringActionType): string {
  switch (type) {
    case 'disable_user':
      return '手动禁用';
    case 'enable_user':
      return '手动恢复';
    case 'release_risk_event':
      return '释放风险事件';
    case 'run_risk_scan':
      return '手动扫描';
    case 'cloudflare_challenge_ip':
      return 'Cloudflare 质询';
    case 'cloudflare_block_ip':
      return 'Cloudflare 封禁';
    case 'cloudflare_unblock_ip':
      return 'Cloudflare 解除';
    default:
      return type;
  }
}

function describeActionResultStatus(status: AdminMonitoringActionItem['result_status']) {
  if (status === 'success') {
    return { label: '成功', className: 'success' as const };
  }
  if (status === 'blocked') {
    return { label: '已拦截', className: 'pending' as const };
  }
  return { label: '失败', className: 'failed' as const };
}

function describeCloudflareStatus(
  status: AdminMonitoringIpCloudflareStatus | null
): { label: string; className: 'success' | 'pending' | 'failed' } {
  if (!status) {
    return { label: '未读取', className: 'pending' };
  }
  if (!status.enabled) {
    return { label: '未接通', className: 'pending' };
  }
  if (status.rule) {
    return {
      label: describeCloudflareMode(status.rule.mode),
      className: status.rule.mode === 'block' ? 'failed' : 'pending'
    };
  }
  return { label: '未下发', className: 'success' };
}

function getUserActionState(item: {
  is_admin_protected: boolean;
  risk_status: AdminRiskEvent['status'] | null;
  sub2api_status: string;
}) {
  if (item.is_admin_protected) {
    return { disabled: true, action: 'disable' as const, label: '受保护' };
  }
  if (isDisabledStatus(item.sub2api_status)) {
    if (item.risk_status) {
      return { disabled: true, action: 'enable' as const, label: '先释放风险事件' };
    }
    return { disabled: false, action: 'enable' as const, label: '恢复用户' };
  }
  return { disabled: false, action: 'disable' as const, label: '禁用用户' };
}

function describeScanStatus(status: AdminRiskOverview['last_scan']['last_status'] | undefined): string {
  if (status === 'running') return '同步中';
  if (status === 'failed') return '最近失败';
  if (status === 'success') return '最近成功';
  return '尚未执行';
}

function describeReleaseAvailability(item: AdminRiskEvent): string {
  if (item.status === 'pending_release') return '已进入人工恢复窗口';
  if (item.status === 'released') return '事件已归档';
  return '仍在最短锁定期内';
}

function sortRuleHits(hits: AdminRiskRuleHit[]): AdminRiskRuleHit[] {
  const levelWeight = { high: 3, warn: 2, info: 1 };
  return [...hits].sort((left, right) => {
    if (levelWeight[right.level] !== levelWeight[left.level]) {
      return levelWeight[right.level] - levelWeight[left.level];
    }
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    return right.actual - left.actual;
  });
}

function MetricCard(props: {
  label: string;
  value: string;
  note: string;
  tone?: 'normal' | 'warning' | 'danger';
  icon: 'chart' | 'users' | 'link' | 'shield' | 'grid' | 'bolt';
}) {
  return (
    <article className={`monitoring-metric-card tone-${props.tone ?? 'normal'}`}>
      <div className="monitoring-metric-head">
        <span className="monitoring-metric-label">{props.label}</span>
        <div className="monitoring-metric-icon">
          <Icon name={props.icon} size={16} />
        </div>
      </div>
      <strong className="monitoring-metric-value">{props.value}</strong>
      <small>{props.note}</small>
    </article>
  );
}

function PaginationBar(props: {
  page: number;
  pages: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div className="pagination-bar monitoring-pagination-bar">
      <span className="muted">
        第 {props.page} / {props.pages} 页，共 {props.total} 条
      </span>
      <div className="actions">
        <button className="button ghost" disabled={props.page <= 1} onClick={props.onPrev}>
          上一页
        </button>
        <button className="button ghost" disabled={props.page >= props.pages} onClick={props.onNext}>
          下一页
        </button>
      </div>
    </div>
  );
}

function RuleHitStack(props: { hits: AdminRiskRuleHit[] }) {
  if (props.hits.length === 0) {
    return <span className="chip">暂无规则命中</span>;
  }

  return (
    <div className="monitoring-rule-hit-list">
      {sortRuleHits(props.hits).map((hit) => (
        <span key={`${hit.code}-${hit.window}`} className={`chip monitoring-rule-hit ${hit.level}`}>
          {hit.label} · {hit.actual}/{hit.threshold}
        </span>
      ))}
    </div>
  );
}

export function AdminMonitoringConsole({
  onUnauthorized,
  onError,
  onSuccess,
  refreshSignal = 0
}: AdminMonitoringConsoleProps) {
  const [workspace, setWorkspace] = useState<Workspace>('ip');
  const [overview, setOverview] = useState<AdminMonitoringOverview | null>(null);
  const [riskOverview, setRiskOverview] = useState<AdminRiskOverview | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [ipFilters, setIpFilters] = useState(defaultIpFilters);
  const [ipSearchInput, setIpSearchInput] = useState('');
  const [ipList, setIpList] = useState<AdminMonitoringIpList | null>(null);
  const [ipLoading, setIpLoading] = useState(true);
  const [userFilters, setUserFilters] = useState(defaultUserFilters);
  const [userList, setUserList] = useState<AdminMonitoringUserList | null>(null);
  const [userLoading, setUserLoading] = useState(false);
  const [riskEventFilters, setRiskEventFilters] = useState(defaultRiskEventFilters);
  const [observations, setObservations] = useState<AdminRiskObservationList | null>(null);
  const [riskEvents, setRiskEvents] = useState<AdminRiskEventList | null>(null);
  const [riskLoading, setRiskLoading] = useState(false);
  const [actionFilters, setActionFilters] = useState(defaultActionFilters);
  const [actionTypeFilter, setActionTypeFilter] = useState<AdminMonitoringActionType | ''>('');
  const [actions, setActions] = useState<AdminMonitoringActionList | null>(null);
  const [actionsLoading, setActionsLoading] = useState(false);
  const [drawer, setDrawer] = useState<DrawerState>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [ipDetail, setIpDetail] = useState<AdminMonitoringIpDetailResponse | null>(null);
  const [userDetail, setUserDetail] = useState<AdminMonitoringUserDetailResponse | null>(null);
  const [busyUserId, setBusyUserId] = useState<number | null>(null);
  const [busyIpAction, setBusyIpAction] = useState<'challenge' | 'block' | 'clear' | null>(null);
  const [releasingId, setReleasingId] = useState<number | null>(null);
  const [scanning, setScanning] = useState(false);
  const [ipActionReason, setIpActionReason] = useState('');
  const [userActionReason, setUserActionReason] = useState('');
  const [riskActionReason, setRiskActionReason] = useState('');

  async function handleRequestError(error: unknown, fallbackMessage: string) {
    if (isUnauthorizedError(error)) {
      await onUnauthorized();
      return;
    }

    onError(error instanceof Error ? error.message : fallbackMessage);
  }

  async function loadSummary() {
    setSummaryLoading(true);
    try {
      const [overviewResult, riskOverviewResult] = await Promise.all([
        api.getAdminMonitoringOverview(),
        api.getAdminMonitoringRiskOverview()
      ]);
      setOverview(overviewResult);
      setRiskOverview(riskOverviewResult);
    } catch (error) {
      await handleRequestError(error, '监控总览加载失败');
    } finally {
      setSummaryLoading(false);
    }
  }

  async function loadIpList(nextFilters = ipFilters) {
    setIpLoading(true);
    try {
      const result = await api.listAdminMonitoringIps(nextFilters);
      setIpList(result);
    } catch (error) {
      await handleRequestError(error, 'IP 榜单加载失败');
    } finally {
      setIpLoading(false);
    }
  }

  async function loadUserList(nextFilters = userFilters) {
    setUserLoading(true);
    try {
      const result = await api.listAdminMonitoringUsers(nextFilters);
      setUserList(result);
    } catch (error) {
      await handleRequestError(error, '用户榜单加载失败');
    } finally {
      setUserLoading(false);
    }
  }

  async function loadRiskWorkspace(nextFilters = riskEventFilters) {
    setRiskLoading(true);
    try {
      const [observationResult, riskEventResult] = await Promise.all([
        api.listAdminMonitoringRiskObservations({
          page: 1,
          page_size: 12
        }),
        api.listAdminMonitoringRiskEvents(nextFilters)
      ]);
      setObservations(observationResult);
      setRiskEvents(riskEventResult);
    } catch (error) {
      await handleRequestError(error, '风险队列加载失败');
    } finally {
      setRiskLoading(false);
    }
  }

  async function loadActionsWorkspace(
    nextFilters = actionFilters,
    nextActionType = actionTypeFilter || undefined
  ) {
    setActionsLoading(true);
    try {
      const result = await api.listAdminMonitoringActions({
        ...nextFilters,
        action_type: nextActionType
      });
      setActions(result);
    } catch (error) {
      await handleRequestError(error, '处置审计加载失败');
    } finally {
      setActionsLoading(false);
    }
  }

  async function openIpDrawer(ipAddress: string) {
    setDrawer({ type: 'ip', ipAddress });
    setDrawerLoading(true);
    setUserDetail(null);
    try {
      const result = await api.getAdminMonitoringIpDetail(ipAddress);
      setIpDetail(result);
    } catch (error) {
      await handleRequestError(error, 'IP 详情加载失败');
    } finally {
      setDrawerLoading(false);
    }
  }

  async function openUserDrawer(userId: number) {
    setDrawer({ type: 'user', userId });
    setDrawerLoading(true);
    setIpDetail(null);
    try {
      const result = await api.getAdminMonitoringUserDetail(userId);
      setUserDetail(result);
    } catch (error) {
      await handleRequestError(error, '用户详情加载失败');
    } finally {
      setDrawerLoading(false);
    }
  }

  async function refreshDrawer() {
    if (!drawer) {
      return;
    }

    if (drawer.type === 'ip') {
      await openIpDrawer(drawer.ipAddress);
      return;
    }

    await openUserDrawer(drawer.userId);
  }

  async function refreshWorkspace() {
    if (workspace === 'ip') {
      await loadIpList();
      return;
    }
    if (workspace === 'users') {
      await loadUserList();
      return;
    }
    if (workspace === 'risk') {
      await loadRiskWorkspace();
      return;
    }
    await loadActionsWorkspace();
  }

  async function refreshAll() {
    await Promise.all([loadSummary(), refreshWorkspace(), refreshDrawer()]);
  }

  useEffect(() => {
    void loadSummary();
  }, [refreshSignal]);

  useEffect(() => {
    if (workspace === 'ip') {
      void loadIpList();
    }
  }, [workspace, ipFilters, refreshSignal]);

  useEffect(() => {
    if (workspace === 'users') {
      void loadUserList();
    }
  }, [workspace, userFilters, refreshSignal]);

  useEffect(() => {
    if (workspace === 'risk') {
      void loadRiskWorkspace();
    }
  }, [workspace, riskEventFilters, refreshSignal]);

  useEffect(() => {
    if (workspace === 'audit') {
      void loadActionsWorkspace();
    }
  }, [workspace, actionFilters, actionTypeFilter, refreshSignal]);

  async function handleUserAction(item: AdminMonitoringUserItem | AdminMonitoringIpUserItem) {
    const state = getUserActionState(item);
    if (state.disabled) {
      return;
    }

    const actionLabel = state.action === 'disable' ? '禁用' : '恢复';
    if (!window.confirm(`确认${actionLabel} ${getUserPrimaryLabel(item)} 吗？`)) {
      return;
    }

    setBusyUserId(item.sub2api_user_id);
    try {
      if (state.action === 'disable') {
        await api.disableAdminMonitoringUser(item.sub2api_user_id, {
          reason: userActionReason.trim() || undefined
        });
        onSuccess(`已禁用 ${getUserPrimaryLabel(item)}`);
      } else {
        await api.enableAdminMonitoringUser(item.sub2api_user_id, {
          reason: userActionReason.trim() || undefined
        });
        onSuccess(`已恢复 ${getUserPrimaryLabel(item)}`);
      }
      await Promise.all([loadSummary(), refreshWorkspace(), refreshDrawer()]);
    } catch (error) {
      await handleRequestError(error, `${actionLabel}用户失败`);
    } finally {
      setBusyUserId(null);
    }
  }

  async function handleIpAction(action: 'challenge' | 'block' | 'clear') {
    if (!ipDetail) {
      return;
    }

    const ipAddress = ipDetail.ip.ip_address;
    const actionText =
      action === 'challenge' ? '托管质询' : action === 'block' ? '直接封禁' : '解除规则';
    if (!window.confirm(`确认对 ${ipAddress} 执行 ${actionText} 吗？`)) {
      return;
    }

    setBusyIpAction(action);
    try {
      if (action === 'challenge') {
        await api.challengeAdminMonitoringIp(ipAddress, {
          reason: ipActionReason.trim() || undefined
        });
        onSuccess(`已对 ${ipAddress} 下发托管质询`);
      } else if (action === 'block') {
        await api.blockAdminMonitoringIp(ipAddress, {
          reason: ipActionReason.trim() || undefined
        });
        onSuccess(`已对 ${ipAddress} 下发直接封禁`);
      } else {
        await api.clearAdminMonitoringIpCloudflare(ipAddress, {
          reason: ipActionReason.trim() || undefined
        });
        onSuccess(`已解除 ${ipAddress} 的托管规则`);
      }
      await Promise.all([loadSummary(), loadIpList(), refreshDrawer()]);
    } catch (error) {
      await handleRequestError(error, 'Cloudflare 操作失败');
    } finally {
      setBusyIpAction(null);
    }
  }

  async function handleRiskRelease(event: AdminRiskEvent) {
    if (
      !window.confirm(
        `确认释放风险事件 #${event.id} 并恢复 ${event.sub2apiUsername || event.sub2apiEmail} 吗？`
      )
    ) {
      return;
    }

    setReleasingId(event.id);
    try {
      await api.releaseAdminMonitoringRiskEvent(event.id, {
        reason: riskActionReason.trim() || undefined
      });
      onSuccess(`已释放风险事件 #${event.id}`);
      await Promise.all([loadSummary(), loadRiskWorkspace(), refreshDrawer()]);
    } catch (error) {
      await handleRequestError(error, '释放风险事件失败');
    } finally {
      setReleasingId(null);
    }
  }

  async function handleRiskScan() {
    setScanning(true);
    try {
      const result: AdminRiskScanResult = await api.scanAdminMonitoringRiskEvents();
      await Promise.all([loadSummary(), loadRiskWorkspace(), refreshDrawer()]);
      onSuccess(
        `手动扫描完成：命中 ${result.matched_user_count} 人，新建 ${result.created_event_count} 条，刷新 ${result.refreshed_event_count} 条`
      );
    } catch (error) {
      await handleRequestError(error, '手动扫描失败');
    } finally {
      setScanning(false);
    }
  }

  function applyIpSearch(search: string) {
    const normalized = search.trim();
    setIpFilters((current) => ({
      ...current,
      page: 1,
      search: normalized
    }));
  }

  const activeIpSearch = ipFilters.search.trim();

  const riskQueue = useMemo(() => {
    const eventStatusWeight = {
      active: 3,
      pending_release: 2,
      released: 0
    };
    const bandWeight = {
      block: 3,
      observe: 2,
      normal: 1
    };

    const observationItems =
      observations?.items.map((item) => ({
        kind: 'observation' as const,
        id: `obs-${item.sub2api_user_id}`,
        userId: item.sub2api_user_id,
        label: getUserPrimaryLabel(item),
        subtitle: item.sub2api_email,
        note: `1h ${item.window_1h_ip_count} 个 IP · 24h ${item.window_24h_ip_count} 个 IP`,
        riskBand: item.risk_band,
        riskScore: item.risk_score,
        lastAt: item.last_hit_at,
        ruleHits: item.rule_hits,
        statusLabel: '观察中'
      })) ?? [];

    const eventItems =
      riskEvents?.items.map((item) => ({
        kind: 'event' as const,
        id: `event-${item.id}`,
        userId: item.sub2apiUserId,
        label: item.sub2apiUsername || item.sub2apiEmail,
        subtitle: item.sub2apiEmail,
        note: `${describeReleaseAvailability(item)} · 不同 IP ${item.distinctIpCount}`,
        riskBand: item.riskBand,
        riskScore: item.riskScore,
        lastAt: item.lastHitAt,
        ruleHits: item.ruleHits,
        statusLabel:
          item.status === 'active'
            ? '封禁中'
            : item.status === 'pending_release'
              ? '待恢复'
              : '已归档',
        event: item
      })) ?? [];

    return [...eventItems, ...observationItems].sort((left, right) => {
      const leftStatus = left.kind === 'event' ? eventStatusWeight[left.event.status] : 1;
      const rightStatus = right.kind === 'event' ? eventStatusWeight[right.event.status] : 1;
      if (rightStatus !== leftStatus) {
        return rightStatus - leftStatus;
      }
      if (bandWeight[right.riskBand] !== bandWeight[left.riskBand]) {
        return bandWeight[right.riskBand] - bandWeight[left.riskBand];
      }
      if (right.riskScore !== left.riskScore) {
        return right.riskScore - left.riskScore;
      }
      return Date.parse(right.lastAt) - Date.parse(left.lastAt);
    });
  }, [observations, riskEvents]);

  const topRiskIps = useMemo(() => ipList?.items.slice(0, 3) ?? [], [ipList]);

  function renderIpWorkspace() {
    return (
      <>
        <div className="monitoring-workbench-head">
          <div>
            <span className="monitoring-kicker">IP First</span>
            <h3 className="monitoring-panel-title">共享 IP 研判</h3>
            <p>先看 10 分钟爆发和 1 小时共享情况，再下钻到关联用户与 Cloudflare。</p>
          </div>
          <div className="monitoring-toolbar-cluster">
            <label className="field monitoring-filter-field monitoring-search-field">
              <span>搜索 IP</span>
              <input
                type="text"
                placeholder="支持完整 IP 或片段"
                value={ipSearchInput}
                onChange={(event) => setIpSearchInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    applyIpSearch(ipSearchInput);
                  }
                }}
              />
            </label>
            <div className="actions">
              <button className="button ghost" type="button" onClick={() => applyIpSearch(ipSearchInput)}>
                搜索
              </button>
              <button
                className="button ghost"
                type="button"
                disabled={!ipSearchInput.trim() && activeIpSearch === ''}
                onClick={() => {
                  setIpSearchInput('');
                  applyIpSearch('');
                }}
              >
                清空
              </button>
            </div>
          </div>
        </div>

        {activeIpSearch ? (
          <p className="monitoring-search-summary">
            当前搜索：<strong>{activeIpSearch}</strong>，命中 {ipList?.total ?? 0} 条
          </p>
        ) : null}

        {ipLoading && !ipList ? (
          <p className="loading-text">正在加载 IP 榜单...</p>
        ) : !ipList || ipList.items.length === 0 ? (
          <div className="empty-state">当前没有可展示的共享 IP。</div>
        ) : (
          <>
            <div className="monitoring-workbench-list">
              {ipList.items.map((item) => {
                const band = describeRiskBand(item.risk_band);
                return (
                  <button
                    key={item.ip_address}
                    className={`monitoring-workbench-row ${drawer?.type === 'ip' && drawer.ipAddress === item.ip_address ? 'active' : ''}`}
                    onClick={() => void openIpDrawer(item.ip_address)}
                  >
                    <div className="monitoring-workbench-mainline">
                      <div>
                        <strong>{item.ip_address}</strong>
                        <span>
                          10m {item.user_count_10m} 人 · 1h {item.user_count_1h} 人 · 24h 请求 {item.request_count_24h}
                        </span>
                      </div>
                      <div className="monitoring-workbench-side">
                        <span className={`status-tag ${band.className}`}>{band.label}</span>
                        <span className="chip">分数 {item.risk_score}</span>
                        <span className="chip">{formatAdminDateTime(item.last_seen_at)}</span>
                      </div>
                    </div>
                    <RuleHitStack hits={item.rule_hits.slice(0, 2)} />
                  </button>
                );
              })}
            </div>

            <PaginationBar
              page={ipList.page}
              pages={ipList.pages}
              total={ipList.total}
              onPrev={() =>
                setIpFilters((current) => ({
                  ...current,
                  page: Math.max(1, current.page - 1)
                }))
              }
              onNext={() =>
                setIpFilters((current) => ({
                  ...current,
                  page: Math.min(ipList.pages, current.page + 1)
                }))
              }
            />
          </>
        )}
      </>
    );
  }

  function renderUserWorkspace() {
    return (
      <>
        <div className="monitoring-workbench-head">
          <div>
            <span className="monitoring-kicker">User Lens</span>
            <h3 className="monitoring-panel-title">用户研判</h3>
            <p>把跨 IP 用户排到前面，点开后直接看关联 IP、风险事件和操作记录。</p>
          </div>
        </div>

        {userLoading && !userList ? (
          <p className="loading-text">正在加载用户榜单...</p>
        ) : !userList || userList.items.length === 0 ? (
          <div className="empty-state">当前没有可展示的用户画像。</div>
        ) : (
          <>
            <div className="monitoring-workbench-list">
              {userList.items.map((item) => {
                const band = describeRiskBand(item.risk_band);
                const riskStatus = describeRiskStatus(item);
                return (
                  <button
                    key={item.sub2api_user_id}
                    className={`monitoring-workbench-row ${drawer?.type === 'user' && drawer.userId === item.sub2api_user_id ? 'active' : ''}`}
                    onClick={() => void openUserDrawer(item.sub2api_user_id)}
                  >
                    <div className="monitoring-workbench-mainline">
                      <div>
                        <strong>{getUserPrimaryLabel(item)}</strong>
                        <span>
                          1h {item.unique_ip_count_1h} 个 IP · 24h {item.unique_ip_count_24h} 个 IP · 请求 {item.request_count_24h}
                        </span>
                      </div>
                      <div className="monitoring-workbench-side">
                        <span className={`status-tag ${band.className}`}>{band.label}</span>
                        <span className={`status-tag ${riskStatus.className}`}>{riskStatus.label}</span>
                        <span className="chip">分数 {item.risk_score}</span>
                      </div>
                    </div>
                    <RuleHitStack hits={item.rule_hits.slice(0, 2)} />
                  </button>
                );
              })}
            </div>

            <PaginationBar
              page={userList.page}
              pages={userList.pages}
              total={userList.total}
              onPrev={() =>
                setUserFilters((current) => ({
                  ...current,
                  page: Math.max(1, current.page - 1)
                }))
              }
              onNext={() =>
                setUserFilters((current) => ({
                  ...current,
                  page: Math.min(userList.pages, current.page + 1)
                }))
              }
            />
          </>
        )}
      </>
    );
  }

  function renderRiskWorkspace() {
    return (
      <>
        <div className="monitoring-workbench-head">
          <div>
            <span className="monitoring-kicker">Risk Queue</span>
            <h3 className="monitoring-panel-title">风险处理</h3>
            <p>观察项和风险事件统一排队，优先处理高分和待恢复对象。</p>
          </div>
          <div className="monitoring-toolbar-cluster">
            <label className="field monitoring-filter-field">
              <span>事件状态</span>
              <select
                value={riskEventFilters.status ?? ''}
                onChange={(event) =>
                  setRiskEventFilters((current) => ({
                    ...current,
                    page: 1,
                    status:
                      event.target.value === ''
                        ? undefined
                        : (event.target.value as NonNullable<AdminRiskEventQuery['status']>)
                  }))
                }
              >
                <option value="">全部</option>
                <option value="active">封禁中</option>
                <option value="pending_release">待恢复</option>
                <option value="released">已恢复</option>
              </select>
            </label>
          </div>
        </div>

        {riskLoading && !riskQueue.length ? (
          <p className="loading-text">正在加载风险队列...</p>
        ) : riskQueue.length === 0 ? (
          <div className="empty-state">当前没有风险队列数据。</div>
        ) : (
          <>
            <div className="monitoring-workbench-list">
              {riskQueue.map((item) => {
                const band = describeRiskBand(item.riskBand);
                return (
                  <button
                    key={item.id}
                    className={`monitoring-workbench-row ${drawer?.type === 'user' && drawer.userId === item.userId ? 'active' : ''}`}
                    onClick={() => void openUserDrawer(item.userId)}
                  >
                    <div className="monitoring-workbench-mainline">
                      <div>
                        <strong>{item.label}</strong>
                        <span>{item.note}</span>
                      </div>
                      <div className="monitoring-workbench-side">
                        <span className={`status-tag ${band.className}`}>{band.label}</span>
                        <span className="chip">{item.statusLabel}</span>
                        <span className="chip">分数 {item.riskScore}</span>
                      </div>
                    </div>
                    <RuleHitStack hits={item.ruleHits.slice(0, 2)} />
                  </button>
                );
              })}
            </div>

            {riskEvents ? (
              <PaginationBar
                page={riskEvents.page}
                pages={riskEvents.pages}
                total={riskEvents.total}
                onPrev={() =>
                  setRiskEventFilters((current) => ({
                    ...current,
                    page: Math.max(1, (current.page ?? 1) - 1)
                  }))
                }
                onNext={() =>
                  setRiskEventFilters((current) => ({
                    ...current,
                    page: Math.min(riskEvents.pages, (current.page ?? 1) + 1)
                  }))
                }
              />
            ) : null}
          </>
        )}
      </>
    );
  }

  function renderActionWorkspace() {
    return (
      <>
        <div className="monitoring-workbench-head">
          <div>
            <span className="monitoring-kicker">Action Ledger</span>
            <h3 className="monitoring-panel-title">处置审计</h3>
            <p>所有人工扫描、账号状态变更和 Cloudflare 处置都在这里回看。</p>
          </div>
          <div className="monitoring-toolbar-cluster">
            <label className="field monitoring-filter-field">
              <span>动作类型</span>
              <select
                value={actionTypeFilter}
                onChange={(event) => {
                  setActionTypeFilter(event.target.value as AdminMonitoringActionType | '');
                  setActionFilters((current) => ({
                    ...current,
                    page: 1
                  }));
                }}
              >
                <option value="">全部</option>
                <option value="disable_user">手动禁用</option>
                <option value="enable_user">手动恢复</option>
                <option value="release_risk_event">释放风险事件</option>
                <option value="run_risk_scan">手动扫描</option>
                <option value="cloudflare_challenge_ip">Cloudflare 质询</option>
                <option value="cloudflare_block_ip">Cloudflare 封禁</option>
                <option value="cloudflare_unblock_ip">Cloudflare 解除</option>
              </select>
            </label>
          </div>
        </div>

        {actionsLoading && !actions ? (
          <p className="loading-text">正在加载处置审计...</p>
        ) : !actions || actions.items.length === 0 ? (
          <div className="empty-state">当前没有处置记录。</div>
        ) : (
          <>
            <div className="monitoring-workbench-list">
              {actions.items.map((item) => {
                const result = describeActionResultStatus(item.result_status);
                return (
                  <article key={item.id} className="monitoring-workbench-row static">
                    <div className="monitoring-workbench-mainline">
                      <div>
                        <strong>{describeActionType(item.action_type)}</strong>
                        <span>{item.target_label || '未命名目标'} · {item.detail || '已记录操作'}</span>
                      </div>
                      <div className="monitoring-workbench-side">
                        <span className={`status-tag ${result.className}`}>{result.label}</span>
                        <span className="chip">{formatAdminDateTime(item.created_at)}</span>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>

            <PaginationBar
              page={actions.page}
              pages={actions.pages}
              total={actions.total}
              onPrev={() =>
                setActionFilters((current) => ({
                  ...current,
                  page: Math.max(1, current.page - 1)
                }))
              }
              onNext={() =>
                setActionFilters((current) => ({
                  ...current,
                  page: Math.min(actions.pages, current.page + 1)
                }))
              }
            />
          </>
        )}
      </>
    );
  }

  function renderDrawer() {
    if (!drawer) {
      return (
        <div className="monitoring-drawer-empty">
          <span className="monitoring-kicker">Detail Drawer</span>
          <h4>从左侧选择一个对象</h4>
          <p>默认优先从 IP 研判开始，右侧会显示规则命中、关联对象和操作区。</p>
          {topRiskIps.length > 0 ? (
            <div className="monitoring-rule-hit-list">
              {topRiskIps.map((item) => (
                <button
                  key={item.ip_address}
                  className="chip monitoring-drawer-suggestion"
                  onClick={() => void openIpDrawer(item.ip_address)}
                >
                  {item.ip_address} · 分数 {item.risk_score}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      );
    }

    if (drawerLoading) {
      return <p className="loading-text">正在加载详情...</p>;
    }

    if (drawer.type === 'ip' && ipDetail) {
      const cloudflareBadge = describeCloudflareStatus(ipDetail.cloudflare);
      return (
        <div className="monitoring-drawer-content">
          <div className="monitoring-drawer-head">
            <div>
              <span className="monitoring-kicker">IP Detail</span>
              <h4>{ipDetail.ip.ip_address}</h4>
            </div>
            <button className="button ghost" onClick={() => setDrawer(null)}>
              关闭
            </button>
          </div>

          <div className="monitoring-detail-stat-grid">
            <div>
              <span>10m 用户数</span>
              <strong>{ipDetail.ip.user_count_10m}</strong>
            </div>
            <div>
              <span>1h 用户数</span>
              <strong>{ipDetail.ip.user_count_1h}</strong>
            </div>
            <div>
              <span>24h 请求数</span>
              <strong>{ipDetail.ip.request_count_24h}</strong>
            </div>
            <div>
              <span>风险分数</span>
              <strong>{ipDetail.ip.risk_score}</strong>
            </div>
          </div>

          <article className="monitoring-drawer-card">
            <div className="monitoring-card-head">
              <span>命中规则</span>
              <strong>{describeRiskBand(ipDetail.ip.risk_band).label}</strong>
            </div>
            <RuleHitStack hits={ipDetail.ip.rule_hits} />
          </article>

          <article className="monitoring-drawer-card">
            <div className="monitoring-card-head">
              <span>关联用户</span>
              <strong>{ipDetail.total} 人</strong>
            </div>
            <label className="field monitoring-inline-field">
              <span>用户处置备注</span>
              <input
                type="text"
                value={userActionReason}
                onChange={(event) => setUserActionReason(event.target.value)}
                placeholder="仅在本次用户操作时使用"
              />
            </label>
            <div className="monitoring-drawer-list">
              {ipDetail.items.map((item) => {
                const risk = describeRiskStatus(item);
                const userState = getUserActionState(item);
                return (
                  <div key={item.sub2api_user_id} className="monitoring-related-row">
                    <div className="monitoring-related-identity">
                      <div className="monitoring-identity-mark">
                        {buildIdentityMark(getUserPrimaryLabel(item))}
                      </div>
                      <div className="monitoring-related-copy">
                        <strong>{getUserPrimaryLabel(item)}</strong>
                        <span>{item.sub2api_email}</span>
                        <span>
                          1h {item.request_count_1h} 请求 · 24h {item.unique_ip_count_24h} 个 IP
                        </span>
                      </div>
                    </div>
                    <div className="monitoring-related-actions">
                      <span className={`status-tag ${risk.className}`}>{risk.label}</span>
                      <button className="button ghost" onClick={() => void openUserDrawer(item.sub2api_user_id)}>
                        查看
                      </button>
                      <button
                        className="button ghost"
                        disabled={userState.disabled || busyUserId === item.sub2api_user_id}
                        onClick={() => void handleUserAction(item)}
                      >
                        {busyUserId === item.sub2api_user_id ? '处理中...' : userState.label}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </article>

          <article className="monitoring-drawer-card">
            <div className="monitoring-card-head">
              <span>Cloudflare</span>
              <strong>{cloudflareBadge.label}</strong>
            </div>
            <label className="field monitoring-inline-field">
              <span>Cloudflare 备注</span>
              <input
                type="text"
                value={ipActionReason}
                onChange={(event) => setIpActionReason(event.target.value)}
                placeholder="仅在本次 Cloudflare 操作时写入"
              />
            </label>
            <div className="monitoring-cloudflare-meta">
              <span className={`status-tag ${cloudflareBadge.className}`}>{cloudflareBadge.label}</span>
              <span className="chip">命中规则 {ipDetail.cloudflare.matched_rule_count} 条</span>
            </div>
            {ipDetail.cloudflare.disabled_reason ? (
              <div className="monitoring-inline-note">
                <span className="monitoring-kicker">Cloudflare Note</span>
                <p>{ipDetail.cloudflare.disabled_reason}</p>
              </div>
            ) : null}
            {ipDetail.cloudflare.rule?.notes ? (
              <div className="monitoring-inline-note monitoring-inline-note-muted">
                <span className="monitoring-kicker">Rule Notes</span>
                <p>{ipDetail.cloudflare.rule.notes}</p>
              </div>
            ) : null}
            <div className="monitoring-cloudflare-actions">
              <button
                className="button ghost"
                disabled={!ipDetail.cloudflare.enabled || !ipDetail.cloudflare.can_manage || busyIpAction != null}
                onClick={() => void handleIpAction('challenge')}
              >
                {busyIpAction === 'challenge' ? '处理中...' : '托管质询'}
              </button>
              <button
                className="button ghost"
                disabled={!ipDetail.cloudflare.enabled || !ipDetail.cloudflare.can_manage || busyIpAction != null}
                onClick={() => void handleIpAction('block')}
              >
                {busyIpAction === 'block' ? '处理中...' : '直接封禁'}
              </button>
              <button
                className="button ghost"
                disabled={
                  !ipDetail.cloudflare.enabled ||
                  !ipDetail.cloudflare.can_manage ||
                  !ipDetail.cloudflare.rule ||
                  busyIpAction != null
                }
                onClick={() => void handleIpAction('clear')}
              >
                {busyIpAction === 'clear' ? '处理中...' : '解除'}
              </button>
            </div>
          </article>
        </div>
      );
    }

    if (drawer.type === 'user' && userDetail) {
      const userState = getUserActionState(userDetail.user);
      const riskState = describeRiskStatus(userDetail.user);
      return (
        <div className="monitoring-drawer-content">
          <div className="monitoring-drawer-head">
            <div>
              <span className="monitoring-kicker">User Detail</span>
              <h4>{getUserPrimaryLabel(userDetail.user)}</h4>
            </div>
            <button className="button ghost" onClick={() => setDrawer(null)}>
              关闭
            </button>
          </div>

          <div className="monitoring-detail-stat-grid">
            <div>
              <span>1h 请求数</span>
              <strong>{userDetail.user.request_count_1h}</strong>
            </div>
            <div>
              <span>24h 请求数</span>
              <strong>{userDetail.user.request_count_24h}</strong>
            </div>
            <div>
              <span>24h IP 数</span>
              <strong>{userDetail.user.unique_ip_count_24h}</strong>
            </div>
            <div>
              <span>风险分数</span>
              <strong>{userDetail.user.risk_score}</strong>
            </div>
          </div>

          <article className="monitoring-drawer-card">
            <div className="monitoring-card-head">
              <span>用户状态</span>
              <strong>{riskState.label}</strong>
            </div>
            <div className="monitoring-detail-user-meta">
              <span>{userDetail.user.sub2api_email}</span>
              <span>
                sub2api #{userDetail.user.sub2api_user_id}
                {userDetail.user.linuxdo_subject ? ` · ${userDetail.user.linuxdo_subject}` : ''}
              </span>
            </div>
            <label className="field monitoring-inline-field">
              <span>用户处置备注</span>
              <input
                type="text"
                value={userActionReason}
                onChange={(event) => setUserActionReason(event.target.value)}
                placeholder="仅在本次用户操作时使用"
              />
            </label>
            <div className="monitoring-cloudflare-actions">
              <button
                className="button ghost"
                disabled={userState.disabled || busyUserId === userDetail.user.sub2api_user_id}
                onClick={() => void handleUserAction(userDetail.user)}
              >
                {busyUserId === userDetail.user.sub2api_user_id ? '处理中...' : userState.label}
              </button>
            </div>
            <RuleHitStack hits={userDetail.user.rule_hits} />
          </article>

          <article className="monitoring-drawer-card">
            <div className="monitoring-card-head">
              <span>关联 IP</span>
              <strong>{userDetail.total} 个</strong>
            </div>
            <div className="monitoring-drawer-list">
              {userDetail.items.map((item) => (
                <div key={item.ip_address} className="monitoring-related-row compact">
                  <div className="monitoring-related-copy">
                    <strong>{item.ip_address}</strong>
                    <span>
                      1h {item.request_count_1h} 请求 · 24h {item.request_count_24h} 请求
                    </span>
                  </div>
                  <div className="monitoring-related-actions">
                    <span className="chip">共享 {item.shared_user_count_24h} 人</span>
                    <button className="button ghost" onClick={() => void openIpDrawer(item.ip_address)}>
                      看 IP
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </article>

          {userDetail.open_risk_event ? (
            <article className="monitoring-drawer-card">
              <div className="monitoring-card-head">
                <span>风险事件</span>
                <strong>{userDetail.open_risk_event.status === 'pending_release' ? '待恢复' : '封禁中'}</strong>
              </div>
              <div className="monitoring-risk-facts">
                <span>不同 IP {userDetail.open_risk_event.distinctIpCount}</span>
                <span>{describeReleaseAvailability(userDetail.open_risk_event)}</span>
                <span>最短锁定至 {formatAdminDateTime(userDetail.open_risk_event.minimumLockUntil)}</span>
              </div>
              <RuleHitStack hits={userDetail.open_risk_event.ruleHits} />
              <label className="field monitoring-inline-field">
                <span>恢复备注</span>
                <input
                  type="text"
                  value={riskActionReason}
                  onChange={(event) => setRiskActionReason(event.target.value)}
                  placeholder="仅在释放风险事件时写入"
                />
              </label>
              <div className="monitoring-cloudflare-actions">
                <button
                  className="button ghost"
                  disabled={userDetail.open_risk_event.status !== 'pending_release' || releasingId === userDetail.open_risk_event.id}
                  onClick={() => void handleRiskRelease(userDetail.open_risk_event!)}
                >
                  {releasingId === userDetail.open_risk_event.id ? '处理中...' : '释放并恢复'}
                </button>
              </div>
            </article>
          ) : null}
        </div>
      );
    }

    return <div className="empty-state">当前详情不可用。</div>;
  }

  return (
    <div className="monitoring-console monitoring-workbench">
      <section className="panel monitoring-workbench-hero">
        <div className="monitoring-workbench-headerbar">
          <div>
            <span className="monitoring-kicker">Traffic Observatory</span>
            <h3 className="monitoring-hero-title">监控工作台</h3>
            <p className="monitoring-hero-description">
              默认从共享 IP 入手，右侧抽屉承接详情、规则解释和处置动作。
            </p>
          </div>
          <div className="monitoring-side-actions">
            <button className="button ghost" onClick={() => void refreshAll()}>
              刷新工作台
            </button>
            <button className="button primary" disabled={scanning} onClick={() => void handleRiskScan()}>
              {scanning ? '扫描中...' : '立即扫描'}
            </button>
          </div>
        </div>

        {summaryLoading && !overview ? (
          <p className="loading-text">正在加载监控总览...</p>
        ) : (
          <>
            <div className="monitoring-metric-grid">
              <MetricCard label="24h 原始调用" value={formatCompactCount(overview?.summary.raw_request_count_24h ?? 0)} note="直接来自 sub2API usage 的原始计数" icon="chart" />
              <MetricCard label="24h 风控有效" value={formatCompactCount(overview?.summary.request_count_24h ?? 0)} note="可归因到有效用户和 IP 的记录" icon="users" />
              <MetricCard label="24h 排除记录" value={formatCompactCount(overview?.summary.excluded_request_count_24h ?? 0)} note="缺少 IP、用户或时间非法的记录" tone="warning" icon="grid" />
              <MetricCard label="1h 共享 IP" value={formatCompactCount(overview?.summary.shared_ip_count_1h ?? 0)} note="优先从这里开始排查" tone="warning" icon="link" />
              <MetricCard label="待人工恢复" value={formatCompactCount(overview?.summary.pending_release_count ?? 0)} note="已经过最短锁定期" tone="danger" icon="shield" />
              <MetricCard label="最近同步" value={describeScanStatus(overview?.usage_sync.last_status)} note={`最近更新 ${formatAdminDateTime(overview?.usage_sync.updated_at)}`} icon="bolt" />
            </div>

            <div className="monitoring-threshold-strip">
              <span className="monitoring-threshold-pill">观察线 {overview?.thresholds.observe_ip_count ?? 0} IP / 1h</span>
              <span className="monitoring-threshold-pill">封锁线 {overview?.thresholds.block_ip_count ?? 0} IP / 1h</span>
              <span className="monitoring-threshold-pill">缺少用户 {overview?.excluded_breakdown.missing_user_id ?? 0} / 缺少 IP {overview?.excluded_breakdown.missing_ip_address ?? 0}</span>
              <span className="monitoring-threshold-pill">usage 已同步 {overview?.usage_sync.upserted_count ?? 0} 条</span>
            </div>
          </>
        )}
      </section>

      <section className="panel monitoring-workbench-tabs">
        <div className="monitoring-workbench-tablist">
          {[
            ['ip', 'IP 研判'],
            ['users', '用户研判'],
            ['risk', '风险处理'],
            ['audit', '处置审计']
          ].map(([key, label]) => (
            <button key={key} className={`monitoring-workbench-tab ${workspace === key ? 'active' : ''}`} onClick={() => setWorkspace(key as Workspace)}>
              {label}
            </button>
          ))}
        </div>
      </section>

      <div className="monitoring-workbench-layout">
        <section className="panel monitoring-workbench-main">
          {workspace === 'ip'
            ? renderIpWorkspace()
            : workspace === 'users'
              ? renderUserWorkspace()
              : workspace === 'risk'
                ? renderRiskWorkspace()
                : renderActionWorkspace()}
        </section>

        <aside className={`panel monitoring-workbench-drawer ${drawer ? 'open' : 'empty'}`}>
          {renderDrawer()}
        </aside>
      </div>
    </div>
  );
}
