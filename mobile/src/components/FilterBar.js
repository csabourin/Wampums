import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import theme, { commonStyles } from '../theme';

/**
 * FilterBar Component
 *
 * Reusable filter bar for searching and filtering lists/tables.
 * Supports search input, filter toggles, and sort controls.
 *
 * @param {Object} props
 * @param {string} props.searchValue - Current search value
 * @param {function} props.onSearchChange - Search change handler
 * @param {string} props.searchPlaceholder - Placeholder text for search input
 * @param {Array} props.filterOptions - Array of filter options {label, value, active}
 * @param {function} props.onFilterToggle - Filter toggle handler
 * @param {boolean} props.showFilters - Whether to show filter options
 * @param {Object} props.style - Additional custom styles
 */
const FilterBar = ({
  searchValue,
  onSearchChange,
  searchPlaceholder = 'Search...',
  filterOptions = [],
  onFilterToggle,
  showFilters = true,
  style,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <View style={[styles.container, style]}>
      {/* Search Input */}
      <View style={styles.searchContainer}>
        <TextInput
          style={commonStyles.input}
          value={searchValue}
          onChangeText={onSearchChange}
          placeholder={searchPlaceholder}
          placeholderTextColor={theme.colors.textMuted}
        />
      </View>

      {/* Filter Toggle Button */}
      {showFilters && filterOptions.length > 0 && (
        <TouchableOpacity
          style={styles.filterToggle}
          onPress={() => setIsExpanded(!isExpanded)}
          activeOpacity={0.7}
        >
          <Text style={styles.filterToggleText}>
            {isExpanded ? '− Filters' : '+ Filters'}
          </Text>
        </TouchableOpacity>
      )}

      {/* Filter Options */}
      {isExpanded && filterOptions.length > 0 && (
        <View style={styles.filterOptions}>
          {filterOptions.map((filter, index) => (
            <TouchableOpacity
              key={filter.value || index}
              style={[
                styles.filterChip,
                filter.active && styles.filterChipActive,
              ]}
              onPress={() => onFilterToggle && onFilterToggle(filter.value)}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.filterChipText,
                  filter.active && styles.filterChipTextActive,
                ]}
              >
                {filter.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
};

/**
 * SortButton Component
 *
 * Button for sorting lists with direction indicator.
 */
export const SortButton = ({ label, direction, onPress, style }) => {
  const getSortIcon = () => {
    if (!direction) return '';
    return direction === 'asc' ? '▲' : '▼';
  };

  return (
    <TouchableOpacity
      style={[styles.sortButton, style]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text style={styles.sortButtonText}>
        {label} {getSortIcon()}
      </Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: theme.spacing.md,
  },
  searchContainer: {
    marginBottom: theme.spacing.sm,
  },
  filterToggle: {
    backgroundColor: theme.colors.secondary,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.sm,
    marginBottom: theme.spacing.sm,
    minHeight: theme.touchTarget.min,
    justifyContent: 'center',
    alignItems: 'center',
  },
  filterToggleText: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.primary,
  },
  filterOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
    padding: theme.spacing.sm,
    backgroundColor: theme.colors.secondary,
    borderRadius: theme.borderRadius.md,
  },
  filterChip: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  filterChipActive: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  filterChipText: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.text,
  },
  filterChipTextActive: {
    color: theme.colors.selectedText,
  },
  sortButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.secondary,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.md,
    minHeight: theme.touchTarget.min,
  },
  sortButtonText: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.primary,
  },
});

export default FilterBar;
