import { useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { useAuth } from '../lib/auth';
import { api, isUnauthorizedError } from '../lib/api';
import { pageVariants, staggerContainer, staggerItem } from '../lib/animations';

export function RedeemPage() {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const [redeemCodeInput, setRedeemCodeInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function redirectToLogin() {
    await logout();
    navigate('/login', { replace: true });
  }

  async function handleRedeem() {
    if (!redeemCodeInput.trim() || submitting) {
      return;
    }

    setSubmitting(true);
    setError('');
    setSuccess('');

    try {
      const result = await api.redeemCode({
        code: redeemCodeInput.trim()
      });
      setRedeemCodeInput('');
      setSuccess(
        `兑换成功，${result.title} 已发放 ${result.reward_balance}，当前余额 ${result.new_balance ?? '未知'}`
      );
    } catch (err) {
      if (isUnauthorizedError(err)) {
        await redirectToLogin();
        return;
      }

      setError(
        `兑换失败：${err instanceof Error && err.message ? err.message : '请稍后重试'}`
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <motion.div
      className="page utility-page"
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      <motion.div
        className="utility-page-stack"
        variants={staggerContainer}
        initial="initial"
        animate="animate"
      >
        <motion.section variants={staggerItem} className="panel utility-hero">
          <span className="eyebrow">Reward Exchange</span>
          <h1 className="hero-title utility-title">福利码兑换</h1>
          <p className="lead utility-lead">活动码和补发码统一在这里处理。</p>
          <div className="utility-chip-row">
            <span className="chip">单次兑换即时入账</span>
            <span className="chip">失败原因直接回显</span>
            <span className="chip">历史记录移到独立页面</span>
          </div>
        </motion.section>

        {(error || success) && (
          <motion.div variants={staggerItem}>
            {error && <p className="alert error">{error}</p>}
            {success && <p className="alert success">{success}</p>}
          </motion.div>
        )}

        <motion.section variants={staggerItem} className="panel utility-form-panel">
          <div className="section-head">
            <h2 className="section-title">输入福利码</h2>
          </div>
          <div className="redeem-form-row">
            <div className="field redeem-field">
              <span>福利码 (Code)</span>
              <input
                type="text"
                value={redeemCodeInput}
                onChange={(event) => setRedeemCodeInput(event.target.value)}
                placeholder="例如：WELCOME100"
                disabled={submitting}
              />
            </div>
            <div className="redeem-action">
              <button
                className="button primary wide"
                disabled={redeemCodeInput.trim() === '' || submitting}
                onClick={handleRedeem}
              >
                {submitting ? '兑换中...' : '立即兑换'}
              </button>
            </div>
          </div>
        </motion.section>

        <motion.section variants={staggerItem} className="utility-grid">
          <div className="panel utility-side-card">
          <div className="utility-side-icon">
            <Icon name="ticket" size={18} />
          </div>
            <strong>独立兑换入口</strong>
            <p>避免继续把签到页拉长。</p>
          </div>
          <div className="panel utility-side-card">
            <div className="utility-side-icon">
              <Icon name="chart" size={18} />
            </div>
            <strong>记录单独查看</strong>
            <p>历史流水统一放到“记录”页。</p>
          </div>
        </motion.section>
      </motion.div>
    </motion.div>
  );
}
