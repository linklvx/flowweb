// apps/api/src/modules/collab/collab-vacuum-stale-client-resurrection.spec.ts
// Y1c T0-B（plan v1.7 Task 0 spike S2）：vacuum 离线重连推演——纯 Yjs 实验（零服务/零 DB/零网络）。
//
// 【问题】vacuum（collab-shrink.service vacuumCore 七步：rebuildVacuumDoc fresh doc 新 clientID 重写
// +vacuumReplace 单事务 generation=n+1/preVacuumSv 落列）之后，三类离线客户端重连：
//  ① 旧缓存（clean、全同步：SV==preVacuumSv）
//  ② 旧 SV 部分陈旧（全 clock<pre——spec §1.9「vacuum 洞全链」判定的真实暴露面）
//  ③ dirty draft（离线本地编辑：own clientID clock>pre）
// 各自在「现状 SV 代际门（guardSyncFrame SyncStep1 分支）」与「目标链（D2 偏离 27：旧 #g auth
// 直接 generation mismatch→DraftEnvelope 导出→清缓存→新 name 导入）」下的行为。
//
// 【本套件锁定的 Yjs 机制】（后续卡片 T5a pending 区间法/T9 actor 世代验证/T25 DraftEnvelope/T27
// 换代状态机全部依赖这些语义——升级 yjs 致任一断言变红=先停下重推演）：
//  A. 真空 doc=无墓碑新历史：rebuildVacuumDoc 只重放活 records（读侧 readRecordsFromMaps→fillDoc），
//     pre-vacuum 删除的结构在新 doc 零痕迹 → 部分陈旧客户端 SS2 携带的旧 structs 无任何东西与之
//     抵消 → 已删内容原样复活（n2 复活断言）。
//  B. 旧值覆盖：Y.Map 同 key 并发写胜负=clientID 比较（YATA——Item.integrate「The id decides
//     which item comes first」structs/Item.js:472 +_map head 落位 :510-514（integrate）/:116-117
//     （splitItem）+typeMapGet 读 head AbstractType.js:889-893；clock 只判因果不判胜负）。fresh vacuum doc clientID=随机 → 生产中
//     「旧 entry 覆盖真空 entry」是掷硬币事件；本语料把作者端 clientID 钉在 uint32 上界使覆盖
//     确定性复现（证明可发生即足）——n1 旧视图整条换掉真空后的当前值+fresh 失败子树成孤儿垃圾
//     （n1 'old' 覆盖 'current' 断言+编码字节增长断言）。
//  C. Update 帧路径同样复活：SV 代际门只存在于 SS1 分支（guardSyncFrame type===SyncStep1 才判
//     ——SS2/Update 只有帧大小/速率/只读/配额判据），同一批旧 structs 走 Update 帧直达 apply，
//     复活结果与 SS2 路径逐字节同因 → SV 谓词防不住任意帧路径，gate 必须在身份/世代层（帧携带
//     generation 或 docName auth 拒绝），非 SV clock 关系层。
//  D. SS1 谓词真值表（复刻 registry :687-696 逐字语义）：①全同步 clean=拒（own clock==pre）
//     ③dirty=拒（own clock>pre）②部分陈旧=放行（全部 clock<pre）——即现状门只漏②，但②恰是
//     「从未 author 的查看端/早期同步端」常态人群；目标链 auth 层对三者一致拒绝（不装载/不 SS1/
//     不上行旧 structs），差异只在载荷形态。
//  E. 【v4 前瞻探针】rebuildVacuumDoc 对嵌套 Y.Text（T15/T16 目标形状 data.content:Y.Text）——
//     Y1c T4 前实测=**静默跨 doc 别名**（readRecordsFromMaps 把 Y.Text 实例当 record 值原样传给
//     fillDoc 重放，新 doc 持有与源 doc 同一实例；源 doc destroy 后别名仍可读写=对已亡 doc 的
//     结构空间继续写）。T4 起读侧收编 doc-codec toReadModel：嵌套 Y 类型解码 plain JSON 后重放
//     ——别名亡（零共享实例），代价=类型保真平面化（Y.Text→string）；保真重建（serializeCanvas
//     全新实例形态）归 T15/T18/T27 vacuum 链扩裁随卡。仍为 T15/T18/T27 提供「vacuum 链必须先扩
//     或先拒」的裁定输入。
//
// 【装置语义对齐】
//  · wire 形态：客户端 SS2=y-protocols writeSyncStep2=encodeStateAsUpdate(doc, serverSv)（diff 形
//    ——sync.js:59-62/readSyncStep1:72 实证；服务端 SS1 回询 SV 后客户端按此回差量）。
//  · 真空重建：真 CollabDocRegistryService 直构（stub repo/persistence/pgBreaker——rebuildVacuumDoc
//    零依赖；与 collab-shrink.spec spyOn 同一入口，非手抄复刻）。
//  · 「形态②」构造：viewer 在 t0 截断同步（持 n1='old'+n2 活），此后 A/D 的演进不再到达——
//    SV={A:t0 clock} 全部 <preVacuumSv 同 client 条目。
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { fillDoc } from '@flowweb/shared';
import { CollabDocRegistryService } from './collab-doc-registry.service';
import { toDocLike } from './doc-like.util';

/** 语料图章（t0 截断点/编辑链各 doc 一致）——本套件所有用例共享同一台语料装置 */
interface Corpus {
  server: Y.Doc;          // 服务端旧代终态（vacuum 输入）
  staleViewer: Y.Doc;     // 形态②：t0 截断的部分陈旧客户端（从未 author）
  cleanViewer: Y.Doc;     // 形态①：全同步 clean 客户端（旧缓存）
  dirtyAuthor: Y.Doc;     // 形态③：t2 后离线继续编辑的作者端
  preVacuumSv: Map<number, number>;
}

/** 三客户端语料（作者端 clientID 钉 uint32 上界：Y.Map 并发冲突胜负=clientID 比较——使形态②
 *  的「旧 entry 覆盖真空 entry」确定性复现；生产中 fresh clientID 随机=掷硬币，本钉死只证可发生性） */
function buildCorpus(): Corpus {
  const author = new Y.Doc();
  author.clientID = 0xffffffff;   // > 任何 fresh 随机 uint32（map 冲突 id 决胜——Item.js:472）
  const server = new Y.Doc();
  const staleViewer = new Y.Doc();
  const cleanViewer = new Y.Doc();
  const deleter = new Y.Doc();
  const fillers = Array.from({ length: 10 }, (_, i) => ({
    id: `f${i}`, type: 'textInput', data: { tag: `f${i}` },
  }));
  // t-1：fillers 建 + 100 次 rev churn（fresh doc 只重放终值=1 op——历史膨胀只留旧代；形态②注入后
  // 这 100 次 churn structs 整段回流=垃圾膨胀量化语料）
  fillDoc(toDocLike(author), fillers, []);
  const f0data = (author.getMap('nodes').get('f0') as Y.Map<unknown>).get('data') as Y.Map<unknown>;
  for (let i = 0; i < 100; i++) author.transact(() => f0data.set('rev', i));
  // t0：n1('old')+n2 创建 → 同步 server+staleViewer（形态②截断点）
  fillDoc(toDocLike(author), [
    { id: 'n1', type: 'textInput', data: { content: 'old' } },
    { id: 'n2', type: 'textInput', data: { content: 'dead-man-walking' } },
  ], []);
  const t0 = Y.encodeStateAsUpdate(author);
  Y.applyUpdate(server, t0);
  Y.applyUpdate(staleViewer, t0);
  // t1：n1 → 'current'；同步 server+deleter（deleter 全量同步到 t1）
  const n1dataA = (author.getMap('nodes').get('n1') as Y.Map<unknown>).get('data') as Y.Map<unknown>;
  author.transact(() => n1dataA.set('content', 'current'));
  const t1 = Y.encodeStateAsUpdate(author);
  Y.applyUpdate(server, t1);
  Y.applyUpdate(deleter, t1);
  // t2：deleter 删 n2（墓碑）；同步 server → 旧代终态
  deleter.transact(() => deleter.getMap('nodes').delete('n2'));
  Y.applyUpdate(server, Y.encodeStateAsUpdate(deleter));
  // t3：作者离线继续编辑（形态③：同一 clientID 连续会话——own clock 越过 server 已知，SS2 永未上行）
  author.transact(() => n1dataA.set('content', 'draft-offline'));
  // 形态①：clean viewer=旧缓存（server 终态整份，此后离线）
  Y.applyUpdate(cleanViewer, Y.encodeStateAsUpdate(server));
  deleter.destroy();   // author 存活=形态③语料（dirtyAuthor 即 author 本体）
  return { server, staleViewer, cleanViewer, dirtyAuthor: author, preVacuumSv: Y.decodeStateVector(Y.encodeStateVector(server)) };
}

/** 真空重建（真 registry 直构——rebuildVacuumDoc 与生产 vacuumCore ④/ residue 评估共用单源） */
function vacuumRegistry(): CollabDocRegistryService {
  return new CollabDocRegistryService({} as never, {} as never, {} as never);
}

const contentOf = (doc: Y.Doc, id: string): unknown =>
  ((doc.getMap('nodes').get(id) as Y.Map<unknown> | undefined)?.get('data') as Y.Map<unknown> | undefined)?.get('content');

describe('Y1c T0-S2 vacuum 离线重连——纯 Yjs 机制实验', () => {
  it('Phase 0：语料前置——真空前终态（n1=current/n2 已删）与三形态持有面', () => {
    const c = buildCorpus();
    expect(c.server.getMap('nodes').has('n2')).toBe(false);            // 旧代终态：n2 已删（墓碑在）
    expect(contentOf(c.server, 'n1')).toBe('current');
    expect(contentOf(c.staleViewer, 'n1')).toBe('old');                // 形态②：t0 旧视图
    expect(c.staleViewer.getMap('nodes').has('n2')).toBe(true);        // 形态②：n2 仍活（未见删除）
    expect(contentOf(c.cleanViewer, 'n1')).toBe('current');            // 形态①：与终态一致
    expect(contentOf(c.dirtyAuthor, 'n1')).toBe('draft-offline');      // 形态③：离线编辑
    // 形态② SV 全部 clock<pre（放行前提成立——对照 preVacuumSv 逐 client 验证）
    for (const [client, clock] of Y.decodeStateVector(Y.encodeStateVector(c.staleViewer))) {
      const pre = c.preVacuumSv.get(client);
      if (pre !== undefined) expect(clock).toBeLessThan(pre);
    }
    c.server.destroy(); c.staleViewer.destroy(); c.cleanViewer.destroy(); c.dirtyAuthor.destroy();
  });

  it('Phase A+B：形态② SS2 注入新真空 doc——已删内容复活+旧值整条覆盖+垃圾膨胀', () => {
    const c = buildCorpus();
    const registry = vacuumRegistry();
    const vacuumed = registry.rebuildVacuumDoc(c.server)!;
    expect(vacuumed).not.toBeNull();
    expect(vacuumed.clientID).not.toBe(c.server.clientID);             // fresh clientID 重写（registry:628-648）
    expect(vacuumed.getMap('nodes').has('n2')).toBe(false);            // 真空 doc 零墓碑：n2 无任何痕迹
    expect(contentOf(vacuumed, 'n1')).toBe('current');                 // 真空保留的是当前值
    const bytesBefore = Y.encodeStateAsUpdate(vacuumed).byteLength;
    // ——重连（现状语义）：SS1 放行（Phase 0 已证谓词前提）→ 服务端 SS1 回询新 doc SV → 客户端 SS2=diff 形
    const serverSvAfterVacuum = Y.encodeStateVector(vacuumed);         // {fresh:~41}——旧 clientID 零覆盖
    const ss2 = Y.encodeStateAsUpdate(c.staleViewer, serverSvAfterVacuum);
    Y.applyUpdate(vacuumed, ss2);                                      // 现状：SS2 帧无校验 apply（spec §1.9）
    // A. 复活：无墓碑可抵消——pre-vacuum 删除的 n2 原样回归
    expect(vacuumed.getMap('nodes').has('n2')).toBe(true);
    expect(contentOf(vacuumed, 'n2')).toBe('dead-man-walking');
    // B. 旧值覆盖：n1 slot 并发冲突 id 决胜（作者端钉 uint32 上界 > fresh 随机）→ 旧 entry 整条胜出
    expect(contentOf(vacuumed, 'n1')).toBe('old');
    // B′. 垃圾膨胀：fresh 失败子树成孤儿+100 次 rev churn 历史回流（真空字节数据被撤销）
    const bytesAfter = Y.encodeStateAsUpdate(vacuumed).byteLength;
    expect(bytesAfter).toBeGreaterThan(bytesBefore);
    // 量化钉死（行为锁）：复活后编码 > 真空前旧代编码的一半（churn 历史+双份 n1 子树皆在）
    expect(bytesAfter).toBeGreaterThan(Y.encodeStateAsUpdate(c.server).byteLength / 2);
    vacuumed.destroy(); c.server.destroy(); c.staleViewer.destroy(); c.cleanViewer.destroy(); c.dirtyAuthor.destroy();
  });

  it('Phase C：同一批旧 structs 走 Update 帧路径——复活结果与 SS2 路径同因同果', () => {
    const c = buildCorpus();
    const vacuumed = vacuumRegistry().rebuildVacuumDoc(c.server)!;
    // Update 帧（type=messageYjsUpdate）不携 SV：guardSyncFrame SS1 分支（:678-698）结构性不经手，
    // 只过帧大小/速率/只读/配额（:705-779）——同一批 structs 直达 apply
    Y.applyUpdate(vacuumed, Y.encodeStateAsUpdate(c.staleViewer));
    expect(vacuumed.getMap('nodes').has('n2')).toBe(true);             // 复活同 Phase A
    expect(contentOf(vacuumed, 'n1')).toBe('old');                     // 旧值覆盖同 Phase B
    vacuumed.destroy(); c.server.destroy(); c.staleViewer.destroy(); c.cleanViewer.destroy(); c.dirtyAuthor.destroy();
  });

  it('Phase D：SS1 SV 代际门谓词真值表——只漏形态②；auth 世代层三形态一致拒', () => {
    const c = buildCorpus();
    // 谓词逐字复刻（registry guardSyncFrame :687-696：任一 (client,clock) 满足 pre>0∧clock>=pre 即拒）
    const ss1Rejects = (clientSvEncoded: Uint8Array): boolean => {
      for (const [client, clock] of Y.decodeStateVector(clientSvEncoded)) {
        const pre = c.preVacuumSv.get(client);
        if (pre !== undefined && pre > 0 && clock >= pre) return true;
      }
      return false;
    };
    // 形态① 旧缓存（clean 全同步）：own/A/D clock==pre → 拒（4410 doc-generation-stale）
    expect(ss1Rejects(Y.encodeStateVector(c.cleanViewer))).toBe(true);
    // 形态② 部分陈旧：全 clock<pre → 放行 → Phase A/B 复活链成立（现状唯一漏网形态）
    expect(ss1Rejects(Y.encodeStateVector(c.staleViewer))).toBe(false);
    // 形态③ dirty draft：own clock>pre（离线编辑未上行）→ 拒（脏编辑困在本地——现状靠 .yjs 导出自救）
    expect(ss1Rejects(Y.encodeStateVector(c.dirtyAuthor))).toBe(true);
    // 目标链对照（D2 偏离 27）：世代身份在 docName（#g 段）auth 层判定（isValidDocName 现状冻结尾段
    // 放行+isGenerationMismatch 对比 DB 列——doc-name.util.ts:36-45 铺位），三形态统一拒绝且先于
    // 装载/SS1/上行（不依赖 clock 关系——无「前缀漏网」类形态）；本谓词仅作为现状行为锁保留。
    c.server.destroy(); c.staleViewer.destroy(); c.cleanViewer.destroy(); c.dirtyAuthor.destroy();
  });

  it('Phase E【v4 前瞻探针】：rebuildVacuumDoc×嵌套 Y.Text——Y1c T4 改道 doc-codec 后=平面化解码（别名亡、类型保真重建归 T15+ 写点迁移随卡）', () => {
    const v4 = new Y.Doc();
    fillDoc(toDocLike(v4), [{ id: 'x1', type: 'textInput', data: {} }], []);
    const data = (v4.getMap('nodes').get('x1') as Y.Map<unknown>).get('data') as Y.Map<unknown>;
    const text = new Y.Text();
    v4.transact(() => data.set('content', text));
    text.insert(0, 'v4-nested');
    const registry = vacuumRegistry();
    const rebuilt = registry.rebuildVacuumDoc(v4);
    expect(rebuilt).not.toBeNull();                                    // 非 Map 根守卫（:629-632）只看根——嵌套类型不设防
    // Y1c T4 前实测=静默跨 doc 别名（readRecordsFromMaps 传 Y.Text 引用给 fillDoc 重放——源 doc
    // destroy 后别名仍可写=对已亡 doc 结构空间继续写，F-S2-1）。T4 起 rebuild 读侧=doc-codec
    // toReadModel（readRecordsFromMaps 收编 codec 内部单源）：嵌套 Y 类型解码为 plain JSON 后重放
    // ——**别名结构性亡**（零共享实例）；代价=类型保真损失（Y.Text→string 平面化）。类型保真的
    // vacuum 重建（serializeCanvas+全新实例重建——doc-codec 备份路径形态）归 T15/T16 写点迁移
    // 随卡定裁（vacuum 链届时先扩或先拒，本探针保留为新现状行为锁）。
    const rdata = (rebuilt!.getMap('nodes').get('x1') as Y.Map<unknown>).get('data') as Y.Map<unknown>;
    const rcontent = rdata.get('content');
    expect(rcontent).not.toBeInstanceOf(Y.Text);                       // 非共享 Y 实例（别名亡——F-S2-1 危险面消除）
    expect(rcontent).toBe('v4-nested');                                // 文本内容保真（Y.Text 解码=显式 string）
    // 源 doc destroy 后重建 doc 独立存活（无跨 doc 结构空间共享——写不互达）
    v4.destroy();
    expect(() => rdata.set('content', 'after-destroy')).not.toThrow();
    expect(rdata.get('content')).toBe('after-destroy');
    rebuilt!.destroy();
  });
});
