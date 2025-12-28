import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import theme, { commonStyles } from '../theme';

/**
 * TableRow Component
 *
 * Reusable table/list row component for displaying data in a structured format.
 * Supports touch interactions, alternating row styles, and custom layouts.
 *
 * @param {Object} props
 * @param {Array} props.children - Row cells/content
 * @param {boolean} props.isOdd - Whether this is an odd-numbered row (for striping)
 * @param {function} props.onPress - Optional press handler
 * @param {Object} props.style - Additional custom styles
 */
const TableRow = ({ children, isOdd, onPress, style }) => {
  const rowStyle = [
    commonStyles.tableRow,
    isOdd && styles.tableRowOdd,
    style,
  ];

  if (onPress) {
    return (
      <TouchableOpacity
        style={rowStyle}
        onPress={onPress}
        activeOpacity={0.7}
      >
        {children}
      </TouchableOpacity>
    );
  }

  return <View style={rowStyle}>{children}</View>;
};

/**
 * TableHeader Component
 *
 * Header row for tables with styled header cells.
 */
export const TableHeader = ({ children, style }) => {
  return (
    <View style={[styles.tableHeader, commonStyles.tableHeaderRow, style]}>
      {children}
    </View>
  );
};

/**
 * TableCell Component
 *
 * Individual cell within a table row.
 */
export const TableCell = ({ children, flex = 1, align = 'left', style }) => {
  const textAlign = align === 'center' ? 'center' : align === 'right' ? 'right' : 'left';

  return (
    <View style={[commonStyles.tableCell, { flex }, style]}>
      {typeof children === 'string' || typeof children === 'number' ? (
        <Text style={[styles.cellText, { textAlign }]}>{children}</Text>
      ) : (
        children
      )}
    </View>
  );
};

/**
 * TableHeaderCell Component
 *
 * Header cell with appropriate styling.
 */
export const TableHeaderCell = ({ children, flex = 1, align = 'left', style }) => {
  const textAlign = align === 'center' ? 'center' : align === 'right' ? 'right' : 'left';

  return (
    <View style={[commonStyles.tableHeaderCell, { flex }, style]}>
      {typeof children === 'string' ? (
        <Text style={[styles.headerCellText, { textAlign }]}>{children}</Text>
      ) : (
        children
      )}
    </View>
  );
};

/**
 * Table Container Component
 *
 * Wrapper for table with standard styling.
 */
export const Table = ({ children, style }) => {
  return <View style={[commonStyles.table, style]}>{children}</View>;
};

const styles = StyleSheet.create({
  tableHeader: {
    backgroundColor: theme.colors.secondary,
    borderBottomWidth: 2,
    borderBottomColor: theme.colors.border,
  },
  tableRowOdd: {
    backgroundColor: '#f8fbf9',
  },
  cellText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.text,
  },
  headerCellText: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.primary,
  },
});

export default TableRow;
