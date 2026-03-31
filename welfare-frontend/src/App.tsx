import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { AppShell } from './components/AppShell';
import { useAuth } from './lib/auth';
import { LoginPage } from './pages/LoginPage';
import { AuthCallbackPage } from './pages/AuthCallbackPage';
import { Sub2apiBridgePage } from './pages/Sub2apiBridgePage';
import { CheckinPage } from './pages/CheckinPage';
import { RedeemPage } from './pages/RedeemPage';
import { HistoryPage } from './pages/HistoryPage';
import { ResetPage } from './pages/ResetPage';
import { AdminPage } from './pages/AdminPage';

function AuthLoadingScreen() {
  return (
    <div className="page page-center">
      <div className="card auth-card">
        <span className="eyebrow">身份验证</span>
        <h1 className="hero-title">正在校验会话</h1>
        <p className="loading-text">请稍候...</p>
      </div>
    </div>
  );
}

function AuthErrorScreen() {
  const { error, refresh } = useAuth();

  return (
    <div className="page page-center">
      <div className="card auth-card">
        <span className="eyebrow">身份验证</span>
        <h1 className="hero-title">会话校验失败</h1>
        <p className="alert error">{error || '服务暂时不可用，请稍后重试'}</p>
        <button
          className="button primary wide"
          onClick={() => {
            void refresh().catch((refreshError) => {
              console.error('[auth] 手动重试会话失败', refreshError);
            });
          }}
        >
          重试校验
        </button>
      </div>
    </div>
  );
}

function RequireAuth({
  children,
  requireAdmin = false
}: {
  children: JSX.Element;
  requireAdmin?: boolean;
}) {
  const location = useLocation();
  const { status, user } = useAuth();

  if (status === 'loading') {
    return <AuthLoadingScreen />;
  }

  if (status === 'error') {
    return <AuthErrorScreen />;
  }

  if (status === 'unauthenticated') {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: `${location.pathname}${location.search}${location.hash}` }}
      />
    );
  }

  if (requireAdmin && !user?.is_admin) {
    return <Navigate to="/checkin" replace />;
  }

  return children;
}

export default function App() {
  const location = useLocation();
  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/auth/callback" element={<AuthCallbackPage />} />
        <Route path="/auth/sub2api-bridge" element={<Sub2apiBridgePage />} />
        <Route
          path="/admin"
          element={
            <RequireAuth requireAdmin>
              <AdminPage />
            </RequireAuth>
          }
        />
        <Route
          element={
            <RequireAuth>
              <AppShell />
            </RequireAuth>
          }
        >
          <Route path="/checkin" element={<CheckinPage />} />
          <Route path="/redeem" element={<RedeemPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/reset" element={<ResetPage />} />
          <Route path="*" element={<Navigate to="/checkin" replace />} />
        </Route>
      </Routes>
    </AnimatePresence>
  );
}
