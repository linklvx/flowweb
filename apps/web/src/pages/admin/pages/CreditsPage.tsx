import { PageContainer, ProCard, ProForm, ProFormText, ProFormDigit, ProFormRadio } from '@ant-design/pro-components';
import { App as AntdApp } from 'antd';
import { grantCredits } from '@/api/adminApi';

export default function CreditsPage() {
  const { message } = AntdApp.useApp();
  return (
    <PageContainer title="积分发放">
      <ProCard style={{ maxWidth: 520 }}>
        <ProForm
          submitter={{ searchConfig: { submitText: '发放' }, resetButtonProps: false }}
          onFinish={async (v: { userId: string; amount: number; creditType: 'regular' | 'subscription' }) => {
            try {
              await grantCredits(v);
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
