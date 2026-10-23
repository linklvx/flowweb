// apps/api/src/modules/media/media-probe.int.spec.ts —— Y1a+Y1b T7 红测（int：真 PG+真 S3+真 sharp/ffprobe）
// probe 单相（spec Z7'' v13/v14 口径）：DB poller claim（FOR UPDATE SKIP LOCKED+probeRunId CAS）
// +分型批（image 4/lease 180s；video 1/lease 5min）+sniffed 路由+server natural done 同事务
// （factVersion+1+MediaFactOutbox factType='natural'）+sharp 40MP downscale+EXIF 5-8 交换+ffprobe 沙箱
// （spawn 数组+15s SIGKILL+protocol_whitelist）+mismatch permanent 不无限重试+transient jitter 退避。
// probe 仅上传路径：claim 只吃 sniffedMimeType（confirm 面=唯一 sniffed 写点；生成路径 sniffed=null 不入池）。
// 无 DATABASE_URL/MINIO_ENDPOINT 自动 skip（vitest 不自动加载 apps/api/.env——靠 shell export 注入）。
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient, Media } from '@prisma/client';
import { mkdtemp, rm, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import sharp from 'sharp';
import { PrismaService } from '../../prisma/prisma.service';
import { MinioService } from '../minio/minio.service';
import { deleteTeamsWithPass } from '../../test-utils/intent-fixture';
import {
  MediaProbePoller, PROBE_IMAGE_BATCH, PROBE_IMAGE_LEASE_MS, PROBE_VIDEO_LEASE_MS,
  MAX_IMAGE_PIXELS, MAX_PROBE_ATTEMPTS,
} from './media-probe.poller';

const hasDb = !!process.env.DATABASE_URL;
const hasS3 = !!process.env.MINIO_ENDPOINT;
const maybe = hasDb && hasS3 ? describe : describe.skip;

const prisma = new PrismaClient();

const OWNER = `it-t7-owner-${Date.now()}`;
let TID = '';
let minio: MinioService;
let poller: MediaProbePoller;
/** 同库第二 poller（并发 claim 恰一用例——真 PG SKIP LOCKED 互斥） */
let pollerB: MediaProbePoller;
let realGetObj: MinioService['getObject'];
const createdMedia: string[] = [];
const createdKeys: string[] = [];
let tmpDir = '';

/** 模拟 T4 confirm 输出态的行：对象真上传+status completed+sniffed 落列+probeState 按 sniffed 预置 */
async function makeUploadMedia(opts: {
  bytes: Buffer; sniffed: string; mime?: string; probeState?: 'pending' | 'skipped'; projectId?: string | null;
}): Promise<string> {
  const key = `uploads/${OWNER}/it-t7/${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await minio.upload(key, opts.bytes, opts.mime ?? opts.sniffed);
  createdKeys.push(key);
  const m = await prisma.media.create({
    data: {
      userId: OWNER, teamId: TID, bucket: 'flowai', key,
      originalName: 'a.bin', mimeType: opts.mime ?? opts.sniffed, size: BigInt(opts.bytes.length),
      projectId: opts.projectId === undefined ? null : opts.projectId,
      type: 'uploaded', status: 'completed',
      sniffedMimeType: opts.sniffed, probeState: opts.probeState ?? 'pending',
      factVersion: 1n,
    },
  });
  createdMedia.push(m.id);
  return m.id;
}

async function getObjBytes(key: string): Promise<Buffer> {
  const stream = await realGetObj(key);
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

const png = async (w: number, h: number): Promise<Buffer> =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: 60, g: 80, b: 120 } } })
    .png().toBuffer();

/** 4×2 JPEG 带 EXIF orientation 6（90° 系——spec 记忆锚「5,6,7,8 全交换」的最小代表） */
const jpegOriented = async (): Promise<Buffer> =>
  sharp({ create: { width: 4, height: 2, channels: 3, background: { r: 10, g: 200, b: 30 } } })
    .jpeg().withMetadata({ orientation: 6 }).toBuffer();

/** 真 mp4（ffmpeg lavfi testsrc 64x48 1s）——probe 视频路径真调 ffprobe 的夹具 */
async function tinyMp4(): Promise<Buffer> {
  const out = path.join(tmpDir, `gen-${Date.now()}.mp4`);
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(process.env.FFMPEG_PATH || 'ffmpeg', [
      '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=64x48:rate=10',
      '-t', '1', '-pix_fmt', 'yuv420p', '-y', out,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    proc.stderr?.on('data', (c: Buffer) => { err += c.toString(); });
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg fixture: ${err}`))));
    proc.on('error', reject);
  });
  return readFile(out);
}

const claimIds = (rows: Media[]) => rows.map((r) => r.id);

maybe('Y1a+Y1b T7：probe 单相（真 PG+真 S3+真 sharp/ffprobe）', () => {
  beforeAll(async () => {
    await prisma.user.upsert({
      where: { id: OWNER },
      create: { id: OWNER, name: 'it-t7', email: `${OWNER}@test.local`, emailVerified: false },
      update: {},
    });
    const team = await prisma.team.create({ data: { name: 'it-t7', ownerId: OWNER } });
    TID = team.id;
    await prisma.teamMember.create({ data: { teamId: TID, userId: OWNER, role: 'OWNER' } });

    const useSsl = (process.env.MINIO_USE_SSL ?? '').toLowerCase() === 'true';
    minio = new MinioService({
      endpoint: process.env.MINIO_ENDPOINT!,
      accessKey: process.env.MINIO_ACCESS_KEY!,
      secretKey: process.env.MINIO_SECRET_KEY!,
      bucket: process.env.MINIO_BUCKET || 'flowai',
      useSsl,
    });
    await minio.ensureBucket();
    realGetObj = minio.getObject.bind(minio);
    poller = new MediaProbePoller(prisma as unknown as PrismaService, minio);
    pollerB = new MediaProbePoller(prisma as unknown as PrismaService, minio);
    tmpDir = await mkdtemp(path.join(tmpdir(), 'probe-it-'));
  }, 60_000);

  afterAll(async () => {
    for (const id of createdMedia) {
      await prisma.mediaFactOutbox.deleteMany({ where: { mediaId: id } }).catch(() => {});
      await prisma.mediaBinding.deleteMany({ where: { mediaId: id } }).catch(() => {});
    }
    await prisma.media.deleteMany({ where: { id: { in: createdMedia } } });
    for (const k of createdKeys) await minio.delete(k).catch(() => {});
    await deleteTeamsWithPass(prisma as unknown as PrismaService, [TID]);
    await prisma.user.deleteMany({ where: { id: OWNER } });
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
    await prisma.$disconnect();
  }, 60_000);

  it('claim 并发恰一（真 PG SKIP LOCKED）：双 poller 并发 claimImageBatch → 零交集+批上界 4+行落 running/runId/lease≈180s+无丢单', async () => {
    const ids: string[] = [];
    for (let i = 0; i < PROBE_IMAGE_BATCH + 2; i++) {
      ids.push(await makeUploadMedia({ bytes: await png(8, 8), sniffed: 'image/png' }));
    }
    const [a, b] = await Promise.all([poller.claimImageBatch(), pollerB.claimImageBatch()]);
    const union = [...claimIds(a), ...claimIds(b)];
    expect(new Set(union).size).toBe(union.length);            // 零交集（恰一主）
    expect(a.length).toBeLessThanOrEqual(PROBE_IMAGE_BATCH);   // 单 poller 批上界
    expect(b.length).toBeLessThanOrEqual(PROBE_IMAGE_BATCH);
    expect(union.length).toBe(ids.length);                     // 两波并发合计恰清空池（无丢单）

    const row = await prisma.media.findUnique({ where: { id: a[0].id } });
    expect(row?.probeState).toBe('running');
    expect(row?.probeRunId).toBeTruthy();
    const lease = row!.probeLeaseUntil!.getTime() - Date.now();
    expect(lease).toBeGreaterThan(PROBE_IMAGE_LEASE_MS - 5_000);
    expect(lease).toBeLessThan(PROBE_IMAGE_LEASE_MS + 5_000);
    expect(await poller.claimImageBatch()).toHaveLength(0);    // 池空（running+lease 新鲜不可夺）
  }, 30_000);

  it('lease 过期接管+旧代 done fenced（probeRunId CAS）：running∧lease 过期 → 新代接管；旧 runId done 写 0 行不动', async () => {
    const id = await makeUploadMedia({ bytes: await png(8, 8), sniffed: 'image/png' });
    // 手工置旧代 running+过期 lease（模拟崩溃残留）
    await prisma.media.update({
      where: { id },
      data: { probeState: 'running', probeRunId: 'old-run', probeLeaseUntil: new Date(Date.now() - 1_000) },
    });
    const claimed = await poller.claimImageBatch();
    expect(claimIds(claimed)).toContain(id);
    const row = await prisma.media.findUnique({ where: { id } });
    expect(row?.probeRunId).not.toBe('old-run');   // 新代接管（lease 过期 reclaim）

    // 旧代写 done → CAS 0 行（fenced）——不落 natural/factVersion
    const fenced = await poller.doneNatural({
      mediaId: id, probeRunId: 'old-run',
      naturalWidth: 111, naturalHeight: 222, naturalRotation: 1,
    });
    expect(fenced).toBe(false);
    const after = await prisma.media.findUnique({ where: { id } });
    expect(after?.naturalWidth).toBeNull();
    expect(after?.factVersion).toBe(1n);
  }, 30_000);

  it('sniffed 路由：伪报 audio 的图片（sniffed=image→pending）入池；audio→skipped 不入池；生成路径（sniffed=null）不入池', async () => {
    const fakeAudioImage = await makeUploadMedia({
      bytes: await png(6, 6), sniffed: 'image/png', mime: 'audio/mpeg',   // 声明 audio 字节实为图——T4 按 sniffed 预置 pending
    });
    const audio = await makeUploadMedia({
      bytes: Buffer.from('id3----'), sniffed: 'audio/mpeg', probeState: 'skipped',
    });
    // 生成路径形态：generated create 面不设 sniffed（plan 锚 media.create 生成 8 面现状）
    const genKey = `generated/${OWNER}/it-t7/${Date.now()}.png`;
    await minio.upload(genKey, await png(6, 6), 'image/png');
    createdKeys.push(genKey);
    const gen = await prisma.media.create({
      data: {
        userId: OWNER, teamId: TID, bucket: 'flowai', key: genKey, originalName: 'g.png',
        mimeType: 'image/png', size: 10n, type: 'generated', status: 'completed',
      },
    });
    createdMedia.push(gen.id);

    const claimed = await poller.claimImageBatch();
    const ids = claimIds(claimed);
    expect(ids).toContain(fakeAudioImage);   // 按 sniffed 路由——伪报 audio 的图片不再永 skipped
    expect(ids).not.toContain(audio);
    expect(ids).not.toContain(gen);          // probe 仅上传路径
  }, 30_000);

  it('image done 同事务：EXIF 6（90° 系）natural 全交换+probeState done+factVersion+1+probedAt+outbox 行（factType=natural+factVersion 快照）+对象已剥 EXIF（重编码）', async () => {
    const bytes = await jpegOriented();   // 4x2 orientation 6 → display 2x4
    const id = await makeUploadMedia({ bytes, sniffed: 'image/jpeg', projectId: 'it-t7-proj-exif' });
    const key = createdKeys[createdKeys.length - 1];
    const claimed = await poller.claimImageBatch();
    const target = claimed.find((r) => r.id === id);
    expect(target).toBeTruthy();
    await poller.probeRow(target!);

    const after = await prisma.media.findUnique({ where: { id } });
    expect(after?.probeState).toBe('done');
    expect(after?.probeError).toBeNull();
    expect(after?.naturalWidth).toBe(2);      // EXIF 6=90° 系——宽高交换（display 语义，v5 裁决一律 display）
    expect(after?.naturalHeight).toBe(4);
    expect(after?.naturalRotation).toBe(6);   // 血缘留存不渲染
    expect(after?.naturalSource).toBe('probe');
    expect(after?.probedAt).toBeTruthy();
    expect(after?.factVersion).toBe(2n);      // confirm=1 → probe done=2

    const facts = await prisma.mediaFactOutbox.findMany({ where: { mediaId: id } });
    expect(facts).toHaveLength(1);
    expect(facts[0].factType).toBe('natural');
    expect(facts[0].factVersion).toBe(2n);
    expect(facts[0].projectId).toBe('it-t7-proj-exif');
    expect(facts[0].state).toBe('pending');
    expect((facts[0].payload as { naturalWidth: number }).naturalWidth).toBe(2);
    // F4c：正常图（未超限）payload 不含 downscaledFrom 键（防过度携带）
    expect('downscaledFrom' in (facts[0].payload as Record<string, unknown>)).toBe(false);

    // 对象重编码已剥 EXIF：重读对象 sharp metadata 无 orientation
    const meta = await sharp(await getObjBytes(key)).metadata();
    expect(meta.orientation).toBeUndefined();
  }, 30_000);

  it('40MP+downscale 产品策略：49MP（7000x7000）→ probe 后 natural 像素≤40MP+对象实宽高同步缩小+outbox payload 携 downscaledFrom 原尺寸（F4c 告知数据源）', async () => {
    const bytes = await png(7000, 7000);   // 49MP solid PNG——压缩后极小
    const id = await makeUploadMedia({ bytes, sniffed: 'image/png', projectId: 'it-t7-proj-ds' });
    const key = createdKeys[createdKeys.length - 1];
    const claimed = await poller.claimImageBatch();
    const target = claimed.find((r) => r.id === id);
    await poller.probeRow(target!);

    const after = await prisma.media.findUnique({ where: { id } });
    expect(after?.probeState).toBe('done');
    expect(Number(after!.naturalWidth) * Number(after!.naturalHeight)).toBeLessThanOrEqual(MAX_IMAGE_PIXELS);
    expect(after!.naturalWidth).toBeLessThan(7000);

    // F4c（用户裁定④）：payload 携 downscaledFrom=降尺度前原尺寸（web「已自动缩小至支持尺寸」告知源）
    const facts = await prisma.mediaFactOutbox.findMany({ where: { mediaId: id } });
    expect(facts).toHaveLength(1);
    const p = facts[0].payload as {
      naturalWidth: number; naturalHeight: number; downscaledFrom?: { width: number; height: number };
    };
    expect(p.downscaledFrom).toEqual({ width: 7000, height: 7000 });   // 改前红=undefined（零告知数据源）
    expect(p.naturalWidth! * p.naturalHeight!).toBeLessThanOrEqual(MAX_IMAGE_PIXELS);   // natural=降尺度后值

    const meta = await sharp(await getObjBytes(key)).metadata();
    expect(meta.width! * meta.height!).toBeLessThanOrEqual(MAX_IMAGE_PIXELS);   // 对象真身已 downscale
  }, 60_000);

  it('video done：真 mp4 ffprobe → natural=64x48+metadata 只留 codec/duration/bitrate 族+outbox 行+video claim 分型（batch 1/lease≈5min）', async () => {
    const bytes = await tinyMp4();
    const id = await makeUploadMedia({ bytes, sniffed: 'video/mp4', projectId: 'it-t7-proj-vid' });
    const claimed = await poller.claimVideoBatch();
    expect(claimed).toHaveLength(1);   // video batch=1（分型批）
    expect(claimed[0].id).toBe(id);
    const leaseRow = await prisma.media.findUnique({ where: { id } });
    const lease = leaseRow!.probeLeaseUntil!.getTime() - Date.now();
    expect(lease).toBeGreaterThan(PROBE_VIDEO_LEASE_MS - 5_000);
    expect(lease).toBeLessThan(PROBE_VIDEO_LEASE_MS + 5_000);

    await poller.probeRow(claimed[0]);
    const after = await prisma.media.findUnique({ where: { id } });
    expect(after?.probeState).toBe('done');
    expect(after?.naturalWidth).toBe(64);
    expect(after?.naturalHeight).toBe(48);
    const md = after?.metadata as Record<string, unknown>;
    expect(md?.duration).toBeGreaterThanOrEqual(0.9);   // testsrc 1s（容器时基取整容差）
    expect(typeof md?.videoCodec).toBe('string');
    // 「metadata 只留 codec/duration/bitrate」——无 width/height 旁路键（natural 列承载尺寸）
    expect(Object.keys(md!).every((k) => ['duration', 'bitrate', 'videoCodec', 'audioCodec'].includes(k))).toBe(true);
    const facts = await prisma.mediaFactOutbox.findMany({ where: { mediaId: id } });
    expect(facts).toHaveLength(1);
    expect(facts[0].factType).toBe('natural');
    // F4c：视频路径 payload 不含 downscaledFrom 键（仅图片超限降尺度路径携带）
    expect('downscaledFrom' in (facts[0].payload as Record<string, unknown>)).toBe(false);
  }, 60_000);

  it('mismatch permanent 不无限重试：伪 PNG（文本字节）→ 一轮即 failed+probeFailureKind=mismatch+后续 claim 不命中', async () => {
    const id = await makeUploadMedia({ bytes: Buffer.from('this is definitely not an image'), sniffed: 'image/png' });
    const claimed = await poller.claimImageBatch();
    const target = claimed.find((r) => r.id === id);
    expect(target).toBeTruthy();
    await poller.probeRow(target!);

    const after = await prisma.media.findUnique({ where: { id } });
    expect(after?.probeState).toBe('failed');
    expect(after?.probeFailureKind).toBe('mismatch');
    expect(after?.probeError).toBeTruthy();
    expect(after?.probeAttempts).toBe(1);

    const again = await poller.claimImageBatch();
    expect(claimIds(again)).not.toContain(id);   // failed 不入池——不无限重试
  }, 30_000);

  it('transient（对象读失败）jitter 退避：probeState 回 pending+attempts+1+nextProbeAt∈[0.5x,1.5x] 退避窗+窗内 claim 不命中；耗尽 MAX_PROBE_ATTEMPTS → failed', async () => {
    const id = await makeUploadMedia({ bytes: await png(5, 5), sniffed: 'image/png' });
    const failMinio = {
      getObject: vi.fn(async () => { throw new Error('ECONNRESET'); }),
    } as unknown as MinioService;
    const failing = new MediaProbePoller(prisma as unknown as PrismaService, failMinio);

    let claimed = await poller.claimImageBatch();
    let target = claimed.find((r) => r.id === id);
    await failing.probeRow(target!);

    let row = await prisma.media.findUnique({ where: { id } });
    expect(row?.probeState).toBe('pending');          // 瞬态回 pending 重试（热循环红线：非立即重投）
    expect(row?.probeAttempts).toBe(1);
    const wait = row!.nextProbeAt!.getTime() - Date.now();
    expect(wait).toBeGreaterThan(14_000);             // 30s 基数 ×[0.5,1.5] jitter 下界
    expect(wait).toBeLessThan(46_000);
    const nextClaim = await poller.claimImageBatch(); // 退避窗内不命中
    expect(claimIds(nextClaim)).not.toContain(id);

    // 推进到耗尽：手工清 nextProbeAt 逐轮触发（免真等退避窗）
    for (let i = 2; i <= MAX_PROBE_ATTEMPTS; i++) {
      await prisma.media.update({ where: { id }, data: { nextProbeAt: new Date(Date.now() - 1) } });
      claimed = await poller.claimImageBatch();
      target = claimed.find((r) => r.id === id);
      await failing.probeRow(target!);
    }
    row = await prisma.media.findUnique({ where: { id } });
    expect(row?.probeState).toBe('failed');
    expect(row?.probeAttempts).toBe(MAX_PROBE_ATTEMPTS);
    expect(row?.probeFailureKind).toBeTruthy();
  }, 60_000);

  it('outbox 来源 union：Media.projectId=null+binding 一行（他项目）→ done 后恰一 outbox 行且 projectId=binding 侧', async () => {
    const id = await makeUploadMedia({ bytes: await png(7, 7), sniffed: 'image/png', projectId: null });
    const bindingProject = `it-t7-bp-${Date.now()}`;
    await prisma.mediaBinding.create({
      data: { mediaId: id, projectId: bindingProject, nodeId: 'n1', teamId: TID },
    });
    const claimed = await poller.claimImageBatch();
    const target = claimed.find((r) => r.id === id);
    await poller.probeRow(target!);

    const facts = await prisma.mediaFactOutbox.findMany({ where: { mediaId: id } });
    expect(facts).toHaveLength(1);
    expect(facts[0].projectId).toBe(bindingProject);
  }, 30_000);
});
