'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const Ajv=require('ajv/dist/2020');
const schema=require('../public/rules/schema/rule-profile.schema.json');
const V=require('../public/js/rules/validate');
const R=require('../public/js/rules/rule-resolver');
const G=require('../public/js/engines/gpa-aggregation-engine');
const A=require('../public/js/engines/attendance-policy');
const E=require('../public/js/engines/assessment-engine');
const T=require('../public/js/engines/grading-policy-engine');
const S=require('../public/js/engines/scenario-engine');
const Adapter=require('../public/js/engines/legacy-course-adapter');
const Storage=require('../public/storage');
const c=require('../public/rules/cuhk-undergraduate-2026-27.json');
const v=require('../public/rules/vtc-higher-diploma-ba114062-2023.json');
const copy=x=>structuredClone(x);
const req=()=>({...c.identity,programmeId:'general',programmeCategory:'non-medical',campus:'hong-kong'});
const cr=()=>R.resolve(req(),[c]);
const vr=()=>R.resolve({...v.identity,programmeId:'BA114062'},[v]);
const safe=(x={})=>({id:1,units:3,officialGrade:'A',included:true,repeatStatus:'not-repeat',...x});
const custom=(scope,profile,itemStatus,scopeRef)=>({schemaVersion:1,identity:copy(c.identity),scope,scopeRef,profile,itemStatus,itemSources:{}});
function configured(){
 const r=cr();
 r.fields.gpaRules.rounding={method:'half-up',dp:2};
 r.status['gpaRules.rounding']='custom';
 return r;
}
const schemaValidate=new Ajv({allErrors:true,strict:true,strictRequired:false}).compile(schema);

test('Draft 2020-12 really validates all seeds and permits documented notes',()=>{
 for(const p of [c,v,require('../public/rules/cuhk-undergraduate-2021-22.json')]){
  assert.equal(schemaValidate(p),true,JSON.stringify(schemaValidate.errors));
  assert.equal(V.validateProfile(p).ok,true);
 }
 const bad=copy(v);bad.unlisted=true;
 assert.equal(schemaValidate(bad),false);
 assert.equal(V.validateProfile(bad).ok,false);
});
test('Schema rejects unsupported versions, missing sources and mismatched scope refs',()=>{
 for(const mutate of [p=>p.schemaVersion=2,p=>delete p.itemSources,p=>p.scopeRef={subjectCode:'X'}]){
  const p=copy(v);mutate(p);assert.equal(V.validateProfile(p).ok,false);
 }
});
test('Schema rejects invalid policies and rounding',()=>{
 for(const mutate of [
  p=>p.profile.attendancePolicy.countingUnit='bogus',
  p=>p.profile.attendancePolicy.attendanceThresholdPercent=150,
  p=>p.profile.attendancePolicy.lateWeight=-1,
  p=>p.profile.attendancePolicy.sessionMinutes=0,
  p=>p.profile.gpaRules.rounding={method:'bankers',dp:2},
  p=>p.profile.gpaRules.rounding={method:'half-up',dp:5},
  p=>p.profile.assessmentPolicy.formPassThreshold=101
 ]){const p=copy(v);mutate(p);assert.equal(V.validateProfile(p).ok,false);}
});
test('Semantic validation rejects overlapping and duplicate grades',()=>{
 let p=copy(v);p.profile.gradeScale.grades[1].maxMark=80;assert.equal(V.validateProfile(p).ok,false);
 p=copy(v);p.profile.gradeScale.grades[1].letter='A';assert.equal(V.validateProfile(p).ok,false);
 p=copy(v);p.profile.gradeScale.grades[1].minMark=null;assert.equal(V.validateProfile(p).ok,false);
});
test('Verified fields require provenance',()=>{
 const p=copy(c);p.itemSources={};assert.equal(V.validateProfile(p).ok,false);
});
test('Invalid profile is ignored and cannot supply a grade scale',()=>{
 const p=copy(v);p.schemaVersion=99;
 const r=R.resolve({...v.identity,programmeId:'BA114062'},[p]);
 assert.equal(r.fields.gradeScale,undefined);assert.ok(r.warnings.includes('invalid-profile'));
});
test('All three layers preserve sibling values, leaf statuses and sources',()=>{
 const prog=custom('programme',{gpaRules:{rounding:{method:'truncate',dp:1}}},{gpaRules:'custom'},{programmeId:'general'});
 const subj=custom('subject',{gpaRules:{rounding:{dp:3}}},{'gpaRules.rounding.dp':'custom'},{subjectCode:'X'});
 const source={url:'https://example.test/policy',title:'custom policy',accessedAt:'2026-10-23',excerpt:'3 places'};
 subj.itemSources['gpaRules.rounding.dp']=[source];
 const r=R.resolve({...req(),subjectCode:'X'},[c,prog,subj]);
 assert.equal(r.layers.length,3);
 assert.equal(r.fields.gpaRules.formula,c.profile.gpaRules.formula);
 assert.deepEqual(r.fields.gpaRules.rounding,{method:'truncate',dp:3});
 assert.equal(r.status['gpaRules.formula'],'verified');
 assert.equal(r.status['gpaRules.rounding.dp'],'custom');
 assert.deepEqual(r.sources['gpaRules.formula'],c.itemSources['gpaRules.formula']);
 assert.deepEqual(r.sources['gpaRules.rounding.dp'],[source]);
});
test('Null, unknown and deprecated explicitly clear inherited children',()=>{
 for(const [profile,status] of [
  [{gpaRules:{formula:null}},{'gpaRules.formula':'custom'}],
  [{},{'gpaRules.formula':'unknown'}],
  [{},{'gpaRules.formula':'deprecated'}]
 ]){
  const override=custom('subject',profile,status,{subjectCode:'X'});
  const r=R.resolve({...req(),subjectCode:'X'},[c,override]);
  assert.equal(r.fields.gpaRules.formula,null);
  assert.notEqual(r.status['gpaRules.formula'],'verified');
  assert.equal(r.fields.gradeScale.grades[0].gp,4);
  assert.equal(G.computeGpa([safe()],r).value,null);
 }
});
test('Array overrides replace and resolver does not mutate seed data',()=>{
 const before=copy(c);
 const subj=custom('subject',{gradeScale:{nonCountedLetters:['P']}},{gradeScale:'custom'},{subjectCode:'X'});
 const r=R.resolve({...req(),subjectCode:'X'},[c,subj]);
 assert.deepEqual(r.fields.gradeScale.nonCountedLetters,['P']);
 assert.equal(r.fields.gradeScale.grades.length,c.profile.gradeScale.grades.length);
 r.fields.gradeScale.grades[0].gp=9;
 assert.deepEqual(c,before);
});
test('Duplicate matching layer fails closed and identity never crosses versions',()=>{
 const r=R.resolve(req(),[c,copy(c)]);
 assert.equal(r.fields.gradeScale,null);
 assert.equal(R.resolve({...req(),admissionYear:2025},[c]).fields.gradeScale,undefined);
});
test('CUHK blocks unconfirmed scope, medicine and Shenzhen',()=>{
 for(const request of [c.identity,{...req(),programmeId:'medicine'},{...req(),programmeCategory:'medical'},{...req(),campus:'shenzhen'}]){
  assert.equal(G.computeGpa([safe()],R.resolve(request,[c])).value,null);
 }
 assert.equal(G.computeGpa([safe()],cr()).value,4);
});
test('Unknown inclusion and repeat status are skipped with precise reasons',()=>{
 const r=G.computeGpa([safe(),safe({id:2,included:null}),safe({id:3,repeatStatus:'unknown'})],cr());
 assert.equal(r.value,4);assert.equal(r.status,'partial');
 assert.deepEqual(r.skippedCourses.map(x=>x.reason),['inclusion-unknown','repeat-status-unknown']);
});
test('Unknown repeat replacement skips repeated attempts while retaining safe subjects',()=>{
 const r=G.computeGpa([safe(),safe({id:2,repeatStatus:'repeat',officialGrade:'F'}),safe({id:3,repeatStatus:'repeat'})],cr());
 assert.equal(r.value,4);assert.equal(r.computedCourses.length,1);
 assert.equal(r.skippedCourses.filter(x=>x.reason==='repeat-policy-unknown').length,2);
});
test('Explicit keep-all works; unsupported replacement modes never silently count',()=>{
 const r=configured();r.fields.repeatRules.gradeReplacementPolicy='keep-all';r.status['repeatRules.gradeReplacementPolicy']='custom';
 assert.equal(G.computeGpa([safe({repeatStatus:'repeat'})],r).value,4);
 r.fields.repeatRules.gradeReplacementPolicy='replace';
 assert.equal(G.computeGpa([safe({repeatStatus:'repeat'})],r).skippedCourses[0].reason,'unsupported-repeat-policy');
});
test('Reject invalid units, overflow and zero denominator; no GPA 12',()=>{
 for(const units of [-2,Infinity,NaN,'3',null]){
  const r=G.computeGpa([safe(),safe({id:2,officialGrade:'F',units})],cr());
  assert.equal(r.value,4);assert.ok(r.skippedCourses.some(x=>x.reason==='invalid-units'));
 }
 assert.equal(G.computeGpa([safe({units:0})],cr()).value,null);
 assert.equal(G.computeGpa([safe({units:Number.MAX_VALUE})],cr()).value,null);
});
test('Policy formula whitelist and failed-course switch are enforced',()=>{
 const r=configured();
 for(const formula of ['weighted-points-over-attempted-units','weighted-points-over-graded-units']){
  r.fields.gpaRules.formula=formula;
  assert.equal(G.computeGpa([safe(),safe({id:2,officialGrade:'F'})],r).value,2);
  r.fields.gpaRules.includeFailedCourses=false;
  assert.equal(G.computeGpa([safe(),safe({id:2,officialGrade:'F'})],r).value,4);
  r.fields.gpaRules.includeFailedCourses=true;
 }
 r.fields.gpaRules.formula='invented';
 assert.equal(G.computeGpa([safe()],r).value,null);
});
test('Excluded policy must be known, explicit user exclusion always wins',()=>{
 const r=configured();
 assert.equal(G.computeGpa([safe({policyExcluded:true})],r).skippedCourses[0].reason,'excluded-inclusion-unknown');
 r.fields.gpaRules.includeExcludedCourses=true;r.status['gpaRules.includeExcludedCourses']='custom';
 assert.equal(G.computeGpa([safe({policyExcluded:true})],r).value,4);
 assert.equal(G.computeGpa([safe({included:false})],r).value,null);
 r.fields.gpaRules.includeExcludedCourses=false;
 assert.equal(G.computeGpa([safe({policyExcluded:true})],r).value,null);
});
test('Partial and custom policies never produce verified output',()=>{
 for(const status of ['partial','custom']){
  const r=configured();r.status.gradeScale=status;r.status['gpaRules.rounding']=status;
  assert.equal(G.computeGpa([safe()],r).status,status);
 }
});
test('CUHK rounding unknown returns raw GPA with skipped rounding; explicit custom rounding works',()=>{
 const courses=[safe(),safe({id:2,units:2,officialGrade:'B-'})],r=G.computeGpa(courses,cr());
 assert.equal(r.roundingApplied,false);assert.equal(r.value,17.4/5);
 assert.ok(r.skippedFields.includes('gpaRules.rounding'));assert.equal(r.status,'partial');
 const customR=configured();customR.fields.gpaRules.rounding={method:'truncate',dp:1};
 assert.equal(G.computeGpa(courses,customR).value,3.4);
});
test('P/U exclusions do not fabricate missing-grade errors',()=>{
 const r=G.computeGpa([safe(),safe({id:2,officialGrade:'P'}),safe({id:3,officialGrade:null})],cr());
 assert.equal(r.value,4);assert.ok(r.skippedCourses.some(x=>x.reason==='non-counted-grade'));
 assert.ok(r.skippedCourses.some(x=>x.reason==='no-official-grade'));
});
test('Scenario preserves safety declarations and uses predicted field names',()=>{
 const r=S.predictGpa([safe({assumedGrade:'A'})],cr());
 assert.equal(r.predicted,true);assert.deepEqual(r.computedFields,['predictedGpa']);
 assert.equal(S.predictGpa([{units:3,assumedGrade:'A'}],cr()).value,null);
});
test('VTC requires exact programme and has no official GPA formula',()=>{
 assert.equal(R.resolve({...v.identity,programmeId:'IT114105'},[v]).fields.gradeScale,undefined);
 assert.equal(G.computeGpa([safe()],vr()).value,null);
 assert.deepEqual(v.profile.assessmentPolicy,{modulePassThreshold:40,formPassThreshold:40,requireEaPass:true});
});
test('Attendance unknown late, early leave, leave and cancellation never imply a pass',()=>{
 for(const status of ['late','earlyLeave','leave','cancelled']){
  const r=A.compute([{status}],{countingUnit:'session',attendanceThresholdPercent:70});
  assert.equal(r.rate,null);assert.equal(r.meetsThreshold,null);assert.equal(r.status,'unknown');
 }
});
test('Minutes and hybrid do not omit absences with missing durations',()=>{
 for(const countingUnit of ['minute','hybrid']){
  const r=A.compute([{status:'present',sessionMinutes:60},{status:'absent'}],{countingUnit,attendanceThresholdPercent:70});
  assert.equal(r.rate,null);assert.equal(r.meetsThreshold,null);assert.equal(r.status,'insufficient-data');
 }
});
test('Cancelled records counted once, excluded explicitly or included as missed sessions',()=>{
 for(const cancelledExcluded of [true,false]){
  const r=A.compute([{status:'present',sessionMinutes:60},{status:'cancelled',sessionMinutes:60}],{countingUnit:'session',cancelledExcluded});
  assert.equal(r.counts.cancelled,1);assert.equal(r.sessions,cancelledExcluded?1:2);
  assert.equal(r.rate,cancelledExcluded?100:50);
 }
});
test('Unsupported attendance policies are explicit and block judgement',()=>{
 for(const extra of [{classTypes:{lab:{}}},{absenceQuotaSessions:2},{absenceQuotaMinutes:60},{riskTiers:[]},{lateAfterMinutes:5}]){
  const r=A.compute([{status:'present'}],{countingUnit:'session',attendanceThresholdPercent:70,...extra});
  assert.equal(r.meetsThreshold,null);assert.ok(r.issues.some(x=>x.reason.startsWith('unsupported-')));
 }
});
test('Attendance validates thresholds, duration and record status; future unknown cannot certify threshold',()=>{
 for(const [records,policy] of [
  [[{status:'present'}],{countingUnit:'session',attendanceThresholdPercent:150}],
  [[{status:'present',sessionMinutes:-1}],{countingUnit:'minute'}],
  [[{status:'bogus'}],{countingUnit:'session'}]
 ])assert.equal(A.compute(records,policy).status,'invalid');
 const r=A.compute([{status:'present'}],{countingUnit:'session',attendanceThresholdPercent:70,futureTotalSessionsUnknown:true});
 assert.equal(r.status,'incomplete');assert.equal(r.meetsThreshold,null);
});
test('VTC unknown counting basis cannot apply 70% threshold',()=>{
 const r=A.compute([{status:'present'}],vr());
 assert.equal(r.rate,null);assert.equal(r.meetsThreshold,null);
});
test('Partly graded groups remain pending and empty data never passes',()=>{
 const r=E.compute([{assessmentGroup:'CA',weightPercent:10,maxPoints:100,earnedPoints:100},{assessmentGroup:'CA',weightPercent:90,maxPoints:100,earnedPoints:null}],{caPassThreshold:40});
 assert.equal(r.ca.complete,false);assert.equal(r.ca.pass,'pending');assert.equal(r.passGate,'pending');
 assert.notEqual(E.compute([],{}).passGate,'pass');
});
test('Invalid assessment values and total weight never pass',()=>{
 for(const bad of [
  {weightPercent:-1,maxPoints:100,earnedPoints:100},
  {weightPercent:100,maxPoints:0,earnedPoints:0},
  {weightPercent:100,maxPoints:100,earnedPoints:101},
  {weightPercent:100,maxPoints:100,earnedPoints:NaN},
  {weightPercent:50,maxPoints:100,earnedPoints:100}
 ])assert.notEqual(E.compute([{assessmentGroup:'CA',...bad}],{caPassThreshold:40}).passGate,'pass');
});
test('VTC seeded thresholds drive module, assessment forms and required EA gates',()=>{
 const a=(group,w,earned)=>({assessmentGroup:group,weightPercent:w,maxPoints:100,earnedPoints:earned});
 assert.equal(E.compute([a('CA',80,95),a('EA',20,0)],vr()).passGate,'fail');
 assert.equal(E.compute([a('CA',50,80),a('EA',50,80)],vr()).passGate,'pass');
 assert.equal(E.compute([a('CA',100,80)],vr()).passGate,'unknown');
 // A form must not be hidden inside a passing CA average.
 const xs=[{...a('CA',25,20),assessmentFormId:'quiz'},{...a('CA',25,100),assessmentFormId:'project'},a('EA',50,80)];
 assert.equal(E.compute(xs,vr()).passGate,'fail');
});
test('Grading respects disabled/unknown score policy and strict percent bounds',()=>{
 for(const status of ['unknown','deprecated']){
  const r=vr();r.status['scoreToGrade.available']=status;
  assert.equal(T.toGrade(95,r).grade,null);
 }
 const r=vr();r.fields.scoreToGrade.available=false;
 assert.equal(T.toGrade(95,r).grade,null);
 for(const score of [-1,100.4,Infinity,NaN,'95'])assert.equal(T.toGrade(score,vr()).grade,null);
 assert.equal(T.toGrade(100,vr()).grade,'A');
});
test('Every VTC boundary maps correctly, output stays partial and predicted',()=>{
 for(const [score,grade] of [[0,'F'],[39.99,'F'],[40,'D'],[46,'D+'],[50,'C-'],[53,'C'],[57,'C+'],[60,'B-'],[63,'B'],[67,'B+'],[70,'A-'],[75,'A'],[100,'A']]){
  const r=T.toGrade(score,vr());assert.equal(r.grade,grade);assert.equal(r.status,'partial');assert.equal(r.predicted,true);
 }
});
test('Legacy adapter preserves credits and inclusion without promoting calculated GP',()=>{
 const legacy={id:7,credits:3,gpaInclusion:'include',officialMark:95,officialGP:4};
 const before=copy(legacy),adapted=Adapter.adapt(legacy);
 assert.equal(adapted.units,3);assert.equal(adapted.included,true);
 assert.equal(adapted.officialGrade,null);assert.equal(adapted.repeatStatus,'unknown');
 assert.equal(adapted.legacyOfficialGP,4);assert.deepEqual(legacy,before);
 assert.equal(G.computeGpa([adapted],cr()).value,null);
 assert.equal(G.computeGpa([Adapter.adapt({...legacy,officialGrade:'A',repeatStatus:'not-repeat'})],cr()).value,4);
 assert.equal(Adapter.adapt({...legacy,gpaInclusion:'exclude'}).included,false);
 assert.equal(Adapter.adapt({}).included,null);
});
test('All legacy template courses adapt without data loss or invented official grades',()=>{
 const original=Storage.template(),before=copy(original);
 const adapted=original.courses.map(Adapter.adapt);
 assert.equal(adapted.length,34);assert.deepEqual(original,before);
 assert.ok(adapted.every(x=>x.officialGrade===null));
 assert.equal(G.computeGpa(adapted,cr()).value,null);
});
test('Offline browser modules use the compiled schema and enforce the same rules',()=>{
 const ctx=vm.createContext({});
 for(const file of [
  'rules/profile-schema-validator.js','rules/rule-utils.js','rules/validate.js','rules/rule-resolver.js',
  'engines/gpa-aggregation-engine.js','engines/grading-policy-engine.js','engines/assessment-engine.js',
  'engines/attendance-policy.js','engines/scenario-engine.js','engines/legacy-course-adapter.js'
 ])vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/js',file),'utf8'),ctx,{filename:file});
 assert.equal(ctx.GpaRuleValidate.validateProfile(v).ok,true);
 const resolved=ctx.GpaRuleResolver.resolve({...v.identity,programmeId:'BA114062'},[v]);
 assert.equal(ctx.GpaGradingPolicyEngine.toGrade(100,resolved).grade,'A');
 assert.equal(ctx.GpaAggregationEngine.computeGpa([safe()],resolved).value,null);
 const invalid=copy(v);invalid.schemaVersion=2;
 assert.equal(ctx.GpaRuleValidate.validateProfile(invalid).ok,false);
});

test('Leaf-only rounding overrides are usable without promoting the group status',()=>{
 const prog=custom('programme',{gpaRules:{rounding:{method:'truncate',dp:1}}},
  {'gpaRules.rounding.method':'custom','gpaRules.rounding.dp':'custom'},{programmeId:'general'});
 const r=R.resolve(req(),[c,prog]);
 const result=G.computeGpa([safe(),safe({id:2,units:2,officialGrade:'B-'})],r);
 assert.equal(result.value,3.4);assert.equal(result.status,'custom');
 const partial=configured();partial.status.gpaRules='partial';partial.status['gpaRules.rounding']='verified';
 assert.equal(G.computeGpa([safe()],partial).status,'partial');
});

test('Extreme finite inputs do not create non-finite attendance or assessment results',()=>{
 const r=A.compute([{status:'present',sessionMinutes:Number.MAX_VALUE},{status:'absent',sessionMinutes:Number.MAX_VALUE}],
  {countingUnit:'minute',attendanceThresholdPercent:70});
 assert.equal(r.status,'invalid');assert.equal(r.rate,null);assert.equal(r.meetsThreshold,null);
 const s=E.compute([{assessmentGroup:'CA',weightPercent:100,maxPoints:Number.MAX_VALUE,earnedPoints:Number.MAX_VALUE}],{caPassThreshold:40});
 assert.equal(s.secured,100);assert.equal(s.passGate,'pass');
});
