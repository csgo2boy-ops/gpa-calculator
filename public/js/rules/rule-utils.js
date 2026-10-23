(function(root,factory){
 if(typeof module==='object'&&module.exports)module.exports=factory();
 else root.GpaRuleUtils=factory();
})(typeof self!=='undefined'?self:this,function(){
 'use strict';
 function statusOf(r,path){
  var s=r&&r.status||{};
  while(path){if(Object.prototype.hasOwnProperty.call(s,path))return s[path];path=path.split('.').slice(0,-1).join('.');}
  return 'unknown';
 }
 function usable(s){return ['verified','partial','custom'].indexOf(s)>=0;}
 function combine(ss){
  if(ss.some(function(s){return s==='custom';}))return 'custom';
  return ss.some(function(s){return s!=='verified';})?'partial':'verified';
 }
 function get(o,path){return path.split('.').reduce(function(v,k){return v==null?undefined:v[k];},o);}
 function set(o,path,v){
  var ks=path.split('.'),last=ks.pop();
  ks.forEach(function(k){if(!o[k]||typeof o[k]!=='object')o[k]={};o=o[k];});o[last]=v;
 }
 function finite(n){return typeof n==='number'&&Number.isFinite(n);}
 return {statusOf:statusOf,usable:usable,combine:combine,get:get,set:set,finite:finite};
});
