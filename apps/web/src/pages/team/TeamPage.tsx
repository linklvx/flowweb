import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router';
import { Table, Button, Modal, Input, Progress, Tag, message, Pagination, Switch } from 'antd';
import {
  getMyTeams, listMembers, changeRole, removeMember, setQuota, renameTeam, disbandTeam,
  listJoinRequests, approveJoinRequest, rejectJoinRequest,
  getTeamBalanceView, listTeamTransactions,
  createTeamRechargeOrder, payTeamOrder, createSubscriptionOrder, listTeamPlans,
  getTeamLimits, getTeamUsage,
} from '@/api/teamApi';
import { WeChatQRModal } from '@/components/WeChatQRModal';
import { useAuth } from '@/components/AuthProvider';

const ACCENT = '#5DDCFF';

function fmtBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)}G`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)}M`;
  return `${(n / 1024).toFixed(0)}K`;
}

const ROLE_LABEL: Record<string, string> = { OWNER: '所有者', ADMIN: '管理员', MEMBER: '成员' };

export default function TeamPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [teams, setTeams] = useState<Awaited<ReturnType<typeof getMyTeams>>>([]);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [team, setTeam] = useState<Awaited<ReturnType<typeof getMyTeams>>[number] | null>(null);
  const [tab, setTab] = useState<'members' | 'credits' | 'permissions' | 'requests'>('members');

  const [members, setMembers] = useState<{ items: any[]; total: number }>({ items: [], total: 0 });
  const [memberPage, setMemberPage] = useState(1);
  const [balance, setBalance] = useState<{ credits: number; subscriptionCredits: number; total: number } | null>(null);
  const [transactions, setTransactions] = useState<{ items: any[]; total: number }>({ items: [], total: 0 });
  const [txPage, setTxPage] = useState(1);
  const [limits, setLimits] = useState<{ seatLimit: number; storageLimitBytes: number } | null>(null);
  const [usage, setUsage] = useState(0);
  const [requests, setRequests] = useState<any[]>([]);
  const [plans, setPlans] = useState<Awaited<ReturnType<typeof listTeamPlans>>>([]);

  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [quotaTarget, setQuotaTarget] = useState<any | null>(null);
  const [quotaValue, setQuotaValue] = useState('');
  const [rechargeOpen, setRechargeOpen] = useState(false);
  const [qrOrder, setQrOrder] = useState<{ orderNo: string; codeUrl: string } | null>(null);
  const [subscribePlan, setSubscribePlan] = useState<any | null>(null);

  const refreshTeams = useCallback(async () => {
    const list = await getMyTeams();
    setTeams(list);
    const saved = localStorage.getItem('currentTeamId');
    const next = list.find((t) => t.id === saved)?.id ?? list[0]?.id ?? null;
    setTeamId(next);
    setTeam(list.find((t) => t.id === next) ?? null);
  }, []);

  useEffect(() => { void refreshTeams(); }, [refreshTeams]);

  const refreshAll = useCallback(async () => {
    if (!teamId) return;
    const [m, b, tx, lim, u, rq, ps] = await Promise.all([
      listMembers(teamId, memberPage),
      getTeamBalanceView(teamId),
      listTeamTransactions(teamId, txPage),
      getTeamLimits(teamId),
      getTeamUsage(teamId),
      listJoinRequests(teamId, 'PENDING').catch(() => []),
      listTeamPlans().catch(() => []),
    ]);
    setMembers(m); setBalance(b); setTransactions(tx); setLimits(lim); setUsage(u); setRequests(rq as any[]); setPlans(ps);
  }, [teamId, memberPage, txPage]);

  useEffect(() => { void refreshAll(); }, [refreshAll]);

  if (!teamId || !team) {
    return <div className="min-h-screen bg-[#111] text-[#e2e8f0] p-10">加载中…</div>;
  }

  const isOwner = team.role === 'OWNER';
  const isAdmin = isOwner || team.role === 'ADMIN';
  const seatLimit = limits?.seatLimit ?? 20;
  const storageLimit = limits?.storageLimitBytes ?? 6 * 1024 ** 3;
  const total = (balance?.total ?? 0);

  const switchTeam = (id: string) => {
    localStorage.setItem('currentTeamId', id);
    location.reload();
  };

  const doRecharge = async (amountYuan: number) => {
    const { outTradeNo } = await createTeamRechargeOrder(teamId, amountYuan);
    const pay = await payTeamOrder(teamId, outTradeNo);
    if (pay.codeUrl) {
      setRechargeOpen(false);
      setQrOrder({ orderNo: outTradeNo, codeUrl: pay.codeUrl });
    }
  };

  const doSubscribe = async () => {
    const { outTradeNo } = await createSubscriptionOrder(teamId, subscribePlan.id);
    const pay = await payTeamOrder(teamId, outTradeNo);
    if (pay.codeUrl) {
      setSubscribePlan(null);
      setQrOrder({ orderNo: outTradeNo, codeUrl: pay.codeUrl });
    }
  };

  const tabs: { key: typeof tab; label: string }[] = [
    { key: 'members', label: '成员管理' },
    { key: 'credits', label: '积分管理' },
    { key: 'permissions', label: '权限设置' },
    { key: 'requests', label: '加入申请' },
  ];

  // 预留席位占位行（seatLimit 补齐）
  const placeholderRows = Math.max(0, seatLimit - members.total);

  return (
    <div className="min-h-screen bg-[#111] text-[#e2e8f0]">
      {/* Header */}
      <div className="border-b border-[#222] px-8 py-4 flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold">{team.name}</span>
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
              content: teams.length <= 1 ? '不能解散唯一团队' : '解散后项目与素材将被删除，支付凭证保留。确认解散？',
              okButtonProps: { disabled: teams.length <= 1 },
              onOk: async () => { await disbandTeam(teamId); message.success('已解散'); void refreshTeams(); },
            });
          }}>解散团队</Button>
        )}
        {teams.length > 1 && (
          <select
            value={teamId}
            onChange={(e) => switchTeam(e.target.value)}
            className="bg-[#1A1A1A] border border-[#333] rounded px-2 py-1 text-xs"
            data-testid="team-switcher"
          >
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
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
                      {isAdmin && r.role !== 'OWNER' && (
                        <>
                          <Button size="small" onClick={() => { setQuotaTarget(r); setQuotaValue(String(r.monthlyQuota)); }}>配额度</Button>
                          <Button size="small" danger onClick={() => { void removeMember(teamId, r.user.id).then(refreshAll); }}>移除</Button>
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
              <Button type="primary" style={{ background: ACCENT, color: '#000', borderColor: ACCENT }} onClick={() => setRechargeOpen(true)}>充值</Button>
              {!team.subscription && (
                <Button onClick={() => setSubscribePlan(plans[0] ?? null)}>立即开通</Button>
              )}
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
                    <Button size="small" type="primary" style={{ background: ACCENT, borderColor: ACCENT, color: '#000' }} onClick={() => { void approveJoinRequest(teamId, r.id).then(refreshAll); }}>批准</Button>
                    <Button size="small" danger onClick={() => { void rejectJoinRequest(teamId, r.id).then(refreshAll); }}>拒绝</Button>
                  </div>
                ),
              },
            ]}
          />
        )}
      </div>

      {/* Modals */}
      <Modal open={renameOpen} title="重命名团队" onCancel={() => setRenameOpen(false)}
        onOk={async () => { await renameTeam(teamId, renameValue || team.name); setRenameOpen(false); void refreshTeams(); }}>
        <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} placeholder={team.name} />
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

      <Modal open={rechargeOpen} title="团队积分充值（1 元 = 10 积分）" footer={null} onCancel={() => setRechargeOpen(false)}>
        <div className="grid grid-cols-3 gap-3">
          {[10, 30, 50, 100, 200, 500].map((yuan) => (
            <button key={yuan} onClick={() => void doRecharge(yuan)}
              className="bg-[#1A1A1A] border border-[#333] rounded-lg p-4 cursor-pointer hover:border-[#5DDCFF]">
              <div className="text-lg font-bold">{yuan * 10}</div>
              <div className="text-xs text-[#666]">¥{yuan}</div>
            </button>
          ))}
        </div>
      </Modal>

      <Modal open={!!subscribePlan} title="开通团队订阅" onCancel={() => setSubscribePlan(null)} footer={null}>
        <div className="flex flex-col gap-3">
          {plans.map((p) => (
            <button key={p.id} onClick={() => setSubscribePlan(p)}
              className={`bg-[#1A1A1A] border rounded-lg p-4 text-left cursor-pointer ${subscribePlan?.id === p.id ? 'border-[#5DDCFF]' : 'border-[#333]'}`}>
              <div className="font-bold">{p.name}</div>
              <div className="text-xs text-[#888] mt-1">¥{(p.priceMonthly / 100).toFixed(0)}/月 · {p.monthlyCredits} 积分 · {p.seatLimit} 席位 · {fmtBytes(Number(p.storageLimitBytes))}</div>
            </button>
          ))}
          <Button type="primary" disabled={!subscribePlan} style={{ background: ACCENT, borderColor: ACCENT, color: '#000' }} onClick={() => void doSubscribe()}>
            去支付
          </Button>
        </div>
      </Modal>

      {qrOrder && (
        <WeChatQRModal
          codeUrl={qrOrder.codeUrl}
          orderNo={qrOrder.orderNo}
          onClose={() => { setQrOrder(null); void refreshAll(); }}
        />
      )}
    </div>
  );
}
