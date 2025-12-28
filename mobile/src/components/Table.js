/**
 * Table Components
 *
 * Responsive table/list components for mobile
 * Optimized for touch interfaces with card-based rows
 */

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import theme, { commonStyles } from '../theme';

/**
 * Table Container
 * @param {Object} props
 * @param {React.ReactNode} props.children - Table content
 * @param {Object} props.style - Additional styles
 */
export const Table = ({ children, style }) => {
  return (
    <View style={[styles.table, style]}>
      {children}
    </View>
  );
};

/**
 * Table Header Row
 * @param {Object} props
 * @param {Array} props.columns - Column definitions [{key, label, width, align}]
 */
export const TableHeader = ({ columns }) => {
  return (
    <View style={styles.headerRow}>
      {columns.map((col, index) => (
        <TableHeaderCell
          key={col.key || index}
          width={col.width}
          align={col.align}
        >
          {col.label}
        </TableHeaderCell>
      ))}
    </View>
  );
};

/**
 * Table Header Cell
 * @param {Object} props
 * @param {React.ReactNode} props.children - Cell content
 * @param {string|number} props.width - Cell width (flex value or fixed width)
 * @param {string} props.align - Text alignment ('left', 'center', 'right')
 */
export const TableHeaderCell = ({ children, width = 1, align = 'left', style }) => {
  const cellStyle = [
    styles.headerCell,
    typeof width === 'number' ? { flex: width } : { width },
    align && styles[`align_${align}`],
    style,
  ];

  return (
    <View style={cellStyle}>
      <Text style={styles.headerText} numberOfLines={1}>
        {children}
      </Text>
    </View>
  );
};

/**
 * Table Row (Card-style for mobile)
 * @param {Object} props
 * @param {React.ReactNode} props.children - Row content
 * @param {Function} props.onPress - Press handler
 * @param {Object} props.style - Additional styles
 */
export const TableRow = ({ children, onPress, style }) => {
  const Container = onPress ? TouchableOpacity : View;
  const containerProps = onPress ? { onPress, activeOpacity: 0.7 } : {};

  return (
    <Container
      style={[styles.row, style]}
      {...containerProps}
    >
      {children}
    </Container>
  );
};

/**
 * Table Cell
 * @param {Object} props
 * @param {React.ReactNode} props.children - Cell content
 * @param {string|number} props.width - Cell width (flex value or fixed width)
 * @param {string} props.align - Text alignment
 * @param {boolean} props.bold - Bold text
 * @param {string} props.color - Text color
 */
export const TableCell = ({ 
  children, 
  width = 1, 
  align = 'left', 
  bold = false,
  color,
  style 
}) => {
  const cellStyle = [
    styles.cell,
    typeof width === 'number' ? { flex: width } : { width },
    align && styles[`align_${align}`],
    style,
  ];

  const textStyle = [
    styles.cellText,
    bold && styles.boldText,
    color && { color },
  ];

  return (
    <View style={cellStyle}>
      {typeof children === 'string' ? (
        <Text style={textStyle} numberOfLines={2}>
          {children}
        </Text>
      ) : (
        children
      )}
    </View>
  );
};

/**
 * Mobile-optimized List Item (alternative to table row)
 * Better for narrow screens - stacks information vertically
 */
export const ListItem = ({ 
  title, 
  subtitle, 
  rightText, 
  onPress, 
  leftIcon,
  rightIcon = '›',
  style 
}) => {
  const Container = onPress ? TouchableOpacity : View;
  const containerProps = onPress ? { onPress, activeOpacity: 0.7 } : {};

  return (
    <Container
      style={[styles.listItem, style]}
      {...containerProps}
    >
      {leftIcon && (
        <View style={styles.leftIcon}>
          <Text style={styles.iconText}>{leftIcon}</Text>
        </View>
      )}
      
      <View style={styles.listItemContent}>
        <Text style={styles.listItemTitle} numberOfLines={1}>
          {title}
        </Text>
        {subtitle && (
          <Text style={styles.listItemSubtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        )}
      </View>

      {rightText && (
        <Text style={styles.listItemRightText} numberOfLines={1}>
          {rightText}
        </Text>
      )}

      {onPress && rightIcon && (
        <Text style={styles.chevron}>{rightIcon}</Text>
      )}
    </Container>
  );
};

const styles = StyleSheet.create({
  // Table container
  table: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.md,
    overflow: 'hidden',
  },

  // Header row
  headerRow: {
    flexDirection: 'row',
    backgroundColor: theme.colors.secondary,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },

  headerCell: {
    paddingHorizontal: theme.spacing.xs,
  },

  headerText: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.text,
  },

  // Data rows
  row: {
    flexDirection: 'row',
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.borderLight,
    minHeight: theme.touchTarget.min,
    alignItems: 'center',
  },

  cell: {
    paddingHorizontal: theme.spacing.xs,
    justifyContent: 'center',
  },

  cellText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.text,
    lineHeight: theme.fontSize.base * 1.4,
  },

  boldText: {
    fontWeight: theme.fontWeight.semibold,
  },

  // Alignment
  align_left: {
    alignItems: 'flex-start',
  },

  align_center: {
    alignItems: 'center',
  },

  align_right: {
    alignItems: 'flex-end',
  },

  // List item (mobile-optimized alternative)
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
    backgroundColor: theme.colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.borderLight,
    minHeight: theme.touchTarget.min * 1.5,
  },

  leftIcon: {
    marginRight: theme.spacing.md,
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.colors.secondary,
    borderRadius: theme.borderRadius.full,
  },

  iconText: {
    fontSize: theme.fontSize.lg,
  },

  listItemContent: {
    flex: 1,
    justifyContent: 'center',
  },

  listItemTitle: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.text,
    marginBottom: theme.spacing.xs / 2,
  },

  listItemSubtitle: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textLight,
  },

  listItemRightText: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.textLight,
    marginRight: theme.spacing.sm,
  },

  chevron: {
    fontSize: theme.fontSize.xl,
    color: theme.colors.textMuted,
    marginLeft: theme.spacing.xs,
  },
});

export default TableRow;
