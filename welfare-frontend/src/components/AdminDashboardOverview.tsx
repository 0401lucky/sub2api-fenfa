import { Icon } from './Icon';
import { formatAdminBusinessDate, formatAdminDateTime } from '../lib/admin-format';
import { formatRewardRange } from '../lib/welfare-display';
import type { AdminCheckinItem, AdminRedeemClaimItem, AdminRedeemCodeItem, AdminSettings, DailyStats, WhitelistItem } from '../types';
import { motion } from 'framer-motion';

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

  const containerVariants = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: {
        staggerChildren: 0.05
      }
    }
  };

  const itemVariants: import('framer-motion').Variants = {
    hidden: { opacity: 0, y: 20 },
    show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 300, damping: 24 } }
  };

  return (
    <motion.div 
      className="admin-dashboard-overview"
      variants={containerVariants}
      initial="hidden"
      animate="show"
    >
      <div className="admin-bento-grid">
        {metricCards.map((item) => (
          <motion.article
            key={item.label}
            variants={itemVariants}
            className="admin-card-modern"
          >
            <div className="admin-card-header">
              <div className="admin-card-title">
                <div className="admin-card-icon">
                  <Icon name={item.icon} size={16} />
                </div>
                <span>{item.label}</span>
              </div>
              <span className={`admin-status-tag-modern`} style={{ color: item.tone === 'good' ? 'var(--sage)' : item.tone === 'bad' ? 'var(--rose)' : 'var(--ink-1)' }}>
                {item.tone === 'good' && <span className="admin-status-dot healthy" />}
                {item.tone === 'bad' && <span className="admin-status-dot error" />}
                {item.badge}
              </span>
            </div>
            <div className="admin-card-value">{item.value}</div>
            <p className="admin-card-description">{item.note}</p>
          </motion.article>
        ))}
      </div>

      <div className="admin-bento-grid" style={{ gridTemplateColumns: 'minmax(400px, 1.5fr) minmax(320px, 1fr)' }}>
        <motion.section variants={itemVariants} className="admin-card-modern">
          <div className="admin-card-header">
            <div className="admin-card-title">
              <div className="admin-card-icon"><Icon name="chart" size={16} /></div>
              <span>最近 30 天签到热度</span>
            </div>
            <span className="admin-status-tag-modern">近 {latestPoints.length} 日</span>
          </div>
          
          <div className="admin-trends-container">
            {latestPoints.length === 0 && (
              <div className="empty-state">最近 30 天还没有可展示的签到数据。</div>
            )}
            {latestPoints.map((point) => (
              <div key={point.checkinDate} className="admin-trend-bar-modern">
                <div className="admin-trend-date">{formatAdminBusinessDate(point.checkinDate)}</div>
                <div className="admin-trend-track">
                  <motion.div 
                    className="admin-trend-fill"
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: Math.max(0.05, point.grantTotal / statsMaxGrant) }}
                    transition={{ duration: 0.8, ease: "easeOut", delay: 0.2 }}
                  />
                </div>
                <div className="admin-trend-amount">{point.grantTotal}</div>
                <div style={{ fontSize: 12, color: 'var(--ink-3)', width: '60px', textAlign: 'right' }}>
                  {point.checkinUsers} 人
                </div>
              </div>
            ))}
          </div>
        </motion.section>

        <motion.section variants={itemVariants} className="admin-card-modern">
          <div className="admin-card-header">
            <div className="admin-card-title">
              <div className="admin-card-icon"><Icon name="ticket" size={16} /></div>
              <span>热门兑换码 & 即将过期</span>
            </div>
          </div>
          
          <div className="admin-data-list">
            {hottestRedeemCodes.length === 0 && <div className="empty-state">暂无兑换码数据</div>}
            {hottestRedeemCodes.map((item) => (
              <div key={item.id} className="admin-data-row">
                <div className="admin-data-main">
                  <span className="admin-data-title">{item.title}</span>
                  <span className="admin-data-sub">{item.code}</span>
                </div>
                <div className="admin-data-tail">
                  <span className="admin-data-title">{item.claimedCount} / {item.maxClaims}</span>
                  <br />
                  <span className="admin-data-sub">余 {item.remainingClaims}</span>
                </div>
              </div>
            ))}
            
            {expiringRedeemCodes.slice(0, 3).map((item) => (
              <div key={item.id} className="admin-data-row" style={{ marginTop: 8, borderColor: 'var(--amber-soft)', background: 'rgba(251, 191, 36, 0.05)' }}>
                <div className="admin-data-main">
                  <span className="admin-data-title" style={{ color: 'var(--amber)' }}>{item.title}</span>
                  <span className="admin-data-sub">即将过期：{formatAdminDateTime(item.expiresAt)}</span>
                </div>
              </div>
            ))}
          </div>
        </motion.section>
      </div>

      <div className="admin-bento-grid">
        <motion.section variants={itemVariants} className="admin-card-modern">
          <div className="admin-card-header">
            <div className="admin-card-title">
              <div className="admin-card-icon"><Icon name="bolt" size={16} /></div>
              <span>最近失败签到</span>
            </div>
            {failedCheckinsTotal > 0 && <span className="admin-status-tag-modern" style={{ color: 'var(--rose)' }}><span className="admin-status-dot error" /> {failedCheckinsTotal} 条需处理</span>}
          </div>
          <div className="admin-data-list">
            {failedCheckins.length === 0 && <div className="empty-state" style={{ padding: '24px 0', opacity: 0.6 }}>当前没有失败签到，系统健康运行中。</div>}
            {failedCheckins.map((item) => {
              const identity = getUserIdentity({
                username: item.sub2apiUsername,
                email: item.sub2apiEmail,
                linuxdoSubject: item.linuxdoSubject
              });
              return (
                <div key={item.id} className="admin-data-row">
                  <div className="admin-data-main">
                    <span className="admin-data-title">{identity.title}</span>
                    <span className="admin-data-sub">{formatAdminBusinessDate(item.checkinDate)}</span>
                  </div>
                  <div className="admin-data-tail">
                    {renderGrantTag(item.grantStatus)}
                  </div>
                </div>
              );
            })}
          </div>
        </motion.section>

        <motion.section variants={itemVariants} className="admin-card-modern">
          <div className="admin-card-header">
            <div className="admin-card-title">
              <div className="admin-card-icon"><Icon name="grid" size={16} /></div>
              <span>最近失败兑换</span>
            </div>
            {failedRedeemClaimsTotal > 0 && <span className="admin-status-tag-modern" style={{ color: 'var(--rose)' }}><span className="admin-status-dot error" /> {failedRedeemClaimsTotal} 条异常</span>}
          </div>
          <div className="admin-data-list">
            {failedRedeemClaims.length === 0 && <div className="empty-state" style={{ padding: '24px 0', opacity: 0.6 }}>当前没有失败兑换记录。</div>}
            {failedRedeemClaims.map((item) => {
              const identity = getUserIdentity({
                username: item.sub2apiUsername,
                email: item.sub2apiEmail,
                linuxdoSubject: item.linuxdoSubject
              });
              return (
                <div key={item.id} className="admin-data-row">
                  <div className="admin-data-main">
                    <span className="admin-data-title">{item.redeemCode}</span>
                    <span className="admin-data-sub">{identity.title}</span>
                  </div>
                  <div className="admin-data-tail">
                    {renderGrantTag(item.grantStatus)}
                  </div>
                </div>
              );
            })}
          </div>
        </motion.section>
      </div>
    </motion.div>
  );
}
