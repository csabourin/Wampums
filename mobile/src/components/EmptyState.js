import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import theme, { commonStyles } from '../theme';

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
      title="No Results Found"
      message={
        searchTerm
          ? `No items match "${searchTerm}"`
          : 'Try adjusting your search or filters'
      }
      actionLabel={onClear && 'Clear Filters'}
      onAction={onClear}
    />
  );
};

/**
 * NoData Component
 *
 * Pre-configured empty state for empty lists/collections.
 */
export const NoData = ({ message = 'No items yet', actionLabel, onAction }) => {
  return (
    <EmptyState
      icon="📋"
      title="Nothing Here Yet"
      message={message}
      actionLabel={actionLabel}
      onAction={onAction}
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
