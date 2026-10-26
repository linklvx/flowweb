# 登记不修 flake 台账（Controller 台账——Y1c T19 双评审 spec-M-4 落痕）

- **ENOTEMPTY rmdir 竞态**（collab-project-actor.spec.ts per-connection 入站排队用例收尾）：
  复现条件=Windows 全池并发下偶现（2026-10-24 两次全池一次复现，单跑恒绿）；归因=collab-spool
  临时目录清理竞态存量（fs.rm/rmdir 与并发句柄释放窗口——非 Y1c T19 引入，T9 actor 落地起在库）；
  处置=CI 复现时单独收口（本批零动作——登记留痕防误判回归）。
