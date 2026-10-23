'use strict';
// No migrations or privilege changes are loaded or executed by this runner.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const root = path.join(__dirname, '..');
const TABLES = ['semesters','courses','assessments','gpa_user_state'];
const reportFile = path.join(root, 'db-test-report.local.json');
const recoveryFile = path.join(root, 'db-test-recovery.local.json');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function requireThat(ok, code) { if (!ok) throw Object.assign(new Error(code), {safeCode:code}); }
function validateConfig(c) {
  requireThat(c && c.projectName === 'gpa-tracker-test', 'TEST_PROJECT_REQUIRED');
  requireThat(/^[a-z]{20}$/.test(c.projectRef), 'INVALID_TEST_REF');
  const productionRefs = [...fs.readFileSync(path.join(root,'public/config.js'),'utf8').matchAll(/https:\/\/([a-z]{20})\.supabase\.co/g)].map(x=>x[1]);
  requireThat(productionRefs.length > 0, 'PRODUCTION_GUARD_UNAVAILABLE');
  requireThat(!productionRefs.includes(c.projectRef), 'PRODUCTION_TARGET_REFUSED');
  requireThat(c.confirmTestProjectRef === c.projectRef, 'CONFIRM_TEST_REF_REQUIRED');
  requireThat(c.database === 'postgres' && Number(c.port) === 5432, 'SESSION_PORT_5432_REQUIRED');
  const direct = c.host === 'db.'+c.projectRef+'.supabase.co' && c.user === 'postgres';
  const pooler = /^aws-[a-z0-9-]+\.pooler\.supabase\.com$/.test(c.host) && c.user === 'postgres.'+c.projectRef;
  requireThat(direct || pooler, 'TARGET_HOST_USER_MISMATCH');
  requireThat(typeof c.password === 'string' && c.password.length > 0, 'LOCAL_PASSWORD_REQUIRED');
  return c;
}
function safeSql(sql) {
  requireThat(typeof sql === 'string' && !/\b(create|alter|drop|truncate|grant|revoke)\b/i.test(sql), 'DDL_OR_PRIVILEGE_CHANGE_REFUSED');
}
function client(c) {
  const {Client} = require('pg'); // dependency failures are captured by the report
  const db = new Client({
    host:c.host, port:Number(c.port), user:c.user, database:c.database, password:c.password,
    ssl:{rejectUnauthorized:true}, connectionTimeoutMillis:10000,
    statement_timeout:15000, query_timeout:18000, application_name:'gpa-tracker-test-safety'
  });
  const query = db.query.bind(db);
  db.query = (sql, values) => { safeSql(sql); return query(sql, values); };
  db.on('error', () => {});
  return db;
}
function safeError(e) {
  if (e && /^[A-Z0-9_]+$/.test(e.safeCode || '')) return e.safeCode;
  if (e && e.code === 'ERR_ASSERTION') return 'ASSERTION_FAILED';
  if (e && /^[A-Z0-9_]+$/.test(e.code || '')) return e.code;
  return 'STARTUP_OR_CONNECTION_ERROR'; // raw SQL/driver messages may contain secrets
}
async function identity(db, id) {
  await db.query('set local role authenticated');
  await db.query('set local row_security = on');
  await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",
    [id || '', JSON.stringify(id ? {sub:id,role:'authenticated'} : {role:'authenticated'})]);
  const r=(await db.query("select current_user as role,auth.uid()::text as uid,(select rolsuper or rolbypassrls from pg_roles where rolname=current_user) as bypass")).rows[0];
  assert.equal(r.role,'authenticated'); assert.equal(r.uid,id); assert.equal(r.bypass,false);
}
async function fixture(db,id) {
  assert.match(id,UUID);
  await db.query('insert into auth.users(id,email) values($1,$2)',[id,'gpa-safety-'+id+'@example.invalid']);
}
async function seed(db,id) {
  const uid=randomUUID();
  await db.query("insert into public.semesters(user_id,local_id,uid,name) values($1,1,$2,'S-original')",[id,uid]);
  await db.query("insert into public.courses(user_id,local_id,uid,semester_local_id,title) values($1,1,$2,1,'C-original')",[id,uid]);
  await db.query("insert into public.assessments(user_id,local_id,uid,course_local_id,name) values($1,1,$2,1,'A-original')",[id,uid]);
}
async function dump(db,id) {
  await db.query('reset role'); // administrative observation, never an RLS assertion
  const out={};
  for(const t of TABLES) out[t]=(await db.query('select * from public.'+t+' where user_id=$1 order by '+(t==='gpa_user_state'?'user_id':'local_id'),[id])).rows;
  return out;
}
async function denied(db,sql,values,code,message) {
  await db.query('savepoint expected_error');
  let error;
  try {await db.query(sql,values);} catch(e) {error=e;}
  await db.query('rollback to savepoint expected_error');
  await db.query('release savepoint expected_error');
  assert.ok(error); assert.equal(error.code,code);
  if(message) assert.match(error.message,message);
}
async function rpc(db,label,revision,invalid=false,forged=null) {
  const semesters=[{local_id:1,uid:randomUUID(),name:label}];
  const courses=[{local_id:1,uid:randomUUID(),semester_local_id:1,title:'C-'+label}];
  const assessments=[{local_id:1,uid:randomUUID(),course_local_id:1,name:invalid?null:'A-'+label}];
  if(forged)for(const rows of [semesters,courses,assessments])rows[0].user_id=forged;
  return (await db.query('select public.gpa_replace_snapshot($1::jsonb,$2::jsonb,$3::jsonb,$4::bigint) as r',
    [JSON.stringify(semesters),JSON.stringify(courses),JSON.stringify(assessments),revision])).rows[0].r;
}
async function snapshot(db) {return (await db.query('select public.gpa_read_snapshot() as r')).rows[0].r;}
function checkSnapshot(s,id,label,revision=1) {
  assert.equal(s.has_state,true); assert.equal(s.revision,revision);
  for(const t of TABLES.slice(0,3)) {
    assert.ok(Array.isArray(s[t])); assert.equal(s[t].length,1);
    assert.equal(s[t][0].user_id,id); assert.equal(s[t][0].local_id,1);
    assert.match(s[t][0].uid,/^[0-9a-f-]{36}$/);
  }
  assert.equal(s.semesters[0].name,label);
  assert.equal(s.courses[0].title,'C-'+label); assert.equal(s.courses[0].semester_local_id,1);
  assert.equal(s.assessments[0].name,'A-'+label); assert.equal(s.assessments[0].course_local_id,1);
}
async function transaction(db,fn) {
  await db.query('begin isolation level read committed');
  try {
    await db.query("set local idle_in_transaction_session_timeout='25s'");
    return await fn();
  } finally {
    try {await db.query('rollback');}
    catch(e) {throw Object.assign(new Error('ROLLBACK_FAILED'),{safeCode:'ROLLBACK_FAILED'});}
  }
}
async function close(db) {
  if(!db)return;
  await db.end().catch(()=>{});
}
async function preflight(db) {
  for(const t of TABLES) {
    const r=(await db.query("select relrowsecurity,relowner='authenticated'::regrole as owned_by_auth from pg_class where oid=$1::regclass",['public.'+t])).rows[0];
    assert.ok(r);assert.equal(r.relrowsecurity,true);assert.equal(r.owned_by_auth,false);
  }
  for(const sig of ['public.gpa_read_snapshot()','public.gpa_replace_snapshot(jsonb,jsonb,jsonb,bigint)']) {
    const r=(await db.query("select prosecdef,has_function_privilege('authenticated',oid,'execute') as allowed,has_function_privilege('anon',oid,'execute') as anon_allowed from pg_proc where oid=$1::regprocedure",[sig])).rows[0];
    assert.ok(r);assert.equal(r.prosecdef,false);assert.equal(r.allowed,true);assert.equal(r.anon_allowed,false);
  }
}
async function t5(db) {
  const a=randomUUID(),b=randomUUID();
  for(const id of [a,b]){await fixture(db,id);await seed(db,id);}
  await db.query('insert into public.gpa_user_state(user_id) values($1),($2)',[a,b]);
  const before=await dump(db,b);
  for(const [who,other] of [[a,b],[b,a]]) {
    await identity(db,who);
    for(const t of TABLES) {
      assert.equal((await db.query('select count(*)::int n from public.'+t+' where user_id=$1',[who])).rows[0].n,1);
      assert.equal((await db.query('select count(*)::int n from public.'+t+' where user_id=$1',[other])).rows[0].n,0);
      assert.equal((await db.query('update public.'+t+' set user_id=user_id where user_id=$1',[other])).rowCount,0);
      assert.equal((await db.query('delete from public.'+t+' where user_id=$1',[other])).rowCount,0);
      await denied(db,'update public.'+t+' set user_id=$1 where user_id=$2',[other,who],'42501');
      const cols=t==='gpa_user_state'?'':',local_id,'+(t==='semesters'?'name':t==='courses'?'semester_local_id,title':'course_local_id,name');
      const vals=t==='gpa_user_state'?'':",2,"+(t==='semesters'?"'forged'":"1,'forged'");
      await denied(db,'insert into public.'+t+'(user_id'+cols+') values($1'+vals+')',[other],'42501');
      assert.equal((await db.query('update public.'+t+' set updated_at=updated_at where user_id=$1',[who])).rowCount,1);
    }
  }
  assert.deepEqual(await dump(db,b),before);
  await identity(db,a);
  for(const t of [...TABLES].reverse())assert.equal((await db.query('delete from public.'+t+' where user_id=$1',[a])).rowCount,1);
  assert.deepEqual(await dump(db,b),before);
  return {directions:2,tables:4,ownRowsPerTable:1,crossUserRowsVisible:0};
}
async function t6(db) {
  const a=randomUUID();await fixture(db,a);await seed(db,a);await identity(db,a);
  for(const t of TABLES.slice(0,3)) {
    const r=await db.query("update public."+t+" set updated_at='2000-01-01' where user_id=$1 returning updated_at=transaction_timestamp() as ok",[a]);
    assert.equal(r.rowCount,1);assert.equal(r.rows[0].ok,true);
    const cols=t==='semesters'?'name':t==='courses'?'title,semester_local_id':'name,course_local_id';
    const vals=t==='semesters'?"'trigger'":"'trigger',1";
    const inserted=await db.query("insert into public."+t+"(user_id,local_id,"+cols+",updated_at) values($1,2,"+vals+",'2000-01-01') returning updated_at=transaction_timestamp() as ok",[a]);
    assert.equal(inserted.rowCount,1);assert.equal(inserted.rows[0].ok,true);
  }
  return {insertAssertions:3,updateAssertions:3};
}
async function t7(db) {
  const a=randomUUID(),b=randomUUID();
  await fixture(db,a);await fixture(db,b);await seed(db,b);
  const before=await dump(db,b);await identity(db,a);
  assert.deepEqual(await rpc(db,'snapshot',0,false,b),{ok:true,revision:1});
  checkSnapshot(await snapshot(db),a,'snapshot');
  assert.deepEqual(await dump(db,b),before);
  await identity(db,null);
  await denied(db,'select public.gpa_read_snapshot()',[],'P0001',/not authenticated/);
  await denied(db,"select public.gpa_replace_snapshot('[]','[]','[]',0)",[],'P0001',/not authenticated/);
  return {rowsPerArray:1,forgedOwnerIgnored:true,otherUserUnchanged:true};
}
async function t8(db) {
  const a=randomUUID();await fixture(db,a);await seed(db,a);
  for(const existing of [false,true]) {
    if(existing)await db.query('insert into public.gpa_user_state(user_id,revision) values($1,4)',[a]);
    const before=await dump(db,a);await identity(db,a);
    for(const sql of ["select public.gpa_replace_snapshot('[]','[]','[]',null)","select public.gpa_replace_snapshot('[]','[]','[]')"])
      await denied(db,sql,[],'P0001',/p_expected_revision is required/);
    assert.deepEqual(await dump(db,a),before);
  }
  return {missingStateAndExistingState:true,rejectedCalls:4};
}
async function t9(db) {
  const a=randomUUID(),b=randomUUID();await fixture(db,a);await fixture(db,b);await seed(db,a);await seed(db,b);
  const beforeB=await dump(db,b);await identity(db,a);
  assert.deepEqual(await rpc(db,'winner',0),{ok:true,revision:1});
  checkSnapshot(await snapshot(db),a,'winner');
  const beforeA=await dump(db,a);await identity(db,a);
  assert.deepEqual(await rpc(db,'stale',0),{ok:false,conflict:true,current_revision:1});
  checkSnapshot(await snapshot(db),a,'winner');
  await db.query('savepoint atomic_failure');
  let error;try {await rpc(db,'invalid',1,true);}catch(e){error=e;}
  await db.query('rollback to savepoint atomic_failure');await db.query('release savepoint atomic_failure');
  assert.equal(error&&error.code,'23502');
  assert.deepEqual(await dump(db,a),beforeA);assert.deepEqual(await dump(db,b),beforeB);
  await identity(db,a);checkSnapshot(await snapshot(db),a,'winner');
  return {conflictRevision:1,failedLateInsertSqlstate:'23502',fullRollbackVerified:true};
}
async function cleanup(c,filename=recoveryFile,makeClient=client) {
  if(!fs.existsSync(filename))return 'NOT NEEDED';
  const m=JSON.parse(fs.readFileSync(filename,'utf8'));
  requireThat(m.target===c.projectRef && m.test==='gpa-safety-t10','RECOVERY_TARGET_MISMATCH');
  requireThat(Array.isArray(m.ids)&&m.ids.length>0&&m.ids.every(id=>UUID.test(id)),'INVALID_RECOVERY_IDS');
  const db=makeClient(c);
  try {
    await db.connect();await db.query('begin');
    for(const id of m.ids) {
      await db.query('delete from auth.users where id=$1 and email=$2',[id,'gpa-safety-'+id+'@example.invalid']);
      for(const t of [...TABLES,'auth.users']) {
        const table=t==='auth.users'?t:'public.'+t;
        const col=t==='auth.users'?'id':'user_id';
        assert.equal((await db.query('select count(*)::int n from '+table+' where '+col+'=$1',[id])).rows[0].n,0);
      }
    }
    await db.query('commit');fs.unlinkSync(filename);return 'VERIFIED';
  } catch(e) {await db.query('rollback').catch(()=>{});throw e;}
  finally {await close(db);}
}
async function t10(c,hasState,files,signal,makeClient=client) {
  files.lastCleanup='NOT RUN';
  const id=randomUUID(),admin=makeClient(c),a=makeClient(c),b=makeClient(c);
  // Exclusive creation prevents overwriting a previous run's recovery IDs.
  fs.writeFileSync(files.recovery,JSON.stringify({target:c.projectRef,test:'gpa-safety-t10',ids:[id]}),{flag:'wx'});
  let pending,cleanupStatus;
  try {
    await admin.connect();await fixture(admin,id);
    if(hasState)await admin.query('insert into public.gpa_user_state(user_id) values($1)',[id]);
    await a.connect();await b.connect();
    for(const conn of [a,b]) {
      await conn.query('begin isolation level read committed');
      await conn.query("set local idle_in_transaction_session_timeout='25s'");
      await identity(conn,id);
    }
    const pidA=(await a.query('select pg_backend_pid() pid')).rows[0].pid;
    const pidB=(await b.query('select pg_backend_pid() pid')).rows[0].pid;
    assert.notEqual(pidA,pidB);
    assert.deepEqual(await rpc(a,'winner',0),{ok:true,revision:1});
    pending=rpc(b,'loser',0).then(value=>({value}),error=>({error}));
    let blocked=false;
    for(let i=0;i<100;i++) {
      requireThat(!signal.aborted,'INTERRUPTED');
      blocked=(await admin.query('select $1::int=any(pg_blocking_pids($2)) as blocked',[pidA,pidB])).rows[0].blocked;
      if(blocked)break;await new Promise(resolve=>setTimeout(resolve,50));
    }
    assert.equal(blocked,true);
    await transaction(admin,async()=>{
      await identity(admin,id);const old=await snapshot(admin);
      assert.equal(old.has_state,hasState);assert.equal(old.revision,0);
      for(const t of TABLES.slice(0,3))assert.deepEqual(old[t],[]);
    });
    requireThat(!signal.aborted,'INTERRUPTED');await a.query('commit');
    const second=await pending;if(second.error)throw second.error;
    assert.deepEqual(second.value,{ok:false,conflict:true,current_revision:1});
    checkSnapshot(await snapshot(b),id,'winner');await b.query('rollback');
    return {pidA,pidB,blockingObserved:true,loserConflict:true};
  } finally {
    // A rollback releases B before waiting for its rollback, avoiding a deadlock.
    await a.query('rollback').catch(()=>{});await b.query('rollback').catch(()=>{});
    if(pending)await pending;
    await close(a);await close(b);await close(admin);
    try {cleanupStatus=await cleanup(c,files.recovery,makeClient);files.lastCleanup=cleanupStatus;}
    catch(e) {files.lastCleanup='FAILED';throw Object.assign(new Error('CLEANUP_FAILED'),{safeCode:'CLEANUP_FAILED'});}
    requireThat(cleanupStatus==='VERIFIED','CLEANUP_NOT_VERIFIED');
  }
}
function newReport(mode) {
  const selected=mode==='remaining'?['T5','T6','T7','T8','T9']:mode==='concurrency'?['T10-existing','T10-first']:[];
  const ids=['T1','T2','T3','T4','PREFLIGHT','T5','T6','T7','T8','T9','T10-existing','T10-first','CLEANUP'];
  return {
    runId:randomUUID(),startedAt:new Date().toISOString(),mode,target:null,status:'RUNNING',
    results:ids.map(id=>({id,status:'NOT RUN',reason:/^T[1-4]$/.test(id)?'使用者已確認，本輪不重測':
      id==='PREFLIGHT'&&mode!=='cleanup'||selected.includes(id)||mode==='cleanup'&&id==='CLEANUP'?'尚未執行':'本輪未選取'}))
  };
}
function saveReport(report,filename) {
  fs.writeFileSync(filename,JSON.stringify(report,null,2)+'\n');
  const text=['# GPA test report', 'Run: '+report.runId,'Mode: '+report.mode,'Status: '+report.status,'',
    '| Test | Status | Reason |','| --- | --- | --- |',
    ...report.results.map(r=>'| '+r.id+' | '+r.status+' | '+(r.reason||'')+' |')].join('\n')+'\n';
  fs.writeFileSync(filename.replace(/\.json$/,'.md'),text);
}
async function execute(options={}) {
  const mode=options.mode||'remaining';
  const filename=options.reportFile||(mode==='remaining'?reportFile:path.join(root,'db-test-'+mode+'-report.local.json'));
  const files={recovery:options.recoveryFile||recoveryFile};
  const report=newReport(mode),signal=options.signal||{aborted:false};
  const makeClient=options.makeClient||client;
  let fatal=false;
  function set(id,status,reason,evidence) {
    Object.assign(report.results.find(r=>r.id===id),{status,reason,evidence:evidence||null});
    saveReport(report,filename);
  }
  // Replace any stale report BEFORE loading config or attempting a connection.
  saveReport(report,filename);
  try {
    requireThat(['remaining','concurrency','cleanup'].includes(mode),'INVALID_MODE');
    let c;
    if(options.config)c=options.config;
    else {
      const configPath=process.env.GPA_TEST_CONFIG||path.join(root,'db-test.local.json');
      requireThat(fs.existsSync(configPath),'CONFIG_MISSING');
      c=JSON.parse(fs.readFileSync(configPath,'utf8').replace(/^\uFEFF/,''));
      c.password=process.env.GPA_TEST_PASSWORD||c.password;
    }
    validateConfig(c);report.target=c.projectRef;saveReport(report,filename);
    requireThat(!signal.aborted,'INTERRUPTED');
    if(mode==='cleanup') {
      try {set('CLEANUP','PASS',await cleanup(c,files.recovery,makeClient));}
      catch(e) {set('CLEANUP','FAIL',safeError(e));}
      return report;
    }
    requireThat(!fs.existsSync(files.recovery),'RECOVERY_REQUIRED');
    const probe=makeClient(c);
    try {await probe.connect();await (options.preflight||preflight)(probe);}
    finally {await close(probe);}
    set('PREFLIGHT','PASS','唯讀前置檢查通過，未執行任何 Migration／權限變更');
    const cases=mode==='remaining'?(options.caseFunctions||[
      ['T5',t5],['T6',t6],['T7',t7],['T8',t8],['T9',t9]
    ]):[['T10-existing',null],['T10-first',null]];
    for(const [id,fn] of cases) {
      if(signal.aborted||fatal) {set(id,'NOT RUN',signal.aborted?'INTERRUPTED':'前項清理失敗，停止寫入');continue;}
      let db;
      try {
        let evidence;
        if(mode==='remaining') {
          // Fresh session per case: no failed transaction/role leaks into the next test.
          db=makeClient(c);await db.connect();
          evidence=await transaction(db,()=>fn(db));
        } else evidence=await t10(c,id==='T10-existing',files,signal,makeClient);
        requireThat(!signal.aborted,'INTERRUPTED');
        set(id,'PASS','所有斷言及回滾／清理完成',evidence);
      } catch(e) {
        set(id,'FAIL',safeError(e));
        fatal=['ROLLBACK_FAILED','CLEANUP_FAILED','CLEANUP_NOT_VERIFIED'].includes(e.safeCode);
      } finally {await close(db);}
    }
  } catch(e) {set('PREFLIGHT','FAIL',safeError(e));}
  finally {
    if(mode==='concurrency'&&report.results.some(r=>r.id.startsWith('T10-')&&r.status!=='NOT RUN')) {
      const cleaned=files.lastCleanup==='VERIFIED'&&!fs.existsSync(files.recovery);
      set('CLEANUP',cleaned?'PASS':'FAIL',cleaned?'一次性測試帳號清理已驗證':'清理未驗證，請保留恢復檔並重試');
    }
    report.finishedAt=new Date().toISOString();
    report.status=report.results.some(r=>r.status==='FAIL')?'FAIL':
      report.results.some(r=>r.reason==='尚未執行')||signal.aborted?'NOT RUN':'PASS';
    for(const r of report.results)if(r.reason==='尚未執行')r.reason='前置條件未通過或執行中斷';
    saveReport(report,filename);
    if(!options.quiet)for(const r of report.results)console.log(r.status+' '+r.id+' '+r.reason);
  }
  return report;
}
async function main() {
  const args=process.argv.slice(2);
  const mode=args.includes('--cleanup')?'cleanup':args.includes('--concurrency')?'concurrency':'remaining';
  if(args.includes('--initialize-only')) {
    const initial=newReport(mode);initial.status='NOT RUN';
    for(const row of initial.results)if(row.reason==='尚未執行')row.reason='啟動準備未完成，尚未連線';
    saveReport(initial,process.env.GPA_TEST_REPORT||(mode==='remaining'?reportFile:path.join(root,'db-test-'+mode+'-report.local.json')));
    console.log('NOT RUN: startup report initialized; no connection attempted');return;
  }
  const controller=new AbortController();
  const abort=()=>controller.abort();
  process.on('SIGINT',abort);process.on('SIGTERM',abort);
  try {
    const known=args.every(arg=>['--cleanup','--concurrency'].includes(arg));
    const result=await execute({mode:known?mode:'invalid',signal:controller.signal,reportFile:process.env.GPA_TEST_REPORT});
    if(result.status!=='PASS')process.exitCode=1;
  } finally {process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);}
}
module.exports={validateConfig,safeSql,safeError,newReport,saveReport,execute,transaction,identity,checkSnapshot,cleanup};
if(require.main===module)main().catch(()=>{console.error('REPORT_WRITE_FAILED: check local output permissions');process.exitCode=1;});
