import type { DataTableData } from './schema';

export const SAMPLE_DATA_TABLE: DataTableData = {
  columns: [
    { key: 'name', label: 'Name', type: 'string', sortable: true, filterable: true },
    { key: 'score', label: 'Score', type: 'number', sortable: true, filterable: true },
    { key: 'passed', label: 'Passed', type: 'boolean', sortable: true, filterable: false },
  ],
  rows: [
    { name: 'Ada', score: 92, passed: true },
    { name: 'Linus', score: 88, passed: true },
    { name: 'Grace', score: 75, passed: true },
    { name: 'Donald', score: 64, passed: false },
  ],
  pageSize: 25,
};
