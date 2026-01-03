import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import theme, { commonStyles } from '../theme';
import { translate as t } from '../i18n';

/**
 * EmptyState Component
 *
 * Displays an empty state message when no data is available.
 * Can include an optional icon, message, and action button.
 *
 * @param {Object} props
 * @param {string} props.icon - Optional icon/emoji to display
 * @param {string} props.title - Empty state title
 * @param {string} props.message - Empty state message/description
 * @param {string} props.actionLabel - Optional action button label
 * @param {function} props.onAction - Optional action button handler
 * @param {Object} props.style - Additional custom styles
 */
const EmptyState = ({
  icon,
  title,
  message,
  actionLabel,
  onAction,
  style,
}) => {
  return (
    <View style={[commonStyles.emptyContainer, style]}>
      {icon && <Text style={styles.icon}>{icon}</Text>}

      {title && <Text style={styles.title}>{title}</Text>}

      {message && <Text style={commonStyles.emptyText}>{message}</Text>}

      {actionLabel && onAction && (
        <TouchableOpacity
          style={[commonStyles.button, styles.actionButton]}
          onPress={onAction}
          activeOpacity={0.7}
        >
          <Text style={commonStyles.buttonText}>{actionLabel}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

/**
 * NoResults Component
 *
 * Pre-configured empty state for search/filter with no results.
 */
export const NoResults = ({ searchTerm, onClear }) => {
  return (
    <EmptyState
      icon="🔍"
      title={t('empty_no_results_found')}
      message={
        searchTerm
          ? t('empty_no_items_match').replace('{searchTerm}', searchTerm)
          : t('empty_try_adjusting')
      }
      actionLabel={onClear && t('empty_clear_filters')}
      onAction={onClear}
    />
  );
};

/**
 * NoData Component
 *
 * Pre-configured empty state for empty lists/collections.
 */
export const NoData = ({ message, actionLabel, onAction }) => {
  return (
    <EmptyState
      icon="📋"
      title={t('empty_nothing_here_yet')}
      message={message || t('empty_no_items_yet')}
      actionLabel={actionLabel}
      onAction={onAction}
    />
  );
};

/**
 * LoadingState Component
 *
 * Pre-configured empty state for loading.
 */
export const LoadingState = ({ message }) => {
  return (
    <EmptyState
      icon="⏳"
      title={t('state_loading')}
      message={message || t('state_loading_message')}
    />
  );
};

/**
 * ErrorState Component
 *
 * Pre-configured empty state for errors with retry.
 */
export const ErrorState = ({ message, onRetry }) => {
  return (
    <EmptyState
      icon="⚠️"
      title={t('state_error')}
      message={message || t('state_error_occurred')}
      actionLabel={onRetry ? t('state_retry') : undefined}
      onAction={onRetry}
    />
  );
};

/**
 * OfflineState Component
 *
 * Pre-configured empty state for offline status.
 */
export const OfflineState = ({ message, onRetry }) => {
  return (
    <EmptyState
      icon="📡"
      title={t('state_offline')}
      message={message || t('state_no_internet')}
      actionLabel={onRetry ? t('state_retry') : undefined}
      onAction={onRetry}
    />
  );
};

const styles = StyleSheet.create({
  icon: {
    fontSize: 64,
    marginBottom: theme.spacing.md,
  },
  title: {
    fontSize: theme.fontSize.xl,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.text,
    marginBottom: theme.spacing.sm,
    textAlign: 'center',
  },
  actionButton: {
    marginTop: theme.spacing.lg,
  },
});

export default EmptyState;
