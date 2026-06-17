import { PrismaClient } from '@prisma/client';
import {
  S3Client,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';

const BUCKET = 'flowai';

const s3 = new S3Client({
  region: 'us-east-1',
  endpoint: 'http://127.0.0.1:9000',
  credentials: {
    accessKeyId: 'minioadmin',
    secretAccessKey: 'minioadmin',
  },
  forcePathStyle: true,
});

async function objectExists(key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch (err: any) {
    if (err.$metadata?.httpStatusCode === 404 || err.name === 'NotFound') {
      return false;
    }
    throw err;
  }
}

async function main() {
  const prisma = new PrismaClient();

  const records = await prisma.media.findMany({
    where: { deletedAt: null },
  });

  console.log(`Checking ${records.length} Media records...\n`);

  const orphaned: string[] = [];

  for (const r of records) {
    const exists = await objectExists(r.key);
    if (!exists) {
      orphaned.push(r.id);
      console.log(`  MISSING  [${r.status}] ${r.key}  (${r.originalName})`);
    }
  }

  if (orphaned.length === 0) {
    console.log('\nNo orphaned records found.');
    await prisma.$disconnect();
    return;
  }

  console.log(`\nFound ${orphaned.length} orphaned records. Deleting...`);

  await prisma.media.deleteMany({
    where: { id: { in: orphaned } },
  });

  console.log(`Deleted ${orphaned.length} orphaned records.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
