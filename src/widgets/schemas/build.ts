import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZodSchema } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

import { TheoryDataSchema } from '@/widgets/Theory/schema';
import { QuizDataSchema } from '@/widgets/Quiz/schema';
import { CodeDataSchema } from '@/widgets/Code/schema';
import { CodeClozeDataSchema } from '@/widgets/CodeCloze/schema';
import { DataTableDataSchema } from '@/widgets/DataTable/schema';
import { DemoDataSchema } from '@/widgets/Demo/schema';
import { DragMatchDataSchema } from '@/widgets/DragMatch/schema';
import { SandboxDataSchema } from '@/widgets/Sandbox/schema';
import { HistogramDataSchema } from '@/widgets/Histogram/schema';
import { ParametricExplorerDataSchema } from '@/widgets/ParametricExplorer/schema';
import { PlotImageDataSchema } from '@/widgets/PlotImage/schema';
import { CourseSchema } from '@/lib/schemas/course';
import { LessonSchema } from '@/lib/schemas/lesson';

const widgets: Record<string, ZodSchema> = {
  theory: TheoryDataSchema,
  quiz: QuizDataSchema,
  code: CodeDataSchema,
  'code-cloze': CodeClozeDataSchema,
  demo: DemoDataSchema,
  sandbox: SandboxDataSchema,
  histogram: HistogramDataSchema,
  'plot-image': PlotImageDataSchema,
  'parametric-explorer': ParametricExplorerDataSchema,
  'drag-match': DragMatchDataSchema,
  'data-table': DataTableDataSchema,
};

const topLevel: Record<string, ZodSchema> = {
  course: CourseSchema,
  lesson: LessonSchema,
};

const outDir = dirname(fileURLToPath(import.meta.url));
mkdirSync(outDir, { recursive: true });

for (const [name, schema] of Object.entries(widgets)) {
  const jsonSchema = zodToJsonSchema(schema, { name: `${name}Data`, target: 'jsonSchema7' });
  const outPath = join(outDir, `${name}.json`);
  writeFileSync(outPath, JSON.stringify(jsonSchema, null, 2) + '\n', 'utf8');
  console.log(`wrote ${outPath}`);
}

for (const [name, schema] of Object.entries(topLevel)) {
  const jsonSchema = zodToJsonSchema(schema, { name, target: 'jsonSchema7' });
  const outPath = join(outDir, `${name}.json`);
  writeFileSync(outPath, JSON.stringify(jsonSchema, null, 2) + '\n', 'utf8');
  console.log(`wrote ${outPath}`);
}
