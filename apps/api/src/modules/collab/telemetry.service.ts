// apps/api/src/modules/collab/telemetry.service.ts
// Y0b-5 T1（spec §5.6 冻结契约 11）：客户端遥测批次 ingest——手写 guard（批≤12/单条 stringify≤512/
// 单 type≤5）+指标分派。detail 键域唯一来源=shared TELEMETRY_DETAIL_SCHEMA（sanitizeTelemetryDetail
// 单源净化：表外键剥除/枚举越界折 other/数值守卫剥键）——本 service 不复制值域表。
// 一律 204 的责任在 controller；本 service 只计不拒（禁 4xx——sendBeacon 不可观测响应）。
import { Injectable, Logger } from '@nestjs/common';
import {
  MAX_TELEMETRY_EVENT_BYTES,
  MAX_TELEMETRY_EVENTS_PER_BATCH,
  isKnownTelemetryType,
  sanitizeTelemetryDetail,
  type CollabTelemetryEventType,
} from '@flowweb/shared';
import {
  collabTelemetryAuthRejectTotal,
  collabTelemetryCloseTotal,
  collabTelemetryEventsTotal,
  collabTelemetryProjectionMs,
  collabTelemetryRejectedTotal,
  collabTelemetryUnknownTotal,
  collabTelemetryWsReasonTotal,
  collabTelemetryWsTransitionTotal,
} from './store.metrics';

/** 采样上限：单 type 单 flush 窗计满 5 条即截断（降频防单一事件刷屏——正常客户端远达不到） */
export const TELEMETRY_SAMPLE_CAP_PER_TYPE = 5;

/** 批次级元数据三键——客户端可控字符串，只走结构化日志（禁进 label=无界基数面，零 info gauge） */
interface TelemetryBatch {
  events?: unknown;
  clientBuild?: string;
  csv?: string;
  generation?: string;
}

@Injectable()
export class TelemetryService {
  private readonly logger = new Logger(TelemetryService.name);

  ingest(body: unknown): void {
    const batch = body as TelemetryBatch | undefined;
    const events = batch?.events;
    if (!Array.isArray(events)) return;   // text/plain 空 body/异形——json parser 预检防线维持（零计数）
    if (events.length > MAX_TELEMETRY_EVENTS_PER_BATCH) {
      collabTelemetryRejectedTotal.inc({ reason: 'batch-size' });   // 整批拒——超限即异常/滥用形态
      return;
    }
    const perType = new Map<string, number>();
    let accepted = 0;
    let rejected = 0;
    for (const raw of events) {
      const event = (raw ?? {}) as { type?: unknown; detail?: Record<string, unknown> };   // null/原始值归一——恒对象访问
      const type = event.type;
      if (typeof type !== 'string' || !isKnownTelemetryType(type)) {
        collabTelemetryUnknownTotal.inc();   // 未知 type 值不进任何 label（自由字符串）
        rejected++;
        continue;
      }
      if (JSON.stringify(raw).length > MAX_TELEMETRY_EVENT_BYTES) {
        collabTelemetryRejectedTotal.inc({ reason: 'event-bytes' });
        rejected++;
        continue;
      }
      const used = perType.get(type) ?? 0;
      if (used >= TELEMETRY_SAMPLE_CAP_PER_TYPE) {
        collabTelemetryRejectedTotal.inc({ reason: 'sample-cap' });
        rejected++;
        continue;
      }
      perType.set(type, used + 1);
      this.dispatch(type, sanitizeTelemetryDetail(type, event.detail ?? {}));
      accepted++;
    }
    if (accepted + rejected > 0) {
      const meta = (v?: string) => (v === undefined ? undefined : String(v).slice(0, 64));   // 客户端可控——截断防日志膨胀
      this.logger.log(JSON.stringify({ event: 'collab_telemetry_batch', clientBuild: meta(batch?.clientBuild), csv: meta(batch?.csv), generation: meta(batch?.generation), accepted, rejected }));
    }
  }

  /** 净化后 detail 的受控键分派（值域已由 sanitize 保障——typeof 仅防御缺键/半键形态） */
  private dispatch(type: CollabTelemetryEventType, detail: Record<string, unknown>): void {
    collabTelemetryEventsTotal.inc({ type });
    switch (type) {
      case 'close_code':
        if (detail.code !== undefined) collabTelemetryCloseTotal.inc({ code: String(detail.code) });
        break;
      case 'auth_reject':
        if (typeof detail.reason === 'string') collabTelemetryAuthRejectTotal.inc({ reason: detail.reason });
        break;
      case 'ws_status':
        if (typeof detail.reason === 'string') collabTelemetryWsReasonTotal.inc({ reason: detail.reason });
        if (typeof detail.from === 'string' && typeof detail.to === 'string') {
          collabTelemetryWsTransitionTotal.inc({ from: detail.from, to: detail.to });
        }
        break;
      case 'projection_duration':
        if (typeof detail.ms === 'number') collabTelemetryProjectionMs.observe(detail.ms);
        break;
    }
  }
}

