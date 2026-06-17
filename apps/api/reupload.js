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
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.mp4': 'video/mp4', '.webp': 'image/webp', '.gif': 'image/gif',
};

let total = 0, done = 0, fails = 0;

async function upload(key, data, ct) {
  try {
    await client.send(new PutObjectCommand({
      Bucket: 'flowai', Key: key, Body: data, ContentType: ct,
    }));
    return true;
  } catch (e) {
    process.stderr.write('FAIL ' + key + ': ' + e.message + '\n');
    fails++;
    return false;
  }
}

function collectTasks(dir) {
  if (!fs.existsSync(dir)) return [];
  const tasks = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) {
      tasks.push(...collectTasks(fp));
    } else {
      total++;
      const key = path.relative(BASE, fp).split(path.sep).join('/');
      const ct = mimeMap[path.extname(fp).toLowerCase()] || 'application/octet-stream';
      tasks.push({ key, data: fs.readFileSync(fp), ct });
    }
  }
  return tasks;
}

(async () => {
  let allTasks = collectTasks(path.join(BASE, 'uploads'));
  try { allTasks = allTasks.concat(collectTasks(path.join(BASE, 'thumbnails'))); } catch (e) { /* ok */ }

  console.log('Uploading ' + allTasks.length + ' files...');

  const BATCH = 10;
  for (let i = 0; i < allTasks.length; i += BATCH) {
    const batch = allTasks.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map(t => upload(t.key, t.data, t.ct))
    );
    done += results.filter(Boolean).length;
    process.stdout.write('\r' + done + '/' + total);
  }

  console.log('\nDone! ' + (total - fails) + '/' + total + ' succeeded' + (fails > 0 ? ', ' + fails + ' failed' : ''));
})();
