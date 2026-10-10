/// <reference types="vite/client" />

/** Y0b-3 T5（M-9）：客户端构建标识（vite define 编译期注入——GIT_COMMIT_HASH ?? 'dev'）。
 *  用途=collab WS URL 的 cb 审计透传参数（服务端本批不消费，遥测预留 Y0b-5）。 */
declare const __CLIENT_BUILD__: string;
