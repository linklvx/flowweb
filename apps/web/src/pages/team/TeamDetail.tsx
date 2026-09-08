import { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router';
import { Table, Button, Modal, Input, Progress, Tag, message, Pagination, Switch } from 'antd';
import {
  listMembers, changeRole, removeMember, setQuota, renameTeam, disbandTeam, transferOwnership,
  listJoinRequests, approveJoinRequest, rejectJoinRequest,
  getTeamBalanceView, listTeamTransactions,
  getTeamLimits, getTeamUsage,
  getAuditLogs, teamDisplayName, type AuditLogRow, type MyTeam,
} from '@/api/teamApi';
import { useAuth } from '@/components/AuthProvider';
import { useTeamStore } from '@/stores/teamStore';

const ACCENT = '#5DDCFF';

function fmtBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)}G`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)}M`;
  return `${(n / 1024).toFixed(0)}K`;
}

const ROLE_LABEL: Record<string, string> = { OWNER: '所有者', ADMIN: '管理员', MEMBER: '成员' };

const ACTION_LABEL: Record<string, string> = {
  create_team: '建立团队',
  disband_team: '解散团队',
  remove_member: '移除成员',
  change_role: '变更角色',
  adjust_quota: '调整配额',
  transfer_ownership: '转让所有权',
  approve_join: '通过申请',
  reject_join: '拒绝申请',
  recharge: '充值',
  subscribe: '订阅',
  expire: '过期',
  add_project_member: '添加项目成员',
  change_project_role: '变更项目角色',
  remove_project_member: '移除项目成员',
};

interface TeamDetailProps {
  team: MyTeam;
  /** 打开外层 createModal（个人面板与 header 的新建团队按钮共用） */
  onCreateTeam: () => void;
}

/** 团队/个人面板主体：key={team.id} 由父层强制重挂载，切换团队时本地 state 天然归零 */
export function TeamDetail({ team, onCreateTeam }: TeamDetailProps) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const teamId = team.id;
  const [tab, setTab] = useState<'members' | 'credits' | 'permissions' | 'requests' | 'audit'>('members');

  const [members, setMembers] = useState<{ items: any[]; total: number }>({ items: [], total: 0 });
  const [memberPage, setMemberPage] = useState(1);
  const [balance, setBalance] = useState<{ credits: number; subscriptionCredits: number; total: number } | null>(null);
  const [transactions, setTransactions] = useState<{ items: any[]; total: number }>({ items: [], total: 0 });
  const [txPage, setTxPage] = useState(1);
  const [limits, setLimits] = useState<{ seatLimit: number; storageLimitBytes: number } | null>(null);
  const [usage, setUsage] = useState(0);
  const [requests, setRequests] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<{ items: AuditLogRow[]; total: number }>({ items: [], total: 0 });
  const [auditPage, setAuditPage] = useState(1);

  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [quotaTarget, setQuotaTarget] = useState<any | null>(null);
  const [quotaValue, setQuotaValue] = useState('');

  const isPersonal = team.isDefault;

  const refreshAll = useCallback(async () => {
    if (!teamId || isPersonal) return;
    const [m, b, tx, lim, u, rq] = await Promise.all([
      listMembers(teamId, memberPage),
      getTeamBalanceView(teamId),
      listTeamTransactions(teamId, txPage),
      getTeamLimits(teamId),
      getTeamUsage(teamId),
      listJoinRequests(teamId, 'PENDING').catch(() => []),
    ]);
    setMembers(m); setBalance(b); setTransactions(tx); setLimits(lim); setUsage(u); setRequests(rq as any[]);
  }, [teamId, memberPage, txPage, isPersonal]);

  useEffect(() => { void refreshAll(); }, [refreshAll]);

  // 个人（默认）团队：不走团队管理接口，只拉余额视图
  useEffect(() => {
    if (!teamId || !isPersonal) return;
    setBalance(null);
    getTeamBalanceView(teamId).then(setBalance).catch(() => {});
  }, [teamId, isPersonal]);

  // 审计日志：切到 audit tab 时按需拉取（仅 OWNER/ADMIN 可见，且接口仅管理员可调）
  const refreshAudit = useCallback(async () => {
    if (!teamId || isPersonal || tab !== 'audit') return;
    if (team.role !== 'OWNER' && team.role !== 'ADMIN') return;
    try {
      setAuditLogs(await getAuditLogs(teamId, auditPage));
    } catch {
      message.error('审计日志加载失败');
    }
  }, [teamId, team, tab, auditPage, isPersonal]);

  useEffect(() => { void refreshAudit(); }, [refreshAudit]);

  if (isPersonal) {
    return (
      <div className="text-[#e2e8f0]">
        <div className="max-w-2xl mx-auto p-8" data-testid="personal-panel">
          <h2 className="text-lg font-bold mb-1">个人项目</h2>
          <p className="text-sm text-[#888] mb-6">个人项目的积分、订阅与作品独立于团队，无需团队管理。</p>
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="bg-white/5 rounded-lg p-4">
              <p className="text-3xl font-bold text-[#f59e0b]" data-testid="personal-balance-total">
                {(balance?.total ?? 0).toLocaleString()}
              </p>
              <p className="text-xs text-[#888] mt-1">可用积分（通用 {balance?.credits ?? 0} · 订阅 {balance?.subscriptionCredits ?? 0}）</p>
            </div>
            <div className="bg-white/5 rounded-lg p-4">
              {team.subscription ? (
                <>
                  <p className="text-base font-bold">{team.subscription.planName}</p>
                  <p className="text-xs text-[#888] mt-1">有效期至 {new Date(team.subscription.currentPeriodEnd).toLocaleDateString()}</p>
                </>
              ) : (
                <p className="text-sm text-[#888]">暂无订阅</p>
              )}
            </div>
          </div>
          <div className="flex gap-3">
            <Link to="/settings/credits" data-testid="link-personal-recharge" className="px-4 py-1.5 rounded-md bg-[#f59e0b] text-black text-sm no-underline">充值</Link>
            <Link to="/settings/membership" data-testid="link-personal-membership" className="px-4 py-1.5 rounded-md bg-[#4ade80] text-black text-sm no-underline">开通/管理会员</Link>
            <Button size="small" onClick={onCreateTeam}>新建团队</Button>
          </div>
        </div>
      </div>
    );
  }

  const isOwner = team.role === 'OWNER';
  const isAdmin = isOwner || team.role === 'ADMIN';
  const seatLimit = limits?.seatLimit ?? 20;
  const storageLimit = limits?.storageLimitBytes ?? 6 * 1024 ** 3;
  const total = (balance?.total ?? 0);

  const tabs: { key: typeof tab; label: string }[] = [
    { key: 'members', label: '成员管理' },
    { key: 'credits', label: '积分管理' },
    { key: 'permissions', label: '权限设置' },
    { key: 'requests', label: '加入申请' },
    ...(isAdmin ? [{ key: 'audit' as const, label: '审计日志' }] : []),
  ];

  // 预留席位占位行（seatLimit 补齐）
  const placeholderRows = Math.max(0, seatLimit - members.total);

  return (
    <div className="text-[#e2e8f0]">
      {/* Header */}
      <div className="border-b border-[#222] px-8 py-4 flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold">{teamDisplayName(team)}</span>
          <Tag color={isOwner ? 'gold' : isAdmin ? 'cyan' : 'default'}>{ROLE_LABEL[team.role]}</Tag>
          {team.subscription ? (
            <Tag style={{ background: '#07B8DD', color: '#000', border: 'none' }}>
              已开通·{new Date(team.subscription.currentPeriodEnd).toLocaleDateString()}到期
            </Tag>
          ) : (
            <Tag>免费版</Tag>
          )}
        </div>
        <Button size="small" type="text" onClick={() => setRenameOpen(true)} disabled={!isAdmin}>重命名</Button>
        <span className="text-xs text-[#666]">
          团队 ID：
          <button
            className="text-[#888] hover:text-[#5DDCFF] cursor-pointer bg-transparent border-none"
            onClick={() => { navigator.clipboard?.writeText(teamId); message.success('已复制'); }}
            data-testid="team-id-copy"
          >
            {teamId.slice(0, 10)}… 复制
          </button>
        </span>
        <div className="flex-1" />
        {isOwner && (
          <Button danger size="small" onClick={() => {
            Modal.confirm({
              title: '解散团队',
              content: useTeamStore.getState().teams.length <= 1 ? '不能解散唯一团队' : '解散后项目与素材将被删除，支付凭证保留。确认解散？',
              okButtonProps: { disabled: useTeamStore.getState().teams.length <= 1 },
              onOk: async () => {
                await disbandTeam(teamId);
                message.success('已解散');
                useTeamStore.getState().remove(teamId);
              },
            });
          }}>解散团队</Button>
        )}
        <Button size="small" onClick={onCreateTeam}>新建团队</Button>
      </div>

      {/* Overview cards */}
      <div className="px-8 py-5 grid grid-cols-4 gap-4">
        <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-lg p-4">
          <div className="text-xs text-[#888] mb-1">剩余积分</div>
          <div className="text-2xl font-bold" style={{ color: ACCENT }}>{total}</div>
          <div className="text-xs text-[#666] mt-1">通用积分 {balance?.credits ?? 0}</div>
        </div>
        <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-lg p-4">
          <div className="text-xs text-[#888] mb-1">席位</div>
          <div className="text-2xl font-bold">{members.total}<span className="text-sm text-[#666]">/{seatLimit}</span></div>
        </div>
        <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-lg p-4">
          <div className="text-xs text-[#888] mb-1">存储</div>
          <div className="text-2xl font-bold">{fmtBytes(usage)}<span className="text-sm text-[#666]">/{fmtBytes(storageLimit)}</span></div>
          <Progress percent={Math.min(100, Math.round((usage / storageLimit) * 100))} showInfo={false} strokeColor={ACCENT} size="small" />
        </div>
        <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-lg p-4">
          <div className="text-xs text-[#888] mb-1">到期时间</div>
          <div className="text-2xl font-bold">{team.subscription ? new Date(team.subscription.currentPeriodEnd).toLocaleDateString() : '--'}</div>
          <div className="text-xs text-[#666] mt-1">下次发放权益时间 --</div>
        </div>
      </div>

      {/* Tabs nav */}
      <div className="px-8 flex gap-1 border-b border-[#222]">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm border-b-2 bg-transparent cursor-pointer ${
              tab === t.key ? 'border-b-[#5DDCFF] text-[#5DDCFF]' : 'border-b-transparent text-[#888] hover:text-[#ccc]'
            }`}
            data-testid={`tab-${t.key}`}
          >
            {t.label}
          </button>
        ))}
        <div className="flex-1" />
        <button
          onClick={() => setInviteOpen(true)}
          className="my-1 px-4 rounded text-sm font-bold text-black cursor-pointer border-none"
          style={{ background: ACCENT }}
        >
          邀请成员
        </button>
      </div>

      <div className="px-8 py-5">
        {tab === 'members' && (
          <>
            <Table
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={[
                ...members.items,
                ...Array.from({ length: Math.min(placeholderRows, 20) }, (_, i) => ({ id: `__ph_${i}`, placeholder: true })),
              ]}
              columns={[
                { title: '成员', dataIndex: ['user', 'name'], render: (_: any, r: any) => r.placeholder ? <span className="text-[#333]">— 空席位 —</span> : r.user?.name },
                { title: '角色', dataIndex: 'role', render: (r: string) => <Tag>{ROLE_LABEL[r]}</Tag> },
                {
                  title: '本月用量/额度', render: (_: any, r: any) => r.placeholder ? '-' : (
                    <span className="flex items-center gap-2">
                      <Progress percent={r.monthlyQuota > 0 ? Math.min(100, Math.round((r.monthlyUsed / r.monthlyQuota) * 100)) : 0} showInfo={false} strokeColor={ACCENT} style={{ width: 80 }} size="small" />
                      <span className="text-xs text-[#888]">{r.monthlyUsed}/{r.monthlyQuota > 0 ? r.monthlyQuota : '不限'}</span>
                    </span>
                  ),
                },
                {
                  title: '', render: (_: any, r: any) => r.placeholder ? null : (
                    <div className="flex gap-2">
                      {isOwner && r.role !== 'OWNER' && (
                        <Button size="small" onClick={() => { void changeRole(teamId, r.user.id, r.role === 'ADMIN' ? 'MEMBER' : 'ADMIN').then(refreshAll); }}>改角色</Button>
                      )}
                      {isOwner && r.role !== 'OWNER' && user?.id !== r.user.id && (
                        <Button size="small" danger onClick={() => {
                          Modal.confirm({
                            title: '转让所有权',
                            content: `将把团队所有权转让给 ${r.user?.name}，你将降为管理员（ADMIN）。确认转让？`,
                            onOk: async () => {
                              try {
                                await transferOwnership(teamId, r.user.id);
                                message.success('已转让所有权');
                                void useTeamStore.getState().fetchTeams(user!.id).then(refreshAll).catch(() => message.error('团队信息刷新失败'));
                              } catch {
                                message.error('转让失败');
                              }
                            },
                          });
                        }}>转让所有权</Button>
                      )}
                      {isAdmin && r.role !== 'OWNER' && (
                        <>
                          <Button size="small" onClick={() => { setQuotaTarget(r); setQuotaValue(String(r.monthlyQuota)); }}>配额度</Button>
                          <Button size="small" danger onClick={() => {
                            void removeMember(teamId, r.user.id).then(() => {
                              void useTeamStore.getState().fetchTeams(user!.id).catch(() => undefined);
                              return refreshAll();
                            });
                          }}>移除</Button>
                        </>
                      )}
                    </div>
                  ),
                },
              ]}
            />
            <Pagination
              size="small" current={memberPage} total={members.total} pageSize={20}
              onChange={setMemberPage} className="mt-3"
            />
          </>
        )}

        {tab === 'credits' && (
          <div>
            <div className="flex items-center gap-3 mb-4">
              <Button type="primary" onClick={() => navigate(`/team/${teamId}/billing`)}>充值 / 订阅</Button>
            </div>
            <Table
              rowKey="id" size="small"
              pagination={false}
              dataSource={transactions.items}
              columns={[
                { title: '时间', dataIndex: 'createdAt', render: (v: string) => new Date(v).toLocaleString() },
                { title: '类型', dataIndex: 'type' },
                { title: '积分', dataIndex: 'amount', render: (v: number) => <span style={{ color: v > 0 ? '#4ade80' : '#ef4444' }}>{v > 0 ? `+${v}` : v}</span> },
                { title: '类型池', dataIndex: 'creditType' },
                { title: '余额', dataIndex: 'balanceAfter' },
              ]}
            />
            <Pagination size="small" current={txPage} total={transactions.total} pageSize={20} onChange={setTxPage} className="mt-3" />
          </div>
        )}

        {tab === 'permissions' && (
          <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-lg p-6 max-w-md">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm">加入需审批</div>
                <div className="text-xs text-[#666] mt-1">关闭后通过邀请链接加入将直接入团</div>
              </div>
              <Switch
                checkedChildren="开" unCheckedChildren="关"
                onChange={() => message.info('审批开关需团队设置端点（后续接线）')}
              />
            </div>
          </div>
        )}

        {tab === 'requests' && (
          <Table
            rowKey="id" size="small" pagination={false}
            dataSource={requests}
            columns={[
              { title: '申请人', dataIndex: ['user', 'name'] },
              { title: '留言', dataIndex: 'message', render: (v?: string) => v || '-' },
              { title: '申请时间', dataIndex: 'createdAt', render: (v: string) => new Date(v).toLocaleString() },
              {
                title: '', render: (_: any, r: any) => (
                  <div className="flex gap-2">
                    <Button size="small" type="primary" style={{ background: ACCENT, borderColor: ACCENT, color: '#000' }} onClick={() => {
                      void approveJoinRequest(teamId, r.id).then(() => {
                        void useTeamStore.getState().fetchTeams(user!.id).catch(() => undefined);
                        return refreshAll();
                      });
                    }}>批准</Button>
                    <Button size="small" danger onClick={() => { void rejectJoinRequest(teamId, r.id).then(refreshAll); }}>拒绝</Button>
                  </div>
                ),
              },
            ]}
          />
        )}

        {tab === 'audit' && (
          <div>
            <Table
              rowKey="id" size="small"
              pagination={false}
              dataSource={auditLogs.items}
              columns={[
                { title: '时间', dataIndex: 'createdAt', render: (v: string) => new Date(v).toLocaleString() },
                { title: '操作者', dataIndex: 'operatorName' },
                { title: '动作', dataIndex: 'action', render: (v: string) => ACTION_LABEL[v] ?? v },
                { title: '对象', dataIndex: 'targetType' },
                {
                  title: '摘要',
                  render: (_: any, r: AuditLogRow) => (
                    <div className="text-xs text-[#888] break-all">
                      {r.remark && <div>{r.remark}</div>}
                      {r.beforeValue != null && <div>前：{JSON.stringify(r.beforeValue)}</div>}
                      {r.afterValue != null && <div>后：{JSON.stringify(r.afterValue)}</div>}
                      {!r.remark && r.beforeValue == null && r.afterValue == null && '-'}
                    </div>
                  ),
                },
              ]}
            />
            <Pagination size="small" current={auditPage} total={auditLogs.total} pageSize={20} onChange={setAuditPage} className="mt-3" />
          </div>
        )}
      </div>

      {/* Modals */}
      <Modal open={renameOpen} title="重命名团队" onCancel={() => setRenameOpen(false)}
        onOk={async () => {
          await renameTeam(teamId, renameValue || team.name);
          setRenameOpen(false);
          useTeamStore.getState().upsert({ id: teamId, name: renameValue || team.name });
        }}>
        <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} placeholder={teamDisplayName(team)} />
      </Modal>

      <Modal open={inviteOpen} title="邀请成员" footer={null} onCancel={() => setInviteOpen(false)}>
        <div className="text-xs text-[#888] mb-2">团队 ID</div>
        <Input value={teamId} readOnly />
        <div className="text-xs text-[#888] mt-3 mb-2">邀请链接</div>
        <Input value={`${location.origin}/join?team=${teamId}`} readOnly />
        <Button className="mt-3" type="primary" style={{ background: ACCENT, borderColor: ACCENT, color: '#000' }}
          onClick={() => { navigator.clipboard?.writeText(`${location.origin}/join?team=${teamId}`); message.success('链接已复制'); }}>
          复制链接
        </Button>
      </Modal>

      <Modal open={!!quotaTarget} title={`配额度（${quotaTarget?.user?.name ?? ''}）`} onCancel={() => setQuotaTarget(null)}
        onOk={async () => {
          await setQuota(teamId, quotaTarget.user.id, Number(quotaValue) || 0);
          setQuotaTarget(null); void refreshAll();
        }}>
        <Input value={quotaValue} onChange={(e) => setQuotaValue(e.target.value)} placeholder="0 = 不限额" />
      </Modal>
    </div>
  );
}
