/**
 * Error Message Component
 *
 * Displays error messages with consistent styling
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Button from './Button';

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
    padding: 20,
    backgroundColor: '#f5f5f5',
  },
  errorText: {
    color: '#FF3B30',
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 20,
  },
  retryButton: {
    minWidth: 120,
  },
});

export default ErrorMessage;
