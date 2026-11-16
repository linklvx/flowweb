/** C3a-8 修复批 C1（卡①抽取）：进程内 import 覆盖标记的唯一所有者（原 persistence.importPending）。
 *  只覆盖「本进程 import apply → 字节进 PG」窗口。重启后为空是对的——持久权威是 CanvasDoc.
 *  bindingsDirty；boot 回灌在 collab.gateway.ts:1005-1010 直接 markDirty/enqueue，不读本 Set，
 *  也不经 :480 的 face（face 只服务运行期 reconciler 与 releaseImportCoverage）。
 *  release 零副作用（只清标记）——enqueue 只发生在 releaseImportCoverage（清了才入队；已删项目
 *  只 forget 不入队）；reconciler onReplayed 无条件入队且只调 release——两变体 enqueue 时机契约
 *  不同，按最小行为面保留双变体；如未来合并须引入回退分支并补恰一次/顺序断言。
 *  purgePersistenceState 不清标记=有意语义（thaw 后保守申报直至下次落定），勿补。
 *  landed 只由 persistence.importBytesLanded 计算（全文件实参仅两处生产点）。 */
export class ImportCoverageTracker {
  private readonly pending = new Set<string>();
  mark(pid: string): void { this.pending.add(pid); }                    // 幂等；仅 origin=import（调用方守）
  isUncovered(pid: string): boolean { return this.pending.has(pid); }
  /** 卡② K6：待落定项目数（yjs_import_coverage_open gauge 读面——同步 collect）。 */
  size(): number { return this.pending.size; }
  /** 仅当仍标记且 landed 时清除；返回 true=本次发生清除。landed 只允许 importBytesLanded 的返回值传入。 */
  release(pid: string, landed: boolean): boolean { return landed && this.pending.delete(pid); }
  forget(pid: string): void { this.pending.delete(pid); }               // discard 终态+落定入口已删分支（幂等）
}
