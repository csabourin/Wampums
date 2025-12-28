/**
 * Parent Dashboard Screen
 *
 * Mirrors spa/parent_dashboard.js functionality
 * Shows parent-specific content:
 * - My children (participants)
 * - Upcoming activities
 * - Outstanding fees
 * - Permission slips
 * - Carpool assignments
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
} from 'react-native';
import { getParticipants, getActivities, getMyChildrenAssignments } from '../api/api-endpoints';
import StorageUtils from '../utils/StorageUtils';
import { translate as t } from '../i18n';
import DateUtils from '../utils/DateUtils';
import NumberUtils from '../utils/NumberUtils';
import { Card, LoadingSpinner, ErrorMessage } from '../components';
import CONFIG from '../config';

const ParentDashboardScreen = ({ navigation }) => {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [children, setChildren] = useState([]);
  const [upcomingActivities, setUpcomingActivities] = useState([]);
  const [carpoolAssignments, setCarpoolAssignments] = useState([]);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      setError('');

      // Get guardian participants
      const guardianParticipants = await StorageUtils.getItem(
        CONFIG.STORAGE_KEYS.GUARDIAN_PARTICIPANTS
      );

      // Load children data
      const participantsResponse = await getParticipants();
      if (participantsResponse.success) {
        // Filter to only this guardian's children
        const myChildren = participantsResponse.data.filter((p) =>
          guardianParticipants?.includes(p.id)
        );
        setChildren(myChildren);
      }

      // Load upcoming activities
      const activitiesResponse = await getActivities();
      if (activitiesResponse.success) {
        // Filter to future activities and sort by date
        const upcoming = activitiesResponse.data
          .filter((a) => DateUtils.isFuture(a.date))
          .sort((a, b) => new Date(a.date) - new Date(b.date))
          .slice(0, 5); // Show next 5 activities
        setUpcomingActivities(upcoming);
      }

      // Load carpool assignments for my children
      const carpoolResponse = await getMyChildrenAssignments();
      if (carpoolResponse.success) {
        setCarpoolAssignments(carpoolResponse.data);
      }
    } catch (err) {
      setError(err.message || t('error_loading_data'));
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
    return <LoadingSpinner message={t('loading')} />;
  }

  if (error) {
    return <ErrorMessage message={error} onRetry={loadDashboardData} />;
  }

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{t('Parent Dashboard')}</Text>
      </View>

      {/* My Children Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('My Children')}</Text>
        {children.length === 0 ? (
          <Card>
            <Text style={styles.emptyText}>{t('no_participants')}</Text>
          </Card>
        ) : (
          children.map((child) => (
            <Card
              key={child.id}
              onPress={() => navigation.navigate('ParticipantDetail', { id: child.id })}
            >
              <Text style={styles.childName}>
                {child.firstName} {child.lastName}
              </Text>
              <Text style={styles.childDetail}>
                {t('age')}: {DateUtils.calculateAge(child.birthdate)}{' '}
                {t('years')}
              </Text>
              {child.group && (
                <Text style={styles.childDetail}>
                  {t('group')}: {child.group}
                </Text>
              )}
            </Card>
          ))
        )}
      </View>

      {/* Upcoming Activities Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('Upcoming Activities')}</Text>
        {upcomingActivities.length === 0 ? (
          <Card>
            <Text style={styles.emptyText}>{t('No upcoming activities')}</Text>
          </Card>
        ) : (
          upcomingActivities.map((activity) => (
            <Card
              key={activity.id}
              onPress={() => navigation.navigate('ActivityDetail', { id: activity.id })}
            >
              <Text style={styles.activityName}>{activity.name}</Text>
              <Text style={styles.activityDate}>
                📅 {DateUtils.formatDate(activity.date)}
              </Text>
              {activity.location && (
                <Text style={styles.activityDetail}>📍 {activity.location}</Text>
              )}
            </Card>
          ))
        )}
      </View>

      {/* Carpool Assignments Section */}
      {carpoolAssignments.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('Carpool Assignments')}</Text>
          {carpoolAssignments.map((assignment, index) => (
            <Card key={index}>
              <Text style={styles.carpoolActivity}>{assignment.activityName}</Text>
              <Text style={styles.carpoolDetail}>
                🚗 {t('Driver')}: {assignment.driverName}
              </Text>
              <Text style={styles.carpoolDetail}>
                👥 {t('Spots')}: {assignment.occupiedSpots}/
                {assignment.totalSpots}
              </Text>
            </Card>
          ))}
        </View>
      )}

      {/* Quick Actions */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('Quick Actions')}</Text>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => navigation.navigate('Finance')}
        >
          <Text style={styles.actionButtonText}>💰 {t('View Fees')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => navigation.navigate('PermissionSlips')}
        >
          <Text style={styles.actionButtonText}>
            📄 {t('Permission Slips')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => navigation.navigate('HealthForm')}
        >
          <Text style={styles.actionButtonText}>
            🏥 {t('Health Form')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => navigation.navigate('RiskAcceptance')}
        >
          <Text style={styles.actionButtonText}>
            ⚠️ {t('Risk Acceptance Form')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => navigation.navigate('ParticipantDocuments')}
        >
          <Text style={styles.actionButtonText}>
            📋 {t('View Documents')}
          </Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    backgroundColor: '#007AFF',
    padding: 20,
    paddingTop: 40,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
  },
  section: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 12,
    color: '#333',
  },
  emptyText: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    padding: 20,
  },
  childName: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 4,
  },
  childDetail: {
    fontSize: 14,
    color: '#666',
    marginTop: 2,
  },
  activityName: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  activityDate: {
    fontSize: 14,
    color: '#333',
    marginTop: 4,
  },
  activityDetail: {
    fontSize: 14,
    color: '#666',
    marginTop: 2,
  },
  carpoolActivity: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  carpoolDetail: {
    fontSize: 14,
    color: '#666',
    marginTop: 2,
  },
  actionButton: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 8,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#ddd',
    minHeight: CONFIG.UI.TOUCH_TARGET_SIZE,
    justifyContent: 'center',
  },
  actionButtonText: {
    fontSize: 16,
    color: '#007AFF',
    fontWeight: '500',
  },
});

export default ParentDashboardScreen;
