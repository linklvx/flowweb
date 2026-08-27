import { apiFetch } from './client';

export interface MyTeam {
  id: string;
  name: string;
  role: 'OWNER' | 'ADMIN' | 'MEMBER';
  status: string;
  memberCount: number;
  balance: { credits: number; subscriptionCredits: number };
  subscription: { planName: string; status: string; currentPeriodEnd: string } | null;
}

export interface TeamMemberRow {
  id: string;
  role: 'OWNER' | 'ADMIN' | 'MEMBER';
  monthlyQuota: number;
  monthlyUsed: number;
  user: { id: string; name: string; email: string };
}

export interface JoinRequestRow {
  id: string;
  userId: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  message?: string;
  createdAt: string;
  user: { id: string; name: string };
}

export interface TeamPlanRow {
  id: string;
  name: string;
  monthlyCredits: number;
  storageLimitBytes: string;
  seatLimit: number;
  priceMonthly: number;
  isActive: boolean;
}

export function getMyTeams() {
  return apiFetch<MyTeam[]>('/team/mine');
}

export function listMembers(teamId: string, page = 1, pageSize = 20) {
  return apiFetch<{ items: TeamMemberRow[]; total: number }>(`/team/${teamId}/members?page=${page}&pageSize=${pageSize}`);
}

export function changeRole(teamId: string, memberUserId: string, role: 'ADMIN' | 'MEMBER') {
  return apiFetch(`/team/${teamId}/members/${memberUserId}/role`, {
    method: 'PATCH',
    body: JSON.stringify({ role }),
  });
}

export function removeMember(teamId: string, memberUserId: string) {
  return apiFetch(`/team/${teamId}/members/${memberUserId}`, { method: 'DELETE' });
}

export function setQuota(teamId: string, memberUserId: string, monthlyQuota: number) {
  return apiFetch(`/team/${teamId}/members/${memberUserId}/quota`, {
    method: 'PATCH',
    body: JSON.stringify({ monthlyQuota }),
  });
}

export function renameTeam(teamId: string, name: string) {
  return apiFetch(`/team/${teamId}`, { method: 'PATCH', body: JSON.stringify({ name }) });
}

export function disbandTeam(teamId: string) {
  return apiFetch(`/team/${teamId}/disband`, { method: 'POST' });
}

export function listJoinRequests(teamId: string, status?: 'PENDING' | 'APPROVED' | 'REJECTED') {
  return apiFetch<JoinRequestRow[]>(`/team/${teamId}/join-requests${status ? `?status=${status}` : ''}`);
}

export function approveJoinRequest(teamId: string, requestId: string) {
  return apiFetch(`/team/${teamId}/join-requests/${requestId}/approve`, { method: 'POST' });
}

export function rejectJoinRequest(teamId: string, requestId: string) {
  return apiFetch(`/team/${teamId}/join-requests/${requestId}/reject`, { method: 'POST' });
}

export function applyJoin(teamId: string, message?: string) {
  return apiFetch(`/team/${teamId}/join-requests`, {
    method: 'POST',
    body: JSON.stringify({ message }),
  });
}

export function getTeamBalanceView(teamId: string) {
  return apiFetch<{ credits: number; subscriptionCredits: number; total: number; quota: number; used: number }>(`/team/${teamId}/balance`);
}

export function listTeamTransactions(teamId: string, page = 1, pageSize = 20) {
  return apiFetch<{ items: any[]; total: number }>(`/team/${teamId}/transactions?page=${page}&pageSize=${pageSize}`);
}

export function createTeamRechargeOrder(teamId: string, amountYuan: number) {
  return apiFetch<{ outTradeNo: string }>(`/team/${teamId}/recharge/orders`, {
    method: 'POST',
    body: JSON.stringify({ amount: amountYuan }),
  });
}

export function payTeamOrder(teamId: string, orderNo: string) {
  return apiFetch<{ orderNo: string; amount: number; status: string; codeUrl: string | null }>(`/team/${teamId}/recharge/orders/${orderNo}/pay`, {
    method: 'POST',
  });
}

export function createSubscriptionOrder(teamId: string, planId: string) {
  return apiFetch<{ outTradeNo: string }>(`/team/${teamId}/subscription/orders`, {
    method: 'POST',
    body: JSON.stringify({ planId }),
  });
}

export function listTeamPlans() {
  return apiFetch<TeamPlanRow[]>('/admin/team-plans');
}

export function getTeamLimits(teamId: string) {
  return apiFetch<{ seatLimit: number; storageLimitBytes: number }>(`/team/${teamId}/limits`);
}

export function getTeamUsage(teamId: string) {
  return apiFetch<number>(`/team/${teamId}/storage-usage`);
}
