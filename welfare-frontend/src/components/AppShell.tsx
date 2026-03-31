import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
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
  const [hoveredPath, setHoveredPath] = useState<string | null>(null);

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  const navItems = user?.is_admin
    ? [...baseNavItems, { to: '/admin', label: '后台', icon: 'settings' as const }]
    : baseNavItems;

  return (
    <div className="frontend-workspace">
      <div className="frontend-floating-nav-wrapper">
        <motion.nav 
          className="frontend-floating-nav"
          initial={{ y: -64, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ type: "spring", stiffness: 300, damping: 24 }}
        >
          <div className="frontend-nav-brand">
            <span className="frontend-brand-mark">W</span>
            <span>Station</span>
          </div>

          <div 
            className="frontend-nav-links"
            onMouseLeave={() => setHoveredPath(null)}
          >
            {navItems.map((item) => {
              const isActive = location.pathname.startsWith(item.to);
              const isHovered = hoveredPath === item.to;
              
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onMouseEnter={() => setHoveredPath(item.to)}
                  className={`frontend-nav-item ${isActive ? 'active' : ''}`}
                >
                  <Icon name={item.icon} size={14} />
                  <span>{item.label}</span>
                  
                  {isActive && (
                    <motion.div
                      layoutId="frontend-nav-indicator"
                      className="frontend-nav-highlight"
                      initial={false}
                      transition={{ type: "spring", stiffness: 400, damping: 30 }}
                    />
                  )}
                  {isHovered && !isActive && (
                    <motion.div
                      layoutId="frontend-nav-hover"
                      className="frontend-nav-highlight"
                      style={{ opacity: 0.5, zIndex: -2 }}
                      initial={false}
                      transition={{ type: "spring", stiffness: 400, damping: 30 }}
                    />
                  )}
                </NavLink>
              );
            })}
          </div>

          <div className="frontend-nav-user">
            {user?.avatar_url ? (
              <img className="frontend-user-avatar" src={user.avatar_url} alt={user.username} />
            ) : (
              <div className="frontend-brand-mark" style={{ background: 'var(--ink-2)' }}>
                {user?.username?.slice(0, 1) || 'U'}
              </div>
            )}
            <button 
              type="button" 
              className="frontend-user-logout" 
              onClick={handleLogout}
              title="退出登录"
            >
              <span style={{ fontSize: '12px', fontWeight: 'bold' }}>✕</span>
            </button>
          </div>
        </motion.nav>
      </div>

      <main className="frontend-container">
        <Outlet />
      </main>
    </div>
  );
}
