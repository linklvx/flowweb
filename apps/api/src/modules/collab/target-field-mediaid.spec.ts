// apps/api/src/modules/collab/target-field-mediaid.spec.ts
// Y2 B4（spec 第②步 6「约束与写者同一次提交」）：targetField 域收紧 'fileId'→'mediaId' 的静态面锚——
// 迁移/CHECK/词表/写点/读点七件同 commit，本文件锁四条静态不变量（int 段序与约束拒写归
// collab-media.int.spec 真库族——本文件零 DB）：
//   ①五写点+词表宿主零 'fileId' 字面量残留（targetFieldOfKind/collab-media 五处/CAS 段已删/
//     keyOf 归 'mediaId'|'result'/词表 SCALAR_REF_FIELDS 首=mediaId）——改前红：现行 'fileId' 字面量在场；
//   ②词表六键恰（mediaId/referenceImage/referenceVideo/referenceAudio/images/allImages——
//     trimmedFileId/videoFileId/audioFileId 三键退役）；
//   ③两份上游槽查询 SQL 消失（upstream-media.service 与 execution-request.service 生产源零
//     targetField:'fileId' 键名写死——「禁留第二份」spec §4.2）；
//   ④公开缩略图收集函数源零 data.fileId 回落（computeThumbnailUrls 回落改解析——两处）。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { MEDIA_REF_TARGET_FIELDS } from '@flowweb/shared';

const MODULES = resolve(process.cwd(), 'src', 'modules');   // vitest cwd=apps/api（ratchet spec 同款 resolve(process.cwd()) 先例）

const src = (rel: string): string => readFileSync(join(MODULES, rel), 'utf8');

describe('Y2 B4：targetField 域收紧 mediaId——静态面锚（改前全红）', () => {
  it('①五写点宿主零 targetField:"fileId" 字面量（node-artifact/collab-media/poller keyOf/collab-binding CAS 段已删）', () => {
    expect(src('artifact-core/node-artifact.service.ts')).not.toContain("'fileId' | 'result'");
    expect(src('artifact-core/node-artifact.service.ts')).not.toContain(`kind === 'text' ? 'result' : 'fileId'`);
    expect(src('collab/collab-media.controller.ts')).not.toContain(`targetField: 'fileId'`);
    expect(src('collab/collab-media.controller.ts')).not.toContain(`targetField: 'fileId';`);
    expect(src('media-delivery/projection-outbox.poller.ts')).not.toContain(`return row.targetField === 'result' ? 'result' : 'fileId';`);
    expect(src('collab/collab-binding.controller.ts')).not.toContain(`targetField: 'fileId'`);
  });

  it('②词表六键恰（mediaId 首位+三退役键不在）', () => {
    expect([...MEDIA_REF_TARGET_FIELDS]).toEqual([
      'mediaId', 'referenceImage', 'referenceVideo', 'referenceAudio', 'images', 'allImages',
    ]);
    for (const retired of ['trimmedFileId', 'videoFileId', 'audioFileId']) {
      expect([...MEDIA_REF_TARGET_FIELDS]).not.toContain(retired);
    }
  });

  it('③两份上游槽查询 SQL 消失（生产源零写死 fileId 槽键——spec「禁留第二份」）', () => {
    expect(src('execution/upstream-media.service.ts')).not.toContain(`targetField: 'fileId'`);
    expect(src('execution/execution-request.service.ts')).not.toContain(`"targetField" = 'fileId'`);
  });

  it('④公开缩略图收集零 data.fileId 回落（computeThumbnailUrls 两处回落改 resolvePrimaryMediaId）', () => {
    const s = src('video-work/video-work.service.ts');
    const fn = s.slice(s.indexOf('computeThumbnailUrls(model'), s.indexOf('getProcessSnapshot'));
    expect(fn).toContain('resolvePrimaryMediaId');
    expect(fn).not.toContain('?.fileId');
  });
});
