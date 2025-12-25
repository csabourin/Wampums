/**
 * Dashboard Screen
 *
 * Mirrors spa/dashboard.js functionality
 * Role-based dashboard with different views for different user types
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { getInitialData } from '../api/api-endpoints';
import StorageUtils from '../utils/StorageUtils';
import { translate as t } from '../i18n';
import CONFIG from '../config';

const DashboardScreen = ({ navigation }) => {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [userData, setUserData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      // Get user data from storage
      const userRole = await StorageUtils.getItem(CONFIG.STORAGE_KEYS.USER_ROLE);
      const userFullName = await StorageUtils.getItem(CONFIG.STORAGE_KEYS.USER_FULL_NAME);
      const userId = await StorageUtils.getItem(CONFIG.STORAGE_KEYS.USER_ID);

      setUserData({ userRole, userFullName, userId });

      // Load initial data from API
      const response = await getInitialData();

      if (response.success) {
        // Process initial data
        // TODO: Store relevant data in state or context
      }
    } catch (err) {
      setError(err.message || t('common.errorLoadingData'));
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadDashboardData();
    setRefreshing(false);
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={styles.loadingText}>{t('common.loading')}</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error}</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    >
      <View style={styles.header}>
        <Text style={styles.greeting}>
          {t('dashboard.welcome')}, {userData?.userFullName}!
        </Text>
        <Text style={styles.role}>{userData?.userRole}</Text>
      </View>

      <View style={styles.content}>
        <Text style={styles.placeholder}>
          {t('dashboard.contentPlaceholder')}
        </Text>

        {/* TODO: Add role-specific dashboard content */}
        {/* - Parent users: participant info, upcoming activities, fees */}
        {/* - Admin users: quick stats, recent activity, shortcuts */}
        {/* - Leader users: group info, attendance, activities */}
      </View>
    </ScrollView>
  );
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
