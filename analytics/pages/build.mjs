import { mkdir, copyFile, writeFile } from 'node:fs/promises';

const output = new URL('../.wrangler/pages-output/', import.meta.url);
await mkdir(output, { recursive: true });
await copyFile(new URL('./gateway.mjs', import.meta.url), new URL('_worker.js', output));
await writeFile(new URL('index.html', output), '<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><p>统计服务暂时不可用，请稍后重试。</p>');
console.log('Pages gateway built; it contains no credentials or visitor data.');
