// Dependency-free source/atlas contract audit; no build or game state is changed.
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {CREW,ASSETS,CARD_TYPES,EVENT_PROTOTYPES} from '../src/content.mjs';
const root=new URL('../',import.meta.url);
const read=path=>readFile(new URL(path,root));
const atlas=JSON.parse(await read('public/assets/ui.json'));
const portraits=JSON.parse(await read('art/ui/portraits.json'));
const icons=(await readdir(new URL('art/ui/icons/',root))).filter(f=>f.endsWith('.svg')).map(f=>f.slice(0,-4));
const expected=[...icons,...['navy','paper','red','green'].map(c=>`medallion-${c}`),...CREW.map(id=>`chip-${id}`)].sort();
assert.deepEqual(Object.keys(atlas.frames).sort(),expected);
const required=[...ASSETS.map(a=>`res-${a.id}`),...Object.keys(CARD_TYPES).map(k=>`card-${k}`),...CREW.map(c=>`role-${c}`),...Object.keys(EVENT_PROTOTYPES).map(k=>`ev-${k}`),...['sighting','access','claim','withdraw'].map(k=>`fact-${k}`)];
for(const key of required)assert(atlas.frames[key],`missing ${key}`);
const pngSize=async path=>{const bytes=await read(path);assert.equal(bytes.subarray(1,4).toString(),'PNG');return {width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),bytes:bytes.length};};
const png=await pngSize('public/assets/ui.png');assert.equal(png.width,atlas.meta.size.w);assert.equal(png.height,atlas.meta.size.h);
for(const {frame:f} of Object.values(atlas.frames))assert(f.x>=0&&f.y>=0&&f.w===128&&f.h===128&&f.x+f.w<=png.width&&f.y+f.h<=png.height);
const source=await pngSize(portraits.source);
assert.deepEqual(Object.keys(portraits.rects).sort(),[...CREW].sort());assert.deepEqual(Object.keys(portraits.chips).sort(),[...CREW].sort());
for(const crop of [...Object.values(portraits.rects),...Object.values(portraits.chips)]) {const [x,y,w,h=w]=crop;assert(x>=0&&y>=0&&x+w<=source.width&&y+h<=source.height);}
const server=(await read('src/server.mjs')).toString();
for(const file of ['ui.png','ui.json','grain.png','desk.png','reference.png'])assert(server.includes(`'/assets/${file}'`));
console.log(JSON.stringify({icons:icons.length,frames:expected.length,atlas:png,paper:await pngSize('public/assets/grain.png'),portraitSource:source,factKinds:4},null,2));
