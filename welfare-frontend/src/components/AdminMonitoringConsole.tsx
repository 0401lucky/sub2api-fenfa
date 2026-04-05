import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Icon';
import { formatAdminDateTime } from '../lib/admin-format';
import { api, isUnauthorizedError } from '../lib/api';
import type {
  AdminMonitoringActionItem,
  AdminMonitoringActionList,
  AdminMonitoringActionType,
  AdminMonitoringIpCloudflareStatus,
  AdminMonitoringIpItem,
  AdminMonitoringIpList,
  AdminMonitoringIpUserItem,
  AdminMonitoringIpUsersResponse,
  AdminMonitoringOverview,
  AdminMonitoringUserIpItem,
  AdminMonitoringUserIpsResponse,
  AdminMonitoringUserItem,
  AdminMonitoringUserList,
  AdminRiskEvent,
  AdminRiskEventList,
  AdminRiskEventQuery,
  AdminRiskObservation,
  AdminRiskObservationList,
  AdminRiskOverview,
  AdminRiskScanResult
} from '../types';

interface AdminMonitoringConsoleProps {
  onUnauthorized: () => Promise<void>;
  onError: (message: string) => void;
  onSuccess: (message: string) => void;
  refreshSignal?: number;
}

const defaultIpFilters = {
  page: 1,
  page_size: 6,
  search: ''
};

const defaultUserFilters = {
  page: 1,
  page_size: 6
};

const defaultActionFilters = {
  page: 1,
  page_size: 8
};

const defaultRiskEventFilters: AdminRiskEventQuery = {
  page: 1,
  page_size: 6
};

const compactNumberFormatter = new Intl.NumberFormat('zh-CN');

type MonitoringUserLike = AdminMonitoringUserItem | AdminMonitoringIpUserItem;

function buildIdentityMark(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    return 'NA';
  }

  return normalized.slice(0, 2).toUpperCase();
}

function formatCompactCount(value: number): string {
  return compactNumberFormatter.format(value);
}

function isDisabledStatus(status: string): boolean {
  return status.trim().toLowerCase() === 'disabled';
}

function describeRiskLevel(level: AdminMonitoringIpItem['risk_level']) {
  if (level === 'block') {
    return {
      label: '封锁线',
      className: 'failed'
    };
  }

  if (level === 'observe') {
    return {
      label: '观察线',
      className: 'pending'
    };
  }

  return {
    label: '正常',
    className: 'success'
  };
}

function describeRiskStatus(item: MonitoringUserLike) {
  if (item.risk_status === 'active') {
    return {
      label: '封禁中',
      className: 'failed'
    };
  }

  if (item.risk_status === 'pending_release') {
    return {
      label: '待恢复',
      className: 'pending'
    };
  }

  if (item.is_admin_protected) {
    return {
      label: '管理员保护',
      className: 'success'
    };
  }

  if (isDisabledStatus(item.sub2api_status)) {
    return {
      label: '已禁用',
      className: 'failed'
    };
  }

  return {
    label: '正常',
    className: 'success'
  };
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

function describeActionResultStatus(status: AdminMonitoringActionItem['result_status']) {
  if (status === 'success') {
    return {
      label: '成功',
      className: 'success'
    };
  }

  if (status === 'blocked') {
    return {
      label: '已拦截',
      className: 'pending'
    };
  }

  return {
    label: '失败',
    className: 'failed'
  };
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

function describeScanStatus(status: AdminRiskOverview['last_scan']['last_status'] | undefined): string {
  if (status === 'running') {
    return '扫描中';
  }

  if (status === 'failed') {
    return '最近失败';
  }

  if (status === 'success') {
    return '最近成功';
  }

  return '尚未执行';
}

function describeActionDetail(item: AdminMonitoringActionItem): string {
  if (item.detail.trim()) {
    return item.detail;
  }

  switch (item.action_type) {
    case 'disable_user':
      return '用户被人工禁用，福利站会话同步失效。';
    case 'enable_user':
      return '用户被人工恢复为 active。';
    case 'release_risk_event':
      return '风险事件已释放，可以重新登录。';
    case 'run_risk_scan':
      return '执行了一次人工风险扫描。';
    case 'cloudflare_challenge_ip':
      return '已对目标 IP 下发 Cloudflare 托管质询。';
    case 'cloudflare_block_ip':
      return '已对目标 IP 下发 Cloudflare 封禁。';
    case 'cloudflare_unblock_ip':
      return '已解除目标 IP 的福利站托管规则。';
    default:
      return '已记录操作。';
  }
}

function describeCloudflareStatus(
  status: AdminMonitoringIpCloudflareStatus | null
): { label: string; className: 'success' | 'pending' | 'failed' } {
  if (!status) {
    return {
      label: '未读取',
      className: 'pending'
    };
  }

  if (!status.enabled) {
    return {
      label: '未配置',
      className: 'pending'
    };
  }

  if (status.rule) {
    return {
      label: describeCloudflareMode(status.rule.mode),
      className: status.rule.mode === 'block' ? 'failed' : 'pending'
    };
  }

  return {
    label: '未下发',
    className: 'success'
  };
}

function describeReleaseAvailability(item: AdminRiskEvent): string {
  if (item.status === 'pending_release') {
    return '已达到人工恢复窗口';
  }

  if (item.status === 'released') {
    return '事件已归档';
  }

  return '仍在最短锁定期内';
}

function getUserPrimaryLabel(item: {
  sub2api_username: string;
  sub2api_email: string;
}): string {
  return item.sub2api_username || item.sub2api_email;
}

function getUserActionState(item: MonitoringUserLike) {
  if (item.is_admin_protected) {
    return {
      disabled: true,
      action: 'disable' as const,
      label: '保护中'
    };
  }

  if (isDisabledStatus(item.sub2api_status)) {
    if (item.risk_status) {
      return {
        disabled: true,
        action: 'enable' as const,
        label: '先释放风险事件'
      };
    }

    return {
      disabled: false,
      action: 'enable' as const,
      label: '恢复用户'
    };
  }

  return {
    disabled: false,
    action: 'disable' as const,
    label: '禁用用户'
  };
}

function renderEventStatus(status: AdminRiskEvent['status']) {
  if (status === 'released') {
    return <span className="status-tag success">已恢复</span>;
  }

  if (status === 'pending_release') {
    return <span className="status-tag pending">待恢复</span>;
  }

  return <span className="status-tag failed">封禁中</span>;
}

function renderSyncStatus(status: AdminRiskEvent['mainSiteSyncStatus']) {
  if (status === 'success') {
    return <span className="chip">主站已同步</span>;
  }

  if (status === 'failed') {
    return <span className="chip monitoring-chip-danger">主站同步失败</span>;
  }

  return <span className="chip">主站待同步</span>;
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
        <button
          className="button ghost"
          disabled={props.page >= props.pages}
          onClick={props.onNext}
        >
          下一页
        </button>
      </div>
    </div>
  );
}

export function AdminMonitoringConsole({
  onUnauthorized,
  onError,
  onSuccess,
  refreshSignal = 0
}: AdminMonitoringConsoleProps) {
  const [overview, setOverview] = useState<AdminMonitoringOverview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [ipFilters, setIpFilters] = useState(defaultIpFilters);
  const [ipSearchInput, setIpSearchInput] = useState('');
  const [ipList, setIpList] = useState<AdminMonitoringIpList | null>(null);
  const [ipLoading, setIpLoading] = useState(true);
  const [selectedIp, setSelectedIp] = useState<string | null>(null);
  const [ipUsers, setIpUsers] = useState<AdminMonitoringIpUsersResponse | null>(null);
  const [ipUsersLoading, setIpUsersLoading] = useState(false);
  const [ipCloudflareStatus, setIpCloudflareStatus] =
    useState<AdminMonitoringIpCloudflareStatus | null>(null);
  const [ipCloudflareLoading, setIpCloudflareLoading] = useState(false);
  const [userFilters, setUserFilters] = useState(defaultUserFilters);
  const [userList, setUserList] = useState<AdminMonitoringUserList | null>(null);
  const [userLoading, setUserLoading] = useState(true);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [userIps, setUserIps] = useState<AdminMonitoringUserIpsResponse | null>(null);
  const [userIpsLoading, setUserIpsLoading] = useState(false);
  const [actionFilters, setActionFilters] = useState(defaultActionFilters);
  const [actionTypeFilter, setActionTypeFilter] = useState<AdminMonitoringActionType | ''>('');
  const [actions, setActions] = useState<AdminMonitoringActionList | null>(null);
  const [actionsLoading, setActionsLoading] = useState(true);
  const [riskOverview, setRiskOverview] = useState<AdminRiskOverview | null>(null);
  const [riskOverviewLoading, setRiskOverviewLoading] = useState(true);
  const [observations, setObservations] = useState<AdminRiskObservationList | null>(null);
  const [observationsLoading, setObservationsLoading] = useState(true);
  const [riskEventFilters, setRiskEventFilters] = useState<AdminRiskEventQuery>(defaultRiskEventFilters);
  const [riskEvents, setRiskEvents] = useState<AdminRiskEventList | null>(null);
  const [riskEventsLoading, setRiskEventsLoading] = useState(true);
  const [operatorReason, setOperatorReason] = useState('');
  const [busyUserId, setBusyUserId] = useState<number | null>(null);
  const [busyIpAction, setBusyIpAction] = useState<'challenge' | 'block' | 'clear' | null>(null);
  const [releasingId, setReleasingId] = useState<number | null>(null);
  const [scanning, setScanning] = useState(false);
  const ipUsersRequestIdRef = useRef(0);
  const ipCloudflareRequestIdRef = useRef(0);

  async function handleRequestError(error: unknown, fallbackMessage: string) {
    if (isUnauthorizedError(error)) {
      await onUnauthorized();
      return;
    }

    onError(error instanceof Error ? error.message : fallbackMessage);
  }

  async function loadOverview() {
    setOverviewLoading(true);
    try {
      const result = await api.getAdminMonitoringOverview();
      setOverview(result);
    } catch (error) {
      await handleRequestError(error, '监控总览加载失败');
    } finally {
      setOverviewLoading(false);
    }
  }

  function resetIpDetailState() {
    ipUsersRequestIdRef.current += 1;
    ipCloudflareRequestIdRef.current += 1;
    setIpUsers(null);
    setIpCloudflareStatus(null);
    setIpUsersLoading(false);
    setIpCloudflareLoading(false);
  }

  async function loadIpUsers(ipAddress: string) {
    const requestId = ipUsersRequestIdRef.current + 1;
    ipUsersRequestIdRef.current = requestId;
    setIpUsersLoading(true);
    setIpUsers((current) => (current?.ip.ip_address === ipAddress ? current : null));
    try {
      const result = await api.getAdminMonitoringIpUsers(ipAddress);
      if (ipUsersRequestIdRef.current !== requestId) {
        return;
      }
      setIpUsers(result);
    } catch (error) {
      if (ipUsersRequestIdRef.current === requestId) {
        setIpUsers(null);
        await handleRequestError(error, 'IP 关联用户加载失败');
      }
    } finally {
      if (ipUsersRequestIdRef.current === requestId) {
        setIpUsersLoading(false);
      }
    }
  }

  async function loadIpCloudflareStatus(ipAddress: string) {
    const requestId = ipCloudflareRequestIdRef.current + 1;
    ipCloudflareRequestIdRef.current = requestId;
    setIpCloudflareLoading(true);
    setIpCloudflareStatus((current) => (current?.ip_address === ipAddress ? current : null));
    try {
      const result = await api.getAdminMonitoringIpCloudflareStatus(ipAddress);
      if (ipCloudflareRequestIdRef.current !== requestId) {
        return;
      }
      setIpCloudflareStatus(result);
    } catch (error) {
      if (ipCloudflareRequestIdRef.current === requestId) {
        setIpCloudflareStatus(null);
        await handleRequestError(error, 'Cloudflare IP 状态加载失败');
      }
    } finally {
      if (ipCloudflareRequestIdRef.current === requestId) {
        setIpCloudflareLoading(false);
      }
    }
  }

  async function loadIps(nextFilters = ipFilters) {
    setIpLoading(true);
    try {
      const result = await api.listAdminMonitoringIps(nextFilters);
      setIpList(result);

      const nextIp =
        result.items.find((item) => item.ip_address === selectedIp)?.ip_address ??
        result.items[0]?.ip_address ??
        null;

      if (!nextIp) {
        setSelectedIp(null);
        resetIpDetailState();
        return;
      }

      setSelectedIp(nextIp);
      if (nextIp === selectedIp) {
        void loadIpUsers(nextIp);
        void loadIpCloudflareStatus(nextIp);
      }
    } catch (error) {
      await handleRequestError(error, 'IP 榜单加载失败');
    } finally {
      setIpLoading(false);
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

  function clearIpSearch() {
    setIpSearchInput('');
    applyIpSearch('');
  }

  async function loadUserIps(userId: number) {
    setUserIpsLoading(true);
    try {
      const result = await api.getAdminMonitoringUserIps(userId);
      setSelectedUserId(result.user.sub2api_user_id);
      setUserIps(result);
    } catch (error) {
      setUserIps(null);
      await handleRequestError(error, '用户 IP 画像加载失败');
    } finally {
      setUserIpsLoading(false);
    }
  }

  async function loadUsers(nextFilters = userFilters) {
    setUserLoading(true);
    try {
      const result = await api.listAdminMonitoringUsers(nextFilters);
      setUserList(result);

      const nextUserId =
        result.items.find((item) => item.sub2api_user_id === selectedUserId)?.sub2api_user_id ??
        result.items[0]?.sub2api_user_id ??
        null;

      if (!nextUserId) {
        setSelectedUserId(null);
        setUserIps(null);
        return;
      }

      setSelectedUserId(nextUserId);
      if (nextUserId === selectedUserId) {
        void loadUserIps(nextUserId);
      }
    } catch (error) {
      await handleRequestError(error, '用户榜单加载失败');
    } finally {
      setUserLoading(false);
    }
  }

  async function loadActions(
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

  async function loadRiskOverview() {
    setRiskOverviewLoading(true);
    try {
      const result = await api.getAdminMonitoringRiskOverview();
      setRiskOverview(result);
    } catch (error) {
      await handleRequestError(error, '风险总览加载失败');
    } finally {
      setRiskOverviewLoading(false);
    }
  }

  async function loadObservations() {
    setObservationsLoading(true);
    try {
      const result = await api.listAdminMonitoringRiskObservations({
        page: 1,
        page_size: 8
      });
      setObservations(result);
    } catch (error) {
      await handleRequestError(error, '观察名单加载失败');
    } finally {
      setObservationsLoading(false);
    }
  }

  async function loadRiskEvents(nextFilters = riskEventFilters) {
    setRiskEventsLoading(true);
    try {
      const result = await api.listAdminMonitoringRiskEvents(nextFilters);
      setRiskEvents(result);
    } catch (error) {
      await handleRequestError(error, '风险事件加载失败');
    } finally {
      setRiskEventsLoading(false);
    }
  }

  async function refreshConsoleData() {
    await Promise.all([
      loadOverview(),
      loadIps(ipFilters),
      loadUsers(userFilters),
      loadActions(actionFilters, actionTypeFilter || undefined),
      loadRiskOverview(),
      loadObservations(),
      loadRiskEvents(riskEventFilters)
    ]);
  }

  useEffect(() => {
    void Promise.all([loadOverview(), loadRiskOverview(), loadObservations()]);
  }, [refreshSignal]);

  useEffect(() => {
    void loadIps(ipFilters);
  }, [ipFilters, refreshSignal]);

  useEffect(() => {
    void loadUsers(userFilters);
  }, [userFilters, refreshSignal]);

  useEffect(() => {
    if (!selectedIp) {
      resetIpDetailState();
      return;
    }

    void loadIpUsers(selectedIp);
    void loadIpCloudflareStatus(selectedIp);
  }, [selectedIp]);

  useEffect(() => {
    if (selectedUserId == null) {
      return;
    }

    void loadUserIps(selectedUserId);
  }, [selectedUserId]);

  useEffect(() => {
    void loadActions(actionFilters, actionTypeFilter || undefined);
  }, [actionFilters, actionTypeFilter, refreshSignal]);

  useEffect(() => {
    void loadRiskEvents(riskEventFilters);
  }, [riskEventFilters, refreshSignal]);

  const trendPoints = useMemo(() => {
    return overview?.snapshot_points.slice(-12) ?? [];
  }, [overview]);

  const activeIpSearch = ipFilters.search.trim();

  const maxRequestCount = useMemo(() => {
    return Math.max(...trendPoints.map((item) => item.request_count_24h), 1);
  }, [trendPoints]);

  const recentActionHighlights = useMemo(() => {
    return overview?.recent_actions.slice(0, 5) ?? [];
  }, [overview]);

  async function handleRiskScan() {
    setScanning(true);
    try {
      const result: AdminRiskScanResult = await api.scanAdminMonitoringRiskEvents();
      await refreshConsoleData();
      onSuccess(
        `手动扫描完成：命中 ${result.matched_user_count} 人，新建 ${result.created_event_count} 条，刷新 ${result.refreshed_event_count} 条`
      );
    } catch (error) {
      await handleRequestError(error, '手动扫描失败');
    } finally {
      setScanning(false);
    }
  }

  async function handleUserAction(item: MonitoringUserLike) {
    const actionState = getUserActionState(item);
    if (actionState.disabled) {
      return;
    }

    const label = getUserPrimaryLabel(item);
    const confirmed = window.confirm(
      actionState.action === 'disable'
        ? `确认禁用 ${label} 吗？该操作会让福利站已登录会话立即失效。`
        : `确认恢复 ${label} 吗？`
    );

    if (!confirmed) {
      return;
    }

    setBusyUserId(item.sub2api_user_id);
    try {
      if (actionState.action === 'disable') {
        await api.disableAdminMonitoringUser(item.sub2api_user_id, {
          reason: operatorReason.trim() || undefined
        });
        onSuccess(`已禁用 ${label}`);
      } else {
        await api.enableAdminMonitoringUser(item.sub2api_user_id, {
          reason: operatorReason.trim() || undefined
        });
        onSuccess(`已恢复 ${label}`);
      }

      await refreshConsoleData();
    } catch (error) {
      await handleRequestError(
        error,
        actionState.action === 'disable' ? '禁用用户失败' : '恢复用户失败'
      );
    } finally {
      setBusyUserId(null);
    }
  }

  async function handleIpAction(action: 'challenge' | 'block' | 'clear') {
    const ipAddress = ipUsers?.ip.ip_address ?? selectedIp;
    if (!ipAddress || !ipCloudflareStatus) {
      return;
    }

    if (!ipCloudflareStatus.enabled || !ipCloudflareStatus.can_manage) {
      if (ipCloudflareStatus.disabled_reason) {
        onError(ipCloudflareStatus.disabled_reason);
      }
      return;
    }

    const actionText =
      action === 'challenge'
        ? '对这个 IP 启用 Cloudflare 托管质询'
        : action === 'block'
          ? '对这个 IP 直接下发 Cloudflare 封禁'
          : '解除这个 IP 的福利站托管规则';
    const confirmed = window.confirm(
      action === 'block'
        ? `确认${actionText}吗？建议只有在质询后仍明显异常时再升级为封禁。`
        : `确认${actionText}吗？`
    );

    if (!confirmed) {
      return;
    }

    setBusyIpAction(action);
    try {
      if (action === 'challenge') {
        await api.challengeAdminMonitoringIp(ipAddress, {
          reason: operatorReason.trim() || undefined
        });
        onSuccess(`已对 ${ipAddress} 下发 Cloudflare 托管质询`);
      } else if (action === 'block') {
        await api.blockAdminMonitoringIp(ipAddress, {
          reason: operatorReason.trim() || undefined
        });
        onSuccess(`已对 ${ipAddress} 下发 Cloudflare 封禁`);
      } else {
        await api.clearAdminMonitoringIpCloudflare(ipAddress, {
          reason: operatorReason.trim() || undefined
        });
        onSuccess(`已清除 ${ipAddress} 的福利站托管 Cloudflare 规则`);
      }

      await refreshConsoleData();
    } catch (error) {
      await handleRequestError(
        error,
        action === 'challenge'
          ? 'Cloudflare 质询失败'
          : action === 'block'
            ? 'Cloudflare 封禁失败'
            : 'Cloudflare 解除失败'
      );
    } finally {
      setBusyIpAction(null);
    }
  }

  async function handleRiskRelease(item: AdminRiskEvent) {
    const confirmed = window.confirm(
      `确认释放风险事件 #${item.id} 吗？这会把 ${item.sub2apiUsername || item.sub2apiEmail} 恢复为 active。`
    );

    if (!confirmed) {
      return;
    }

    setReleasingId(item.id);
    try {
      await api.releaseAdminMonitoringRiskEvent(item.id, {
        reason: operatorReason.trim() || undefined
      });
      await refreshConsoleData();
      onSuccess(`已释放风险事件 #${item.id}`);
    } catch (error) {
      await handleRequestError(error, '释放风险事件失败');
    } finally {
      setReleasingId(null);
    }
  }

  return (
    <div className="admin-section-stack monitoring-console">
      <section className="panel monitoring-hero-panel">
        <div className="monitoring-hero-shell">
          <div className="monitoring-hero-copy">
            <span className="monitoring-kicker">Traffic Observatory</span>
            <h3 className="monitoring-hero-title">监控主控台</h3>
            <p className="monitoring-hero-description">
              这里优先看 24 小时请求面、共享 IP 扩散、风险事件积压和人工处置。
              第一版只聚焦用户与 IP，不做自动封禁，保留人工判断空间。
            </p>

            {overviewLoading && !overview ? (
              <p className="loading-text">正在加载监控总览...</p>
            ) : (
              <>
                <div className="monitoring-metric-grid">
                  <MetricCard
                    label="24h 请求量"
                    value={formatCompactCount(overview?.summary.request_count_24h ?? 0)}
                    note="最近 24 小时的 usage 日志总量"
                    icon="chart"
                  />
                  <MetricCard
                    label="24h 活跃用户"
                    value={formatCompactCount(overview?.summary.active_user_count_24h ?? 0)}
                    note="按用户去重后的调用人数"
                    icon="users"
                  />
                  <MetricCard
                    label="24h 独立 IP"
                    value={formatCompactCount(overview?.summary.unique_ip_count_24h ?? 0)}
                    note="过去 24 小时出现过的 IP 数"
                    icon="link"
                  />
                  <MetricCard
                    label="1h 观察用户"
                    value={formatCompactCount(overview?.summary.observe_user_count_1h ?? 0)}
                    note="达到观察线但还没进入风险事件"
                    tone="warning"
                    icon="shield"
                  />
                  <MetricCard
                    label="封禁中"
                    value={formatCompactCount(overview?.summary.blocked_user_count ?? 0)}
                    note="当前仍在锁定期内的用户"
                    tone="danger"
                    icon="shield"
                  />
                  <MetricCard
                    label="待人工恢复"
                    value={formatCompactCount(overview?.summary.pending_release_count ?? 0)}
                    note="锁定期结束，等待你最终判断"
                    tone="warning"
                    icon="grid"
                  />
                </div>

                <div className="monitoring-threshold-strip">
                  <span className="monitoring-threshold-pill">
                    观察线 {overview?.thresholds.observe_ip_count ?? 0} IP / 1h
                  </span>
                  <span className="monitoring-threshold-pill">
                    封锁线 {overview?.thresholds.block_ip_count ?? 0} IP / 1h
                  </span>
                  <span className="monitoring-threshold-pill">
                    会话缓存 {Math.round((overview?.thresholds.live_cache_ttl_ms ?? 0) / 1000)}s
                  </span>
                  <span className="monitoring-threshold-pill">
                    快照间隔 {Math.round((overview?.thresholds.snapshot_interval_ms ?? 0) / 60000)} 分钟
                  </span>
                  <span className="monitoring-threshold-pill">
                    锁定时长 {Math.round((overview?.thresholds.lock_duration_ms ?? 0) / 3600000)} 小时
                  </span>
                </div>
              </>
            )}
          </div>

          <div className="monitoring-hero-side">
            <article className="monitoring-side-card">
              <div className="monitoring-side-head">
                <div>
                  <span className="monitoring-kicker">Risk Sweep</span>
                  <strong>
                    {riskOverviewLoading && !riskOverview
                      ? '加载中'
                      : describeScanStatus(riskOverview?.last_scan.last_status)}
                  </strong>
                </div>
                <span className="chip">{riskOverview?.last_scan.last_trigger_source || '未记录'}</span>
              </div>

              <div className="monitoring-side-list">
                <div className="monitoring-side-row">
                  <span>最近扫描开始</span>
                  <strong>{formatAdminDateTime(riskOverview?.last_scan.last_started_at)}</strong>
                </div>
                <div className="monitoring-side-row">
                  <span>最近扫描结束</span>
                  <strong>{formatAdminDateTime(riskOverview?.last_scan.last_finished_at)}</strong>
                </div>
                <div className="monitoring-side-row">
                  <span>扫描命中</span>
                  <strong>{riskOverview?.last_scan.hit_user_count ?? 0} 人</strong>
                </div>
                <div className="monitoring-side-row">
                  <span>数据快照</span>
                  <strong>{formatAdminDateTime(overview?.generated_at)}</strong>
                </div>
              </div>

              <div className="monitoring-inline-note">
                <span className="monitoring-kicker">Last Error</span>
                <p>{riskOverview?.last_scan.last_error || '无'}</p>
              </div>
            </article>

            <article className="monitoring-side-card">
              <label className="field">
                <span>本次操作备注</span>
                <input
                  type="text"
                  value={operatorReason}
                  onChange={(event) => setOperatorReason(event.target.value)}
                  placeholder="可选，写入处置审计和风险释放记录"
                />
              </label>

              <div className="monitoring-side-actions">
                <button className="button primary" disabled={scanning} onClick={() => void handleRiskScan()}>
                  {scanning ? '扫描中...' : '立即扫描'}
                </button>
                <button className="button ghost" onClick={() => void refreshConsoleData()}>
                  刷新主控台
                </button>
              </div>

              <div className="monitoring-side-caption">
                手动禁用会同步失效福利站会话。手动恢复前，必须先释放对应风险事件。
              </div>
            </article>
          </div>
        </div>
      </section>

      <section className="panel monitoring-timeline-panel">
        <div className="monitoring-panel-head">
          <div>
            <span className="monitoring-kicker">Pulse Archive</span>
            <h3 className="monitoring-panel-title">快照脉冲与最新动作</h3>
            <p>上方看趋势，下方看最近一次人工处置，便于快速判断系统是在升温还是回落。</p>
          </div>
        </div>

        <div className="monitoring-timeline-grid">
          <article className="monitoring-card-shell">
            <div className="monitoring-card-head">
              <span>近 12 个快照</span>
              <strong>{trendPoints.length} 个点</strong>
            </div>

            {trendPoints.length === 0 ? (
              <div className="empty-state">当前还没有监控快照。</div>
            ) : (
              <div className="monitoring-spark-chart">
                {trendPoints.map((item) => (
                  <div key={item.snapshot_at} className="monitoring-spark-column">
                    <div className="monitoring-spark-stack">
                      <div
                        className="monitoring-spark-bar traffic"
                        style={{
                          height: `${Math.max(18, Math.round((item.request_count_24h / maxRequestCount) * 160))}px`
                        }}
                        title={`请求 ${item.request_count_24h}`}
                      />
                      <div
                        className="monitoring-spark-bar risk"
                        style={{
                          height: `${Math.max(12, (item.pending_release_count + item.blocked_user_count) * 12)}px`
                        }}
                        title={`未结风险 ${item.pending_release_count + item.blocked_user_count}`}
                      />
                    </div>
                    <div className="monitoring-spark-meta">
                      <strong>{item.request_count_24h}</strong>
                      <span>{formatAdminDateTime(item.snapshot_at).slice(5)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </article>

          <article className="monitoring-card-shell">
            <div className="monitoring-card-head">
              <span>最近动作</span>
              <strong>{recentActionHighlights.length} 条</strong>
            </div>

            {recentActionHighlights.length === 0 ? (
              <div className="empty-state">最近还没有人工处置记录。</div>
            ) : (
              <div className="monitoring-action-highlight-list">
                {recentActionHighlights.map((item) => (
                  <div key={item.id} className="monitoring-action-highlight-item">
                    <div className="monitoring-action-highlight-top">
                      <span className="monitoring-action-badge">{describeActionType(item.action_type)}</span>
                      <span
                        className={`status-tag ${describeActionResultStatus(item.result_status).className}`}
                      >
                        {describeActionResultStatus(item.result_status).label}
                      </span>
                    </div>
                    <strong>{item.target_label || '未命名目标'}</strong>
                    <p>{describeActionDetail(item)}</p>
                    <span className="muted">
                      {item.operator_username || item.operator_email} · {formatAdminDateTime(item.created_at)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </article>
        </div>
      </section>

      <div className="monitoring-board-grid">
        <section className="panel monitoring-board-panel">
          <div className="monitoring-panel-head monitoring-panel-head-inline">
            <div>
              <span className="monitoring-kicker">IP Radar</span>
              <h3 className="monitoring-panel-title">共享 IP 榜</h3>
              <p>优先定位在 1h 内同时承载多个用户的 IP，再下钻到该 IP 的用户明细。</p>
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
                <button
                  className="button ghost"
                  type="button"
                  onClick={() => applyIpSearch(ipSearchInput)}
                >
                  搜索
                </button>
                <button
                  className="button ghost"
                  type="button"
                  disabled={!ipSearchInput.trim() && activeIpSearch === ''}
                  onClick={clearIpSearch}
                >
                  清空
                </button>
              </div>
            </div>
          </div>

          {ipLoading && !ipList ? (
            <p className="loading-text">正在加载 IP 榜单...</p>
          ) : !ipList || ipList.items.length === 0 ? (
            <div className="empty-state">
              {activeIpSearch
                ? `没有匹配 “${activeIpSearch}” 的共享 IP。`
                : '过去 24 小时还没有可展示的 IP 数据。'}
            </div>
          ) : (
            <>
              {activeIpSearch ? (
                <p className="monitoring-search-summary">
                  当前搜索：<strong>{activeIpSearch}</strong>，命中 {ipList.total} 条
                </p>
              ) : null}
              <div className="monitoring-rank-list">
                {ipList.items.map((item) => {
                  const risk = describeRiskLevel(item.risk_level);
                  return (
                    <button
                      key={item.ip_address}
                      className={`monitoring-rank-row ${selectedIp === item.ip_address ? 'active' : ''}`}
                      onClick={() => setSelectedIp(item.ip_address)}
                    >
                      <div className="monitoring-rank-main">
                        <strong>{item.ip_address}</strong>
                        <span>
                          1h {item.user_count_1h} 人 · 24h {item.user_count_24h} 人 · 请求 {item.request_count_24h}
                        </span>
                      </div>
                      <div className="monitoring-rank-side">
                        <span className={`status-tag ${risk.className}`}>{risk.label}</span>
                        <span className="chip">{formatAdminDateTime(item.last_seen_at)}</span>
                      </div>
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

              <div className="monitoring-detail-card">
                <div className="monitoring-detail-head">
                  <div>
                    <span className="monitoring-kicker">Selected IP</span>
                    <h4>{ipUsers?.ip.ip_address || selectedIp || '未选择'}</h4>
                  </div>
                  {ipUsers?.ip && (
                    <span className={`status-tag ${describeRiskLevel(ipUsers.ip.risk_level).className}`}>
                      {describeRiskLevel(ipUsers.ip.risk_level).label}
                    </span>
                  )}
                </div>

                {ipUsersLoading ? (
                  <p className="loading-text">正在加载该 IP 的用户明细...</p>
                ) : !ipUsers ? (
                  <div className="empty-state">选择左侧 IP 查看用户明细。</div>
                ) : (
                  <>
                    <div className="monitoring-detail-stat-grid">
                      <div>
                        <span>1h 用户数</span>
                        <strong>{ipUsers.ip.user_count_1h}</strong>
                      </div>
                      <div>
                        <span>24h 用户数</span>
                        <strong>{ipUsers.ip.user_count_24h}</strong>
                      </div>
                      <div>
                        <span>24h 请求数</span>
                        <strong>{ipUsers.ip.request_count_24h}</strong>
                      </div>
                      <div>
                        <span>最后命中</span>
                        <strong>{formatAdminDateTime(ipUsers.ip.last_seen_at)}</strong>
                      </div>
                    </div>

                    <div className="monitoring-detail-toolbar">
                      <div className="monitoring-detail-user-meta">
                        <span>Cloudflare IP 处置</span>
                        <span>
                          {ipCloudflareStatus?.rule
                            ? `${
                                ipCloudflareStatus.rule.source === 'managed'
                                  ? '福利站托管规则'
                                  : '外部既有规则'
                              } · ${
                                ipCloudflareStatus.rule.modified_at
                                  ? `最近更新 ${formatAdminDateTime(ipCloudflareStatus.rule.modified_at)}`
                                  : '暂无更新时间'
                              }`
                            : '建议先托管质询，再根据复发情况升级为直接封禁'}
                        </span>
                      </div>

                      <span
                        className={`status-tag ${describeCloudflareStatus(ipCloudflareStatus).className}`}
                      >
                        {describeCloudflareStatus(ipCloudflareStatus).label}
                      </span>
                    </div>

                    <div className="monitoring-cloudflare-card">
                      {ipCloudflareLoading ? (
                        <p className="loading-text">正在读取 Cloudflare 规则状态...</p>
                      ) : (
                        <>
                          <div className="monitoring-cloudflare-meta">
                            <span className="chip">
                              命中规则 {ipCloudflareStatus?.matched_rule_count ?? 0} 条
                            </span>
                            {ipCloudflareStatus?.rule && (
                              <span className="chip">
                                {describeCloudflareMode(ipCloudflareStatus.rule.mode)}
                              </span>
                            )}
                            <span className="chip">
                              {ipCloudflareStatus?.enabled ? 'Cloudflare 已接通' : 'Cloudflare 未接通'}
                            </span>
                          </div>

                          {ipCloudflareStatus?.disabled_reason && (
                            <div className="monitoring-inline-note">
                              <span className="monitoring-kicker">Cloudflare Note</span>
                              <p>{ipCloudflareStatus.disabled_reason}</p>
                            </div>
                          )}

                          {ipCloudflareStatus?.rule?.notes && (
                            <div className="monitoring-inline-note monitoring-inline-note-muted">
                              <span className="monitoring-kicker">Rule Notes</span>
                              <p>{ipCloudflareStatus.rule.notes}</p>
                            </div>
                          )}

                          <div className="monitoring-cloudflare-actions">
                            <button
                              className="button ghost"
                              disabled={
                                ipCloudflareLoading ||
                                busyIpAction != null ||
                                !ipCloudflareStatus?.enabled ||
                                !ipCloudflareStatus.can_manage
                              }
                              onClick={() => void handleIpAction('challenge')}
                            >
                              {busyIpAction === 'challenge' ? '处理中...' : '托管质询'}
                            </button>
                            <button
                              className="button ghost"
                              disabled={
                                ipCloudflareLoading ||
                                busyIpAction != null ||
                                !ipCloudflareStatus?.enabled ||
                                !ipCloudflareStatus.can_manage
                              }
                              onClick={() => void handleIpAction('block')}
                            >
                              {busyIpAction === 'block' ? '处理中...' : '直接封禁'}
                            </button>
                            <button
                              className="button ghost"
                              disabled={
                                ipCloudflareLoading ||
                                busyIpAction != null ||
                                !ipCloudflareStatus?.enabled ||
                                !ipCloudflareStatus.can_manage ||
                                !ipCloudflareStatus.rule
                              }
                              onClick={() => void handleIpAction('clear')}
                            >
                              {busyIpAction === 'clear' ? '处理中...' : '解除'}
                            </button>
                          </div>
                        </>
                      )}
                    </div>

                    <div className="monitoring-related-list">
                      {ipUsers.items.map((item) => {
                        const risk = describeRiskStatus(item);
                        const actionState = getUserActionState(item);
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
                                  1h {item.request_count_1h} 请求 · 24h {item.request_count_24h} 请求 · 24h {item.unique_ip_count_24h} 个 IP
                                </span>
                              </div>
                            </div>

                            <div className="monitoring-related-actions">
                              <span className={`status-tag ${risk.className}`}>{risk.label}</span>
                              <button
                                className="button ghost"
                                disabled={actionState.disabled || busyUserId === item.sub2api_user_id}
                                onClick={() => void handleUserAction(item)}
                              >
                                {busyUserId === item.sub2api_user_id ? '处理中...' : actionState.label}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </section>
        <section className="panel monitoring-board-panel">
          <div className="monitoring-panel-head monitoring-panel-head-inline">
            <div>
              <span className="monitoring-kicker">User Lens</span>
              <h3 className="monitoring-panel-title">用户画像榜</h3>
              <p>把多 IP 用户排到前面，右侧直接看这个用户关联过的 IP 与共享程度。</p>
            </div>
          </div>

          {userLoading && !userList ? (
            <p className="loading-text">正在加载用户榜单...</p>
          ) : !userList || userList.items.length === 0 ? (
            <div className="empty-state">过去 24 小时还没有可展示的用户调用数据。</div>
          ) : (
            <>
              <div className="monitoring-rank-list">
                {userList.items.map((item) => {
                  const risk = describeRiskStatus(item);
                  return (
                    <button
                      key={item.sub2api_user_id}
                      className={`monitoring-rank-row ${selectedUserId === item.sub2api_user_id ? 'active' : ''}`}
                      onClick={() => setSelectedUserId(item.sub2api_user_id)}
                    >
                      <div className="monitoring-rank-main">
                        <strong>{getUserPrimaryLabel(item)}</strong>
                        <span>
                          1h {item.unique_ip_count_1h} 个 IP · 24h {item.unique_ip_count_24h} 个 IP · 请求 {item.request_count_24h}
                        </span>
                      </div>
                      <div className="monitoring-rank-side">
                        <span className={`status-tag ${risk.className}`}>{risk.label}</span>
                        <span className="chip">{item.sub2api_status || '未知状态'}</span>
                      </div>
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

              <div className="monitoring-detail-card">
                <div className="monitoring-detail-head">
                  <div>
                    <span className="monitoring-kicker">Selected User</span>
                    <h4>{userIps ? getUserPrimaryLabel(userIps.user) : '未选择'}</h4>
                  </div>
                  {userIps && (
                    <span className={`status-tag ${describeRiskStatus(userIps.user).className}`}>
                      {describeRiskStatus(userIps.user).label}
                    </span>
                  )}
                </div>

                {userIpsLoading ? (
                  <p className="loading-text">正在加载用户 IP 画像...</p>
                ) : !userIps ? (
                  <div className="empty-state">选择左侧用户查看 IP 画像。</div>
                ) : (
                  <>
                    <div className="monitoring-detail-stat-grid">
                      <div>
                        <span>1h 请求数</span>
                        <strong>{userIps.user.request_count_1h}</strong>
                      </div>
                      <div>
                        <span>24h 请求数</span>
                        <strong>{userIps.user.request_count_24h}</strong>
                      </div>
                      <div>
                        <span>24h IP 数</span>
                        <strong>{userIps.user.unique_ip_count_24h}</strong>
                      </div>
                      <div>
                        <span>最后命中</span>
                        <strong>{formatAdminDateTime(userIps.user.last_seen_at)}</strong>
                      </div>
                    </div>

                    <div className="monitoring-detail-toolbar">
                      <div className="monitoring-detail-user-meta">
                        <span>{userIps.user.sub2api_email}</span>
                        <span>
                          sub2api #{userIps.user.sub2api_user_id}
                          {userIps.user.linuxdo_subject ? ` · ${userIps.user.linuxdo_subject}` : ''}
                        </span>
                      </div>

                      <button
                        className="button ghost"
                        disabled={
                          getUserActionState(userIps.user).disabled ||
                          busyUserId === userIps.user.sub2api_user_id
                        }
                        onClick={() => void handleUserAction(userIps.user)}
                      >
                        {busyUserId === userIps.user.sub2api_user_id
                          ? '处理中...'
                          : getUserActionState(userIps.user).label}
                      </button>
                    </div>

                    <div className="monitoring-related-list">
                      {userIps.items.map((item: AdminMonitoringUserIpItem) => (
                        <div key={item.ip_address} className="monitoring-related-row compact">
                          <div className="monitoring-related-copy">
                            <strong>{item.ip_address}</strong>
                            <span>
                              1h {item.request_count_1h} 请求 · 24h {item.request_count_24h} 请求
                            </span>
                          </div>
                          <div className="monitoring-related-actions">
                            <span className="chip">共享 {item.shared_user_count_24h} 人</span>
                            <span className="chip">{formatAdminDateTime(item.last_seen_at)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </section>
      </div>

      <section className="panel monitoring-risk-panel">
        <div className="monitoring-panel-head monitoring-panel-head-inline">
          <div>
            <span className="monitoring-kicker">Risk Bench</span>
            <h3 className="monitoring-panel-title">风险事件与观察名单</h3>
            <p>观察名单负责早期预警，风险事件负责人工恢复。两块放在一起，减少来回跳页判断。</p>
          </div>

          <div className="monitoring-risk-filters">
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

        <div className="monitoring-risk-grid">
          <article className="monitoring-card-shell monitoring-risk-column">
            <div className="monitoring-card-head">
              <span>观察名单</span>
              <strong>{observations?.total ?? 0} 人</strong>
            </div>

            <div className="monitoring-risk-summary-strip">
              <span className="monitoring-threshold-pill">
                1h 观察 {riskOverview?.windows.window_1h_observe_count ?? 0}
              </span>
              <span className="monitoring-threshold-pill">
                6h 观察 {riskOverview?.windows.window_6h_observe_count ?? 0}
              </span>
              <span className="monitoring-threshold-pill">
                24h 观察 {riskOverview?.windows.window_24h_observe_count ?? 0}
              </span>
            </div>

            {observationsLoading ? (
              <p className="loading-text">正在加载观察名单...</p>
            ) : !observations || observations.items.length === 0 ? (
              <div className="empty-state">当前没有进入观察线的用户。</div>
            ) : (
              <div className="monitoring-risk-list">
                {observations.items.map((item: AdminRiskObservation) => (
                  <div key={item.sub2api_user_id} className="monitoring-risk-card observation">
                    <div className="monitoring-risk-card-head">
                      <div className="monitoring-risk-identity">
                        <div className="monitoring-identity-mark">
                          {buildIdentityMark(getUserPrimaryLabel(item))}
                        </div>
                        <div>
                          <strong>{getUserPrimaryLabel(item)}</strong>
                          <span>{item.sub2api_email}</span>
                        </div>
                      </div>
                      <span className="status-tag pending">观察中</span>
                    </div>

                    <div className="monitoring-risk-facts">
                      <span>1h {item.window_1h_ip_count} 个 IP</span>
                      <span>3h {item.window_3h_ip_count} 个 IP</span>
                      <span>24h {item.window_24h_ip_count} 个 IP</span>
                    </div>

                    <div className="monitoring-ip-cloud">
                      {item.ip_samples.map((ip) => (
                        <span key={ip} className="monitoring-ip-pill">
                          {ip}
                        </span>
                      ))}
                    </div>

                    <span className="muted">
                      最近命中 {formatAdminDateTime(item.last_hit_at)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </article>

          <article className="monitoring-card-shell monitoring-risk-column">
            <div className="monitoring-card-head">
              <span>风险事件</span>
              <strong>{riskEvents?.total ?? 0} 条</strong>
            </div>

            {riskEventsLoading ? (
              <p className="loading-text">正在加载风险事件...</p>
            ) : !riskEvents || riskEvents.items.length === 0 ? (
              <div className="empty-state">当前没有风险事件。</div>
            ) : (
              <>
                <div className="monitoring-risk-list">
                  {riskEvents.items.map((item) => (
                    <div key={item.id} className="monitoring-risk-card">
                      <div className="monitoring-risk-card-head">
                        <div className="monitoring-risk-identity">
                          <div className="monitoring-identity-mark">
                            {buildIdentityMark(item.sub2apiUsername || item.sub2apiEmail)}
                          </div>
                          <div>
                            <strong>{item.sub2apiUsername || item.sub2apiEmail}</strong>
                            <span>{item.sub2apiEmail}</span>
                          </div>
                        </div>
                        <div className="monitoring-risk-statuses">
                          {renderEventStatus(item.status)}
                          {renderSyncStatus(item.mainSiteSyncStatus)}
                        </div>
                      </div>

                      <div className="monitoring-risk-facts">
                        <span>不同 IP {item.distinctIpCount}</span>
                        <span>{describeReleaseAvailability(item)}</span>
                        <span>最短锁定至 {formatAdminDateTime(item.minimumLockUntil)}</span>
                      </div>

                      <div className="monitoring-ip-cloud">
                        {item.ipSamples.map((ip) => (
                          <span key={ip} className="monitoring-ip-pill">
                            {ip}
                          </span>
                        ))}
                      </div>

                      <div className="monitoring-risk-foot">
                        <span className="muted">
                          最近命中 {formatAdminDateTime(item.lastHitAt)} · 事件 #{item.id}
                        </span>
                        <button
                          className="button ghost"
                          disabled={item.status !== 'pending_release' || releasingId === item.id}
                          onClick={() => void handleRiskRelease(item)}
                        >
                          {releasingId === item.id
                            ? '处理中...'
                            : item.status === 'pending_release'
                              ? '释放并恢复'
                              : item.status === 'released'
                                ? '已归档'
                                : '锁定中'}
                        </button>
                      </div>

                      {item.releaseReason && (
                        <div className="monitoring-inline-note">
                          <span className="monitoring-kicker">Release Note</span>
                          <p>{item.releaseReason}</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

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
              </>
            )}
          </article>
        </div>
      </section>

      <section className="panel monitoring-actions-panel">
        <div className="monitoring-panel-head monitoring-panel-head-inline">
          <div>
            <span className="monitoring-kicker">Action Ledger</span>
            <h3 className="monitoring-panel-title">处置审计</h3>
            <p>手动禁用、恢复、风险释放、人工扫描和 Cloudflare IP 处置都会在这里留档。</p>
          </div>

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

        {actionsLoading ? (
          <p className="loading-text">正在加载处置审计...</p>
        ) : !actions || actions.items.length === 0 ? (
          <div className="empty-state">当前没有审计记录。</div>
        ) : (
          <>
            <div className="monitoring-ledger-list">
              {actions.items.map((item) => (
                <div key={item.id} className="monitoring-ledger-row">
                  <div className="monitoring-ledger-main">
                    <div className="monitoring-ledger-top">
                      <span className="monitoring-action-badge">{describeActionType(item.action_type)}</span>
                      <strong>{item.target_label || '未命名目标'}</strong>
                    </div>
                    <p>{describeActionDetail(item)}</p>
                    <span className="muted">
                      操作人 {item.operator_username || item.operator_email}
                      {item.reason ? ` · 备注：${item.reason}` : ''}
                    </span>
                  </div>

                  <div className="monitoring-ledger-side">
                    <span
                      className={`status-tag ${describeActionResultStatus(item.result_status).className}`}
                    >
                      {describeActionResultStatus(item.result_status).label}
                    </span>
                    <span className="chip">{formatAdminDateTime(item.created_at)}</span>
                  </div>
                </div>
              ))}
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
      </section>
    </div>
  );
}
