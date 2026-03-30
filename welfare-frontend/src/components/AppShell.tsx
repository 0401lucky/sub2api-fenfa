import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Icon } from './Icon';
import { useAuth } from '../lib/auth';

const baseNavItems = [
  { to: '/checkin', label: '签到', icon: 'bolt' as const },
  { to: '/redeem', label: '福利码', icon: 'ticket' as const },
  { to: '/history', label: '记录', icon: 'chart' as const },
  { to: '/reset', label: '重置', icon: 'grid' as const }
];

export function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  const navItems = user?.is_admin
    ? [...baseNavItems, { to: '/admin', label: '后台', icon: 'settings' as const }]
    : baseNavItems;

  return (
    <div className="app-shell">
      <header className="app-shell-header">
        <div className="app-shell-header-inner">
          <NavLink to="/checkin" className="app-shell-brand">
            <span className="app-shell-brand-mark">WF</span>
            <span className="app-shell-brand-copy">
              <strong>Welfare Station</strong>
              <small>签到 · 福利码 · 记录 · 重置</small>
            </span>
          </NavLink>

          <button
            type="button"
            className="button ghost app-shell-menu-button"
            onClick={() => setMenuOpen((current) => !current)}
            aria-expanded={menuOpen}
            aria-controls="app-shell-nav"
          >
            <Icon name="grid" size={16} />
            菜单
          </button>

          <div className="app-shell-user">
            {user?.avatar_url ? (
              <img className="user-avatar user-avatar-sm" src={user.avatar_url} alt={user.username} />
            ) : (
              <span className="app-shell-user-fallback">{user?.username?.slice(0, 1) || 'U'}</span>
            )}
            <div className="app-shell-user-copy">
              <strong>{user?.username}</strong>
              <small>{user?.email}</small>
            </div>
            <button type="button" className="button danger" onClick={handleLogout}>
              退出
            </button>
          </div>
        </div>

        <div className="app-shell-nav-wrap">
          <nav
            id="app-shell-nav"
            className={`app-shell-nav ${menuOpen ? 'open' : ''}`}
            aria-label="主导航"
          >
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `app-shell-nav-item ${isActive ? 'active' : ''}`
                }
              >
                <Icon name={item.icon} size={16} />
                <span>{item.label}</span>
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      <main className="app-shell-main">
        <Outlet />
      </main>
    </div>
  );
}
