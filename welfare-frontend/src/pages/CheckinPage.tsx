import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { BlindboxRevealOverlay, type BlindboxRevealStage } from '../components/BlindboxRevealOverlay';
import { useAuth } from '../lib/auth';
import { api, isUnauthorizedError } from '../lib/api';
import { pageVariants, staggerContainer, staggerItem } from '../lib/animations';
import { formatRewardRange, getModeLabel } from '../lib/welfare-display';
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
  await new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function getNormalActionLabel(status: CheckinStatus | null, submittingMode: CheckinMode | null): string {
  if (submittingMode === 'normal') {
    return '普通签到处理中...';
  }
  if (!status) {
    return '立即普通签到';
  }
  if (status.selected_mode === 'blindbox') {
    return '今日已选择盲盒签到';
  }
  if (status.selected_mode === 'normal' && status.grant_status === 'success') {
    return '✓ 今日普通签到已完成';
  }
  if (status.selected_mode === 'normal' && status.grant_status === 'pending' && !status.can_checkin_normal) {
    return '普通签到处理中...';
  }
  if (status.selected_mode === 'normal' && status.can_checkin_normal) {
    return '继续处理普通签到';
  }
  return '普通签到';
}

function getBlindboxActionLabel(status: CheckinStatus | null, submittingMode: CheckinMode | null): string {
  if (submittingMode === 'blindbox') {
    return '盲盒开启中...';
  }
  if (!status) {
    return '开启今日盲盒';
  }
  if (status.selected_mode === 'normal') {
    return '今日已选择普通签到';
  }
  if (status.selected_mode === 'blindbox' && status.grant_status === 'success') {
    return '✓ 今日盲盒已开启';
  }
  if (status.selected_mode === 'blindbox' && status.grant_status === 'pending' && !status.can_checkin_blindbox) {
    return '盲盒处理中...';
  }
  if (status.selected_mode === 'blindbox' && status.can_checkin_blindbox) {
    return '继续处理本次盲盒';
  }
  if (!status.blindbox_enabled || status.blindbox_preview.item_count === 0) {
    return '盲盒暂不可用';
  }
  return '开启今日盲盒';
}

function getNormalStatusNote(status: CheckinStatus | null): string {
  if (!status) {
    return '按后台区间随机发放。';
  }
  if (!status.checkin_enabled) {
    return '签到已关闭。';
  }
  if (status.selected_mode === 'blindbox') {
    return '今天已选盲盒。';
  }
  if (status.selected_mode === 'normal' && status.grant_status === 'failed') {
    return '本次奖励已锁定，可继续重试。';
  }
  if (status.selected_mode === 'normal' && status.grant_status === 'pending') {
    return status.can_checkin_normal
      ? '可继续接管这次发放。'
      : '正在处理中。';
  }
  if (status.selected_mode === 'normal' && status.grant_status === 'success') {
    return '今日已到账。';
  }
  return '按后台区间随机发放。';
}

function getBlindboxStatusNote(status: CheckinStatus | null): string {
  if (!status) {
    return '奖励由奖池决定。';
  }
  if (status.selected_mode === 'normal') {
    return '今天已完成普通签到。';
  }
  if (status.selected_mode === 'blindbox' && status.grant_status === 'failed') {
    return `结果已锁定：${status.blindbox_result?.title ?? '惊喜签'}。`;
  }
  if (status.selected_mode === 'blindbox' && status.grant_status === 'pending') {
    return status.can_checkin_blindbox
      ? `结果已锁定：${status.blindbox_result?.title ?? '惊喜签'}。`
      : '正在处理中。';
  }
  if (status.selected_mode === 'blindbox' && status.grant_status === 'success') {
    return `已抽中：${status.blindbox_result?.title ?? '惊喜签'}。`;
  }
  if (!status.checkin_enabled) {
    return '签到已关闭。';
  }
  if (!status.blindbox_enabled) {
    return '盲盒未开放。';
  }
  if (status.blindbox_preview.item_count === 0) {
    return '当前没有可用奖项。';
  }
  return '奖励由奖池决定。';
}

function getBlindboxRangeLabel(status: CheckinStatus | null): string {
  if (!status || status.blindbox_preview.item_count === 0) {
    return '--';
  }
  const min = status.blindbox_preview.min_reward;
  const max = status.blindbox_preview.max_reward;
  if (min == null || max == null) {
    return '--';
  }
  return `${min.toFixed(2)} ~ ${max.toFixed(2)}`;
}

function pickBlindboxDemoItem(items: BlindboxPreviewItem[]): BlindboxPreviewItem | null {
  if (items.length === 0) {
    return null;
  }
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
    if (showLoading) {
      setLoading(true);
    }
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
      if (showLoading) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    void loadAll(true);
  }, []);

  useEffect(() => {
    if (!status) {
      return;
    }

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
      setSuccess(
        `普通签到成功，已发放 ${result.reward_balance}，当前余额 ${result.new_balance ?? '未知'}`
      );
      await loadAll();
    } catch (err) {
      if (isUnauthorizedError(err)) {
        await redirectToLogin();
        return;
      }
      setError(
        `普通签到失败：${err instanceof Error && err.message ? err.message : '请稍后重试'}`
      );
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
      message: '幸运纹路正在聚拢，今天的签文即将现身。',
      canSkip: false,
      demoMode: false
    });

    try {
      const requestPromise = api.checkBlindbox();
      skipTimer = window.setTimeout(() => {
        allowSkipByTime = true;
        setBlindboxReveal((current) =>
          current.data ? { ...current, canSkip: true } : current
        );
      }, 800);

      await wait(420);
      setBlindboxReveal((current) => ({
        ...current,
        stage: 'suspense',
        message: '签文正在凝结，今天的好运浓度正在提升。'
      }));

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
        message: `抽中「${revealData.title}」，好运已经离你很近。`,
        canSkip: allowSkipByTime
      }));

      await loadAll();
      await wait(860);

      setBlindboxReveal((current) => ({
        ...current,
        stage: 'resolved',
        data: revealData,
        canSkip: false,
        message:
          result.new_balance != null
            ? `今日抽中「${revealData.title}」，已到账 ${result.reward_balance}，当前余额 ${result.new_balance}`
            : `今日抽中「${revealData.title}」，奖励已发放 ${result.reward_balance}`
      }));
      setSuccess(
        `盲盒签到成功，抽中 ${revealData.title}，已发放 ${result.reward_balance}`
      );
    } catch (err) {
      if (isUnauthorizedError(err)) {
        await redirectToLogin();
        return;
      }

      const detail = err instanceof Error && err.message ? err.message : '请稍后重试';
      setError(`盲盒签到失败：${detail}`);
      await loadAll();
      setBlindboxReveal((current) => ({
        ...current,
        stage: 'error',
        message: detail,
        canSkip: false
      }));
    } finally {
      if (skipTimer) {
        window.clearTimeout(skipTimer);
      }
      setSubmittingMode(null);
    }
  }

  async function handleBlindboxDemo() {
    if (!user?.is_admin || blindboxReveal.open || submittingMode != null) {
      return;
    }

    const demoSourceItems =
      (status?.blindbox_preview.items?.length ?? 0) > 0
        ? status?.blindbox_preview.items ?? []
        : blindboxDemoFallbackItems;
    const demoItem = pickBlindboxDemoItem(demoSourceItems);
    if (!demoItem) {
      setError('当前没有可用于演示的盲盒奖项');
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
      message:
        (status?.blindbox_preview.items?.length ?? 0) > 0
          ? '管理员演示模式已启动：本次会复用当前奖池做视觉演示，不写入签到记录。'
          : '管理员演示模式已启动：当前奖池为空，已切换到内置演示签文，不写入签到记录。',
      canSkip: false,
      demoMode: true
    });

    try {
      skipTimer = window.setTimeout(() => {
        allowSkipByTime = true;
        setBlindboxReveal((current) =>
          current.data ? { ...current, canSkip: true } : current
        );
      }, 800);

      await wait(420);
      setBlindboxReveal((current) => ({
        ...current,
        stage: 'suspense',
        message: '演示中的签文正在凝结，你可以专注看动画与结果卡表现。'
      }));

      await wait(2400);
      const revealData = {
        title: demoItem.title,
        reward_balance: demoItem.reward_balance,
        new_balance: null
      };

      setBlindboxReveal((current) => ({
        ...current,
        stage: 'reveal',
        data: revealData,
        message: `演示抽中「${revealData.title}」，这只是视觉演示，不会真实发奖。`,
        canSkip: allowSkipByTime
      }));

      await wait(860);
      setBlindboxReveal((current) => ({
        ...current,
        stage: 'resolved',
        data: revealData,
        canSkip: false,
        message: `管理员演示完成：当前展示的是「${revealData.title}」的开盒效果，签到状态未发生变化。`
      }));
      setSuccess('管理员演示完成：未写入签到记录，也未发放奖励');
    } catch {
      setBlindboxReveal((current) => ({
        ...current,
        stage: 'error',
        message: '演示启动失败，请稍后重试。',
        canSkip: false,
        demoMode: true
      }));
    } finally {
      if (skipTimer) {
        window.clearTimeout(skipTimer);
      }
    }
  }

  if (loading) {
    return (
      <div className="page page-center">
        <div className="card auth-card">
          <span className="eyebrow">签到</span>
          <h1 className="hero-title">每日签到</h1>
          <p className="loading-text">加载中...</p>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      className="page fortune-page"
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      <motion.div
        variants={staggerContainer}
        initial="initial"
        animate="animate"
        className="checkin-layout"
      >
        <motion.header variants={staggerItem} className="checkin-header fortune-header checkin-command-header">
          <div className="user-info">
            {user?.avatar_url && (
              <img className="user-avatar" src={user.avatar_url} alt={user.username} />
            )}
            <div>
              <span className="fortune-inline-kicker">check station</span>
              <h1 className="hero-title fortune-inline-title">
                {user?.username}
              </h1>
              <p className="muted fortune-inline-meta">
                sub2api #{user?.sub2api_user_id} · {status?.checkin_date} · {status?.timezone}
              </p>
            </div>
          </div>
          <div className="stack checkin-header-note">
            <strong>今日模式只会生成一条签到记录</strong>
            <span className="muted">其他功能在顶部导航</span>
          </div>
        </motion.header>

        <motion.section variants={staggerItem} className="fortune-shell">
          <div className="fortune-shell-glow fortune-shell-glow-a" />
          <div className="fortune-shell-glow fortune-shell-glow-b" />

          <div className="fortune-shell-head">
            <div className="fortune-headline-stack">
              <span className="eyebrow fortune-eyebrow">Daily Ritual</span>
              <h2 className="fortune-title">DAILY CHECK-IN</h2>
              <p className="fortune-title-shadow">MODE SELECTOR</p>
              <p className="fortune-copy">
                普通签到按区间随机发放，盲盒走奖池。每天只能选一种模式。
              </p>
            </div>
            <div className="fortune-meta-grid">
              <div className="fortune-meta-card">
                <span className="fortune-meta-label">普通签到</span>
                <strong>
                  {status
                    ? formatRewardRange(
                        status.daily_reward_min_balance,
                        status.daily_reward_max_balance
                      )
                    : '--'}
                </strong>
                <small>区间随机</small>
              </div>
              <div className="fortune-meta-card">
                <span className="fortune-meta-label">今日状态</span>
                <strong>{status?.selected_mode ? getModeLabel(status.selected_mode) : '待选择'}</strong>
                <small>
                  {status?.selected_mode
                    ? `当前链路：${status.grant_status ?? '待处理'}`
                    : '尚未选择签到模式'}
                </small>
              </div>
              <div className="fortune-meta-card">
                <span className="fortune-meta-label">业务日</span>
                <strong>{status?.checkin_date}</strong>
                <small>{status?.timezone}</small>
              </div>
            </div>
          </div>

          <div className="fortune-mode-switch" role="tablist" aria-label="签到模式切换">
            <button
              type="button"
              role="tab"
              aria-selected={activeMode === 'normal'}
              className={`fortune-mode-tab ${activeMode === 'normal' ? 'active' : ''}`}
              onClick={() => setActiveMode('normal')}
            >
              <span>普通签到</span>
              <small>稳定到账</small>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeMode === 'blindbox'}
              className={`fortune-mode-tab ${activeMode === 'blindbox' ? 'active blindbox' : 'blindbox'}`}
              onClick={() => setActiveMode('blindbox')}
            >
              <span>惊喜签到</span>
              <small>风险型盲盒</small>
            </button>
          </div>

          {user?.is_admin && status?.selected_mode === 'normal' && (
            <div className="admin-demo-inline-hint">
              <div>
                <strong>你今天已经完成普通签到</strong>
                <span>不影响继续测试：可直接切到惊喜签到并使用“管理员演示开盒”，不会写记录也不会发奖励。</span>
              </div>
              <button className="button ghost" onClick={() => setActiveMode('blindbox')}>
                去测试盲盒动画
              </button>
            </div>
          )}

          <AnimatePresence mode="wait">
            {activeMode === 'normal' ? (
              <motion.div
                key="normal-mode"
                className="fortune-panel normal"
                initial={{ opacity: 0, y: 18, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -18, scale: 0.98 }}
                transition={{ duration: 0.36, ease: [0.22, 1, 0.36, 1] }}
              >
                <div className="fortune-panel-left normal-surface">
                  <span className="fortune-panel-kicker">stable lane</span>
                  <div className="fortune-panel-value">
                    {status
                      ? formatRewardRange(
                          status.daily_reward_min_balance,
                          status.daily_reward_max_balance
                        )
                      : '--'}
                  </div>
                  <p className="fortune-panel-title">普通签到奖励区间</p>
                  <p className="fortune-panel-note">{getNormalStatusNote(status)}</p>
                  <button
                    className={`button fortune-action ${canSubmitNormal ? 'primary' : 'ghost'}`}
                    disabled={!canSubmitNormal}
                    onClick={handleNormalCheckin}
                  >
                    {getNormalActionLabel(status, submittingMode)}
                  </button>
                </div>

                <div className="fortune-panel-right">
                  <div className="fortune-bullet-grid">
                    <div className="fortune-bullet-card">
                      <strong>随机区间</strong>
                      <span>按后台配置范围发放。</span>
                    </div>
                    <div className="fortune-bullet-card">
                      <strong>直接发放</strong>
                      <span>不走盲盒奖池。</span>
                    </div>
                    <div className="fortune-bullet-card mode-lock-card">
                      <strong>模式锁定</strong>
                      <span>完成后当日不能改模式。</span>
                    </div>
                  </div>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="blindbox-mode"
                className="fortune-panel blindbox"
                initial={{ opacity: 0, y: 18, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -18, scale: 0.98 }}
                transition={{ duration: 0.36, ease: [0.22, 1, 0.36, 1] }}
              >
                <div className="fortune-panel-left blindbox-surface">
                  <span className="fortune-panel-kicker">surprise lane</span>
                  <div className="fortune-cylinder-wrapper blindbox-inline-symbol">
                    <div className="fortune-sticks-container">
                      {[...Array(5)].map((_, i) => (
                        <div key={i} className="fortune-stick" />
                      ))}
                    </div>
                    <div className="fortune-cylinder">
                      <div className="fortune-cylinder-label">灵签</div>
                    </div>
                  </div>
                  <div className="fortune-panel-value blindbox-value">{getBlindboxRangeLabel(status)}</div>
                  <p className="fortune-panel-title">今天的盲盒奖励区间</p>
                  <p className="fortune-panel-note">{getBlindboxStatusNote(status)}</p>
                  <button
                    className={`button fortune-action blindbox-action ${
                      canSubmitBlindbox ? 'primary' : 'ghost'
                    }`}
                    disabled={!canSubmitBlindbox}
                    onClick={handleBlindboxCheckin}
                  >
                    {getBlindboxActionLabel(status, submittingMode)}
                  </button>
                  {user?.is_admin && (
                    <div className="blindbox-demo-hint">
                      <button
                        className="button blindbox-demo-button"
                        disabled={blindboxReveal.open || submittingMode != null}
                        onClick={handleBlindboxDemo}
                      >
                        管理员演示开盒
                      </button>
                      <span>仅演示，不写记录。</span>
                    </div>
                  )}
                </div>

                <div className="fortune-panel-right">
                  <div className="fortune-side-topline">
                    <span className="fortune-side-title">可能获得</span>
                    <span className="fortune-side-caption">仅展示奖池项与奖励范围，不公开精确概率</span>
                  </div>
                  <div className="blindbox-chip-cloud">
                    {status?.blindbox_preview.items.map((item) => (
                      <span key={item.id} className="blindbox-chip">
                        <strong>{item.title}</strong>
                        <em>+{item.reward_balance.toFixed(2)}</em>
                      </span>
                    ))}
                    {status?.blindbox_preview.items.length === 0 && (
                      <div className="empty-state">
                        当前没有可展示的盲盒奖项。管理员仍可使用“演示开盒”测试动画与结果卡。
                      </div>
                    )}
                  </div>
                  {status?.selected_mode === 'blindbox' && status.blindbox_result?.title && (
                    <div className="blindbox-locked-note">
                      <span>今日已锁定签文</span>
                      <strong>{status.blindbox_result.title}</strong>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.section>

        {(error || success) && (
          <motion.div variants={staggerItem}>
            {error && <p className="alert error">{error}</p>}
            {success && <p className="alert success">{success}</p>}
          </motion.div>
        )}

        <motion.section variants={staggerItem} className="quick-access-grid">
          <div className="panel quick-access-card">
            <strong>福利码</strong>
            <p>兑换入口已独立。</p>
            <button className="button" onClick={() => navigate('/redeem')}>
              前往福利码页
            </button>
          </div>
          <div className="panel quick-access-card">
            <strong>记录</strong>
            <p>签到和兑换流水单独查看。</p>
            <button className="button" onClick={() => navigate('/history')}>
              查看记录
            </button>
          </div>
          <div className="panel quick-access-card">
            <strong>额度重置</strong>
            <p>是否可用由后台规则控制。</p>
            <button className="button" onClick={() => navigate('/reset')}>
              打开重置页
            </button>
          </div>
        </motion.section>
      </motion.div>

      <BlindboxRevealOverlay
        open={blindboxReveal.open}
        stage={blindboxReveal.stage}
        data={blindboxReveal.data}
        message={blindboxReveal.message}
        canSkip={blindboxReveal.canSkip}
        demoMode={blindboxReveal.demoMode}
        onSkip={() => {
          if (!blindboxReveal.data) {
            return;
          }
          setBlindboxReveal((current) => ({ ...current, stage: 'resolved', canSkip: false }));
        }}
        onClose={() => setBlindboxReveal(initialBlindboxRevealState)}
      />
    </motion.div>
  );
}
