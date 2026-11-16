// TD-32/C2 T19：drill-server-control.js 类型声明（TS 消费面——kill9 tsx）。
import type { ChildProcess } from 'node:child_process';

export interface DrillCollabFailure {
  code?: string;
  message: string;
  at: number;
  attempt: number;
  kind: 'port-in-use' | 'docs-not-unloaded' | 'other';
  stateSince: number;
}

export interface DrillCollabState {
  state: string;
  stateSince: number;
  attempt: number;
  wsPort?: number;
  lastStartFailure: DrillCollabFailure | null;
}

export interface DrillHandle {
  child: ChildProcess;
  token: string;
  readonly httpPort: number | undefined;
  readonly wsPort: number | undefined;
  readonly lastState: DrillCollabState | null;
  readonly stderrTail: string;
  readonly stdoutTail: string;
  waitCollab(opts?: { startFailedGraceMs?: number; timeoutMs?: number }): Promise<number>;
  stop(): Promise<void>;
}

export interface StartDrillServerOpts {
  entry: string;
  expectCollab?: boolean;
  timeoutMs?: number;
  startFailedGraceMs?: number;
  allowEphemeral?: boolean;
}

export class DrillStartError extends Error {
  lastState?: DrillCollabState | null;
  stderr?: string;
}
export class DrillPortInUse extends DrillStartError {}
export class DrillStartFailed extends DrillStartError {}
export class DrillExited extends DrillStartError {
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
}

export function startDrillServer(
  env: Record<string, string | undefined>,
  opts: StartDrillServerOpts,
): Promise<DrillHandle>;

/** 卡② K5：创建同拍落定化判别式——成功值为 Error 不并通道。 */
export function settle<T>(p: Promise<T>): Promise<{ ok: true; v: T } | { ok: false; e: unknown }>;
