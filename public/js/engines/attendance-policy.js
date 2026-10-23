(function(root,factory){
 if(typeof module==='object'&&module.exports)module.exports=factory(require('../rules/rule-utils.js'));
 else root.GpaAttendancePolicy=factory(root.GpaRuleUtils);
})(typeof self!=='undefined'?self:this,function(U){
 'use strict';
 var STATUSES=['present','absent','late','earlyLeave','leave','cancelled'];
 function compute(records,policy){
  policy=policy||{};
  if(policy.fields){
   var r=policy;policy=Object.assign({},r.fields.attendancePolicy||{});
   Object.keys(policy).forEach(function(k){if(!U.usable(U.statusOf(r,'attendancePolicy.'+k)))policy[k]=null;});
  }
  var counts={present:0,absent:0,late:0,earlyLeave:0,leave:0,cancelled:0},issues=[];
  var sessions=0,attendedSessions=0,minutes=0,attendedMinutes=0,uncertain=false,missing=false,invalid=false;
  var unit=policy.countingUnit,threshold=policy.attendanceThresholdPercent;
  function issue(reason){issues.push({reason:reason});}
  if(['session','minute','hybrid'].indexOf(unit)<0){uncertain=true;issue('counting-unit-unknown');}
  if(threshold!=null&&(!U.finite(threshold)||threshold<0||threshold>100)){invalid=true;issue('invalid-threshold');}
  ['lateWeight','earlyLeaveWeight'].forEach(function(k){
   if(policy[k]!=null&&(!U.finite(policy[k])||policy[k]<0||policy[k]>1)){invalid=true;issue('invalid-'+k);}
  });
  ['lateCountsAsAbsent','leaveCountsAsAbsent','cancelledExcluded','futureTotalSessionsUnknown'].forEach(function(k){
   if(policy[k]!=null&&typeof policy[k]!=='boolean'){invalid=true;issue('invalid-'+k);}
  });
  ['absenceQuotaSessions','absenceQuotaMinutes'].forEach(function(k){
   if(policy[k]!=null){uncertain=true;issue('unsupported-'+k);}
  });
  if(policy.classTypes&&Object.keys(policy.classTypes).length){uncertain=true;issue('unsupported-class-types');}
  if(policy.riskTiers!=null){uncertain=true;issue('unsupported-risk-tiers');}
  if(policy.lateAfterMinutes!=null){uncertain=true;issue('unsupported-late-after-minutes');}
  if(!Array.isArray(records)){invalid=true;records=[];}
  records.forEach(function(r){
   if(!r||STATUSES.indexOf(r.status)<0){invalid=true;issue('invalid-record');return;}
   counts[r.status]++;
   if(r.status==='cancelled'){
    if(policy.cancelledExcluded===true)return;
    if(policy.cancelledExcluded!==false){uncertain=true;issue('cancelled-policy-unknown');return;}
   }
   sessions++;
   var sm=r.sessionMinutes==null?policy.sessionMinutes:r.sessionMinutes;
   if(sm!=null&&(!U.finite(sm)||sm<=0)){invalid=true;issue('invalid-duration');}
   if(sm==null){missing=true;issue('missing-duration');}
   if(U.finite(sm)&&sm>0)minutes+=sm;
   var weight=null;
   if(r.status==='present')weight=1;
   if(r.status==='absent'||r.status==='cancelled')weight=0;
   if(r.status==='late'){
    if(policy.lateCountsAsAbsent===true)weight=0;
    else if(U.finite(policy.lateWeight))weight=policy.lateWeight;
   }
   if(r.status==='earlyLeave'&&U.finite(policy.earlyLeaveWeight))weight=policy.earlyLeaveWeight;
   if(r.status==='leave'&&typeof policy.leaveCountsAsAbsent==='boolean')weight=policy.leaveCountsAsAbsent?0:1;
   if(weight==null){uncertain=true;issue('attendance-weight-unknown');return;}
   attendedSessions+=weight;if(U.finite(sm)&&sm>0)attendedMinutes+=sm*weight;
  });
  if(!U.finite(minutes)||!U.finite(attendedMinutes)||!U.finite(attendedSessions)){invalid=true;issue('invalid-totals');}
  // Hybrid uses minutes only when every included record has a duration.
  // Never drop undated absences or switch denominators silently.
  var basis=unit==='session'?'session':unit==='minute'||unit==='hybrid'?'minute':null;
  var incomplete=(basis==='minute'&&missing);
  var rate=null,status;
  if(!invalid&&!uncertain&&!incomplete){
   if(basis==='session'&&sessions>0)rate=attendedSessions/sessions*100;
   if(basis==='minute'&&minutes>0)rate=attendedMinutes/minutes*100;
  }
  var meetsThreshold=rate!=null&&U.finite(threshold)?rate>=threshold:null;
  if(invalid)status='invalid';
  else if(uncertain)status='unknown';
  else if(incomplete||rate==null)status='insufficient-data';
  else status=threshold==null?'rate-only':'computed';
  if(policy.futureTotalSessionsUnknown===true){status='incomplete';meetsThreshold=null;}
  return {rate:rate,basis:basis,threshold:threshold==null?null:threshold,meetsThreshold:meetsThreshold,status:status,counts:counts,sessions:sessions,minutes:minutes,attendedSessions:attendedSessions,attendedMinutes:attendedMinutes,issues:issues};
 }
 return {compute:compute,STATUSES:STATUSES};
});
