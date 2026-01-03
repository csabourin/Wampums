/**
 * Group Participant Report Screen
 *
 * Mirrors spa/group-participant-report.js functionality
 * Printable/shareable report of participants organized by group
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
  Alert,
  Share,
} from 'react-native';
import { translate as t } from '../i18n';
import theme, { commonStyles } from '../theme';
import {
  LoadingSpinner,
  Card,
  EmptyState,
} from '../components';
import { canViewReports } from '../utils/PermissionUtils';
import { API } from '../api/api-core';
import StorageUtils from '../utils/StorageUtils';
import { debugError } from '../utils/DebugUtils';

const GroupParticipantReportScreen = ({ navigation }) => {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [participants, setParticipants] = useState([]);
  const [groups, setGroups] = useState([]);

  useEffect(() => {
    checkPermissionsAndLoad();
  }, []);

  const checkPermissionsAndLoad = async () => {
    try {
      if (!canViewReports()) {
        Alert.alert(
          t('access_denied'),
          t('no_permission_to_view_reports'),
          [
            {
              text: t('OK'),
              onPress: () => navigation.goBack(),
            },
          ]
        );
        return;
      }

      await loadData();
    } catch (err) {
      debugError('Error checking permissions:', err);
      setLoading(false);
    }
  };

  const loadData = async () => {
    try {
      const token = await StorageUtils.getJWT();

      const [participantsResponse, groupsResponse] = await Promise.all([
        fetch(`${API.baseURL}/v1/participants`, {
          headers: { Authorization: `Bearer ${token}` },
        }).catch((err) => {
          debugError('Error loading participants:', err);
          return { ok: false };
        }),
        fetch(`${API.baseURL}/v1/groups`, {
          headers: { Authorization: `Bearer ${token}` },
        }).catch((err) => {
          debugError('Error loading groups:', err);
          return { ok: false };
        }),
      ]);

      let participantsData = [];
      let groupsData = [];

      if (participantsResponse.ok) {
        const result = await participantsResponse.json();
        participantsData = result.data || result.participants || [];
      }

      if (groupsResponse.ok) {
        const result = await groupsResponse.json();
        groupsData = result.data || result.groups || [];
      }

      // Sort groups alphabetically
      groupsData.sort((a, b) => a.name.localeCompare(b.name));

      setParticipants(participantsData);
      setGroups(groupsData);
    } catch (err) {
      debugError('Error loading data:', err);
      Alert.alert(t('error'), t('error_loading_data'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
  };

  // Group participants by group and sort
  const groupedParticipants = useMemo(() => {
    return groups.map((group) => {
      const groupParticipants = participants.filter(
        (p) => p.group_id === group.id
      );

      // Sort participants: leaders first, then second leaders, then alphabetically
      groupParticipants.sort((a, b) => {
        if (a.first_leader) return -1;
        if (b.first_leader) return 1;
        if (a.second_leader) return 1;
        if (b.second_leader) return -1;
        return a.first_name.localeCompare(b.first_name);
      });

      return {
        group,
        participants: groupParticipants,
      };
    });
  }, [participants, groups]);

  const handleExportReport = async () => {
    try {
      // Build plain text report
      let reportText = `${t('den_list_report')}\n\n`;

      groupedParticipants.forEach(({ group, participants: groupParts }) => {
        reportText += `\n${group.name}\n`;
        reportText += '─'.repeat(40) + '\n';

        groupParts.forEach((participant) => {
          let role = '';
          if (participant.first_leader) {
            role = ` - ${t('leader')}`;
          } else if (participant.second_leader) {
            role = ` - ${t('second_leader')}`;
          }

          reportText += `  ${participant.first_name} ${participant.last_name}${role}\n`;
        });

        reportText += '\n';
      });

      // Share the report
      await Share.share({
        message: reportText,
        title: t('den_list_report'),
      });
    } catch (err) {
      debugError('Error sharing report:', err);
      Alert.alert(t('error'), t('error_sharing_report'));
    }
  };

  const renderGroupSection = ({ group, participants: groupParts }) => {
    if (groupParts.length === 0) {
      return null;
    }

    return (
      <Card key={group.id} style={styles.groupCard}>
        <Text style={styles.groupName}>{group.name}</Text>
        <View style={styles.participantsList}>
          {groupParts.map((participant) => (
            <View key={participant.id} style={styles.participantRow}>
              <Text style={styles.participantName}>
                {participant.first_name} {participant.last_name}
              </Text>
              {participant.first_leader && (
                <View style={styles.roleBadge}>
                  <Text style={styles.roleBadgeText}>{t('leader')}</Text>
                </View>
              )}
              {participant.second_leader && (
                <View style={styles.roleBadge}>
                  <Text style={styles.roleBadgeText}>{t('second_leader')}</Text>
                </View>
              )}
            </View>
          ))}
        </View>
      </Card>
    );
  };

  if (loading && !refreshing) {
    return <LoadingSpinner message={t('loading')} />;
  }

  return (
    <View style={commonStyles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContainer}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Header */}
        <Card style={styles.headerCard}>
          <Text style={styles.kicker}>{t('reports')}</Text>
          <Text style={styles.title}>{t('den_list_report')}</Text>
          <Text style={styles.subtitle}>{t('participants_organized_by_group')}</Text>
        </Card>

        {/* Export Button */}
        <TouchableOpacity
          style={[commonStyles.button, styles.exportButton]}
          onPress={handleExportReport}
          activeOpacity={0.7}
        >
          <Text style={commonStyles.buttonText}>{t('export_report')}</Text>
        </TouchableOpacity>

        {/* Groups List */}
        {groupedParticipants.length === 0 ? (
          <EmptyState
            icon="📋"
            message={t('no_groups_found')}
            description={t('create_groups_first')}
          />
        ) : (
          groupedParticipants.map(renderGroupSection)
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  scrollContainer: {
    padding: theme.spacing.md,
  },
  headerCard: {
    marginBottom: theme.spacing.lg,
    alignItems: 'center',
  },
  kicker: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.primary,
    textTransform: 'uppercase',
    marginBottom: theme.spacing.xs,
  },
  title: {
    fontSize: theme.fontSize.xxl,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.text,
    marginBottom: theme.spacing.sm,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: theme.fontSize.base,
    color: theme.colors.textMuted,
    textAlign: 'center',
  },
  exportButton: {
    marginBottom: theme.spacing.lg,
  },
  groupCard: {
    marginBottom: theme.spacing.md,
  },
  groupName: {
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.primary,
    marginBottom: theme.spacing.md,
    paddingBottom: theme.spacing.sm,
    borderBottomWidth: 2,
    borderBottomColor: theme.colors.primary,
  },
  participantsList: {
    gap: theme.spacing.sm,
  },
  participantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: theme.spacing.xs,
    minHeight: theme.touchTarget.min,
  },
  participantName: {
    fontSize: theme.fontSize.base,
    color: theme.colors.text,
    flex: 1,
  },
  roleBadge: {
    backgroundColor: theme.colors.primary,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.borderRadius.sm,
  },
  roleBadgeText: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    color: '#FFFFFF',
  },
});

export default GroupParticipantReportScreen;
