/**
 * StatCard Component
 *
 * Displays a statistic card for dashboards
 * Shows a number/value with a label and optional icon
 */

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

const StatCard = ({ label, value, icon, color = '#007AFF', onPress, loading = false }) => {
  const Container = onPress ? TouchableOpacity : View;

  // Props for touchable container
  const containerProps = onPress
    ? { onPress, activeOpacity: 0.7 }
    : {};

  return (
    <Container
      style={[styles.container, { borderLeftColor: color }]}
      {...containerProps}
    >
      {loading ? (
        <Text style={styles.loadingText}>...</Text>
      ) : (
        <>
          <Text style={[styles.value, { color }]}>{value}</Text>
          <Text style={styles.label}>{label}</Text>
        </>
      )}
      {icon && <Text style={styles.icon}>{icon}</Text>}
    </Container>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderLeftWidth: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    minHeight: 80,
    justifyContent: 'center',
  },
  value: {
    fontSize: 32,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  label: {
    fontSize: 14,
    color: '#666',
    fontWeight: '500',
  },
  icon: {
    position: 'absolute',
    top: 16,
    right: 16,
    fontSize: 24,
    opacity: 0.3,
  },
  loadingText: {
    fontSize: 32,
    color: '#ccc',
  },
});

export default StatCard;
