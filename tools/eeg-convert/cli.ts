// EDF / EDF+ → ai-lecturer-eeg@1 asset (see README.md).
//
//   node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.json tools/eeg-convert/cli.ts \
//     --in eeg5.edf --out courses/<slug>/assets/eeg/neo-seizure.json --start 3600 --dur 30 \
//     [--channels Fp1,Fp2,...] [--resample 256] [--seizures 3610:45,...] [--annotations ann.json] \
//     [--source-json meta.json] [--age "term neonate, day 2"] [--state sleep]

import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

import { edfToRecording, parseSeizureList } from '../../src/lib/eeg/edf';
import type { EegAnnotation, EegSource } from '../../src/lib/eeg/recording';

const HELP = `Usage: eeg-convert --in <file.edf> --out <file.json> --start <sec> --dur <sec> [options]

Options:
  --channels a,b,c     keep only these channels (any spelling: T3 → T7, "EEG Fp1-REF" → Fp1)
  --resample <Hz>      integer-factor decimation with anti-alias low-pass (e.g. 1024 → 256)
  --seizures on:dur,…  extra "seizure" annotations in FILE time (seconds), e.g. from CHB-MIT summary.txt
  --annotations <json> extra annotations [{onsetSec, durationSec, label, channels?, source?}] in FILE time
  --source-json <json> {dataset, record, url, license, citation} for the attribution line
  --age <text>         subject age (shown in the course), e.g. "2 y"
  --state <text>       awake / drowsy / sleep …
  --help`;

function args(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
    out[key] = val;
  }
  return out;
}

function main(): void {
  const a = args(process.argv.slice(2));
  if (a.help || !a.in || !a.out || a.start === undefined || a.dur === undefined) {
    console.log(HELP);
    process.exit(a.help ? 0 : 1);
  }
  const bytes = new Uint8Array(readFileSync(a.in));
  const extra: EegAnnotation[] = [];
  if (a.seizures) extra.push(...parseSeizureList(a.seizures));
  if (a.annotations) extra.push(...(JSON.parse(readFileSync(a.annotations, 'utf8')) as EegAnnotation[]));
  const source: EegSource = a['source-json'] ? JSON.parse(readFileSync(a['source-json'], 'utf8')) : {};
  source.record ??= basename(a.in);
  const report = edfToRecording(bytes, {
    startSec: Number(a.start),
    durationSec: Number(a.dur),
    channels: a.channels ? a.channels.split(',').map((s) => s.trim()) : undefined,
    targetRate: a.resample ? Number(a.resample) : undefined,
    extraAnnotations: extra,
    source,
    subject: a.age || a.state ? { age: a.age, state: a.state } : undefined,
  });
  const json = JSON.stringify(report.file);
  writeFileSync(a.out, json);
  console.log(`wrote ${a.out} (${(json.length / 1024).toFixed(0)} KiB) — ${report.reference}, ${report.sampleRate} Hz`);
  console.log(`kept: ${report.kept.map((k) => (k.from === k.to ? k.to : `${k.from}→${k.to}`)).join(', ')}`);
  if (report.skipped.length) console.log(`skipped: ${report.skipped.map((s) => `${s.label} (${s.reason})`).join('; ')}`);
  const ann = report.file.annotations ?? [];
  if (ann.length) console.log(`annotations in segment: ${ann.map((x) => `${x.label}@${x.onsetSec}s/${x.durationSec}s`).join(', ')}`);
}

main();
