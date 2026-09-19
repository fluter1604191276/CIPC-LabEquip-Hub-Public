import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createUpdateManager} from '../lib/update.mjs';
const release={tag_name:'v2.0.0',target_commitish:'a'.repeat(40)};
function setup(t,fetchImpl) {
 const root=mkdtempSync(join(tmpdir(),'update-admission-test-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const options={repository:'example/project',currentVersion:'1.0.0',requestFile:join(root,'request.json'),statusFile:join(root,'status.json'),fetchImpl};
 return {root,options,manager:createUpdateManager(options)};
}

test('parallel requests admit only one task and preserve its request id',async t=>{
 const {manager,options}=setup(t,async()=>({ok:true,json:async()=>release}));
 const results=await Promise.allSettled([manager.requestUpgrade('2.0.0'),manager.requestUpgrade('2.0.0')]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);
 const accepted=results.find(r=>r.status==='fulfilled').value;
 assert.equal(JSON.parse(readFileSync(options.requestFile)).id,accepted.requestId);assert.equal(JSON.parse(readFileSync(options.statusFile)).requestId,accepted.requestId);
});

test('state is rechecked after upstream await, including different manager instances',async t=>{
 const {manager,options}=setup(t,async()=>({ok:true,json:async()=>release}));
 const other=createUpdateManager(options);
 const results=await Promise.allSettled([manager.requestUpgrade('2.0.0'),other.requestUpgrade('2.0.0')]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
});

test('upstream failure releases admission and later request can proceed',async t=>{
 let fail=true;const {manager}=setup(t,async()=>{if(fail)throw Error('offline');return {ok:true,json:async()=>release};});
 await assert.rejects(manager.requestUpgrade('2.0.0'),/offline/);fail=false;
 assert.equal((await manager.requestUpgrade('2.0.0')).state,'queued');
});

test('existing request file is never overwritten even if queued status is missing',async t=>{
 const {manager,options}=setup(t,async()=>({ok:true,json:async()=>release}));
 writeFileSync(options.requestFile,JSON.stringify({id:'already-queued'}));
 await assert.rejects(manager.requestUpgrade('2.0.0'),/升级/);
 assert.equal(JSON.parse(readFileSync(options.requestFile)).id,'already-queued');
});

test('an incomplete shared agent guard is never stolen by API admission',async t=>{
 const {root,manager}=setup(t,async()=>({ok:true,json:async()=>release}));
 const {mkdirSync,existsSync}=await import('node:fs');
 mkdirSync(join(root,'.upgrade-lock'));
 await assert.rejects(manager.requestUpgrade('2.0.0'),/已有升级任务/);
 assert.equal(existsSync(join(root,'.upgrade-lock')),true);
});

test('a manual agent starting during the upstream await prevents publication',async t=>{
 let resume,entered;const gate=new Promise(r=>{resume=r;});const ready=new Promise(r=>{entered=r;});
 const {root,manager,options}=setup(t,async()=>{entered();await gate;return {ok:true,json:async()=>release};});
 const pending=manager.requestUpgrade('2.0.0');await ready;
 const {mkdirSync,existsSync}=await import('node:fs');mkdirSync(join(root,'.upgrade-lock'));
 resume();await assert.rejects(pending,/已有升级任务/);
 assert.equal(existsSync(options.requestFile),false);assert.equal(existsSync(options.statusFile),false);
});

test('separate processes cannot replace the winning request',async t=>{
 const {options}=setup(t,async()=>({ok:true,json:async()=>release}));
 const {spawn}=await import('node:child_process');
 const moduleUrl=new URL('../lib/update.mjs',import.meta.url).href;
 const children=Array.from({length:8},()=>spawn(process.execPath,['--input-type=module','-e',`
 import {createUpdateManager} from ${JSON.stringify(moduleUrl)};
 const manager=createUpdateManager({...JSON.parse(process.argv[1]),fetchImpl:async()=>({ok:true,json:async()=>(${JSON.stringify(release)})})});
 process.stdout.write('ready\\n');
 process.stdin.once('data',async()=>{try{const status=await manager.requestUpgrade('2.0.0');console.log(JSON.stringify({ok:true,id:status.requestId}));}catch(e){console.log(JSON.stringify({ok:false,error:e.message}));}process.exit(0);});
 `,JSON.stringify(options)],{stdio:['pipe','pipe','pipe']}));
 t.after(()=>children.forEach(c=>c.kill()));
 const results=children.map(c=>new Promise((resolve,reject)=>{let text='';c.stdout.on('data',v=>{text+=v;});c.on('error',reject);c.on('exit',code=>code===0?resolve(JSON.parse(text.trim().split('\n').at(-1))):reject(Error(text)));}));
 await Promise.all(children.map(c=>new Promise(resolve=>c.stdout.once('data',resolve))));
 children.forEach(c=>c.stdin.write('go\n'));
 const outcomes=await Promise.all(results);const winners=outcomes.filter(r=>r.ok);
 assert.equal(winners.length,1);assert.equal(JSON.parse(readFileSync(options.requestFile)).id,winners[0].id);
 assert.equal(JSON.parse(readFileSync(options.statusFile)).requestId,winners[0].id);
});
