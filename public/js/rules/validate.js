(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.GpaRuleValidate = factory(root);
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var STATUSES = ['verified', 'partial', 'unknown', 'custom', 'deprecated'];
  var LEVELS = ['higher-diploma', 'associate-degree', 'bachelor'];
  var FORMULAS = ['weighted-points-over-attempted-units', 'weighted-points-over-graded-units', 'unknown'];

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  function validateProfile(p) {
    var errors = [];
    if (!isObj(p)) return { ok: false, errors: ['profile must be an object'] };
    if (!Number.isInteger(p.schemaVersion) || p.schemaVersion < 1) errors.push('schemaVersion must be >= 1');
    var id = p.identity;
    if (!isObj(id)) errors.push('identity missing');
    else {
      if (typeof id.institutionId !== 'string' || !id.institutionId) errors.push('identity.institutionId required');
      if (LEVELS.indexOf(id.qualificationLevel) < 0) errors.push('identity.qualificationLevel invalid');
      if (!(id.admissionYear === null || Number.isInteger(id.admissionYear))) errors.push('identity.admissionYear invalid');
      if (typeof id.regulationVersion !== 'string' || !id.regulationVersion) errors.push('identity.regulationVersion required');
    }
    if (['institution', 'programme', 'subject'].indexOf(p.scope) < 0) errors.push('scope invalid');
    if (p.scope === 'programme' && !(isObj(p.scopeRef) && typeof p.scopeRef.programmeId === 'string')) errors.push('scopeRef.programmeId required for programme scope');
    if (p.scope === 'subject' && !(isObj(p.scopeRef) && typeof p.scopeRef.subjectCode === 'string')) errors.push('scopeRef.subjectCode required for subject scope');
    if (!isObj(p.profile)) errors.push('profile missing');
    if (!isObj(p.itemStatus)) errors.push('itemStatus missing');
    else {
      Object.keys(p.itemStatus).forEach(function (k) {
        if (STATUSES.indexOf(p.itemStatus[k]) < 0) errors.push('itemStatus.' + k + ' invalid');
      });
    }
    var gs = p.profile && p.profile.gradeScale;
    if (gs != null) {
      if (!isObj(gs) || !Array.isArray(gs.grades) || gs.grades.length === 0) errors.push('profile.gradeScale.grades required');
      else {
        gs.grades.forEach(function (g, i) {
          if (!isObj(g) || typeof g.letter !== 'string' || !g.letter) errors.push('gradeScale.grades[' + i + '].letter required');
          if (!isObj(g) || !isNum(g.gp)) errors.push('gradeScale.grades[' + i + '].gp must be a number');
          if (g && g.minMark != null && !isNum(g.minMark)) errors.push('gradeScale.grades[' + i + '].minMark invalid');
          if (g && g.maxMark != null && !isNum(g.maxMark)) errors.push('gradeScale.grades[' + i + '].maxMark invalid');
          if (g && isNum(g.minMark) && isNum(g.maxMark) && !(g.minMark < g.maxMark)) errors.push('gradeScale.grades[' + i + '] minMark must be < maxMark');
        });
      }
    }
    var gr = p.profile && p.profile.gpaRules;
    if (gr != null) {
      if (!isObj(gr)) errors.push('profile.gpaRules invalid');
      else if (gr.formula != null && FORMULAS.indexOf(gr.formula) < 0) errors.push('gpaRules.formula invalid');
    }
    return { ok: errors.length === 0, errors: errors };
  }

  function hasMarkBoundaries(gradeScale) {
    if (!gradeScale || !Array.isArray(gradeScale.grades)) return false;
    return gradeScale.grades.some(function (g) { return isNum(g.minMark) && isNum(g.maxMark); });
  }

  return { validateProfile: validateProfile, hasMarkBoundaries: hasMarkBoundaries, STATUSES: STATUSES, LEVELS: LEVELS };

});
