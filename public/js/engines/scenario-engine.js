(function(root,factory){
 if(typeof module==='object'&&module.exports)module.exports=factory(require('./gpa-aggregation-engine.js'));
 else root.GpaScenarioEngine=factory(root.GpaAggregationEngine);
})(typeof self!=='undefined'?self:this,function(Gpa){
 'use strict';
 function predictGpa(courses,resolution){
  var assumed=Array.isArray(courses)?courses.map(function(c){
   return c&&Object.assign({},c,{officialGrade:c.assumedGrade});
  }):courses;
  var r=Gpa.computeGpa(assumed,resolution);
  return Object.assign({},r,{predicted:true,computedFields:r.value==null?[]:['predictedGpa'],note:'predicted GPA, not official'});
 }
 return {predictGpa:predictGpa};
});
