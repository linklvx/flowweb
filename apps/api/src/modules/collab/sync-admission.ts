import { HttpStatus } from '@nestjs/common';
import { BusinessException } from '../../common/exceptions/business.exception';
import { syncPendingTotal } from '../execution/exec.metrics';
import { svDominates } from './sv.util';
import type { CollabDocumentService } from './collab-document.service';

/** Y0b-2 T7：受理端点 SV 支配准入门（spec §2.6①——钱的门权威，claim 之前：零外呼零冻结零意图行）。
 *  四受理端点同型单源（execute/enqueue/image-edit 三端点/lighting）：
 *  - 缺 stateVector ⇒ 400 SYNC_STATE_VECTOR_REQUIRED（第四轮 P1：缺省静默 return 是垫片——fail-open
 *    回到旧行为；空 doc 的 SV 是 0 字节 base64 空串，同按缺省拒——canExecute 已保证发起方必已 synced）；
 *  - 客户端 SV（body.stateVector base64）未被服务端 doc 支配 ⇒ 409 SYNC_PENDING
 *    （svDominates(clientSV, serverSV)=serverSV ⊇ clientSV——客户端伪造/扣小 SV 只会让自己等待，
 *    伪造/超大 SV 只会让自己被拒，两个方向都不影响钱）。
 *  readServerSV=withDoc 内存级（发起方必有 WS⇒doc 常驻）；video-project retake=进程内直调不经
 *  controller，SV 门不在其覆盖面（既成事实进偏离表：执行输入全部由服务端从 doc 读出）。 */
export async function assertSyncAdmitted(
  collabDoc: CollabDocumentService, projectId: string, stateVector: string | undefined,
): Promise<void> {
  if (!stateVector) throw new BusinessException('SYNC_STATE_VECTOR_REQUIRED', '请求缺少 stateVector（本地状态向量）', HttpStatus.BAD_REQUEST);
  const clientSV = new Uint8Array(Buffer.from(stateVector, 'base64'));
  const serverSV = await collabDoc.readServerSV(projectId);
  if (!svDominates(clientSV, serverSV)) {
    syncPendingTotal.inc({ phase: 'first' });
    throw new BusinessException('SYNC_PENDING', '本地内容尚未同步到服务端，请稍后重试', HttpStatus.CONFLICT);
  }
}
