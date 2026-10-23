'use strict';
// Explicit opt-in integration runner. Never included in npm test.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const {Client} = require('pg');
const root = path.join(__dirname, '..');
const recoveryPath = path.join(root, 'db-test-recovery.local.json');
const reportPath = path.join(root, 'db-test-report.local.json');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/001_batch1_1_data_safety.sql'), 'utf8');
// The standalone follow-up normally commits its ACL fix. In its regression test
// strip only its wrapper, so deliberately contaminated grants always roll back.
const aclPatch = fs.readFileSync(path.join(root, 'supabase/migrations/001a_rpc_execute_permissions.sql'), 'utf8').replace(/^(begin|commit);\r?$/gmi, '');
const tables = ['semesters', 'courses', 'assessments', 'gpa_user_state'];
const signatures = ['public.gpa_read_snapshot()', 'public.gpa_replace_snapshot(jsonb,jsonb,jsonb,bigint)'];
function validateConfig(c) {
  assert.equal(c.projectName, 'gpa-tracker-test', 'Only gpa-tracker-test is authorized');
  assert.match(c.projectRef, /^[a-z]{20}$/, 'Copy the test project reference from Dashboard');
  assert.equal(c.database, 'postgres');
  assert.equal(Number(c.port), 5432, 'Use direct or session pooler port 5432, never transaction pooler 6543');
  const direct = c.host === 'db.' + c.projectRef + '.supabase.co' && c.user === 'postgres';
  const pooler = /^aws-[a-z0-9-]+\.pooler\.supabase\.com$/.test(c.host) && c.user === 'postgres.' + c.projectRef;
  assert.ok(direct || pooler, 'Host/user must match the explicitly selected test project reference');
  assert.equal(typeof c.password, 'string');
  assert.ok(c.password.length > 0);
  return c;
}
function client(c) {
  const db = new Client({host:c.host, port:c.port, user:c.user, database:c.database, password:c.password,
    ssl:{rejectUnauthorized:true}, connectionTimeoutMillis:10000, application_name:'gpa-tracker-test-safety'});
  // Keep connection failures handled even when a socket dies between queries.
  db.on('error', () => {});
  return db;
}
async function claims(db, id, role='authenticated') {
  assert.ok(['authenticated','anon'].includes(role));
  await db.query('set local role ' + role);
  await db.query("select set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claims',$2,true)",
    [id || '', JSON.stringify(id ? {sub:id,role} : {role})]);
}
async function fixture(db, id) {
  await db.query("insert into auth.users(id,email) values($1,$2)", [id,'gpa-safety-'+id+'@example.invalid']);
}
async function data(db, id, n=1, uid=randomUUID()) {
  await db.query('insert into public.semesters(user_id,local_id,uid,name) values($1,$2,$3,$4)', [id,n,uid,'S'+n]);
  await db.query('insert into public.courses(user_id,local_id,uid,semester_local_id,title) values($1,$2,$3,$2,$4)', [id,n,uid,'C'+n]);
  await db.query('insert into public.assessments(user_id,local_id,uid,course_local_id,name) values($1,$2,$3,$2,$4)', [id,n,uid,'A'+n]);
}
async function dump(db, id) {
  await db.query('reset role');
  const result = {};
  for (const table of tables) result[table]=(await db.query('select * from public.'+table+' where user_id=$1 order by user_id, '+(table==='gpa_user_state'?'revision':'local_id'),[id])).rows;
  return result;
}
async function denied(db, sql, values, code, message, constraint) {
  await db.query('savepoint expected_failure');
  let error;
  try { await db.query(sql,values); } catch(e) { error=e; }
  await db.query('rollback to savepoint expected_failure');
  await db.query('release savepoint expected_failure');
  assert.ok(error, 'Expected SQL failure');
  assert.equal(error.code,code);
  if(message) assert.match(error.message,message);
  if(constraint) assert.equal(error.constraint,constraint);
}
async function rpc(db, name, revision=0, invalid=false, forgedUserId=null) {
  const semesters=[{local_id:1,uid:randomUUID(),name}];
  const courses=[{local_id:1,uid:randomUUID(),semester_local_id:1,title:'C-'+name}];
  const assessments=[{local_id:1,uid:randomUUID(),course_local_id:1,name:invalid?null:'A-'+name}];
  if(forgedUserId)for(const rows of [semesters,courses,assessments])rows[0].user_id=forgedUserId;
  return (await db.query('select public.gpa_replace_snapshot($1::jsonb,$2::jsonb,$3::jsonb,$4::bigint) as r',
    [JSON.stringify(semesters),JSON.stringify(courses),JSON.stringify(assessments),revision])).rows[0].r;
}
async function snapshot(db) {return (await db.query('select public.gpa_read_snapshot() as r')).rows[0].r;}
async function transaction(db, fn) {
  await db.query('begin');
  await db.query("set local statement_timeout='15s'");
  try {return await fn();} finally {await db.query('rollback');}
}
async function run(c, cleanupOnly=false) {
  const db=client(c), report={target:c.projectRef, projectName:c.projectName, results:[], cleanup:'not-needed'};
  await db.connect();
  async function record(name,fn) {
    try {const evidence=await fn();report.results.push({name,status:'PASS',evidence:evidence||null});console.log('PASS '+name);}
    catch(e) {report.results.push({name,status:'FAIL',sqlstate:e.code||null});throw e;}
  }
  async function cleanup() {
    if(!fs.existsSync(recoveryPath))return;
    const manifest=JSON.parse(fs.readFileSync(recoveryPath,'utf8'));
    assert.equal(manifest.target,c.projectRef,'Recovery file belongs to a different project');
    assert.equal(manifest.test,'gpa-safety-t10');
    for(const id of manifest.ids) assert.match(id,/^[0-9a-f-]{36}$/);
    await db.query('begin');
    try {
      // Exact UUID + generated email, never a broad prefix deletion.
      for(const id of manifest.ids) {
        await db.query("delete from auth.users where id=$1 and email=$2",[id,'gpa-safety-'+id+'@example.invalid']);
        for(const table of tables) assert.equal((await db.query('select count(*)::int as n from public.'+table+' where user_id=$1',[id])).rows[0].n,0);
        assert.equal((await db.query('select count(*)::int as n from auth.users where id=$1',[id])).rows[0].n,0);
      }
      await db.query('commit');fs.unlinkSync(recoveryPath);report.cleanup='verified';
    } catch(e) {await db.query('rollback');report.cleanup='FAILED: keep recovery manifest';throw e;}
  }
  try {
    if(cleanupOnly){await cleanup();return;}
    assert.ok(!fs.existsSync(recoveryPath),'An earlier T10 run needs --cleanup first');
    // Check prerequisites without granting anything: missing grants must fail.
    await record('preflight RLS + invoker + authenticated ACL',async()=>{
      for(const table of tables) {
        const row=(await db.query("select relrowsecurity from pg_class where oid=$1::regclass",['public.'+table])).rows[0];
        assert.equal(row.relrowsecurity,true);
      }
      for(const sig of signatures) {
        assert.equal((await db.query("select prosecdef from pg_proc where oid=$1::regprocedure",[sig])).rows[0].prosecdef,false);
        assert.equal((await db.query("select has_function_privilege('authenticated',$1,'execute') as ok",[sig])).rows[0].ok,true);
      }
    });
    await record('T2 unique UID on all three tables + cross-user reuse',()=>transaction(db,async()=>{
      const a=randomUUID(),b=randomUUID(),uid=randomUUID();
      await fixture(db,a);await fixture(db,b);await data(db,a,1,uid);await data(db,b,1,uid);
      await claims(db,a);
      for(const table of tables.slice(0,3)) {
        const extras=table==='semesters'?'name':table==='courses'?'title,semester_local_id':'name,course_local_id';
        const values=table==='semesters'?"'duplicate'":"'duplicate',1";
        await denied(db,'insert into public.'+table+'(user_id,local_id,uid,'+extras+') values($1,2,$2,'+values+')',
          [a,uid],'23505',null,table+'_user_uid_idx');
      }
    }));
    await record('T3 backfill exact user coverage + preserve existing revision + rerun',()=>transaction(db,async()=>{
      const a=randomUUID(),b=randomUUID(),empty=randomUUID();
      for(const id of [a,b,empty])await fixture(db,id);
      await data(db,a);await data(db,b);
      await db.query('insert into public.gpa_user_state(user_id,revision) values($1,7)',[b]);
      await db.query(migration);await db.query(migration);
      const rows=(await db.query('select user_id,revision::int as revision from public.gpa_user_state where user_id=any($1::uuid[])',[ [a,b,empty] ])).rows;
      assert.equal(rows.length,2);assert.equal(rows.find(x=>x.user_id===a).revision,1);assert.equal(rows.find(x=>x.user_id===b).revision,7);
      assert.equal((await db.query('select count(*)::int n from (select user_id from public.semesters union select user_id from public.courses union select user_id from public.assessments) d left join public.gpa_user_state s using(user_id) where s.user_id is null')).rows[0].n,0);
    }));
    await record('T4 current anon ACL + actual denied calls',()=>transaction(db,async()=>{
      for(const sig of signatures)assert.equal((await db.query("select has_function_privilege('anon',$1,'execute') ok",[sig])).rows[0].ok,false);
      await claims(db,null,'anon');
      await denied(db,'select public.gpa_read_snapshot()',[],'42501');
      await denied(db,"select public.gpa_replace_snapshot('[]','[]','[]',0)",[],'42501');
    }));
    await record('T4 regression explicit anon + PUBLIC grants survive CREATE OR REPLACE unless revoked',()=>transaction(db,async()=>{
      for(const sig of signatures)await db.query('grant execute on function '+sig+' to anon,public');
      for(const sig of signatures)assert.equal((await db.query("select has_function_privilege('anon',$1,'execute') ok",[sig])).rows[0].ok,true);
      await db.query(migration);await db.query(migration);
      for(const sig of signatures) {
        assert.equal((await db.query("select has_function_privilege('anon',$1,'execute') ok",[sig])).rows[0].ok,false);
        assert.equal((await db.query("select count(*)::int n from pg_proc p, lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid=$1::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE'",[sig])).rows[0].n,0);
      }
    }));
    await record('T4 installed-database follow-up patch is idempotent',()=>transaction(db,async()=>{
      for(const sig of signatures)await db.query('grant execute on function '+sig+' to anon,public');
      await db.query(aclPatch);await db.query(aclPatch);
      for(const sig of signatures){
        assert.equal((await db.query("select has_function_privilege('anon',$1,'execute') ok",[sig])).rows[0].ok,false);
        assert.equal((await db.query("select has_function_privilege('authenticated',$1,'execute') ok",[sig])).rows[0].ok,true);
      }
    }));
    await record('T5 RLS cross-user SELECT INSERT UPDATE DELETE + ownership reassignment',()=>transaction(db,async()=>{
      const a=randomUUID(),b=randomUUID();
      await fixture(db,a);await fixture(db,b);await data(db,a);await data(db,b);
      await db.query('insert into public.gpa_user_state(user_id) values($1),($2)',[a,b]);
      const before=await dump(db,b);
      for(const [who,other] of [[a,b],[b,a]]) {
        await claims(db,who);
        for(const table of tables) {
          assert.equal((await db.query('select count(*)::int n from public.'+table+' where user_id=$1',[other])).rows[0].n,0);
          assert.equal((await db.query('select count(*)::int n from public.'+table+' where user_id=$1',[who])).rows[0].n,1);
          assert.equal((await db.query('update public.'+table+' set user_id=user_id where user_id=$1',[other])).rowCount,0);
          assert.equal((await db.query('delete from public.'+table+' where user_id=$1',[other])).rowCount,0);
          await denied(db,'update public.'+table+' set user_id=$1 where user_id=$2',[other,who],'42501');
          const cols=table==='gpa_user_state'?'':',local_id,'+(table==='courses'?'semester_local_id,title':table==='assessments'?'course_local_id,name':'name');
          const vals=table==='gpa_user_state'?'':",2,"+(table==='semesters'?"'forged'":"1,'forged'");
          await denied(db,'insert into public.'+table+'(user_id'+cols+') values($1'+vals+')',[other],'42501');
          assert.equal((await db.query('update public.'+table+' set updated_at=updated_at where user_id=$1',[who])).rowCount,1);
        }
      }
      // B's own positive UPDATE can touch updated_at: compare identity/content separately.
      const after=await dump(db,b);
      assert.deepEqual(after,before);
      await claims(db,a);
      for(const table of [...tables].reverse())assert.equal((await db.query('delete from public.'+table+' where user_id=$1',[a])).rowCount,1);
      assert.deepEqual(await dump(db,b),before);
    }));
    await record('T6 triggers override caller timestamps on insert/update (transaction time)',()=>transaction(db,async()=>{
      const a=randomUUID();await fixture(db,a);await data(db,a);await claims(db,a);
      for(const table of tables.slice(0,3)) {
        const result=await db.query("update public."+table+" set updated_at='2000-01-01' where user_id=$1 returning updated_at=transaction_timestamp() as ok",[a]);
        assert.equal(result.rowCount,1);assert.equal(result.rows[0].ok,true);
        const cols=table==='semesters'?'name':table==='courses'?'title,semester_local_id':'name,course_local_id';
        const vals=table==='semesters'?"'trigger'":"'trigger',1";
        const row=(await db.query("insert into public."+table+"(user_id,local_id,"+cols+",updated_at) values($1,2,"+vals+",'2000-01-01') returning updated_at=transaction_timestamp() as ok",[a])).rows[0];
        assert.equal(row.ok,true);
      }
    }));
    await record('T8 null and omitted revision error without any state/data change',()=>transaction(db,async()=>{
      const a=randomUUID();await fixture(db,a);await data(db,a);
      const before=await dump(db,a);await claims(db,a);
      for(const sql of ["select public.gpa_replace_snapshot('[]','[]','[]',null)","select public.gpa_replace_snapshot('[]','[]','[]')"])
        await denied(db,sql,[],'P0001',/p_expected_revision is required/);
      assert.deepEqual(await dump(db,a),before);
      await db.query('insert into public.gpa_user_state(user_id,revision) values($1,4)',[a]);
      const existing=await dump(db,a);await claims(db,a);
      for(const sql of ["select public.gpa_replace_snapshot('[]','[]','[]',null)","select public.gpa_replace_snapshot('[]','[]','[]')"])
        await denied(db,sql,[],'P0001',/p_expected_revision is required/);
      assert.deepEqual(await dump(db,a),existing);
    }));
    await record('T7/T9 RPC isolation, conflict, null identity and atomic rollback on failed insert',()=>transaction(db,async()=>{
      const a=randomUUID(),b=randomUUID();await fixture(db,a);await fixture(db,b);await data(db,b);
      const beforeB=await dump(db,b);await claims(db,a);
      const first=await rpc(db,'winner',0,false,b);assert.deepEqual(first,{ok:true,revision:1});
      let snap=await snapshot(db);assert.equal(snap.revision,1);
      for(const table of tables.slice(0,3))assert.ok(snap[table].every(x=>x.user_id===a));
      const beforeA=await dump(db,a);await claims(db,a);
      assert.deepEqual(await rpc(db,'stale',0),{ok:false,conflict:true,current_revision:1});
      await db.query('savepoint atomic');
      let error;try{await rpc(db,'invalid',1,true);}catch(e){error=e;}
      await db.query('rollback to savepoint atomic');await db.query('release savepoint atomic');
      assert.equal(error&&error.code,'23502');
      assert.deepEqual(await dump(db,a),beforeA);assert.deepEqual(await dump(db,b),beforeB);
      await claims(db,null);
      await denied(db,'select public.gpa_read_snapshot()',[],'P0001',/not authenticated/);
      await denied(db,"select public.gpa_replace_snapshot('[]','[]','[]',0)",[],'P0001',/not authenticated/);
    }));
    // A genuine committed winner cannot be rolled back together with the loser.
    // Use disposable committed fixtures, then verified compensating cleanup.
    for(const hasState of [true,false])await record('T10 two connections '+(hasState?'existing-state':'first-write'),async()=>{
      const id=randomUUID(),a=client(c),b=client(c);
      fs.writeFileSync(recoveryPath,JSON.stringify({target:c.projectRef,test:'gpa-safety-t10',ids:[id]},null,2));
      let pending;
      try {
        await fixture(db,id);
        if(hasState)await db.query('insert into public.gpa_user_state(user_id) values($1)',[id]);
        await a.connect();await b.connect();
        await a.query('begin');await b.query('begin');
        for(const conn of [a,b]){await conn.query("set local statement_timeout='15s'");await claims(conn,id);}
        const pidA=(await a.query('select pg_backend_pid() pid')).rows[0].pid;
        const pidB=(await b.query('select pg_backend_pid() pid')).rows[0].pid;
        assert.notEqual(pidA,pidB,'Must use two distinct PostgreSQL backend connections');
        assert.deepEqual(await rpc(a,'winner',0),{ok:true,revision:1});
        pending=rpc(b,'loser',0).then(value=>({value}),error=>({error}));
        let blocked=false;
        for(let i=0;i<100;i++){
          const row=(await db.query('select $1::int=any(pg_blocking_pids($2)) as blocked',[pidA,pidB])).rows[0];
          if(row.blocked){blocked=true;break;}
          await new Promise(resolve=>setTimeout(resolve,50));
        }
        assert.equal(blocked,true,'Did not observe B blocked by A; concurrency test cannot pass');
        await transaction(db,async()=>{
          await claims(db,id);const old=await snapshot(db);
          assert.equal(old.revision,0);assert.equal(old.semesters.length,0);assert.equal(old.courses.length,0);assert.equal(old.assessments.length,0);
        });
        await a.query('commit');
        const second=await pending;if(second.error)throw second.error;
        assert.deepEqual(second.value,{ok:false,conflict:true,current_revision:1});
        const final=await snapshot(b);
        assert.equal(final.revision,1);assert.equal(final.semesters.length,1);assert.equal(final.semesters[0].name,'winner');
        assert.equal(final.courses[0].title,'C-winner');assert.equal(final.assessments[0].name,'A-winner');
        await b.query('rollback');
        return {pidA,pidB,blockingObserved:true,winnerRevision:1,loserConflict:true};
      } finally {
        await a.query('rollback').catch(()=>{});await b.query('rollback').catch(()=>{});
        if(pending)await pending;
        await a.end().catch(()=>{});await b.end().catch(()=>{});
        await cleanup();
      }
    });
  } finally {
    await db.query('rollback').catch(()=>{});
    await db.end();
    fs.writeFileSync(reportPath,JSON.stringify(report,null,2));
    console.log('Report: db-test-report.local.json; cleanup: '+report.cleanup);
  }
}
async function main() {
  const filename=process.env.GPA_TEST_CONFIG||path.join(root,'db-test.local.json');
  if(!fs.existsSync(filename))throw Error('No test configuration. Copy supabase/tests/db-test.example.json to db-test.local.json; no database connection was attempted.');
  const config=validateConfig(JSON.parse(fs.readFileSync(filename,'utf8')));
  await run(config,process.argv.includes('--cleanup'));
}
module.exports={validateConfig};
if(require.main===module)main().catch(e=>{
  // Never log connection objects, credentials, SQL payloads or the config.
  console.error('FAIL: '+(e instanceof assert.AssertionError ? e.message : e.code||'CONFIG_OR_CONNECTION_ERROR'));
  if(!fs.existsSync(process.env.GPA_TEST_CONFIG||path.join(root,'db-test.local.json')))console.error('Missing db-test.local.json; database tests NOT RUN.');
  process.exitCode=1;
});

