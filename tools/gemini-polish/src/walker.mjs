// Generic walker: expands the polishableMap path templates against a concrete
// lesson and yields { path, ctx, value } records for each polishable string,
// plus getByPath/setByPath for reassembly.

import {
  LESSON_FIELDS,
  SECTION_COMMON,
  SOURCE_FIELDS,
  POLISHABLE_BY_TYPE,
  KNOWN_NO_EXTRA_PROSE,
} from './polishableMap.mjs';

export function getByPath(obj, pathArr) {
  let cur = obj;
  for (const k of pathArr) {
    if (cur == null) return undefined;
    cur = cur[k];
  }
  return cur;
}

export function setByPath(obj, pathArr, value) {
  let cur = obj;
  for (let i = 0; i < pathArr.length - 1; i++) {
    cur = cur[pathArr[i]];
    if (cur == null) return false;
  }
  cur[pathArr[pathArr.length - 1]] = value;
  return true;
}

// Expand one template (e.g. "data.hints[].markdown") relative to `base` object,
// returning concrete relative path arrays (e.g. [["data","hints",0,"markdown"], ...]).
function expandTemplate(base, template) {
  const segments = template.split('.');
  const results = [];

  function recurse(node, segIdx, acc) {
    if (segIdx === segments.length) {
      results.push(acc);
      return;
    }
    let seg = segments[segIdx];
    const isArray = seg.endsWith('[]');
    if (isArray) seg = seg.slice(0, -2);
    if (node == null) return;
    const child = node[seg];
    if (isArray) {
      if (!Array.isArray(child)) return;
      for (let i = 0; i < child.length; i++) {
        recurse(child[i], segIdx + 1, [...acc, seg, i]);
      }
    } else {
      recurse(child, segIdx + 1, [...acc, seg]);
    }
  }

  recurse(base, 0, []);
  return results;
}

function pushField(out, lesson, absPath, ctx) {
  const value = getByPath(lesson, absPath);
  if (typeof value === 'string' && value.trim().length > 0) {
    out.push({ path: absPath, ctx, value });
  }
}

/**
 * Collect every polishable string field in a lesson, in a stable order.
 * Each record: { path: (string|number)[], ctx: {kind, type, field, label}, value }
 */
export function collectFields(lesson, { warn = () => {} } = {}) {
  const out = [];

  // Lesson-level fields.
  for (const f of LESSON_FIELDS) {
    pushField(out, lesson, [f], { kind: 'lesson', field: f, label: `lesson.${f}` });
  }
  // Lesson-level sources.
  if (Array.isArray(lesson.sources)) {
    lesson.sources.forEach((_, i) => {
      for (const f of SOURCE_FIELDS) {
        pushField(out, lesson, ['sources', i, f], {
          kind: 'source',
          field: f,
          label: `lesson.sources[${i}].${f}`,
        });
      }
    });
  }

  const sections = Array.isArray(lesson.sections) ? lesson.sections : [];
  sections.forEach((section, si) => {
    const type = section?.type;
    // Common section fields.
    for (const f of SECTION_COMMON) {
      pushField(out, lesson, ['sections', si, f], {
        kind: 'section',
        type,
        field: f,
        label: `sections[${si}](${type}).${f}`,
      });
    }
    // Type-specific fields.
    const templates = POLISHABLE_BY_TYPE[type];
    if (!templates) {
      if (type && !KNOWN_NO_EXTRA_PROSE.has(type)) {
        warn(`unmapped section type "${type}" at sections[${si}] — only title/description polished`);
      }
    } else {
      for (const tpl of templates) {
        for (const rel of expandTemplate(section, tpl)) {
          const absPath = ['sections', si, ...rel];
          pushField(out, lesson, absPath, {
            kind: 'section',
            type,
            field: tpl,
            label: `sections[${si}](${type}).${rel.join('.')}`,
          });
        }
      }
    }
    // Section-level sources.
    if (Array.isArray(section.sources)) {
      section.sources.forEach((_, i) => {
        for (const f of SOURCE_FIELDS) {
          pushField(out, lesson, ['sections', si, 'sources', i, f], {
            kind: 'source',
            field: f,
            label: `sections[${si}].sources[${i}].${f}`,
          });
        }
      });
    }
  });

  return out;
}
