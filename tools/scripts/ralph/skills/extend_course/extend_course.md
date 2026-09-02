---
name: extend_course
description: "Propose an extended course schema given the existing course.json (with module + lesson titles and descriptions) plus a free-text user instruction describing what to add. Read-only: emits a single JSON object on stdout — never writes files, never generates lesson content. Triggers on: extend course, extend_course, propose extension, add modules, add lessons."
user-invocable: true
---

# Extend Course

Propose an **extended** course schema. The user has an existing course on disk and wants to add new modules and/or lessons via a free-text instruction. Your job is to merge the request into the schema and emit the result as a single JSON object on stdout. **You do not write any files, you do not generate lesson content.** Persistence is handled by a separate downstream route.

This skill is invoked by the webapp's `POST /api/courses/<slug>/extend` route. The route hands you a JSON input on stdin (or as the `-p` prompt argument) and parses your stdout JSON back out. If your stdout cannot be parsed, the route returns 422 to the client — keep the output strict.

---

## Input

A single JSON object with this shape:

```json
{
  "currentSchema": { /* full course.json validated by CourseSchema (src/lib/schemas/course.ts) */
    "schemaVersion": 1,
    "slug": "...",
    "title": "...",
    "description": "...",
    "accentColor": "default" | "indigo" | "emerald" | "terracotta" | "black",
    "icon": "...",
    "modules": [
      {
        "id": "m1",
        "title": "...",
        "summary": "...",
        "lessons": [
          { "slug": "...", "title": "...", "estimatedMinutes": 12, "description": "..." }
        ]
      }
    ],
    "createdAt": "...",
    "updatedAt": "..."
  },
  "instruction": "<user's free-text instruction describing what to add>",
  "refinements": [                 /* optional, US-145 chat-history for iterative refinement */
    { "role": "user", "content": "<follow-up message>" }
  ]
}
```

**About `description` on lessons:** `CourseSchema` does not currently store per-lesson descriptions on disk (it stores `slug`, `title`, `estimatedMinutes`). The route augments each lesson entry with the `description` field read from the corresponding lesson JSON's `description` so you have the context to plan good additions. When you write `proposedSchema` back out, include each existing lesson's `description` verbatim and add a `description` for every new lesson too.

---

## Output

A **single JSON object on stdout** — nothing else. No leading prose, no markdown code fences, no trailing commentary. The route reads stdout and pipes it directly into a Zod parser; any extra characters cause a 422.

```json
{
  "proposedSchema": { /* the full Course object — same shape as `currentSchema`, with new modules and/or lessons appended */ },
  "additions": {
    "newModuleIds": ["m4", "m5"],
    "newLessonIds": [
      {
        "moduleId": "m2",
        "lessonSlug": "advanced-edge-cases",
        "lessonTitle": "Advanced edge cases",
        "lessonDescription": "Explores corner cases of … so the learner can …"
      }
    ],
    "rationale": "Why these additions match the user's instruction in 1–3 sentences."
  }
}
```

The `additions` block is the diff for the UI to highlight. `newModuleIds` lists the IDs of modules that did not exist in `currentSchema.modules`. `newLessonIds` lists every newly-added lesson — `moduleId` is its parent module's ID (which itself may be new), `lessonSlug` is the lesson's slug, `lessonTitle` and `lessonDescription` mirror the same values you wrote into `proposedSchema`.

---

## Rules

1. **Preserve every existing module and lesson, byte-for-byte.** Do NOT rename modules, do NOT rename lessons, do NOT change `id`, `slug`, `title`, `summary`, `description`, `estimatedMinutes`, `accentColor`, `icon`, `createdAt`, or any other existing field. Additions only.
2. **`updatedAt`** on the course root may be refreshed to the current ISO 8601 timestamp. All other top-level fields stay unchanged.
3. **New module IDs** must be unique within the course and follow the existing pattern (`m<N>` where `N` is one greater than the current max). Example: existing `["m1", "m2", "m3"]` → next is `m4`.
4. **New lesson slugs** must be unique within the course (across all modules) and derived via the same slugify rule as `design_course`: lowercase, replace whitespace with `-`, strip non `[a-z0-9-]`, collapse repeated `-`, trim leading/trailing `-`.
5. **`estimatedMinutes`** on new lessons should be a positive integer in 5–30 (typical lesson sizing).
6. **Module placement.** If the user's instruction implies a new theme (e.g. "add a chapter on …"), create a new module. If the instruction is "add lessons about X to module Y", append lessons to the existing module Y.
7. **`refinements`** (when present) are follow-up messages from the user about a previous extend proposal. Treat them as additional context layered on top of `instruction` — the user is iterating on the same extension, not starting fresh.
8. **Do not** read or write any files. Do not invoke other skills. Do not use the Bash tool. Your only job is to produce the JSON object on stdout.
9. **JSON only on stdout.** The very first character of your output must be `{` and the very last must be `}`. No fences, no prose.

---

## Worked Example

**Input** (abbreviated):

```json
{
  "currentSchema": {
    "schemaVersion": 1,
    "slug": "edge-detection-basics",
    "title": "Edge Detection Basics",
    "description": "How edge detectors find boundaries in images.",
    "accentColor": "indigo",
    "icon": "scan-line",
    "modules": [
      {
        "id": "m1",
        "title": "Gradients in images",
        "summary": "What it means to take a derivative of an image.",
        "lessons": [
          { "slug": "what-is-an-image-gradient", "title": "What is an image gradient?", "estimatedMinutes": 10, "description": "Discrete derivatives in 2D and what they mean." },
          { "slug": "sobel-and-prewitt-operators", "title": "Sobel and Prewitt operators", "estimatedMinutes": 12, "description": "Kernels, separability, magnitude/direction." }
        ]
      }
    ],
    "createdAt": "2026-04-15T10:05:00.000Z",
    "updatedAt": "2026-04-15T10:05:00.000Z"
  },
  "instruction": "Add a module covering the Canny edge detector and its hysteresis step."
}
```

**Output**:

```json
{
  "proposedSchema": {
    "schemaVersion": 1,
    "slug": "edge-detection-basics",
    "title": "Edge Detection Basics",
    "description": "How edge detectors find boundaries in images.",
    "accentColor": "indigo",
    "icon": "scan-line",
    "modules": [
      {
        "id": "m1",
        "title": "Gradients in images",
        "summary": "What it means to take a derivative of an image.",
        "lessons": [
          { "slug": "what-is-an-image-gradient", "title": "What is an image gradient?", "estimatedMinutes": 10, "description": "Discrete derivatives in 2D and what they mean." },
          { "slug": "sobel-and-prewitt-operators", "title": "Sobel and Prewitt operators", "estimatedMinutes": 12, "description": "Kernels, separability, magnitude/direction." }
        ]
      },
      {
        "id": "m2",
        "title": "From gradients to edges",
        "summary": "Turning a gradient map into a clean edge map; the full Canny pipeline.",
        "lessons": [
          { "slug": "non-maximum-suppression-and-thresholding", "title": "Non-maximum suppression and thresholding", "estimatedMinutes": 12, "description": "Thinning a gradient map into one-pixel edges." },
          { "slug": "the-canny-edge-detector", "title": "The Canny edge detector", "estimatedMinutes": 15, "description": "Putting it all together: blur → gradient → NMS → hysteresis." }
        ]
      }
    ],
    "createdAt": "2026-04-15T10:05:00.000Z",
    "updatedAt": "2026-05-08T12:00:00.000Z"
  },
  "additions": {
    "newModuleIds": ["m2"],
    "newLessonIds": [
      { "moduleId": "m2", "lessonSlug": "non-maximum-suppression-and-thresholding", "lessonTitle": "Non-maximum suppression and thresholding", "lessonDescription": "Thinning a gradient map into one-pixel edges." },
      { "moduleId": "m2", "lessonSlug": "the-canny-edge-detector", "lessonTitle": "The Canny edge detector", "lessonDescription": "Putting it all together: blur → gradient → NMS → hysteresis." }
    ],
    "rationale": "The instruction asked for a Canny module; I added m2 with the two natural lessons (NMS+thresholding, then the full Canny pipeline) so the existing gradients module flows directly into Canny."
  }
}
```

---

## Checklist Before Emitting

- [ ] Every module and lesson from `currentSchema.modules` appears in `proposedSchema.modules` with identical fields.
- [ ] Every new lesson has a unique slug derived via slugify().
- [ ] Every new module has a unique `id` of the form `m<N>` continuing the existing sequence.
- [ ] `additions.newModuleIds` and `additions.newLessonIds` are consistent with what changed in `proposedSchema`.
- [ ] Stdout starts with `{` and ends with `}` — no markdown fences, no leading or trailing prose.
