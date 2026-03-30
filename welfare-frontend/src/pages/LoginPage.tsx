import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { buildLinuxDoStartUrl, buildSub2apiAdminLoginUrl } from '../lib/api';
import { Icon } from '../components/Icon';
import { motion } from 'framer-motion';
import { pageVariants } from '../lib/animations';

export function LoginPage() {
  const location = useLocation();
  const { status } = useAuth();
  const redirectPath =
    typeof (location.state as { from?: unknown } | null)?.from === 'string'
      ? (location.state as { from: string }).from
      : '/checkin';
  const adminLoginUrl = buildSub2apiAdminLoginUrl('/admin');

  if (status === 'authenticated') {
    return <Navigate to={redirectPath} replace />;
  }

  return (
    <motion.div 
      className="page page-center"
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      <div className="card auth-card">
        <span className="eyebrow">福利站</span>
        <h1 className="hero-title">sub2api <span className="text-gradient">福利站</span></h1>
        <p className="lead">
          使用 LinuxDo 账号登录后自动匹配 sub2api 用户，通过每日签到领取额度奖励。
        </p>

        <div className="feature-list">
          <div className="feature-item">
            <div className="icon-wrapper">
              <Icon name="link" className="icon" size={20} />
            </div>
            <div className="feature-item-content">
              <strong>账号联动</strong>
              <span>按 LinuxDo subject 精准识别 sub2api 用户</span>
            </div>
          </div>
          <div className="feature-item">
            <div className="icon-wrapper">
              <Icon name="gift" className="icon" size={20} />
            </div>
            <div className="feature-item-content">
              <strong>签到发放</strong>
              <span>调用 sub2api 管理接口并附带幂等键</span>
            </div>
          </div>
          <div className="feature-item">
            <div className="icon-wrapper">
              <Icon name="settings" className="icon" size={20} />
            </div>
            <div className="feature-item-content">
              <strong>后台管理</strong>
              <span>可配置开关、奖励值、时区与管理员白名单</span>
            </div>
          </div>
        </div>

        <a className="button primary wide" href={buildLinuxDoStartUrl(redirectPath)}>
          使用 LinuxDo 登录 →
        </a>
        {adminLoginUrl && (
          <a className="button wide" href={adminLoginUrl}>
            使用 sub2api 管理员登录
          </a>
        )}
      </div>
    </motion.div>
  );
}
