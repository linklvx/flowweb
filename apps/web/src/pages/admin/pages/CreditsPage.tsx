import { PageContainer, ProCard, ProForm, ProFormText, ProFormDigit, ProFormRadio } from '@ant-design/pro-components';
import { App as AntdApp } from 'antd';
import { useRef } from 'react';
import { grantCredits } from '@/api/adminApi';

export default function CreditsPage() {
  const { message } = AntdApp.useApp();
  // Y0b-2 T8（Z113）：Idempotency-Key 手势幂等——ref 铸造、失败/在飞保留复用（超时重试/双击同 key
  // ⓪ 回放不双发）、成功轮换；与 canvas regenToken 同范式（服务端 advisory 锁+指纹比对 409）。
  const idemKeyRef = useRef<string>(crypto.randomUUID());
  return (
    <PageContainer title="积分发放">
      <ProCard style={{ maxWidth: 520 }}>
        <ProForm
          submitter={{ searchConfig: { submitText: '发放' }, resetButtonProps: false }}
          onFinish={async (v: { userId: string; amount: number; creditType: 'regular' | 'subscription' }) => {
            try {
              await grantCredits(v, idemKeyRef.current);
              idemKeyRef.current = crypto.randomUUID();   // 成功轮换（失败保留=重试同 key 回放）
              message.success('发放成功');
              return true;
            } catch (e) { message.error((e as Error).message); return false; }
          }}
        >
          <ProFormText name="userId" label="用户 ID" rules={[{ required: true }]} placeholder="目标用户 ID" />
          <ProFormDigit name="amount" label="发放数量" min={1} rules={[{ required: true }, { validator: (_: unknown, v: number) => v > 0 ? Promise.resolve() : Promise.reject(new Error('需为正数')) }]} />
          <ProFormRadio.Group name="creditType" label="积分类型" initialValue="regular"
            options={[{ label: '普通积分', value: 'regular' }, { label: '订阅积分', value: 'subscription' }]} />
        </ProForm>
      </ProCard>
    </PageContainer>
  );
}
