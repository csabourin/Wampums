/**
 * Skeleton Loading Components
 * React Native implementation of skeleton loading states
 * Port of spa/utils/SkeletonUtils.js
 */

import React from 'react';
import { View, StyleSheet, Animated, Easing } from 'react-native';

/**
 * Base Skeleton Component with shimmer animation
 */
export const Skeleton = ({ width = '100%', height = 20, style, borderRadius = 4 }) => {
  const animatedValue = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(animatedValue, {
          toValue: 1,
          duration: 1000,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
        Animated.timing(animatedValue, {
          toValue: 0,
          duration: 1000,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, [animatedValue]);

  const opacity = animatedValue.interpolate({
    inputRange: [0, 1],
    outputRange: [0.3, 0.7],
  });

  return (
    <Animated.View
      style={[
        styles.skeleton,
        {
          width,
          height,
          borderRadius,
          opacity,
        },
        style,
      ]}
    />
  );
};

/**
 * Skeleton Header
 */
export const SkeletonHeader = () => (
  <View style={styles.skeletonHeader}>
    <Skeleton width="60%" height={32} borderRadius={6} />
  </View>
);

/**
 * Skeleton Card
 */
export const SkeletonCard = ({ small = false }) => {
  const cardHeight = small ? 100 : 150;

  return (
    <View style={[styles.skeletonCard, { height: cardHeight }]}>
      <Skeleton width="80%" height={20} style={{ marginBottom: 12 }} />
      <Skeleton width="100%" height={16} style={{ marginBottom: 8 }} />
      <Skeleton width="90%" height={16} style={{ marginBottom: 8 }} />
      {!small && <Skeleton width="70%" height={16} />}
    </View>
  );
};

/**
 * Multiple Skeleton Cards
 */
export const SkeletonCards = ({ count = 3, small = false }) => (
  <View style={styles.skeletonCardsContainer}>
    {Array.from({ length: count }).map((_, index) => (
      <SkeletonCard key={index} small={small} />
    ))}
  </View>
);

/**
 * Skeleton Text Line
 */
export const SkeletonText = ({ variant = 'default', style }) => {
  const widths = {
    wide: '95%',
    short: '40%',
    default: '75%',
  };

  return <Skeleton width={widths[variant] || widths.default} height={14} style={style} />;
};

/**
 * Multiple Skeleton Text Lines
 */
export const SkeletonTextLines = ({ count = 3, variant = 'default' }) => (
  <View style={styles.skeletonTextContainer}>
    {Array.from({ length: count }).map((_, index) => (
      <SkeletonText key={index} variant={variant} style={{ marginBottom: 8 }} />
    ))}
  </View>
);

/**
 * Skeleton Button
 */
export const SkeletonButton = () => (
  <Skeleton width={120} height={44} borderRadius={8} />
);

/**
 * Skeleton Avatar
 */
export const SkeletonAvatar = ({ size = 48 }) => (
  <Skeleton width={size} height={size} borderRadius={size / 2} />
);

/**
 * Skeleton List Item
 */
export const SkeletonListItem = () => (
  <View style={styles.skeletonListItem}>
    <SkeletonAvatar size={48} />
    <View style={styles.skeletonListItemContent}>
      <Skeleton width="80%" height={16} style={{ marginBottom: 8 }} />
      <Skeleton width="50%" height={14} />
    </View>
  </View>
);

/**
 * Multiple Skeleton List Items
 */
export const SkeletonListItems = ({ count = 5 }) => (
  <View style={styles.skeletonListContainer}>
    {Array.from({ length: count }).map((_, index) => (
      <SkeletonListItem key={index} />
    ))}
  </View>
);

/**
 * Skeleton Dashboard Layout
 */
export const SkeletonDashboard = () => (
  <View style={styles.skeletonDashboard}>
    <SkeletonHeader />
    <View style={styles.skeletonGrid}>
      <SkeletonCards count={4} />
    </View>
  </View>
);

/**
 * Skeleton Activity List Layout
 */
export const SkeletonActivityList = () => (
  <View style={styles.skeletonActivityList}>
    <View style={styles.skeletonActivityHeader}>
      <SkeletonText variant="wide" />
      <SkeletonButton />
    </View>
    <SkeletonCards count={3} />
  </View>
);

/**
 * Skeleton Table Row
 */
export const SkeletonTableRow = ({ cols = 4 }) => (
  <View style={styles.skeletonTableRow}>
    {Array.from({ length: cols }).map((_, index) => (
      <View key={index} style={styles.skeletonTableCell}>
        <Skeleton width="90%" height={14} />
      </View>
    ))}
  </View>
);

/**
 * Skeleton Table
 */
export const SkeletonTable = ({ rows = 5, cols = 4 }) => (
  <View style={styles.skeletonTable}>
    {/* Header Row */}
    <View style={styles.skeletonTableHeader}>
      {Array.from({ length: cols }).map((_, index) => (
        <View key={index} style={styles.skeletonTableCell}>
          <Skeleton width="70%" height={14} />
        </View>
      ))}
    </View>
    {/* Body Rows */}
    {Array.from({ length: rows }).map((_, index) => (
      <SkeletonTableRow key={index} cols={cols} />
    ))}
  </View>
);

/**
 * Spinner Component (replaces spinner() function)
 */
export const Spinner = ({ large = false, color = '#0066cc' }) => {
  const animatedValue = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    Animated.loop(
      Animated.timing(animatedValue, {
        toValue: 1,
        duration: 1000,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    ).start();
  }, [animatedValue]);

  const rotation = animatedValue.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const size = large ? 48 : 24;

  return (
    <Animated.View
      style={[
        styles.spinner,
        {
          width: size,
          height: size,
          borderColor: `${color}33`,
          borderTopColor: color,
          transform: [{ rotate: rotation }],
        },
      ]}
    />
  );
};

const styles = StyleSheet.create({
  skeleton: {
    backgroundColor: '#E1E9EE',
  },
  skeletonHeader: {
    marginBottom: 20,
    paddingHorizontal: 16,
  },
  skeletonCard: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  skeletonCardsContainer: {
    paddingHorizontal: 16,
  },
  skeletonTextContainer: {
    paddingHorizontal: 16,
  },
  skeletonListItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E1E9EE',
  },
  skeletonListItemContent: {
    flex: 1,
    marginLeft: 12,
  },
  skeletonListContainer: {
    flex: 1,
  },
  skeletonDashboard: {
    flex: 1,
    paddingTop: 20,
  },
  skeletonGrid: {
    paddingHorizontal: 16,
  },
  skeletonActivityList: {
    flex: 1,
    paddingTop: 20,
  },
  skeletonActivityHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 20,
  },
  skeletonTable: {
    borderWidth: 1,
    borderColor: '#E1E9EE',
    borderRadius: 8,
    overflow: 'hidden',
    marginHorizontal: 16,
  },
  skeletonTableHeader: {
    flexDirection: 'row',
    backgroundColor: '#F7FAFC',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderBottomWidth: 2,
    borderBottomColor: '#E1E9EE',
  },
  skeletonTableRow: {
    flexDirection: 'row',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#E1E9EE',
  },
  skeletonTableCell: {
    flex: 1,
    paddingHorizontal: 4,
  },
  spinner: {
    borderWidth: 3,
    borderRadius: 100,
  },
});

// Export individual components and styles
export default {
  Skeleton,
  SkeletonHeader,
  SkeletonCard,
  SkeletonCards,
  SkeletonText,
  SkeletonTextLines,
  SkeletonButton,
  SkeletonAvatar,
  SkeletonListItem,
  SkeletonListItems,
  SkeletonDashboard,
  SkeletonActivityList,
  SkeletonTable,
  SkeletonTableRow,
  Spinner,
};
