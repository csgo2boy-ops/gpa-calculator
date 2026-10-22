(function(root,factory){
 if(typeof module==='object'&&module.exports)module.exports=factory(require('../rules/rule-utils.js'));
 else root.GpaAggregationEngine=factory(root.GpaRuleUtils);
})(typeof self!=='undefined'?self:this,function(U){
 'use strict';
 var FORMULAS=['weighted-points-over-attempted-units','weighted-points-over-graded-units'];
 function computeGpa(courses,r){
  var f=r&&r.fields||{},gs=f.gradeScale,gr=f.gpaRules,skippedFields=[],skippedCourses=[],computedCourses=[],states=[];
  function blocked(path){return !U.usable(U.statusOf(r,path));}
  if(!gs||!Array.isArray(gs.grades)||blocked('gradeScale'))skippedFields.push('gradeScale');
  if(!gr||FORMULAS.indexOf(gr.formula)<0||blocked('gpaRules.formula'))skippedFields.push('gpaRules');
  if(!Array.isArray(courses))skippedFields.push('invalid-courses');
  if(skippedFields.length)return {value:null,computedFields:[],skippedFields:skippedFields,computedCourses:[],skippedCourses:[],status:'unknown'};
  states.push(U.statusOf(r,'gradeScale'),U.statusOf(r,'gpaRules'),U.statusOf(r,'gpaRules.formula'));
  var gpMap=Object.create(null);
  gs.grades.forEach(function(g){gpMap[g.letter]=g.gp;});
  var nonCounted=gs.nonCountedLetters||[],candidates=[];
  function skip(c,reason){skippedCourses.push({id:c&&c.id!=null?c.id:null,reason:reason});}
  courses.forEach(function(c){
   if(!c||typeof c!=='object'){skip(c,'invalid');return;}
   if(c.included===false){skip(c,'excluded');return;}
   if(c.included!==true){skip(c,'inclusion-unknown');return;}
   if(!U.finite(c.units)||c.units<0){skip(c,'invalid-units');return;}
   if(c.units===0){skip(c,'zero-units');return;}
   if(!c.officialGrade){skip(c,'no-official-grade');return;}
   if(nonCounted.indexOf(c.officialGrade)>=0){skip(c,'non-counted-grade');return;}
   var gp=gpMap[c.officialGrade];
   if(!U.finite(gp)||gp<0){skip(c,'unknown-grade');return;}
   if(c.policyExcluded===true){
    if(blocked('gpaRules.includeExcludedCourses')||typeof gr.includeExcludedCourses!=='boolean'){skip(c,'excluded-inclusion-unknown');return;}
    states.push(U.statusOf(r,'gpaRules.includeExcludedCourses'));
    if(!gr.includeExcludedCourses){skip(c,'excluded');return;}
   }
   if(c.repeatStatus!=='not-repeat'&&c.repeatStatus!=='repeat'){skip(c,'repeat-status-unknown');return;}
   if(gp===0){
    if(blocked('gpaRules.includeFailedCourses')||typeof gr.includeFailedCourses!=='boolean'){skip(c,'failed-inclusion-unknown');return;}
    states.push(U.statusOf(r,'gpaRules.includeFailedCourses'));
    if(!gr.includeFailedCourses){skip(c,'failed-excluded');return;}
   }
   if(c.repeatStatus==='repeat'){
    var rr=f.repeatRules;
    if(!rr||blocked('repeatRules.gradeReplacementPolicy')||rr.gradeReplacementPolicy==='unknown'){skip(c,'repeat-policy-unknown');return;}
    // The current course contract cannot prove complete ordered attempt groups.
    // Keep-all is safe only when explicitly verified/custom/partial; other modes fail closed.
    if(rr.gradeReplacementPolicy!=='keep-all'){skip(c,'unsupported-repeat-policy');return;}
    states.push(U.statusOf(r,'repeatRules.gradeReplacementPolicy'));
   }
   candidates.push({id:c.id,letter:c.officialGrade,gp:gp,units:c.units});
  });
  var numerator=0,denominator=0;
  candidates.forEach(function(c){numerator+=c.gp*c.units;denominator+=c.units;computedCourses.push(c);});
  if(!U.finite(numerator)||!U.finite(denominator)||denominator<=0)return {value:null,computedFields:[],skippedFields:['no-valid-courses'],computedCourses:[],skippedCourses:skippedCourses,status:'unknown'};
  var raw=numerator/denominator,value=raw,roundingApplied=false;
  var rounding=gr.rounding;
  if(rounding&& !blocked('gpaRules.rounding.method') && !blocked('gpaRules.rounding.dp') &&
    ['half-up','truncate','none'].indexOf(rounding.method)>=0&&Number.isInteger(rounding.dp)&&rounding.dp>=0&&rounding.dp<=4){
   var scale=Math.pow(10,rounding.dp);
   if(rounding.method==='half-up')value=Math.round((raw+Number.EPSILON)*scale)/scale;
   if(rounding.method==='truncate')value=Math.trunc(raw*scale)/scale;
   roundingApplied=true;states.push(U.statusOf(r,'gpaRules.rounding.method'),U.statusOf(r,'gpaRules.rounding.dp'));
  }else{skippedFields.push('gpaRules.rounding');states.push('partial');}
  // Excluded and non-counted grades are intentional policy exclusions, not missing coverage.
  if(skippedCourses.some(function(s){return ['excluded','non-counted-grade','zero-units','failed-excluded'].indexOf(s.reason)<0;}))states.push('partial');
  return {value:value,rawValue:raw,roundingApplied:roundingApplied,computedFields:['officialGpa'],skippedFields:skippedFields,computedCourses:computedCourses,skippedCourses:skippedCourses,status:U.combine(states),formula:gr.formula};
 }
 return {computeGpa:computeGpa};
});
