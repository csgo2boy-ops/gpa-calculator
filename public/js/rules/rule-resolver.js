(function(root,factory){
 if(typeof module==='object'&&module.exports)module.exports=factory(require('./validate.js'),require('./rule-utils.js'));
 else root.GpaRuleResolver=factory(root.GpaRuleValidate,root.GpaRuleUtils);
})(typeof self!=='undefined'?self:this,function(Validate,U){
 'use strict';
 var FIELD_NAMES=['gradeScale','gpaRules','repeatRules','scoreToGrade','attendancePolicy','assessmentPolicy','applicability'];
 // Missing children inherit. Arrays replace atomically. Null, unknown or deprecated
 // explicitly clears a path and its inherited metadata; sources follow each leaf.
 function resolve(request,profiles){
  request=request||{};
  var req={institutionId:request.institutionId,qualificationLevel:request.qualificationLevel,admissionYear:request.admissionYear==null?null:Number(request.admissionYear),regulationVersion:request.regulationVersion};
  var warnings=[],fields={},status={},sources={},layers=[];
  FIELD_NAMES.forEach(function(f){status[f]='unknown';sources[f]=[];});
  var valid=(profiles||[]).filter(function(p){
   if(!Validate||!Validate.validateProfile(p).ok){warnings.push('invalid-profile');return false;}
   return Object.keys(req).every(function(k){return p.identity[k]===req[k];});
  });
  function erase(path){Object.keys(status).forEach(function(k){if(k.indexOf(path+'.')===0){delete status[k];delete sources[k];}});}
  function meta(map,path,fallback){
   while(path){if(Object.prototype.hasOwnProperty.call(map,path))return map[path];path=path.split('.').slice(0,-1).join('.');}
   return fallback;
  }
  function clearAll(){FIELD_NAMES.forEach(function(f){fields[f]=null;erase(f);status[f]='unknown';sources[f]=[];});}
  ['institution','programme','subject'].forEach(function(scope){
   var matches=valid.filter(function(p){
    if(p.scope!==scope)return false;
    if(scope==='programme')return request.programmeId&&p.scopeRef.programmeId===request.programmeId;
    if(scope==='subject')return request.subjectCode&&p.scopeRef.subjectCode===request.subjectCode;
    return true;
   });
   if(matches.length!==1){if(matches.length>1){warnings.push('ambiguous-'+scope);clearAll();}return;}
   var layer=matches[0];layers.push({scope:scope,scopeRef:layer.scopeRef||null});
   function merge(path,value){
    var declared=meta(layer.itemStatus,path,undefined);
    var st=value==null?'unknown':declared,src=meta(layer.itemSources,path,[]);
    if(st==='unknown'||st==='deprecated'||value==null){U.set(fields,path,null);erase(path);status[path]=st;sources[path]=src.slice();return;}
    if(typeof value==='object'&&!Array.isArray(value)){
     if(!U.get(fields,path))U.set(fields,path,{});
     if(st!==undefined){status[path]=st;sources[path]=src.slice();}
     Object.keys(value).forEach(function(k){merge(path+'.'+k,value[k]);});
    }else{U.set(fields,path,JSON.parse(JSON.stringify(value)));erase(path);status[path]=st||'unknown';sources[path]=src.slice();}
   }
   Object.keys(layer.profile).forEach(function(f){merge(f,layer.profile[f]);});
   Object.keys(layer.itemStatus).forEach(function(path){
    if(U.get(layer.profile,path)===undefined&&['unknown','deprecated'].indexOf(layer.itemStatus[path])>=0){
     U.set(fields,path,null);erase(path);status[path]=layer.itemStatus[path];sources[path]=meta(layer.itemSources,path,[]).slice();
    }
   });
  });
  if(fields.applicability&&U.usable(U.statusOf({status:status},'applicability'))){
   var app=fields.applicability;
   if((app.requiresProgrammeConfirmation&&(!request.programmeId||request.programmeCategory!=='non-medical'||request.campus!=='hong-kong'))||(app.excludedProgrammeIds||[]).indexOf(request.programmeId)>=0||(app.excludedCampuses||[]).indexOf(request.campus)>=0){
    warnings.push('applicability-unconfirmed-or-excluded');clearAll();
   }
  }
  return {identity:req,fields:fields,status:status,sources:sources,layers:layers,warnings:warnings};
 }
 return {resolve:resolve,FIELD_NAMES:FIELD_NAMES};
});
