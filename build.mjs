import { copyFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = import.meta.dirname;
const output = resolve(root, 'dist');
const publishFiles = [
  'index.html',
  'casa-em-dia-prototype.html',
  'app.js',
  'supabase-config.js',
  'manifest.webmanifest',
  'icon.svg',
  'service-worker.js',
  '_headers'
];

await mkdir(output, { recursive: true });
await Promise.all(publishFiles.map(file => copyFile(resolve(root, file), resolve(output, file))));
console.log(`Prepared ${publishFiles.length} static PWA files in dist/.`);
