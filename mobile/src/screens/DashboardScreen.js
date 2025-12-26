/**
 * Dashboard Screen
 *
 * Router for role-based dashboards
 * Directs users to the appropriate dashboard based on their role
 *
 * Role-based routing:
 * - parent, demoparent -> ParentDashboardScreen
 * - leader, finance, equipment, administration -> LeaderDashboardScreen
 * - admin, district, unitadmin, demoadmin -> DistrictDashboardScreen
 */

import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import StorageUtils from '../utils/StorageUtils';
import { translate as t } from '../i18n';
import CONFIG from '../config';
import theme, { commonStyles } from '../theme';

// Import role-specific dashboards
import ParentDashboardScreen from './ParentDashboardScreen';
import LeaderDashboardScreen from './LeaderDashboardScreen';
import DistrictDashboardScreen from './DistrictDashboardScreen';

const DashboardScreen = () => {
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState(null);

  useEffect(() => {
    loadUserRole();
  }, []);

  const loadUserRole = async () => {
    try {
      const role = await StorageUtils.getItem(CONFIG.STORAGE_KEYS.USER_ROLE);
      setUserRole(role);
    } catch (err) {
      console.error('Error loading user role:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
        <Text style={styles.loadingText}>{t('loading')}</Text>
      </View>
    );
  }

  // Route to appropriate dashboard based on role
  switch (userRole) {
    case 'parent':
    case 'demoparent':
      return <ParentDashboardScreen />;

    case 'leader':
    case 'finance':
    case 'equipment':
    case 'administration':
      return <LeaderDashboardScreen />;

    case 'admin':
    case 'district':
    case 'unitadmin':
    case 'demoadmin':
      return <DistrictDashboardScreen />;

    default:
      // Fallback to parent dashboard if role is unknown
      return <ParentDashboardScreen />;
  }
};

const styles = StyleSheet.create({
  container: {
    ...commonStyles.container,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.colors.background,
  },
  loadingText: {
    marginTop: theme.spacing.md,
    fontSize: theme.fontSize.base,
    color: theme.colors.textLight,
  },
  errorText: {
    color: theme.colors.error,
    fontSize: theme.fontSize.base,
    textAlign: 'center',
    padding: theme.spacing.lg,
  },
  header: {
    backgroundColor: theme.colors.primary,
    padding: theme.spacing.lg,
    paddingTop: theme.spacing.xxl,
  },
  greeting: {
    fontSize: theme.fontSize.xxl,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.surface,
    marginBottom: theme.spacing.xs,
  },
  role: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.surface,
    opacity: 0.9,
  },
  content: {
    padding: theme.spacing.lg,
  },
  placeholder: {
    fontSize: theme.fontSize.base,
    color: theme.colors.textLight,
    textAlign: 'center',
    marginTop: theme.spacing.xxl,
  },
});

export default DashboardScreen;
