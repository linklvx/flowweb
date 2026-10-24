-- Y1c T10（census⑩——doc 写路径 advisory lock+canvas_doc_update_seq 删除面）：
-- canvas_doc_update_seq 生产 nextval 唯一消费=旧单帧 append（T9 已随新表形态退役——行 seq=WAL walSeq
-- 非 DB 取号，「seq 序≡提交序」由 actor 单写者构造性保证）；无列 DEFAULT 引用（pg_attrdef 零命中）。
-- CLI collab-renumber-layer.mjs 的 nextval 同批改道 MAX(seq)+1（离线工具——api 停写前提下无并发）。
DROP SEQUENCE IF EXISTS "canvas_doc_update_seq";
