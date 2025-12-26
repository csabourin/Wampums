/**
 * Dashboard Screen
 *
 * Router for permission-based dashboards
 * Directs users to the appropriate dashboard based on their permissions
 *
 * Permission-based routing:
 * - Admin permissions (users.assign_roles, org.view, etc.) -> DistrictDashboardScreen
 * - Staff permissions (participants.view, attendance.manage, etc.) -> LeaderDashboardScreen
 * - Parent permissions (limited access) -> ParentDashboardScreen
 */

import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import StorageUtils from '../utils/StorageUtils';
import { getDashboardType } from '../utils/PermissionUtils';
import { translate as t } from '../i18n';
import CONFIG from '../config';
import theme, { commonStyles } from '../theme';

// Import permission-based dashboards
import ParentDashboardScreen from './ParentDashboardScreen';
import LeaderDashboardScreen from './LeaderDashboardScreen';
import DistrictDashboardScreen from './DistrictDashboardScreen';

const DashboardScreen = () => {
  const [loading, setLoading] = useState(true);
  const [dashboardType, setDashboardType] = useState(null);

  useEffect(() => {
    loadUserPermissions();
  }, []);

  const loadUserPermissions = async () => {
    try {
      // Get user permissions from storage (already parsed by StorageUtils)
      const permissions = await StorageUtils.getItem(CONFIG.STORAGE_KEYS.USER_PERMISSIONS);

      // Determine which dashboard to show based on permissions
      const type = getDashboardType(permissions || []);
      setDashboardType(type);
    } catch (err) {
      console.error('Error loading user permissions:', err);
      // Fallback to parent dashboard on error
      setDashboardType('parent');
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

  // Route to appropriate dashboard based on permissions
  switch (dashboardType) {
    case 'district':
      return <DistrictDashboardScreen />;

    case 'leader':
      return <LeaderDashboardScreen />;

    case 'parent':
    default:
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
