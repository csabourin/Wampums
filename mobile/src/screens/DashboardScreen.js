/**
 * Dashboard Screen
 *
 * Router for role-based dashboards
 * Directs users to the appropriate dashboard based on their role
 *
 * Role-based routing:
 * - parent -> ParentDashboardScreen
 * - leader -> LeaderDashboardScreen
 * - admin -> DistrictDashboardScreen
 */

import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import StorageUtils from '../utils/StorageUtils';
import { translate as t } from '../i18n';
import CONFIG from '../config';

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
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={styles.loadingText}>{t('loading')}</Text>
      </View>
    );
  }

  // Route to appropriate dashboard based on role
  switch (userRole) {
    case 'parent':
      return <ParentDashboardScreen />;

    case 'leader':
      return <LeaderDashboardScreen />;

    case 'admin':
      return <DistrictDashboardScreen />;

    default:
      // Fallback to parent dashboard if role is unknown
      return <ParentDashboardScreen />;
  }
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#666',
  },
  errorText: {
    color: '#FF3B30',
    fontSize: 16,
    textAlign: 'center',
    padding: 20,
  },
  header: {
    backgroundColor: '#007AFF',
    padding: 20,
    paddingTop: 40,
  },
  greeting: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 4,
  },
  role: {
    fontSize: 14,
    color: '#fff',
    opacity: 0.9,
  },
  content: {
    padding: 20,
  },
  placeholder: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    marginTop: 40,
  },
});

export default DashboardScreen;
