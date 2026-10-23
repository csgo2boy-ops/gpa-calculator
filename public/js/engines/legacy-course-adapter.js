(function(root,factory){
 if(typeof module==='object'&&module.exports)module.exports=factory();
 else root.GpaLegacyCourseAdapter=factory();
})(typeof self!=='undefined'?self:this,function(){
 'use strict';
 // Legacy officialGP was derived from marks. It is not evidence of an official
 // letter grade. Never reverse-map it or manufacture a non-repeat declaration.
 function adapt(course){
  course=course||{};
  var included=course.gpaInclusion==='include'?true:course.gpaInclusion==='exclude'?false:null;
  return {
   id:course.id,units:course.units===undefined?course.credits:course.units,
   officialGrade:typeof course.officialGrade==='string'?course.officialGrade:null,
   included:typeof course.included==='boolean'?course.included:included,
   repeatStatus:['not-repeat','repeat'].indexOf(course.repeatStatus)>=0?course.repeatStatus:'unknown',
   legacyOfficialGP:course.officialGP==null?null:course.officialGP,
   needsOfficialGradeConfirmation:!course.officialGrade
  };
 }
 return {adapt:adapt};
});
