(function(root,factory){
 if(typeof module==='object'&&module.exports)module.exports=factory(require('./profile-schema-validator.js').validate);
 else root.GpaRuleValidate=factory(root.GpaProfileSchema);
})(typeof self!=='undefined'?self:this,function(schemaValidate){
 'use strict';
 var STATUSES=['verified','partial','unknown','custom','deprecated'];
 var LEVELS=['higher-diploma','associate-degree','bachelor'];
 function finite(n){return typeof n==='number'&&Number.isFinite(n);}
 function validateProfile(p){
  if(!schemaValidate)return {ok:false,errors:['schema-validator-unavailable']};
  if(!schemaValidate(p))return {ok:false,errors:(schemaValidate.errors||[]).map(function(e){return e.instancePath+' '+e.message;})};
  var errors=[],gs=p.profile.gradeScale;
  if(!p.identity.institutionId.trim()||!p.identity.regulationVersion.trim())errors.push('empty-identity');
  if(p.scopeRef&&Object.keys(p.scopeRef).some(function(k){return !p.scopeRef[k].trim();}))errors.push('empty-scope-ref');
  if(gs){
   var letters=Object.create(null),ranges=[];
   (gs.grades||[]).forEach(function(g){
    if(!g.letter.trim()||letters[g.letter])errors.push('duplicate-or-empty-grade');
    letters[g.letter]=true;
    if((g.minMark!=null)!==(g.maxMark!=null))errors.push('incomplete-mark-range');
    if(g.minMark!=null&&g.maxMark!=null){
     if(!(g.minMark<g.maxMark))errors.push('invalid-mark-range');ranges.push(g);
    }
   });
   ranges.sort(function(a,b){return a.minMark-b.minMark;});
   ranges.forEach(function(g,i){
    if(i&&(g.minMark<ranges[i-1].maxMark||(g.minMark===ranges[i-1].maxMark&&ranges[i-1].maxInclusive===true)))errors.push('overlapping-mark-ranges');
   });
  }
  Object.keys(p.itemStatus).forEach(function(path){
   if(p.itemStatus[path]!=='verified')return;
   var k=path,found=false;
   while(k){if(p.itemSources[k]&&p.itemSources[k].length){found=true;break;}k=k.split('.').slice(0,-1).join('.');}
   if(!found)errors.push('verified-without-source:'+path);
  });
  return {ok:errors.length===0,errors:errors};
 }
 function hasMarkBoundaries(gs){return !!gs&&Array.isArray(gs.grades)&&gs.grades.some(function(g){return finite(g.minMark)&&finite(g.maxMark);});}
 return {validateProfile:validateProfile,hasMarkBoundaries:hasMarkBoundaries,STATUSES:STATUSES,LEVELS:LEVELS};
});
