const path=require('path'), fs=require('fs'), {spawn}=require('child_process');
const {PGlite}=require('@electric-sql/pglite');
const {citext}=require('@electric-sql/pglite/contrib/citext');
const {pgcrypto}=require('@electric-sql/pglite/contrib/pgcrypto');
const {PGLiteSocketServer}=require('@electric-sql/pglite-socket');
const root=path.resolve(__dirname, '../..');
const children=[];
function start(args,env={},outfile){const c=spawn(process.execPath,args,{cwd:root,env:{...process.env,...env},stdio:outfile?['ignore',fs.openSync(outfile,'w'),fs.openSync(outfile,'a')]:'inherit'});children.push(c);return c;}
function run(args,env={}){return new Promise((ok,fail)=>{const c=start(args,env);c.on('exit',code=>code===0?ok():fail(new Error('child exit '+code)));});}
(async()=>{
 const db=await PGlite.create({extensions:{citext,pgcrypto}});
 await db.exec("CREATE ROLE ip2p_app LOGIN PASSWORD 'app'");
 await db.exec("CREATE DATABASE ip2p");
 const migrations=path.join(root,'backend/src/db/migrations');
 for(const f of fs.readdirSync(migrations).filter(f=>f.endsWith('.sql')).sort()){try{await db.exec(fs.readFileSync(path.join(migrations,f),'utf8'));console.log('migration OK',f)}catch(e){throw new Error(f+': '+e.message)}}
 const server=new PGLiteSocketServer({db,host:'127.0.0.1',port:5544,maxConnections:30}); await server.start();
 const env={};for(const line of fs.readFileSync(root+'/tests/integration/env.sh','utf8').split('\n')){if(line.startsWith('export ')){for(const pair of line.slice(7).split(' ')){const i=pair.indexOf('=');if(i>0)env[pair.slice(0,i)]=pair.slice(i+1)}}}
 env.DATABASE_URL='postgres://ip2p_app:app@127.0.0.1:5544/postgres';env.TEST_SUPERUSER_DB_URL=env.MIGRATE_DATABASE_URL='postgres://postgres:pg@127.0.0.1:5544/postgres';
 env.SERVER_LOG=root+'/tests/integration/server.log';
 start(['tests/integration/mockBlockbook.js'],env);
 let api = start(['backend/dist/src/server.js'],env,env.SERVER_LOG);
 for(let i=0;i<50;i++){try{if((await fetch('http://127.0.0.1:4100/health')).ok)break}catch{};await new Promise(r=>setTimeout(r,200));}
 await run(['tests/integration/backend.test.js'],env);
 await new Promise(resolve=>{api.once('exit',resolve);api.kill();});
 api=start(['backend/dist/src/server.js'],env,env.SERVER_LOG);
 for(let i=0;i<50;i++){try{if((await fetch('http://127.0.0.1:4100/health')).ok)break}catch{};await new Promise(r=>setTimeout(r,200));}
 await run(['tests/integration/fe.escrow.test.js'],env);
 await run(['tests/integration/pricing.test.js'],env);
 for(const c of children)c.kill();await server.stop();await db.close();
})().catch(e=>{console.error(e.stack);for(const c of children)c.kill();process.exit(1)});
