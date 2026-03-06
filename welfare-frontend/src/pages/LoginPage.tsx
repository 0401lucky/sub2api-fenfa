import { Navigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { buildLinuxDoStartUrl } from '../lib/api';
import { Icon } from '../components/Icon';

export function LoginPage() {
  const { status } = useAuth();

  if (status === 'authenticated') {
    return <Navigate to="/checkin" replace />;
  }

  return (
    <div className="page page-center">
      <div className="card auth-card">
        <span className="eyebrow">福利站</span>
        <h1 className="hero-title">sub2api 福利站</h1>
        <p className="lead">
          使用 LinuxDo 账号登录后自动匹配 sub2api 用户，通过每日签到领取额度奖励。
        </p>

        <div className="feature-list">
          <div className="feature-item">
            <strong>
              <span className="icon-text">
                <Icon name="link" className="icon icon-accent" />
                <span>账号联动</span>
              </span>
            </strong>
            <span>按 LinuxDo subject 精准识别 sub2api 用户</span>
          </div>
          <div className="feature-item">
            <strong>
              <span className="icon-text">
                <Icon name="gift" className="icon icon-accent" />
                <span>签到发放</span>
              </span>
            </strong>
            <span>调用 sub2api 管理接口并附带幂等键</span>
          </div>
          <div className="feature-item">
            <strong>
              <span className="icon-text">
                <Icon name="settings" className="icon icon-accent" />
                <span>后台管理</span>
              </span>
            </strong>
            <span>可配置开关、奖励值、时区与管理员白名单</span>
          </div>
        </div>

        <a className="button primary wide" href={buildLinuxDoStartUrl('/checkin')}>
          使用 LinuxDo 登录 →
        </a>
      </div>
    </div>
  );
}
