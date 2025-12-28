/**
 * Components Index
 *
 * Central export for all shared components
 */

// Existing Components
export { default as Button } from './Button';
export { default as Card } from './Card';
export { default as LoadingSpinner } from './LoadingSpinner';
export { default as ErrorMessage } from './ErrorMessage';
export { default as StatCard } from './StatCard';
export { default as QuickActionButton } from './QuickActionButton';
export { default as DashboardSection } from './DashboardSection';

// Newly Added Shared Components (Phase 1)
export { default as TableRow, Table, TableHeader, TableCell, TableHeaderCell } from './TableRow';
export { default as FilterBar, SortButton } from './FilterBar';
export { default as Modal, ConfirmModal } from './Modal';
export { default as Toast, useToast } from './Toast';
export { default as EmptyState, NoResults, NoData } from './EmptyState';
export { default as FormField, Checkbox, RadioButton, RadioGroup, Select } from './FormField';

// Placeholder exports for future components
// export { default as Header } from './Header';
// export { default as ParticipantCard } from './ParticipantCard';
// export { default as ActivityCard } from './ActivityCard';
// export { default as LanguageSwitcher } from './LanguageSwitcher';
