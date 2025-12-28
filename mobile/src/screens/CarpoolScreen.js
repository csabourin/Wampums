/**
 * CarpoolScreen
 *
 * Carpool coordination and management
 * Mirrors web carpool functionality
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { translate as t } from '../i18n';
import theme from '../theme';

const CarpoolScreen = () => {
  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.icon}>🚗</Text>
        <Text style={styles.title}>{t('carpool_coordination') || 'Carpool Coordination'}</Text>
        <Text style={styles.message}>{t('coming_soon') || 'Coming Soon'}</Text>
        <Text style={styles.description}>
          {t('carpool_description') || 'Coordinate carpools for activities and events.'}
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background.primary,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: theme.spacing.xl,
  },
  icon: {
    fontSize: 64,
    marginBottom: theme.spacing.lg,
  },
  title: {
    fontSize: 24,
    fontWeight: '600',
    color: theme.colors.text.primary,
    marginBottom: theme.spacing.md,
    textAlign: 'center',
  },
  message: {
    fontSize: 18,
    color: theme.colors.text.secondary,
    marginBottom: theme.spacing.lg,
  },
  description: {
    fontSize: 14,
    color: theme.colors.text.secondary,
    textAlign: 'center',
    lineHeight: 20,
  },
});

export default CarpoolScreen;
