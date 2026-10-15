// Shared EEG widget building blocks (client). Widget `schema.ts` files must
// import Node-safe pieces directly from './figure' (schemas) — this barrel
// also exports React components.

export * from './figure';
export * from './types';
export * from './color';
export * from './dataError';
export * from './progress';
export * from './traceLayout';
export * from './figureMath';
export * from './figureMarks';
export * from './useEegTheme';
export * from './useParsedData';
export * from './useWidgetProgress';
export * from './useFigureMarks';
export {
  drawTraceBase,
  drawTraceOverlay,
  caliperMeasurement,
  type TraceBaseState,
  type TraceOverlayState,
} from './traceRender';
export * from './TraceCanvas';
export * from './FigureCanvas';
export * from './AttributionLine';
export * from './SimulationBadge';
export * from './DataErrorCard';
