(function(root,factory){
 if(typeof module==='object'&&module.exports)module.exports=factory(require('../rules/rule-utils.js'));
 else root.GpaAssessmentEngine=factory(root.GpaRuleUtils);
})(typeof self!=='undefined'?self:this,function(U){
 'use strict';
 function compute(assessments,options){
  options=options||{};
  // A resolution may be supplied directly; policy values retain their field status.
  if(options.fields){
   var r=options,p=r.fields.assessmentPolicy||{};
   options={};
   ['modulePassThreshold','formPassThreshold','requireEaPass'].forEach(function(k){
    if(U.usable(U.statusOf(r,'assessmentPolicy.'+k)))options[k]=p[k];
   });
   options.caPassThreshold=options.formPassThreshold;
   options.eaPassThreshold=options.formPassThreshold;
  }
  var caGroups=options.caGroups||['CA','作業','專題'],eaGroups=options.eaGroups||['EA','考試'];
  var issues=[],invalid=false,totalWeight=0,gradedWeight=0,secured=0;
  var acc={ca:{weight:0,gradedWeight:0,earned:0},ea:{weight:0,gradedWeight:0,earned:0},other:{weight:0,gradedWeight:0,earned:0}};
  function thresholdValid(t){return t==null||(U.finite(t)&&t>=0&&t<=100);}
  if(!Array.isArray(caGroups)||!Array.isArray(eaGroups)||caGroups.some(function(g){return eaGroups.indexOf(g)>=0;})){
   invalid=true;issues.push({reason:'invalid-groups'});caGroups=[];eaGroups=[];
  }
  ['caPassThreshold','eaPassThreshold','formPassThreshold','modulePassThreshold'].forEach(function(k){
   if(!thresholdValid(options[k])){invalid=true;issues.push({reason:'invalid-threshold',field:k});}
  });
  if(!Array.isArray(assessments)){invalid=true;assessments=[];}
  var formResults=[];
  assessments.forEach(function(a){
   if(!a||!U.finite(a.weightPercent)||a.weightPercent<0||a.weightPercent>100||
      !U.finite(a.maxPoints)||a.maxPoints<=0||
      (a.earnedPoints!=null&&(!U.finite(a.earnedPoints)||a.earnedPoints<0||a.earnedPoints>a.maxPoints))){
    invalid=true;issues.push({id:a&&a.id,reason:'invalid-assessment'});return;
   }
   var w=a.weightPercent,g=caGroups.indexOf(a.assessmentGroup)>=0?'ca':eaGroups.indexOf(a.assessmentGroup)>=0?'ea':'other';
   totalWeight+=w;acc[g].weight+=w;
   if(a.earnedPoints!=null){
    var score=w*(a.earnedPoints/a.maxPoints);secured+=score;gradedWeight+=w;acc[g].gradedWeight+=w;acc[g].earned+=score;
   }else if(w>0)issues.push({id:a.id,reason:'ungraded'});
   // Records sharing assessmentFormId are one form. Without an id, the group is
   // the form: do not assume every task within coursework is independently gated.
   formResults.push({form:a.assessmentFormId||a.assessmentGroup||'other',w:w,earned:a.earnedPoints==null?null:w*(a.earnedPoints/a.maxPoints)});
  });
  var isWeightValid=Math.abs(totalWeight-100)<1e-7,isGraded=totalWeight>0&&Math.abs(gradedWeight-totalWeight)<1e-7;
  if(!isWeightValid)issues.push({reason:'invalid-total-weight'});
  function group(s,t){
   var pct=s.gradedWeight>0?s.earned/s.gradedWeight*100:null,complete=s.weight>0&&Math.abs(s.gradedWeight-s.weight)<1e-7;
   return {weight:s.weight,gradedWeight:s.gradedWeight,percentage:pct,complete:complete,
    pass:s.weight===0?'n/a':!complete?'pending':t==null?'unknown':pct>=t};
  }
  var ca=group(acc.ca,options.caPassThreshold),ea=group(acc.ea,options.eaPassThreshold),other=group(acc.other,null),passGate;
  if(invalid||!isWeightValid||!totalWeight)passGate='unknown';
  else if(!isGraded)passGate='pending';
  else{
   var gates=[ca.pass,ea.pass];
   if(options.modulePassThreshold!=null)gates.push(secured>=options.modulePassThreshold);
   if(options.requireEaPass===true&&acc.ea.weight===0)gates.push('unknown');
   if(options.formPassThreshold!=null){
    var forms=Object.create(null);
    formResults.forEach(function(x){var v=forms[x.form]||(forms[x.form]={w:0,earned:0});v.w+=x.w;v.earned+=x.earned||0;});
    Object.keys(forms).forEach(function(k){if(forms[k].w>0)gates.push(forms[k].earned/forms[k].w*100>=options.formPassThreshold);});
   }
   passGate=gates.indexOf(false)>=0?'fail':gates.indexOf('unknown')>=0||gates.every(function(g){return g==='n/a';})?'unknown':'pass';
  }
  return {secured:secured,gradedWeight:gradedWeight,ungradedWeight:totalWeight-gradedWeight,maxFinal:secured+totalWeight-gradedWeight,totalWeight:totalWeight,
   isWeightValid:isWeightValid,isGraded:isGraded,passGate:passGate,ca:ca,ea:ea,other:other,issues:issues};
 }
 return {compute:compute};
});
