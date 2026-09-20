# C8 段验收 segcheck 结论留痕（总纲 §3 立规：原始产物验后即删，结论在此常驻）

## D1a（Task 13）@ 本文件首次入库 commit（= D1a 定义层双值化原子提交，父 da03bea3）

- 深侧 before-D × segcheck-D1a: exit=0, unexpectedTotal=0（意外项闸属性 0 + 几何 0，三闸全过）, dExpectedGate absorbed=0（预期 0——深档零 diff 段；D 段注册配对 2 组吸收 0 条，B2 注册配对 43 组吸收 0 条）
- 浅侧 before-D-light × segcheck-D1a-light: exit=0, absorbedByPair={ backgroundColor: 8（rgb(20, 20, 20)→rgb(247, 248, 250) [global]，每页 body 1 条×8 门禁页）, color: 64（rgb(226, 232, 240)→rgb(31, 35, 41) [global]） }, unexpected=0
  - color ×64 = body 8 条 + 继承链合法放大 56 条（>8×2 判据通过，adjudications 按总纲记实际计数）
  - D 段注册配对恰为 2 组（page 限定 0 + 全局 2）——与 Task 12 预登记 body 两条全局 pairs 恰合，无多无少
  - 除 body 两族外浅侧零 diff——岛机制推演成立（域 token 浅值消费者全在 .dark 岛内），无待归因项、无预先豁免
- 配对率两侧同形：video-editor 253/256（3 个运行时生成 testid 键不稳定非结构变化，before/after 元素数 252/252 相同），其余 7 页 100%
- 采集中间物: 已清理（.json/.md 两侧四件 + segcheck-D1a / segcheck-D1a-light 采集目录）
