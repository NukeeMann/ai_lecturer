# eeg-convert — EDF/EDF+ → `ai-lecturer-eeg@1`

Cuts a segment out of an EDF/EDF+ recording and writes the JSON asset the
`eegViewer` / `eegCase` widgets load (`courses/<slug>/assets/eeg/<name>.json`).
The parser and conversion live in `src/lib/eeg/edf.ts` (unit-tested in
`src/lib/eeg/edf.test.ts`); this folder only holds the CLI.

```bash
node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.json tools/eeg-convert/cli.ts \
  --in eeg5.edf --out courses/<slug>/assets/eeg/neo-seizure.json \
  --start 3600 --dur 30 --seizures 3610:45 \
  --source-json helsinki.json --age "term neonate" --state sleep
```

What it does

- Normalises labels: `EEG Fp1-REF` → `Fp1`, old names `T3/T4/T5/T6` → `T7/T8/P7/P8`,
  CHB-MIT bipolar labels `FP1-F7` → `Fp1-F7`, CHB-MIT duplicates (`T8-P8-0`, `T8-P8-1`) dropped.
- Detects the file type: referential ("common", every montage can be derived) or
  fixed bipolar (only the recorded montage, e.g. CHB-MIT).
- Converts mV/V to µV; quantises to Int16 per channel without clipping.
- `--resample` decimates by an integer factor after a zero-phase anti-alias low-pass.
- Keeps EDF+ annotations and adds `--seizures` / `--annotations` (file time), clipped to
  the segment and shifted so 0 s = segment start.

Keep segments short (10–60 s; 30 s × 21 ch × 256 Hz ≈ 420 KiB) and always fill
`--source-json` (dataset, record, url, licence, citation) — the viewer shows it as the
attribution line. Datasets used for the EEG course: Helsinki neonatal EEG (Zenodo,
CC BY 4.0), CHB-MIT (PhysioNet, ODC-By). Never commit restricted recordings.
