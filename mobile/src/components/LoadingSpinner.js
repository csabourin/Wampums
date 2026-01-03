/**
 * Loading Spinner Component
 *
 * Centered loading indicator with optional message
 */

import React from 'react';
import { View, ActivityIndicator, Text, StyleSheet } from 'react-native';
import theme from '../theme';

const LoadingSpinner = ({ message, size = 'large', color }) => {
  return (
    <View style={styles.container}>
      <ActivityIndicator size={size} color={color || theme.colors.primary} />
      {message && <Text style={styles.message}>{message}</Text>}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.colors.background,
  },
  message: {
    marginTop: theme.spacing.md,
    fontSize: theme.fontSize.base,
    color: theme.colors.textLight,
  },
});

export default LoadingSpinner;
