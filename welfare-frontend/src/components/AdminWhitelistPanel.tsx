import { Icon } from './Icon';
import { formatAdminDateTime } from '../lib/admin-format';
import type { AdminUserSearchItem, WhitelistItem } from '../types';

interface AdminWhitelistPanelProps {
  userName: string;
  currentUserId: number;
  whitelist: WhitelistItem[];
  searchQuery: string;
  newNotes: string;
  searchResults: AdminUserSearchItem[];
  searching: boolean;
  onSearchQueryChange: (value: string) => void;
  onNotesChange: (value: string) => void;
  onSearch: () => Promise<void>;
  onAdd: (user: AdminUserSearchItem) => Promise<void>;
  onRemove: (id: number) => Promise<void>;
}

function renderIdentity(item: {
  username: string;
  email: string;
  linuxdoSubject: string | null;
}) {
  return (
    <div className="stack">
      <strong>{item.username || item.email}</strong>
      <span className="muted admin-checkin-meta">{item.email}</span>
      {item.linuxdoSubject && (
        <span className="muted admin-checkin-meta">LinuxDo: {item.linuxdoSubject}</span>
      )}
    </div>
  );
}

export function AdminWhitelistPanel({
  userName,
  currentUserId,
  whitelist,
  searchQuery,
  newNotes,
  searchResults,
  searching,
  onSearchQueryChange,
  onNotesChange,
  onSearch,
  onAdd,
  onRemove
}: AdminWhitelistPanelProps) {
  return (
    <div className="admin-section-stack">
      <div className="admin-two-column">
        <div className="panel">
          <h2 className="section-title">
            <span className="section-title-content">
              <Icon name="shield" className="icon icon-accent" />
              <span>搜索并添加管理员</span>
            </span>
          </h2>
          <div className="form-grid">
            <label className="field">
              <span>用户关键字</span>
              <input
                value={searchQuery}
                onChange={(event) => onSearchQueryChange(event.target.value)}
                placeholder="输入用户名或邮箱"
              />
            </label>
            <label className="field">
              <span>备注</span>
              <input
                value={newNotes}
                onChange={(event) => onNotesChange(event.target.value)}
                placeholder="例如 运营值班号"
              />
            </label>
          </div>
          <div className="form-actions">
            <button className="button primary" onClick={() => void onSearch()}>
              {searching ? '搜索中...' : '搜索 sub2api 用户'}
            </button>
          </div>
          <div className="list" style={{ marginTop: 16 }}>
            {searchResults.length === 0 && (
              <div className="empty-state">先搜索一个 sub2api 用户，再把它加入管理员白名单。</div>
            )}
            {searchResults.map((item) => {
              const alreadyAdded = whitelist.some(
                (current) => current.sub2apiUserId === item.sub2api_user_id
              );

              return (
                <div key={item.sub2api_user_id} className="list-item admin-list-compact">
                  {renderIdentity({
                    username: item.username,
                    email: item.email,
                    linuxdoSubject: item.linuxdo_subject
                  })}
                  <span className="muted admin-checkin-meta">用户 #{item.sub2api_user_id}</span>
                  <button
                    className="button primary"
                    disabled={alreadyAdded}
                    onClick={() => void onAdd(item)}
                  >
                    {alreadyAdded ? '已在白名单' : '添加管理员'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        <div className="panel">
          <h2 className="section-title">
            <span className="section-title-content">
              <Icon name="users" className="icon icon-accent" />
              <span>权限摘要</span>
            </span>
          </h2>
        <div className="admin-stats-summary">
          <span className="chip">管理员数量：{whitelist.length}</span>
          <span className="chip">当前登录：{userName}</span>
        </div>
        <p className="muted admin-note">
          白名单按 sub2api 用户 ID 生效。部署管理员建议通过 `BOOTSTRAP_ADMIN_EMAILS` 预热。
        </p>
        </div>
      </div>

      <div className="panel">
        <h2 className="section-title">
          <span className="section-title-content">
            <Icon name="users" className="icon icon-accent" />
            <span>管理员白名单</span>
          </span>
        </h2>
        <div className="list" style={{ marginTop: 16 }}>
          {whitelist.length === 0 && <div className="empty-state">暂无管理员白名单</div>}
          {whitelist.map((item) => {
            const isCurrentAdmin = item.sub2apiUserId === currentUserId;
            const isProtected = isCurrentAdmin || whitelist.length <= 1;

            return (
              <div key={item.id} className="list-item admin-list-compact">
                {renderIdentity(item)}
                <span className="muted admin-checkin-meta">
                  用户 #{item.sub2apiUserId ?? '待回填'}
                </span>
                <span className="muted admin-checkin-meta">
                  {formatAdminDateTime(item.createdAt)}
                </span>
                <span className="muted admin-checkin-meta">{item.notes || '无备注'}</span>
                <button
                  className="button danger"
                  disabled={isProtected}
                  title={
                    isCurrentAdmin
                      ? '当前登录管理员不能删除自己'
                      : whitelist.length <= 1
                        ? '至少保留一名管理员'
                        : undefined
                  }
                  onClick={() => void onRemove(item.id)}
                >
                  {isCurrentAdmin ? '当前账号' : whitelist.length <= 1 ? '已保护' : '删除'}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
