import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZodSchema } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

import { TheoryDataSchema } from '@/widgets/Theory/schema';
import { QuizDataSchema } from '@/widgets/Quiz/schema';
import { CodeDataSchema } from '@/widgets/Code/schema';
import { DemoDataSchema } from '@/widgets/Demo/schema';
import { SandboxDataSchema } from '@/widgets/Sandbox/schema';

const widgets: Record<string, ZodSchema> = {
  theory: TheoryDataSchema,
  quiz: QuizDataSchema,
  code: CodeDataSchema,
  demo: DemoDataSchema,
  sandbox: SandboxDataSchema,
};

const outDir = dirname(fileURLToPath(import.meta.url));
mkdirSync(outDir, { recursive: true });

for (const [name, schema] of Object.entries(widgets)) {
  const jsonSchema = zodToJsonSchema(schema, { name: `${name}Data`, target: 'jsonSchema7' });
  const outPath = join(outDir, `${name}.json`);
  writeFileSync(outPath, JSON.stringify(jsonSchema, null, 2) + '\n', 'utf8');
  console.log(`wrote ${outPath}`);
}
