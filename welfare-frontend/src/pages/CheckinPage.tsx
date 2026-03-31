import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { BlindboxRevealOverlay, type BlindboxRevealStage } from '../components/BlindboxRevealOverlay';
import { useAuth } from '../lib/auth';
import { api, isUnauthorizedError } from '../lib/api';
import { pageVariants, staggerContainer, staggerItem } from '../lib/animations';
import { formatRewardRange, getModeLabel } from '../lib/welfare-display';
import { Icon } from '../components/Icon';
import type {
  BlindboxPreviewItem,
  CheckinMode,
  CheckinStatus
} from '../types';

interface BlindboxRevealState {
  open: boolean;
  stage: BlindboxRevealStage;
  data: {
    title: string;
    reward_balance: number;
    new_balance: number | null;
  } | null;
  message: string;
  canSkip: boolean;
  demoMode: boolean;
}

const initialBlindboxRevealState: BlindboxRevealState = {
  open: false,
  stage: 'idle',
  data: null,
  message: '',
  canSkip: false,
  demoMode: false
};

const blindboxDemoFallbackItems: BlindboxPreviewItem[] = [
  { id: -1, title: '演示·安稳签', reward_balance: 8 },
  { id: -2, title: '演示·好运签', reward_balance: 15 },
  { id: -3, title: '演示·头奖签', reward_balance: 30 }
];

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => window.setTimeout(resolve, ms));
}

function getNormalActionLabel(status: CheckinStatus | null, submittingMode: CheckinMode | null): string {
  if (submittingMode === 'normal') return '处理中...';
  if (!status) return '普通签到';
  if (status.selected_mode === 'blindbox') return '已选盲盒';
  if (status.selected_mode === 'normal' && status.grant_status === 'success') return '✓ 普通签到完成';
  if (status.selected_mode === 'normal' && status.grant_status === 'pending' && !status.can_checkin_normal) return '处理中...';
  if (status.selected_mode === 'normal' && status.can_checkin_normal) return '继续普通签到';
  return '执 行';
}

function getBlindboxActionLabel(status: CheckinStatus | null, submittingMode: CheckinMode | null): string {
  if (submittingMode === 'blindbox') return '开启中...';
  if (!status) return '开启盲盒';
  if (status.selected_mode === 'normal') return '已选普通签到';
  if (status.selected_mode === 'blindbox' && status.grant_status === 'success') return '✓ 惊喜签已开';
  if (status.selected_mode === 'blindbox' && status.grant_status === 'pending' && !status.can_checkin_blindbox) return '处理中...';
  if (status.selected_mode === 'blindbox' && status.can_checkin_blindbox) return '重试开盒';
  if (!status.blindbox_enabled || status.blindbox_preview.item_count === 0) return '暂不可用';
  return '抽 取';
}

function getNormalStatusNote(status: CheckinStatus | null): string {
  if (!status) return '按后台区间随机发放。';
  if (!status.checkin_enabled) return '签到已关闭。';
  if (status.selected_mode === 'blindbox') return '今天已选盲盒。';
  if (status.selected_mode === 'normal' && status.grant_status === 'failed') return '结果锁定，可重试。';
  if (status.selected_mode === 'normal' && status.grant_status === 'pending') return status.can_checkin_normal ? '接管签到。' : '正在处理中。';
  if (status.selected_mode === 'normal' && status.grant_status === 'success') return '今日已到账。';
  return '按后台区间随机发放。';
}

function getBlindboxStatusNote(status: CheckinStatus | null): string {
  if (!status) return '奖励由奖池决定。';
  if (status.selected_mode === 'normal') return '今天已选普通。';
  if (status.selected_mode === 'blindbox' && status.grant_status === 'failed') return `已锁定：${status.blindbox_result?.title ?? '惊喜签'}。`;
  if (status.selected_mode === 'blindbox' && status.grant_status === 'pending') return status.can_checkin_blindbox ? `已锁定：${status.blindbox_result?.title ?? '惊喜签'}。` : '正在处理中。';
  if (status.selected_mode === 'blindbox' && status.grant_status === 'success') return `已抽中：${status.blindbox_result?.title ?? '惊喜签'}。`;
  if (!status.checkin_enabled) return '签到已关闭。';
  if (!status.blindbox_enabled) return '盲盒未开放。';
  if (status.blindbox_preview.item_count === 0) return '当前没有可用奖项。';
  return '奖励由奖池决定。';
}

function getBlindboxRangeLabel(status: CheckinStatus | null): string {
  if (!status || status.blindbox_preview.item_count === 0) return '--';
  const min = status.blindbox_preview.min_reward;
  const max = status.blindbox_preview.max_reward;
  if (min == null || max == null) return '--';
  return `${min.toFixed(2)} ~ ${max.toFixed(2)}`;
}

function pickBlindboxDemoItem(items: BlindboxPreviewItem[]): BlindboxPreviewItem | null {
  if (items.length === 0) return null;
  const index = Math.floor(Math.random() * items.length);
  return items[index] ?? items[0] ?? null;
}

export function CheckinPage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [activeMode, setActiveMode] = useState<CheckinMode>('normal');
  const [status, setStatus] = useState<CheckinStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [submittingMode, setSubmittingMode] = useState<CheckinMode | null>(null);
  const [blindboxReveal, setBlindboxReveal] = useState<BlindboxRevealState>(
    initialBlindboxRevealState
  );
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function redirectToLogin() {
    await logout();
    navigate('/login', { replace: true });
  }

  async function loadAll(showLoading = false) {
    if (showLoading) setLoading(true);
    setError('');
    try {
      const currentStatus = await api.getCheckinStatus();
      setStatus(currentStatus);
    } catch (err) {
      if (isUnauthorizedError(err)) {
        await redirectToLogin();
        return;
      }
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      if (showLoading) setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll(true);
  }, []);

  useEffect(() => {
    if (!status) return;
    if (status.selected_mode) {
      setActiveMode(status.selected_mode);
      return;
    }
    if (!status.blindbox_enabled || status.blindbox_preview.item_count === 0) {
      setActiveMode('normal');
    }
  }, [status]);

  const canSubmitNormal = useMemo(() => {
    if (!status) return false;
    return status.can_checkin_normal && submittingMode == null;
  }, [status, submittingMode]);

  const canSubmitBlindbox = useMemo(() => {
    if (!status) return false;
    return status.can_checkin_blindbox && submittingMode == null;
  }, [status, submittingMode]);

  async function handleNormalCheckin() {
    if (!canSubmitNormal) return;
    setSubmittingMode('normal');
    setError('');
    setSuccess('');
    try {
      const result = await api.checkin();
      setSuccess(`签到成功，已发放 ${result.reward_balance}，当前余额 ${result.new_balance ?? '未知'}`);
      await loadAll();
    } catch (err) {
      if (isUnauthorizedError(err)) {
        await redirectToLogin();
        return;
      }
      setError(`签到失败：${err instanceof Error && err.message ? err.message : '请稍后重试'}`);
      await loadAll();
    } finally {
      setSubmittingMode(null);
    }
  }

  async function handleBlindboxCheckin() {
    if (!canSubmitBlindbox) return;
    let allowSkipByTime = false;
    let skipTimer = 0;

    setSubmittingMode('blindbox');
    setError('');
    setSuccess('');
    setBlindboxReveal({
      open: true,
      stage: 'charging',
      data: null,
      message: '幸运盲盒启动中...',
      canSkip: false,
      demoMode: false
    });

    try {
      const requestPromise = api.checkBlindbox();
      skipTimer = window.setTimeout(() => {
        allowSkipByTime = true;
        setBlindboxReveal((current) => current.data ? { ...current, canSkip: true } : current);
      }, 800);

      await wait(420);
      setBlindboxReveal((current) => ({ ...current, stage: 'suspense', message: '结果即将揭晓' }));

      const [result] = await Promise.all([requestPromise, wait(2400)]);
      const revealData = {
        title: result.blindbox_title || '惊喜签',
        reward_balance: result.reward_balance,
        new_balance: result.new_balance
      };

      setBlindboxReveal((current) => ({
        ...current,
        stage: 'reveal',
        data: revealData,
        message: `「${revealData.title}」`,
        canSkip: allowSkipByTime
      }));

      await loadAll();
      await wait(860);

      setBlindboxReveal((current) => ({
        ...current,
        stage: 'resolved',
        data: revealData,
        canSkip: false,
        message: result.new_balance != null
          ? `抽中「${revealData.title}」，已到账 ${result.reward_balance}，当前余额 ${result.new_balance}`
          : `抽中「${revealData.title}」，奖励已发放 ${result.reward_balance}`
      }));
      setSuccess(`抽中 ${revealData.title}，已发放 ${result.reward_balance}`);
    } catch (err) {
      if (isUnauthorizedError(err)) {
        await redirectToLogin();
        return;
      }
      const detail = err instanceof Error && err.message ? err.message : '请稍后重试';
      setError(`失败：${detail}`);
      await loadAll();
      setBlindboxReveal((current) => ({ ...current, stage: 'error', message: detail, canSkip: false }));
    } finally {
      if (skipTimer) window.clearTimeout(skipTimer);
      setSubmittingMode(null);
    }
  }

  async function handleBlindboxDemo() {
    if (!user?.is_admin || blindboxReveal.open || submittingMode != null) return;
    const demoSourceItems = (status?.blindbox_preview.items?.length ?? 0) > 0
      ? status?.blindbox_preview.items ?? []
      : blindboxDemoFallbackItems;
    const demoItem = pickBlindboxDemoItem(demoSourceItems);
    if (!demoItem) {
      setError('无演示数据');
      return;
    }

    let allowSkipByTime = false;
    let skipTimer = 0;
    setError('');
    setSuccess('');
    setBlindboxReveal({
      open: true,
      stage: 'charging',
      data: null,
      message: '演示模式（无记录写入）',
      canSkip: false,
      demoMode: true
    });

    try {
      skipTimer = window.setTimeout(() => {
        allowSkipByTime = true;
        setBlindboxReveal((current) => current.data ? { ...current, canSkip: true } : current);
      }, 800);
      await wait(420);
      setBlindboxReveal((current) => ({ ...current, stage: 'suspense', message: '演示中，请关注视觉与卡片' }));
      await wait(2400);
      
      const revealData = { title: demoItem.title, reward_balance: demoItem.reward_balance, new_balance: null };
      setBlindboxReveal((current) => ({
        ...current,
        stage: 'reveal',
        data: revealData,
        message: `演示结果：「${revealData.title}」`,
        canSkip: allowSkipByTime
      }));

      await wait(860);
      setBlindboxReveal((current) => ({
        ...current,
        stage: 'resolved',
        data: revealData,
        canSkip: false,
        message: `演示完毕（${revealData.title}）。未修改数据库。`
      }));
      setSuccess('演示完成');
    } catch {
      setBlindboxReveal((current) => ({ ...current, stage: 'error', message: '演示启动失败', canSkip: false, demoMode: true }));
    } finally {
      if (skipTimer) window.clearTimeout(skipTimer);
    }
  }

  if (loading) {
    return (
      <div className="page page-center">
        <div style={{ color: 'var(--ink-2)', fontSize: '14px' }}>Loading workspace...</div>
      </div>
    );
  }

  return (
    <motion.div
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}
    >
      <motion.div
        variants={staggerContainer}
        initial="initial"
        animate="animate"
        style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}
      >
        <motion.section variants={staggerItem} className="frontend-bento-hero">
          <h1 className="frontend-bento-title">
            <Icon name="bolt" size={20} />
            签到工作台 (Check-in Workspace)
          </h1>
          <p className="frontend-bento-desc">
            业务日：{status?.checkin_date} ({status?.timezone}) · 当前状态：{status?.selected_mode ? getModeLabel(status.selected_mode) : '待执行'} {status?.selected_mode && `(${status.grant_status ?? '待处理'})`}
          </p>
          
          <div className="frontend-checkin-metrics">
            <div className="frontend-metric-item">
              <span className="frontend-metric-label">普通签到区间</span>
              <span className="frontend-metric-value">
                {status ? formatRewardRange(status.daily_reward_min_balance, status.daily_reward_max_balance) : '--'}
              </span>
            </div>
            <div className="frontend-metric-item">
              <span className="frontend-metric-label">盲盒掉落区间</span>
              <span className="frontend-metric-value">{getBlindboxRangeLabel(status)}</span>
            </div>
            <div className="frontend-metric-item">
              <span className="frontend-metric-label">限制模式</span>
              <span className="frontend-metric-value">每日 1 选 1</span>
            </div>
          </div>
        </motion.section>

        {(error || success) && (
          <motion.div variants={staggerItem}>
            {error && <p className="alert error">{error}</p>}
            {success && <p className="alert success">{success}</p>}
          </motion.div>
        )}

        <motion.div variants={staggerItem} className="frontend-segmented">
          <button
            type="button"
            className={`frontend-segment-btn ${activeMode === 'normal' ? 'active' : ''}`}
            onClick={() => setActiveMode('normal')}
          >
            普通签到
            {activeMode === 'normal' && <motion.div layoutId="mode-highlight" className="frontend-segment-highlight" transition={{ type: 'spring', stiffness: 400, damping: 30 }} />}
          </button>
          <button
            type="button"
            className={`frontend-segment-btn ${activeMode === 'blindbox' ? 'active' : ''}`}
            onClick={() => setActiveMode('blindbox')}
          >
            惊喜盲盒
            {activeMode === 'blindbox' && <motion.div layoutId="mode-highlight" className="frontend-segment-highlight" transition={{ type: 'spring', stiffness: 400, damping: 30 }} />}
          </button>
        </motion.div>

        {user?.is_admin && status?.selected_mode === 'normal' && (
          <div className="alert info" style={{ padding: '12px 16px', borderRadius: '12px', fontSize: '13px' }}>
            <Icon name="bolt" size={14} style={{ marginRight: '6px' }} />
            管理员提示：已签到。切换到盲盒可执行“演示开盒”测动画，无数据写入。
          </div>
        )}

        <motion.div className="frontend-bento-grid">
          <AnimatePresence mode="popLayout">
            {activeMode === 'normal' ? (
              <motion.div
                key="normal-mode"
                className="frontend-card"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                transition={{ duration: 0.2 }}
                style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}
              >
                <div className="frontend-bento-title">普通档 (Stable)</div>
                <div className="frontend-metric-value" style={{ fontSize: '24px' }}>
                  {status ? formatRewardRange(status.daily_reward_min_balance, status.daily_reward_max_balance) : '--'}
                </div>
                <p className="frontend-bento-desc">{getNormalStatusNote(status)}</p>
                <button
                  className={`button ${canSubmitNormal ? 'primary' : 'ghost'} wide`}
                  disabled={!canSubmitNormal}
                  onClick={handleNormalCheckin}
                >
                  {getNormalActionLabel(status, submittingMode)}
                </button>
              </motion.div>
            ) : (
              <motion.div
                key="blindbox-mode"
                className="frontend-card"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={{ duration: 0.2 }}
                style={{ display: 'flex', flexDirection: 'column', gap: '16px', background: 'var(--surface-0)' }}
              >
                <div className="frontend-bento-title" style={{ color: 'var(--teal)' }}>盲盒档 (Surprise)</div>
                <div className="frontend-metric-value" style={{ fontSize: '24px', color: 'var(--teal)' }}>
                  {getBlindboxRangeLabel(status)}
                </div>
                <p className="frontend-bento-desc">{getBlindboxStatusNote(status)}</p>
                <button
                  className={`button ${canSubmitBlindbox ? 'primary' : 'ghost'} wide`}
                  disabled={!canSubmitBlindbox}
                  onClick={handleBlindboxCheckin}
                  style={canSubmitBlindbox ? { background: 'var(--teal)', borderColor: 'var(--teal)' } : {}}
                >
                  {getBlindboxActionLabel(status, submittingMode)}
                </button>
                {user?.is_admin && (
                  <button
                    className="button ghost wide"
                    disabled={blindboxReveal.open || submittingMode != null}
                    onClick={handleBlindboxDemo}
                    style={{ marginTop: '-8px', fontSize: '12px' }}
                  >
                    管理员演示开盒
                  </button>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {activeMode === 'blindbox' && status?.blindbox_preview && status.blindbox_preview.items.length > 0 && (
            <motion.div className="frontend-card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div className="frontend-bento-title" style={{ fontSize: '15px' }}>盲盒池大赏</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {status.blindbox_preview.items.map((item) => (
                  <span key={item.id} style={{ padding: '4px 10px', background: 'var(--surface-0)', border: '1px solid var(--panel-border)', borderRadius: '99px', fontSize: '12px', fontWeight: '600' }}>
                     {item.title} <span style={{ color: 'var(--teal)' }}>+{item.reward_balance.toFixed(2)}</span>
                  </span>
                ))}
              </div>
            </motion.div>
          )}
        </motion.div>

      </motion.div>

      <BlindboxRevealOverlay
        open={blindboxReveal.open}
        stage={blindboxReveal.stage}
        data={blindboxReveal.data}
        message={blindboxReveal.message}
        canSkip={blindboxReveal.canSkip}
        demoMode={blindboxReveal.demoMode}
        onSkip={() => {
          if (!blindboxReveal.data) return;
          setBlindboxReveal((current) => ({ ...current, stage: 'resolved', canSkip: false }));
        }}
        onClose={() => setBlindboxReveal(initialBlindboxRevealState)}
      />
    </motion.div>
  );
}
