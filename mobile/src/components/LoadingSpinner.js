/**
 * Loading Spinner Component
 *
 * Centered loading indicator with optional message
 */

import React from 'react';
import { View, ActivityIndicator, Text, StyleSheet } from 'react-native';

const LoadingSpinner = ({ message, size = 'large', color = '#007AFF' }) => {
  return (
    <View style={styles.container}>
      <ActivityIndicator size={size} color={color} />
      {message && <Text style={styles.message}>{message}</Text>}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
  },
  message: {
    marginTop: 16,
    fontSize: 16,
    color: '#666',
  },
});

export default LoadingSpinner;
