(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.GpaRuleResolver = factory(root);
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var FIELD_NAMES = ['gradeScale', 'gpaRules', 'repeatRules', 'scoreToGrade', 'attendancePolicy'];

  function normIdentity(r) {
    return {
      institutionId: r && r.institutionId,
      qualificationLevel: r && r.qualificationLevel,
      admissionYear: (r && r.admissionYear != null) ? Number(r.admissionYear) : null,
      regulationVersion: r && r.regulationVersion
    };
  }

  function identityMatches(p, req) {
    var id = p.identity || {};
    return id.institutionId === req.institutionId &&
      id.qualificationLevel === req.qualificationLevel &&
      (id.admissionYear == null ? null : Number(id.admissionYear)) === req.admissionYear &&
      id.regulationVersion === req.regulationVersion;
  }

  function findLayer(profiles, req, scope, scopeValue) {
    for (var i = 0; i < (profiles || []).length; i++) {
      var p = profiles[i];
      if (!p || p.scope !== scope) continue;
      if (!identityMatches(p, req)) continue;
      if (scope === 'programme') {
        if (!p.scopeRef || p.scopeRef.programmeId !== scopeValue) continue;
      } else if (scope === 'subject') {
        if (!p.scopeRef || p.scopeRef.subjectCode !== scopeValue) continue;
      }
      return p;
    }
    return null;
  }

  // 三層覆寫：institution -> programme -> subject。只做精確身份比對，不跨年份/版本。
  function resolve(request, profiles) {
    var req = normIdentity(request || {});
    var warnings = [];
    var layers = [];

    var inst = findLayer(profiles, req, 'institution', null);
    if (inst) layers.push(inst);
    else warnings.push('no institution profile for this identity (all fields unknown)');

    if (request && request.programmeId) {
      var prog = findLayer(profiles, req, 'programme', request.programmeId);
      if (prog) layers.push(prog);
      else warnings.push('programme override not found: ' + request.programmeId);
    }
    if (request && request.subjectCode) {
      var subj = findLayer(profiles, req, 'subject', request.subjectCode);
      if (subj) layers.push(subj);
      else warnings.push('subject override not found: ' + request.subjectCode);
    }

    var fields = {}, status = {}, sources = {};
    FIELD_NAMES.forEach(function (f) { status[f] = 'unknown'; sources[f] = []; });

    layers.forEach(function (layer) {
      Object.keys(layer.profile || {}).forEach(function (f) {
        if (layer.profile[f] == null) return;
        fields[f] = layer.profile[f];
        status[f] = (layer.itemStatus && layer.itemStatus[f]) || 'unknown';
        sources[f] = (layer.itemSources && layer.itemSources[f]) || [];
      });
    });

    return {
      identity: req,
      fields: fields,
      status: status,
      sources: sources,
      layers: layers.map(function (l) { return { scope: l.scope, scopeRef: l.scopeRef || null }; }),
      warnings: warnings
    };
  }

  return { resolve: resolve, FIELD_NAMES: FIELD_NAMES };

});
