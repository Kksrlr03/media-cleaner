import { mkdir, copyFile, access } from 'node:fs/promises';
const target = new URL('../public/ffmpeg/', import.meta.url);
await mkdir(target, { recursive: true });
for (const name of ['ffmpeg-core.js', 'ffmpeg-core.wasm']) {
  await copyFile(new URL(`../node_modules/@ffmpeg/core/dist/esm/${name}`, import.meta.url), new URL(name, target));
}
for (const name of ['LICENSE', 'LICENSE.txt']) {
  const path = new URL(`../node_modules/@ffmpeg/core/${name}`, import.meta.url);
  try { await access(path); await copyFile(path, new URL('LICENSE.txt', target)); } catch {}
}
console.log('Single-thread video engine copied for self-hosting.');
