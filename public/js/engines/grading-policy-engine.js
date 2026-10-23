(function(root,factory){
 if(typeof module==='object'&&module.exports)module.exports=factory(require('../rules/rule-utils.js'));
 else root.GpaGradingPolicyEngine=factory(root.GpaRuleUtils);
})(typeof self!=='undefined'?self:this,function(U){
 'use strict';
 function toGrade(score,r){
  function no(reason){return {grade:null,gp:null,reason:reason,status:'unknown'};}
  if(!U.finite(score)||score<0||score>100)return no('invalid-score');
  var gs=r&&r.fields&&r.fields.gradeScale;
  if(!gs)return no('no-grade-scale');
  if(!U.usable(U.statusOf(r,'gradeScale')))return no('unverified-grade-scale');
  var grades=gs.grades||[],bounded=grades.filter(function(g){return U.finite(g.minMark)&&U.finite(g.maxMark);});
  if(!bounded.length)return no('no-mark-boundaries');
  var policy=r.fields.scoreToGrade;
  if(!policy||policy.available!==true||!U.usable(U.statusOf(r,'scoreToGrade.available')))return no('score-to-grade-unavailable');
  var matching=bounded.filter(function(g){return score>=g.minMark&&(score<g.maxMark||(score===g.maxMark&&g.maxInclusive===true));});
  if(matching.length!==1)return no(matching.length?'ambiguous-mark-range':'out-of-range');
  var g=matching[0];
  return {grade:g.letter,gp:g.gp,reason:'mark-range',predicted:true,status:U.combine([U.statusOf(r,'gradeScale'),U.statusOf(r,'scoreToGrade.available')])};
 }
 function gpOf(letter,r){
  var gs=r&&r.fields&&r.fields.gradeScale;
  if(!gs||!U.usable(U.statusOf(r,'gradeScale')))return null;
  var g=(gs.grades||[]).find(function(g){return g.letter===letter;});
  return g&&U.finite(g.gp)?g.gp:null;
 }
 return {toGrade:toGrade,gpOf:gpOf};
});
