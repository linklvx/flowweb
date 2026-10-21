// apps/api/src/test-utils/artifact-commit-fixture.ts —— Y1a T10：int specs 直构 ExecutionService 的
// ArtifactCommitService 装置（真 prisma/ledger/teamCredit/intentSvc——finalize 资金/事务面全真；
// MinIO/SafeRemoteFetch 注入 fake：上传产能+PNG 下载）。单元档（无 prisma 真链）可直接用 stubOutcome。
import { vi } from 'vitest';
import { PrismaService } from '../prisma/prisma.service';
import { CreditLedgerService } from '../modules/team/credit-ledger.service';
import { TeamCreditService } from '../modules/team/team-credit.service';
import { GenerationIntentService } from '../modules/execution/generation-intent.service';
import { NodeArtifactService } from '../modules/artifact-core/node-artifact.service';
import { MediaRegistrationService } from '../modules/artifact-core/media-registration.service';
import { ArtifactCommitService } from '../modules/artifact-core/artifact-commit.service';

/** PNG 魔数+填充（sniff 可判 image/png——finalize 提升链的 sniffedMimeType 断言锚）。 */
export const ARTIFACT_PNG_BUFFER = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 0x42),
]);

/** fake 基础设施（MinIO 上传产能+SafeRemoteFetch 下载注入——URL 不校验，任意 sourceUrl 可下）。 */
export function fakeArtifactInfra() {
  const minio = { upload: vi.fn(async () => undefined) };
  const safeFetch = { fetchBuffer: vi.fn(async () => ({ buffer: ARTIFACT_PNG_BUFFER, contentType: 'image/png' })) };
  return { minio, safeFetch };
}

/** 真 prisma 链装配（int specs——finalize 事务/CAS/settle 全真；仅对象存储/下载注入）。 */
export function makeArtifactCommit(
  prisma: PrismaService,
  ledger: CreditLedgerService,
  teamCredit: TeamCreditService,
  intents: GenerationIntentService,
): { artifactCommit: ArtifactCommitService; minio: { upload: ReturnType<typeof vi.fn> }; safeFetch: { fetchBuffer: ReturnType<typeof vi.fn> } } {
  const { minio, safeFetch } = fakeArtifactInfra();
  const artifactCommit = new ArtifactCommitService(
    prisma, ledger, teamCredit, intents,
    minio as any, safeFetch as any,
    new NodeArtifactService(),
    new MediaRegistrationService(prisma, minio as any),
  );
  return { artifactCommit, minio, safeFetch };
}
