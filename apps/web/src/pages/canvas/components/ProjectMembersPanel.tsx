import { useCallback, useEffect, useState } from 'react';
import { Button, Dropdown, Modal, Select, Table, Tag } from 'antd';
import {
  listProjectMembers,
  addProjectMember,
  changeProjectMemberRole,
  removeProjectMember,
  type ProjectMemberRow,
} from '@/api/projectMemberApi';

type GrantRole = 'PROJECT_VIEWER' | 'PROJECT_EDITOR' | 'PROJECT_OWNER';

export function ProjectMembersPanel({ projectId }: { projectId: string }) {
  const [rows, setRows] = useState<ProjectMemberRow[]>([]);
  const [adding, setAdding] = useState(false);
  const load = useCallback(async () => setRows((await listProjectMembers(projectId)).items), [projectId]);
  useEffect(() => { void load(); }, [load]);
  const columns = [
    { title: '成员', dataIndex: 'name' },
    { title: '团队角色', dataIndex: 'teamRole' },
    {
      title: '项目角色',
      dataIndex: 'effectiveRole',
      render: (v: string) => (
        <Tag color={v === 'PROJECT_OWNER' ? 'gold' : v === 'PROJECT_EDITOR' ? 'blue' : 'default'}>
          {v.replace('PROJECT_', '')}
        </Tag>
      ),
    },
    { title: '来源', dataIndex: 'source', render: (v: string) => (v === 'inherited' ? <Tag>继承</Tag> : <Tag color="cyan">显式</Tag>) },
    {
      title: '操作',
      key: 'op',
      render: (_: unknown, r: ProjectMemberRow) => (
        <Dropdown
          menu={{
            items: [
              { key: 'EDITOR', label: '设为编辑' },
              { key: 'VIEWER', label: '设为只读' },
              { key: 'OWNER', label: '设为所有者', danger: true },
              { type: 'divider' },
              { key: 'remove', label: '移除显式记录', danger: true, disabled: r.source === 'inherited' }, // 继承成员无记录，remove 会 404
            ],
            onClick: async ({ key }: { key: string }) => {
              if (key === 'remove') await removeProjectMember(projectId, r.userId);
              else await changeProjectMemberRole(projectId, r.userId, `PROJECT_${key}`);
              void load();
            },
          }}
        >
          <Button size="small">管理</Button>
        </Dropdown>
      ),
    },
  ];
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <span>项目成员</span>
        <Button size="small" type="primary" onClick={() => setAdding(true)}>添加成员</Button>
      </div>
      <Table rowKey="userId" dataSource={rows} columns={columns} pagination={false} size="small" />
      <AddMemberModal open={adding} onClose={() => setAdding(false)} onDone={load} projectId={projectId} rows={rows} />
    </div>
  );
}

function AddMemberModal({ open, onClose, onDone, projectId, rows }: {
  open: boolean; onClose: () => void; onDone: () => void; projectId: string; rows: ProjectMemberRow[];
}) {
  const [userId, setUserId] = useState<string>();
  const [role, setRole] = useState<GrantRole>('PROJECT_EDITOR');
  const candidates = rows.filter((r) => r.source === 'inherited'); // 仅对继承成员做显式覆盖
  const submit = async () => {
    if (!userId) return;
    await addProjectMember(projectId, userId, role);
    onDone(); onClose();
  };
  return (
    <Modal open={open} title="添加项目成员" onCancel={onClose} onOk={submit}>
      <Select style={{ width: '100%' }} placeholder="选择成员" value={userId} onChange={setUserId}
        options={candidates.map((r) => ({ value: r.userId, label: r.name }))} />
      <Select style={{ width: '100%', marginTop: 8 }} value={role} onChange={setRole}
        options={[
          { value: 'PROJECT_VIEWER', label: '只读' },
          { value: 'PROJECT_EDITOR', label: '编辑' },
          { value: 'PROJECT_OWNER', label: '所有者' },
        ]} />
    </Modal>
  );
}
