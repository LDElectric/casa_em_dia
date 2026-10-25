import { copyFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = import.meta.dirname;
const output = resolve(root, 'dist');
const publishFiles = [
  'index.html',
  'casa-em-dia.html',
  'app.js',
  'card-statement.mjs',
  'smart-classify.mjs',
  'backup.mjs',
  'supabase-config.js',
  'manifest.webmanifest',
  'icon.svg',
  'icon-192.png',
  'icon-512.png',
  'icon-maskable-512.png',
  'apple-touch-icon.png',
  'service-worker.js',
  '_headers'
];

await mkdir(output, { recursive: true });
await Promise.all(publishFiles.map(file => copyFile(resolve(root, file), resolve(output, file))));
console.log(`Prepared ${publishFiles.length} static PWA files in dist/.`);
