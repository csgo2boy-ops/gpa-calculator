'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {validateConfig,safeSql,execute,transaction,identity,checkSnapshot,cleanup}=require('../scripts/test-supabase-safety.cjs');
const ref='abcdefghijklmnopqrst';
const cfg=()=>({projectName:'gpa-tracker-test',projectRef:ref,confirmTestProjectRef:ref,host:'db.'+ref+'.supabase.co',port:5432,database:'postgres',user:'postgres',password:'SENTINEL_PASSWORD_NOT_FOR_OUTPUT'});
function directory(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gpa-runner-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 return dir;
}
function opts(t,extra={}){
 const dir=directory(t);
 return {config:cfg(),quiet:true,reportFile:path.join(dir,'report.json'),recoveryFile:path.join(dir,'recovery.json'),...extra};
}
function fakeClient(log=[],failure={}){
 return {
  async connect(){log.push('connect');if(failure.connect)throw failure.connect;},
  async query(sql){log.push(sql);if(sql==='rollback'&&failure.rollback)throw failure.rollback;return {rows:[],rowCount:0};},
  async end(){log.push('end');}
 };
}
const cases=fn=>['T5','T6','T7','T8','T9'].map(id=>[id,()=>fn(id)]);
test('No credentials/invalid target means no connection and a fresh complete report',async t=>{
 let connections=0;
 const options=opts(t,{config:{...cfg(),projectName:'production'},makeClient:()=>{connections++;}});
 fs.writeFileSync(options.reportFile,JSON.stringify({runId:'OLD',results:[{id:'T5',status:'PASS'}]}));
 const r=await execute(options),saved=JSON.parse(fs.readFileSync(options.reportFile));
 assert.notEqual(saved.runId,'OLD');assert.equal(connections,0);assert.equal(r.status,'FAIL');
 assert.equal(r.results.find(x=>x.id==='T5').status,'NOT RUN');
 for(const id of ['T1','T2','T3','T4']){
  const x=r.results.find(x=>x.id===id);assert.equal(x.status,'NOT RUN');assert.match(x.reason,/使用者已確認/);
 }
 assert.ok(!fs.readFileSync(options.reportFile,'utf8').includes(cfg().password));
 assert.ok(fs.existsSync(options.reportFile.replace('.json','.md')));
});
test('Connection failure is reported and never promotes unexecuted tests',async t=>{
 const r=await execute(opts(t,{makeClient:()=>fakeClient([], {connect:Object.assign(Error('secret connection URI'),{code:'ECONNREFUSED'})})}));
 assert.equal(r.results.find(x=>x.id==='PREFLIGHT').reason,'ECONNREFUSED');
 assert.ok(r.results.filter(x=>/^T/.test(x.id)).every(x=>x.status==='NOT RUN'));
 assert.equal(r.status,'FAIL');
});
test('Independent test failure rolls back, continues, and cannot leak a session role',async t=>{
 const sessions=[],executed=[];
 const r=await execute(opts(t,{
  makeClient:()=>{const log=[];sessions.push(log);return fakeClient(log);},preflight:async()=>{},
  caseFunctions:cases(id=>{executed.push(id);if(id==='T6')throw Object.assign(Error('sql payload secret'),{code:'23502'});return {checks:2};})
 }));
 assert.equal(sessions.length,6);assert.deepEqual(executed,['T5','T6','T7','T8','T9']);
 assert.equal(r.results.find(x=>x.id==='T6').status,'FAIL');
 assert.equal(r.results.find(x=>x.id==='T9').status,'PASS');
 for(const log of sessions.slice(1)){assert.ok(log.includes('rollback'));assert.equal(log.at(-1),'end');}
 assert.ok(!JSON.stringify(r).includes('sql payload secret'));
});
test('Successful offline orchestration marks only completed cases, not T1–T4 or T10',async t=>{
 const r=await execute(opts(t,{makeClient:()=>fakeClient(),preflight:async()=>{},caseFunctions:cases(()=>({assertions:1}))}));
 assert.equal(r.status,'PASS');
 assert.equal(r.results.filter(x=>x.status==='PASS').length,6);
 assert.equal(r.results.find(x=>x.id==='T10-existing').status,'NOT RUN');
});
test('Failed rollback prevents further writes and the first case cannot PASS',async t=>{
 let calls=0,ran=0;
 const r=await execute(opts(t,{
  makeClient:()=>fakeClient([],++calls===2?{rollback:Error('lost socket')} : {}),
  preflight:async()=>{},caseFunctions:cases(()=>{ran++;})
 }));
 assert.equal(ran,1);assert.equal(r.results.find(x=>x.id==='T5').status,'FAIL');
 assert.equal(r.results.find(x=>x.id==='T6').status,'NOT RUN');
 assert.equal(r.status,'FAIL');
});
test('Interrupted run does not connect or report successful tests',async t=>{
 let connections=0;
 const r=await execute(opts(t,{signal:{aborted:true},makeClient:()=>{connections++;}}));
 assert.equal(connections,0);assert.equal(r.status,'FAIL');
 assert.ok(r.results.filter(x=>/^T/.test(x.id)).every(x=>x.status==='NOT RUN'));
});
test('SQL guard rejects all schema/permission-changing statements before driver dispatch',()=>{
 for(const sql of ['CREATE TABLE x(id int)','ALTER TABLE x ADD COLUMN y int','DROP TABLE x','TRUNCATE x','GRANT EXECUTE ON FUNCTION x() TO anon','REVOKE ALL ON x FROM public'])
  assert.throws(()=>safeSql(sql),/DDL_OR_PRIVILEGE_CHANGE_REFUSED/);
 for(const sql of ['begin','rollback','set local role authenticated','select auth.uid()','insert into auth.users(id) values($1)'])assert.doesNotThrow(()=>safeSql(sql));
});
test('Known application production ref and missing confirmation are rejected locally',()=>{
 const text=fs.readFileSync(path.join(__dirname,'../public/config.js'),'utf8');
 const production=[...text.matchAll(/https:\/\/([a-z]{20})\.supabase\.co/g)][0][1];
 assert.throws(()=>validateConfig({...cfg(),projectRef:production,confirmTestProjectRef:production,host:'db.'+production+'.supabase.co'}),/PRODUCTION_TARGET_REFUSED/);
 assert.throws(()=>validateConfig({...cfg(),confirmTestProjectRef:undefined}),/CONFIRM_TEST_REF_REQUIRED/);
});
test('RLS identity checks reject administrator/bypass roles and wrong auth UID',async()=>{
 for(const row of [{role:'postgres',uid:'u',bypass:true},{role:'authenticated',uid:'u',bypass:true},{role:'authenticated',uid:'other',bypass:false}]){
  const db={query:async sql=>({rows:sql.startsWith('select current_user')?[row]:[]})};
  await assert.rejects(identity(db,'u'));
 }
});
test('Snapshot assertions reject empty arrays and incorrect owners/content',()=>{
 assert.throws(()=>checkSnapshot({has_state:true,revision:1,semesters:[],courses:[],assessments:[]},'u','winner'));
 const s={has_state:true,revision:1,
  semesters:[{user_id:'u',uid:'00000000-0000-4000-8000-000000000000',local_id:1,name:'winner'}],
  courses:[{user_id:'u',uid:'00000000-0000-4000-8000-000000000000',local_id:1,title:'C-winner',semester_local_id:1}],
  assessments:[{user_id:'u',uid:'00000000-0000-4000-8000-000000000000',local_id:1,name:'A-winner',course_local_id:1}]};
 assert.doesNotThrow(()=>checkSnapshot(s,'u','winner'));
 s.courses[0].user_id='other';assert.throws(()=>checkSnapshot(s,'u','winner'));
});
test('Recovery target mismatch is rejected before any connection or deletion',async t=>{
 const dir=directory(t),file=path.join(dir,'recovery.json');
 fs.writeFileSync(file,JSON.stringify({target:'different',test:'gpa-safety-t10',ids:['00000000-0000-4000-8000-000000000000']}));
 let connects=0;await assert.rejects(cleanup(cfg(),file,()=>{connects++;}),/RECOVERY_TARGET_MISMATCH/);
 assert.equal(connects,0);assert.ok(fs.existsSync(file));
});
test('Failed recovery cleanup preserves manifest for retry',async t=>{
 const dir=directory(t),file=path.join(dir,'recovery.json'),id='00000000-0000-4000-8000-000000000000';
 fs.writeFileSync(file,JSON.stringify({target:ref,test:'gpa-safety-t10',ids:[id]}));
 const log=[];
 const fake={connect:async()=>{},end:async()=>{},query:async(sql,values)=>{
  log.push([sql,values]);if(sql.startsWith('delete '))throw Object.assign(Error(),{code:'ECONNRESET'});return {rows:[]};
 }};
 await assert.rejects(cleanup(cfg(),file,()=>fake));assert.ok(fs.existsSync(file));
 assert.ok(log.some(([sql])=>sql==='rollback'));
 const del=log.find(([sql])=>sql.startsWith('delete '));
 assert.deepEqual(del[1],[id,'gpa-safety-'+id+'@example.invalid']);
});
test('A pending T10 manifest blocks new suites without overwriting it',async t=>{
 const options=opts(t,{makeClient:()=>{throw Error('must not connect');}});
 fs.writeFileSync(options.recoveryFile,'prior-recovery');
 const r=await execute(options);assert.equal(r.results.find(x=>x.id==='PREFLIGHT').reason,'RECOVERY_REQUIRED');
 assert.equal(fs.readFileSync(options.recoveryFile,'utf8'),'prior-recovery');
});
test('Default CLI with missing config writes NOT RUN tests and exits nonzero without connecting',t=>{
 const dir=directory(t);
 // subprocess uses real CLI, but missing config is checked before client creation.
 const result=spawnSync(process.execPath,[path.join(__dirname,'../scripts/test-supabase-safety.cjs')],{
  encoding:'utf8',env:{...process.env,GPA_TEST_CONFIG:path.join(dir,'missing.json'),GPA_TEST_REPORT:path.join(dir,'cli-report.json')}
 });
 assert.equal(result.status,1);
 const report=JSON.parse(fs.readFileSync(path.join(dir,'cli-report.json'),'utf8'));
 assert.equal(report.results.find(x=>x.id==='PREFLIGHT').reason,'CONFIG_MISSING');
 assert.ok(report.results.filter(x=>/^T/.test(x.id)).every(x=>x.status==='NOT RUN'));
 assert.ok(!result.stdout.includes('SENTINEL_PASSWORD'));
});

test('Concurrency requires distinct PostgreSQL backends and still verifies cleanup on failure',async t=>{
 const options=opts(t,{mode:'concurrency',preflight:async()=>{}});
 const logs=[];
 options.makeClient=()=>{
  let uid=null;
  return {connect:async()=>{},end:async()=>{},query:async(sql,values)=>{
   logs.push(sql);
   if(sql.startsWith("select set_config"))uid=values[0]||null;
   if(sql.startsWith('select current_user'))return {rows:[{role:'authenticated',uid,bypass:false}]};
   if(sql==='select pg_backend_pid() pid')return {rows:[{pid:77}]};
   if(sql.startsWith('select count(*)'))return {rows:[{n:0}]};
   return {rows:[],rowCount:1};
  }};
 };
 const r=await execute(options);
 assert.equal(r.results.find(x=>x.id==='T10-existing').status,'FAIL');
 assert.equal(r.results.find(x=>x.id==='T10-first').status,'FAIL');
 assert.equal(r.results.find(x=>x.id==='CLEANUP').status,'PASS');
 assert.ok(!fs.existsSync(options.recoveryFile));
 assert.equal(logs.filter(sql=>sql.startsWith('delete from auth.users')).length,2);
 assert.equal(logs.filter(sql=>sql.startsWith('select public.gpa_replace_snapshot')).length,0);
});
test('Cleanup connection failure is FAIL and keeps the recovery file',async t=>{
 const options=opts(t,{mode:'cleanup',makeClient:()=>fakeClient([],{connect:Object.assign(Error('secret'),{code:'ETIMEDOUT'})})});
 fs.writeFileSync(options.recoveryFile,JSON.stringify({target:ref,test:'gpa-safety-t10',ids:['00000000-0000-4000-8000-000000000000']}));
 const r=await execute(options);
 assert.equal(r.results.find(x=>x.id==='CLEANUP').status,'FAIL');
 assert.equal(r.status,'FAIL');assert.ok(fs.existsSync(options.recoveryFile));
});
test('Interrupted during an active case still rolls back and leaves later cases NOT RUN',async t=>{
 const controller=new AbortController(),log=[];
 const r=await execute(opts(t,{signal:controller.signal,makeClient:()=>fakeClient(log),preflight:async()=>{},
  caseFunctions:cases(()=>{controller.abort();})
 }));
 assert.equal(r.results.find(x=>x.id==='T5').status,'FAIL');
 assert.equal(r.results.find(x=>x.id==='T6').status,'NOT RUN');
 assert.ok(log.includes('rollback'));assert.equal(r.status,'FAIL');
});
test('PowerShell UTF-8 BOM config can be parsed without exposing password or connecting',t=>{
 const dir=directory(t),config=path.join(dir,'bad-target.json'),report=path.join(dir,'bom-report.json');
 fs.writeFileSync(config,'\uFEFF'+JSON.stringify({...cfg(),projectName:'production'}));
 const result=spawnSync(process.execPath,[path.join(__dirname,'../scripts/test-supabase-safety.cjs')],{
  encoding:'utf8',env:{...process.env,GPA_TEST_CONFIG:config,GPA_TEST_REPORT:report}
 });
 assert.equal(result.status,1);
 assert.equal(JSON.parse(fs.readFileSync(report,'utf8')).results.find(x=>x.id==='PREFLIGHT').reason,'TEST_PROJECT_REQUIRED');
 assert.ok(!fs.readFileSync(report,'utf8').includes(cfg().password));
});

test('Launcher initialization replaces stale reports before dependencies or credential prompts',t=>{
 const dir=directory(t),file=path.join(dir,'initial.json');
 for(const flags of [[],['--concurrency'],['--cleanup']]){
  fs.writeFileSync(file,JSON.stringify({status:'PASS',runId:'STALE'}));
  const p=spawnSync(process.execPath,[path.join(__dirname,'../scripts/test-supabase-safety.cjs'),...flags,'--initialize-only'],{
   encoding:'utf8',env:{...process.env,GPA_TEST_REPORT:file,GPA_TEST_CONFIG:path.join(dir,'missing')}
  });
  assert.equal(p.status,0);const r=JSON.parse(fs.readFileSync(file));
  assert.notEqual(r.runId,'STALE');assert.equal(r.status,'NOT RUN');
  assert.ok(r.results.every(x=>x.status==='NOT RUN'));
 }
});

test('Unknown CLI arguments cannot silently launch the default database suite',t=>{
 const dir=directory(t),file=path.join(dir,'invalid.json');
 const p=spawnSync(process.execPath,[path.join(__dirname,'../scripts/test-supabase-safety.cjs'),'--unexpected'],{
  encoding:'utf8',env:{...process.env,GPA_TEST_REPORT:file,GPA_TEST_CONFIG:path.join(dir,'missing')}
 });
 assert.equal(p.status,1);
 const r=JSON.parse(fs.readFileSync(file));assert.equal(r.results.find(x=>x.id==='PREFLIGHT').reason,'INVALID_MODE');
 assert.ok(r.results.filter(x=>/^T/.test(x.id)).every(x=>x.status==='NOT RUN'));
});
