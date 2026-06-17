// Re-upload all existing files from disk into Minio metadata
// Usage: node scripts/reupload-to-minio.js
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs');
const path = require('path');

const client = new S3Client({
  region: 'us-east-1',
  endpoint: 'http://127.0.0.1:9000',
  credentials: { accessKeyId: 'minioadmin', secretAccessKey: 'minioadmin' },
  forcePathStyle: true,
});

const BASE = 'D:/flowweb/flowweb.data/minio/flowai';
const mimeMap = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.mp4': 'video/mp4',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

let total = 0;
let done = 0;

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
    } else if (entry.isFile()) {
      total++;
      const key = path.relative(BASE, full).replace(/\\/g, '/');
      const data = fs.readFileSync(full);
      const ext = path.extname(full).toLowerCase();
      const ct = mimeMap[ext] || 'application/octet-stream';
      const cmd = new PutObjectCommand({ Bucket: 'flowai', Key: key, Body: data, ContentType: ct });
      client.send(cmd)
        .then(() => {
          done++;
          process.stdout.write(`\r${done}/${total}`);
          if (done === total) {
            console.log('\nAll files re-uploaded successfully!');
            process.exit(0);
          }
        })
        .catch((e) => {
          console.error(`\nFAIL: ${key} - ${e.message}`);
          done++;
        });
    }
  }
}

console.log('Scanning files...');
walk(path.join(BASE, 'uploads'));
try { walk(path.join(BASE, 'thumbnails')); } catch(e) { /* ok */ }

if (total === 0) {
  console.log('No files found!');
  process.exit(1);
}
console.log(`Found ${total} files, uploading...`);
