/**
 * SpaceX primitive barrel. Consumers import from `@/components/ui` so the
 * internal file layout can reshuffle without PR churn. Phases 2+ import
 * Panel/Toggle/Chip/SliderField/Metric from here exclusively.
 */
export { Panel, type PanelProps, type McDepartment } from './panel';
export { Toggle, type ToggleProps } from './toggle';
export { Chip, type ChipProps } from './chip';
export { SliderField, type SliderFieldProps } from './slider-field';
export { Metric, type MetricProps, type MetricAccent } from './metric';
