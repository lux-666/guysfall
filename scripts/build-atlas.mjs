// Builds the UI texture atlas from SVG sources. Run with `npm run art` after editing art/ui/**.
// Output is committed (public/assets/ui.*, grain.png) so `npm start` never needs sharp.
import sharp from 'sharp';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const CELL = 128, GAP = 4, COLS = 10;
const svgs = async dir => (await readdir(`${root}${dir}`)).filter(f => f.endsWith('.svg')).sort().map(f => [f.slice(0, -4), `${root}${dir}/${f}`]);
const raster = async file => sharp(await readFile(file), { density: 144 }).resize(CELL, CELL).png().toBuffer();

const frames = [];
// Tintable glyphs: white = tint colour, grey = shaded tint. Never contain text.
for (const [name, file] of await svgs('art/ui/icons')) frames.push({ name, buffer: await raster(file) });
// Full-colour plates (medallions, chip ring). grain.svg is a separate tiling texture.
const frameFiles = (await svgs('art/ui/frames')).filter(([n]) => n !== 'grain');
for (const [name, file] of frameFiles) if (name !== 'chip-ring') frames.push({ name, buffer: await raster(file) });

// Crew chips: circular portrait under a brass ring. Crops come from the style sample until real portraits exist.
const portraits = JSON.parse(await readFile(`${root}art/ui/portraits.json`, 'utf8'));
const ring = await raster(`${root}art/ui/frames/chip-ring.svg`);
const disc = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${CELL}" height="${CELL}"><circle cx="64" cy="62.7" r="52.5" fill="#fff"/></svg>`);
for (const [id, [left, top, side]] of Object.entries(portraits.chips)) {
  const face = await sharp(`${root}${portraits.source}`).extract({ left, top, width: side, height: side }).resize(CELL, CELL, { kernel: 'lanczos3' }).png().toBuffer();
  const masked = await sharp(face).composite([{ input: disc, blend: 'dest-in' }]).png().toBuffer();
  frames.push({ name: `chip-${id}`, buffer: await sharp({ create: { width: CELL, height: CELL, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: masked }, { input: ring }]).png().toBuffer() });
}

const rows = Math.ceil(frames.length / COLS), width = COLS * (CELL + GAP) + GAP, height = rows * (CELL + GAP) + GAP;
const json = { frames: {}, meta: { app: 'guysfall scripts/build-atlas.mjs', image: 'ui.png', format: 'RGBA8888', size: { w: width, h: height }, scale: '1' } };
const composite = frames.map((f, i) => {
  const left = GAP + (i % COLS) * (CELL + GAP), top = GAP + Math.floor(i / COLS) * (CELL + GAP);
  json.frames[f.name] = { frame: { x: left, y: top, w: CELL, h: CELL }, rotated: false, trimmed: false, spriteSourceSize: { x: 0, y: 0, w: CELL, h: CELL }, sourceSize: { w: CELL, h: CELL } };
  return { input: f.buffer, left, top };
});
await sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(composite).png({ compressionLevel: 9 }).toFile(`${root}public/assets/ui.png`);
await writeFile(`${root}public/assets/ui.json`, JSON.stringify(json) + '\n');
await sharp(await readFile(`${root}art/ui/frames/grain.svg`)).png({ compressionLevel: 9 }).toFile(`${root}public/assets/grain.png`);

// Contact sheet for review: every frame on navy, paper and tinted backgrounds, labelled with its frame name.
const tile = 150, sheetCols = 8, sheetRows = Math.ceil(frames.length / sheetCols);
const label = (text, x, y, fill) => `<text x="${x}" y="${y}" font-family="DejaVu Sans, sans-serif" font-size="12" fill="${fill}" text-anchor="middle">${text}</text>`;
const bg = frames.map((f, i) => {
  const x = (i % sheetCols) * tile, y = Math.floor(i / sheetCols) * tile, paper = Math.floor(i / sheetCols) % 2;
  return `<rect x="${x + 4}" y="${y + 4}" width="${tile - 8}" height="${tile - 8}" rx="8" fill="${paper ? '#ead7b3' : '#122433'}" stroke="#b5884e"/>${label(f.name, x + tile / 2, y + tile - 10, paper ? '#192a37' : '#f6e9d0')}`;
}).join('');
const sheetSvg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${sheetCols * tile}" height="${sheetRows * tile}"><rect width="100%" height="100%" fill="#0b151e"/>${bg}</svg>`);
const inks = { paper: { r: 25, g: 42, b: 55 }, navy: { r: 246, g: 233, b: 208 } };
const tinted = await Promise.all(frames.map(async (f, i) => {
  const paper = Math.floor(i / sheetCols) % 2, plain = /^(medallion|chip)-/.test(f.name);
  let buf = await sharp(f.buffer).resize(96, 96).png().toBuffer();
  if (!plain) { // same multiply tint Phaser applies at runtime
    const ink = await sharp({ create: { width: 96, height: 96, channels: 4, background: { ...(paper ? inks.paper : inks.navy), alpha: 1 } } }).png().toBuffer();
    const mixed = await sharp(buf).composite([{ input: ink, blend: 'multiply' }]).png().toBuffer();
    buf = await sharp(mixed).composite([{ input: buf, blend: 'dest-in' }]).png().toBuffer();
  }
  return { input: buf, left: (i % sheetCols) * tile + 27, top: Math.floor(i / sheetCols) * tile + 16 };
}));
await sharp(sheetSvg).composite(tinted).png().toFile(`${root}art/ui/contact-sheet.png`);
console.log(`atlas ${width}x${height}, ${frames.length} frames → public/assets/ui.png/json, grain.png; preview art/ui/contact-sheet.png`);
