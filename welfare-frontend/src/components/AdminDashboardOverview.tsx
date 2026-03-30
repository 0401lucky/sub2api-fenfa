import { Icon } from './Icon';
import { formatAdminBusinessDate, formatAdminDateTime } from '../lib/admin-format';
import { formatRewardRange } from '../lib/welfare-display';
import type { AdminCheckinItem, AdminRedeemClaimItem, AdminRedeemCodeItem, AdminSettings, DailyStats, WhitelistItem } from '../types';

interface AdminDashboardOverviewProps {
  settings: AdminSettings | null;
  stats: DailyStats | null;
  whitelist: WhitelistItem[];
  redeemCodes: AdminRedeemCodeItem[];
  failedCheckins: AdminCheckinItem[];
  failedCheckinsTotal: number;
  failedRedeemClaims: AdminRedeemClaimItem[];
  failedRedeemClaimsTotal: number;
  onOpenCheckins: () => void;
  onOpenRedeemCodes: () => void;
  onOpenRedeemClaims: () => void;
}

function renderGrantTag(status: 'success' | 'pending' | 'failed') {
  const label = status === 'success' ? '成功' : status === 'pending' ? '处理中' : '失败';
  return <span className={`status-tag ${status}`}>{label}</span>;
}

function getUserIdentity(item: {
  username?: string;
  email?: string;
  linuxdoSubject?: string | null;
}) {
  return {
    title: item.username || item.email || '未知用户',
    subtitle: item.email || '无邮箱',
    linuxdo: item.linuxdoSubject ?? null
  };
}

function isExpiringSoon(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }

  const expiresAt = Date.parse(value);
  if (Number.isNaN(expiresAt)) {
    return false;
  }

  const diff = expiresAt - Date.now();
  return diff > 0 && diff <= 7 * 24 * 60 * 60 * 1000;
}

export function AdminDashboardOverview({
  settings,
  stats,
  whitelist,
  redeemCodes,
  failedCheckins,
  failedCheckinsTotal,
  failedRedeemClaims,
  failedRedeemClaimsTotal,
  onOpenCheckins,
  onOpenRedeemCodes,
  onOpenRedeemClaims
}: AdminDashboardOverviewProps) {
  const activeRedeemCodes = redeemCodes.filter((item) => item.enabled && !item.isExpired);
  const expiringRedeemCodes = redeemCodes.filter((item) => isExpiringSoon(item.expiresAt));
  const hottestRedeemCodes = [...redeemCodes]
    .sort((left, right) => right.claimedCount - left.claimedCount)
    .slice(0, 3);
  const statsMaxGrant = Math.max(...(stats?.points.map((point) => point.grantTotal) ?? [0]), 1);
  const latestPoints = [...(stats?.points ?? [])].slice(-6).reverse();
  const urgentTotal = failedCheckinsTotal + failedRedeemClaimsTotal;
  const metricCards = [
    {
      label: '签到状态',
      value: settings?.checkin_enabled ? '运行中' : '已关闭',
      note: settings?.checkin_enabled ? '当前签到链路处于可发放状态' : '当前不会接受新的签到发放请求',
      badge: settings?.checkin_enabled ? '健康' : '暂停',
      icon: 'bolt' as const,
      tone: settings?.checkin_enabled ? 'good' : 'bad'
    },
    {
      label: '每日奖励',
      value: settings
        ? formatRewardRange(
            settings.daily_reward_min_balance,
            settings.daily_reward_max_balance
          )
        : '-',
      note: '普通签到按该区间随机发放',
      badge: '基础配置',
      icon: 'gift' as const,
      tone: 'neutral'
    },
    {
      label: '业务时区',
      value: settings?.timezone ?? '-',
      note: '决定签到业务日切换边界',
      badge: '调度基准',
      icon: 'settings' as const,
      tone: 'neutral',
      compact: true
    },
    {
      label: '30 天签到用户',
      value: String(stats?.active_users ?? 0),
      note: '按用户去重后的活跃人数',
      badge: '去重口径',
      icon: 'users' as const,
      tone: 'neutral'
    },
    {
      label: '30 天签到人次',
      value: String(stats?.total_checkins ?? 0),
      note: '含重复用户的全部签到流水',
      badge: '流水规模',
      icon: 'chart' as const,
      tone: 'neutral'
    },
    {
      label: '兑换码状态',
      value: String(activeRedeemCodes.length),
      note: `${redeemCodes.length} 个总码，${expiringRedeemCodes.length} 个临期`,
      badge: urgentTotal > 0 ? `${urgentTotal} 条异常` : '稳定',
      icon: 'ticket' as const,
      tone: urgentTotal > 0 ? 'bad' : 'good'
    }
  ];

  return (
    <div className="admin-section-stack">
      <div className="admin-hero-grid">
        <section className="admin-surface admin-hero-panel">
          <div className="admin-surface-kicker" style={{ color: 'var(--ink-2)' }}>OVERVIEW</div>
          <div className="admin-hero-copy" style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: 32, fontWeight: 800 }}>福利站运行态势</h2>
            <p style={{ fontSize: 15, color: 'var(--ink-2)' }}>
              核心状态与异常一屏查看。
            </p>
          </div>
          <div className="admin-hero-actions">
            <button className="button primary" onClick={onOpenRedeemCodes}>
              活动码管理
            </button>
            <button className="button" onClick={onOpenCheckins}>
              最新签到
            </button>
            <button className="button ghost" onClick={onOpenRedeemClaims}>
              补发异常
            </button>
          </div>
        </section>

        <section className="admin-surface admin-watch-panel">
          <div className="admin-surface-kicker">今日观察</div>
          <div className="admin-watch-list">
            <div className="admin-watch-item">
              <span>签到功能</span>
              <strong className={settings?.checkin_enabled ? 'tone-good' : 'tone-bad'}>
                {settings?.checkin_enabled ? '开启中' : '已关闭'}
              </strong>
            </div>
            <div className="admin-watch-item">
              <span>需处理异常</span>
              <strong className={urgentTotal > 0 ? 'tone-bad' : 'tone-good'}>
                {urgentTotal} 条
              </strong>
            </div>
            <div className="admin-watch-item">
              <span>活跃兑换码</span>
              <strong>{activeRedeemCodes.length} 个</strong>
            </div>
            <div className="admin-watch-item">
              <span>白名单管理员</span>
              <strong>{whitelist.length} 人</strong>
            </div>
          </div>
        </section>
      </div>

      <div className="admin-metric-grid">
        {metricCards.map((item) => (
          <article
            key={item.label}
            className={`admin-metric-card admin-metric-card-${item.tone}`}
          >
            <div className="admin-metric-head">
              <div className="admin-metric-title">
                <span className="admin-metric-icon">
                  <Icon name={item.icon} size={15} />
                </span>
                <span>{item.label}</span>
              </div>
              <span className="admin-metric-badge">{item.badge}</span>
            </div>
            <strong className={item.compact ? 'admin-metric-string' : undefined}>{item.value}</strong>
            <p className="admin-metric-note">{item.note}</p>
          </article>
        ))}
      </div>

      <div className="admin-overview-grid">
        <section className="admin-surface admin-surface-wide">
          <div className="admin-panel-head">
            <div>
              <h3>最近 30 天签到热度</h3>
              <p>按日查看签到人数和发放额度，方便快速识别活动波峰。</p>
            </div>
            <span className="chip">近 {latestPoints.length} 个业务日</span>
          </div>
          <div className="admin-trend-list">
            {latestPoints.length === 0 && (
              <div className="empty-state">最近 30 天还没有可展示的签到数据。</div>
            )}
            {latestPoints.map((point) => (
                <div key={point.checkinDate} className="admin-trend-row">
                  <div className="admin-trend-label">
                    <strong>{formatAdminBusinessDate(point.checkinDate)}</strong>
                    <span>{point.checkinUsers} 人签到</span>
                  </div>
                <div className="admin-trend-bar">
                  <span
                    style={{
                      width: `${Math.max(12, (point.grantTotal / statsMaxGrant) * 100)}%`
                    }}
                  />
                </div>
                <strong className="admin-trend-value">{point.grantTotal}</strong>
              </div>
            ))}
          </div>
        </section>

        <section className="admin-surface">
          <div className="admin-panel-head">
            <div>
              <h3>热门兑换码</h3>
              <p>优先看消耗最快的活动码。</p>
            </div>
          </div>
          <div className="admin-mini-list">
            {hottestRedeemCodes.length === 0 && <div className="empty-state">暂无兑换码数据</div>}
            {hottestRedeemCodes.map((item) => (
              <div key={item.id} className="admin-mini-item">
                <div>
                  <strong>{item.title}</strong>
                  <span>{item.code}</span>
                </div>
                <div className="admin-mini-item-tail">
                  <strong>
                    {item.claimedCount} / {item.maxClaims}
                  </strong>
                  <span>剩余 {item.remainingClaims}</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="admin-surface">
          <div className="admin-panel-head">
            <div>
              <h3>最近失败签到</h3>
              <p>需要人工复核或补发的签到流水。</p>
            </div>
            <span className="chip warn">{failedCheckinsTotal} 条</span>
          </div>
          <div className="admin-mini-list">
            {failedCheckins.length === 0 && <div className="empty-state">当前没有失败签到。</div>}
            {failedCheckins.map((item) => {
              const identity = getUserIdentity({
                username: item.sub2apiUsername,
                email: item.sub2apiEmail,
                linuxdoSubject: item.linuxdoSubject
              });
              return (
                <div key={item.id} className="admin-mini-item">
                  <div>
                    <strong>{identity.title}</strong>
                    <span>{formatAdminBusinessDate(item.checkinDate)}</span>
                  </div>
                  <div className="admin-mini-item-tail">{renderGrantTag(item.grantStatus)}</div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="admin-surface">
          <div className="admin-panel-head">
            <div>
              <h3>最近失败兑换</h3>
              <p>优先处理码已占用但发放失败的记录。</p>
            </div>
            <span className="chip warn">{failedRedeemClaimsTotal} 条</span>
          </div>
          <div className="admin-mini-list">
            {failedRedeemClaims.length === 0 && <div className="empty-state">当前没有失败兑换。</div>}
            {failedRedeemClaims.map((item) => {
              const identity = getUserIdentity({
                username: item.sub2apiUsername,
                email: item.sub2apiEmail,
                linuxdoSubject: item.linuxdoSubject
              });
              return (
                <div key={item.id} className="admin-mini-item">
                  <div>
                    <strong>{item.redeemCode}</strong>
                    <span>{identity.title}</span>
                  </div>
                  <div className="admin-mini-item-tail">{renderGrantTag(item.grantStatus)}</div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="admin-surface">
          <div className="admin-panel-head">
            <div>
              <h3>即将过期兑换码</h3>
              <p>未来 7 天内到期，适合提前续期或下线。</p>
            </div>
          </div>
          <div className="admin-mini-list">
            {expiringRedeemCodes.length === 0 && (
              <div className="empty-state">最近没有即将过期的兑换码。</div>
            )}
            {expiringRedeemCodes.slice(0, 4).map((item) => (
              <div key={item.id} className="admin-mini-item">
                <div>
                  <strong>{item.title}</strong>
                  <span>{item.code}</span>
                </div>
                <div className="admin-mini-item-tail">
                  <strong>{formatAdminDateTime(item.expiresAt)}</strong>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
