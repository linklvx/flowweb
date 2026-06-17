// Re-upload all existing files from disk into Minio metadata
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
import fs from 'fs';
import path from 'path';

const client = new S3Client({
  region: 'us-east-1',
  endpoint: 'http://127.0.0.1:9000',
  credentials: { accessKeyId: 'minioadmin', secretAccessKey: 'minioadmin' },
  forcePathStyle: true,
});

const BASE = 'flowweb.data/minio/flowai';
const mimeMap = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.mp4': 'video/mp4', '.webp': 'image/webp', '.gif': 'image/gif' };
let total = 0, done = 0;

function walk(dir) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(full); }
    else if (entry.isFile()) {
      total++;
      const key = path.relative(BASE, full).split(path.sep).join('/');
      const data = fs.readFileSync(full);
      const ext = path.extname(full).toLowerCase();
      const ct = mimeMap[ext] || 'application/octet-stream';
      client.send(new PutObjectCommand({ Bucket: 'flowai', Key: key, Body: data, ContentType: ct }))
        .then(() => {
          done++;
          if (done === total) { console.log('All ' + total + ' files re-uploaded!'); process.exit(0); }
        })
        .catch(e => { console.error('FAIL: ' + key + ' - ' + e.message); done++; });
    }
  }
}

walk(path.join(BASE, 'uploads'));
try { walk(path.join(BASE, 'thumbnails')); } catch(e) { /* no thumbnails dir */ }

if (total === 0) { console.log('No files found!'); process.exit(1); }
console.log('Uploading ' + total + ' files...');
