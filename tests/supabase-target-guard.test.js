'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {validateConfig}=require('../scripts/test-supabase-safety.cjs');
const ref='abcdefghijklmnopqrst';
const cfg=()=>({projectName:'gpa-tracker-test',projectRef:ref,host:'db.'+ref+'.supabase.co',port:5432,database:'postgres',user:'postgres',password:'local-test-placeholder'});
test('DB runner target guard accepts explicit test direct/session targets',()=>{
 assert.equal(validateConfig(cfg()).projectRef,ref);
 assert.equal(validateConfig({...cfg(),host:'aws-0-ap-southeast-1.pooler.supabase.com',user:'postgres.'+ref}).projectRef,ref);
});
test('DB runner rejects production name, mismatched target and transaction pooler',()=>{
 for(const change of [{projectName:'production'},{host:'db.zyxwvutsrqponmlkjihg.supabase.co'},{host:'evil.example'},{port:6543},{host:'aws-0-ap-southeast-1.pooler.supabase.com',user:'postgres.wrong'},{password:''}])assert.throws(()=>validateConfig({...cfg(),...change}));
});
