/**
 * Error Message Component
 *
 * Displays error messages with consistent styling
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Button from './Button';
import theme from '../theme';

const ErrorMessage = ({ message, onRetry, retryText = 'Retry' }) => {
  return (
    <View style={styles.container}>
      <Text style={styles.errorText}>{message}</Text>
      {onRetry && (
        <Button
          title={retryText}
          onPress={onRetry}
          variant="secondary"
          size="small"
          style={styles.retryButton}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: theme.spacing.lg,
    backgroundColor: theme.colors.background,
  },
  errorText: {
    color: theme.colors.error,
    fontSize: theme.fontSize.base,
    textAlign: 'center',
    marginBottom: theme.spacing.lg,
  },
  retryButton: {
    minWidth: 120,
  },
});

export default ErrorMessage;
