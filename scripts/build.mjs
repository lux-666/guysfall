import { build } from 'esbuild';
await build({entryPoints:['client/main.ts'],bundle:true,outfile:'public/game.js',format:'iife',platform:'browser',target:'es2022',minify:true,legalComments:'eof'});
