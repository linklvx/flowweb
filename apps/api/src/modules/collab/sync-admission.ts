import { HttpStatus } from '@nestjs/common';
import { BusinessException } from '../../common/exceptions/business.exception';
import { syncPendingTotal } from '../execution/exec.metrics';
import { svDominates } from './sv.util';
import type { CollabDocumentService } from './collab-document.service';

/** Y0b-2 T7：受理端点 SV 支配准入门（spec §2.6①——钱的门权威，claim 之前：零外呼零冻结零意图行）。
 *  四受理端点同型单源（execute/enqueue/image-edit 三端点/lighting），**权限守卫（assertEditor）恒在
 *  本门之前**（0c-6 存在性 oracle 纪律——perm 未过者不得以 409-vs-403 差分探测 doc 同步态）：
 *  - 缺 stateVector ⇒ 400 SYNC_STATE_VECTOR_REQUIRED（第四轮 P1：缺省静默 return 是垫片——fail-open
 *    回到旧行为；canExecute 已保证发起方必已 synced）；
 *  - base64/Yjs 解码失败（垃圾/截断）⇒ 400 SYNC_STATE_VECTOR_INVALID（decode 抛错若不接会落 500
 *    ——错误契约缺一态〔T7 质量审 I-1〕；空 doc 的 SV 实为 1 字节 "AA=="〔truthy 非空串〕且空 map
 *    支配成立放行=行为正确）；
 *  - 客户端 SV（body.stateVector base64）未被服务端 doc 支配 ⇒ 409 SYNC_PENDING
 *    （svDominates(clientSV, serverSV)=serverSV ⊇ clientSV——客户端伪造/超大 SV 只会让自己被拒，
 *    扣小 SV 更易被支配放行，两个方向都不影响钱）。
 *  readServerSV=withDoc 内存级（发起方必有 WS⇒doc 常驻）；video-project retake=进程内直调不经
 *  controller，SV 门不在其覆盖面（既成事实进偏离表：执行输入全部由服务端从 doc 读出）。 */
export async function assertSyncAdmitted(
  collabDoc: CollabDocumentService, projectId: string, stateVector: string | undefined,
): Promise<void> {
  if (!stateVector) throw new BusinessException('SYNC_STATE_VECTOR_REQUIRED', '请求缺少 stateVector（本地状态向量）', HttpStatus.BAD_REQUEST);
  let clientSV: Uint8Array;
  try {
    clientSV = new Uint8Array(Buffer.from(stateVector, 'base64'));
    svDominates(clientSV, clientSV);   // 解码探针：垃圾/截断字节在 Yjs 解码处抛错（Buffer.from 静默丢弃不抛）
  } catch {
    throw new BusinessException('SYNC_STATE_VECTOR_INVALID', 'stateVector 不是合法的状态向量编码', HttpStatus.BAD_REQUEST);
  }
  const serverSV = await collabDoc.readServerSV(projectId);
  if (!svDominates(clientSV, serverSV)) {
    syncPendingTotal.inc({ phase: 'first' });
    throw new BusinessException('SYNC_PENDING', '本地内容尚未同步到服务端，请稍后重试', HttpStatus.CONFLICT);
  }
}
