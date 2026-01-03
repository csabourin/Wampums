/**
 * Participants Screen
 *
 * Mirrors spa/manage_participants.js functionality
 * Allows inline assignment of groups and roles to participants
 * For admin and leader users
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  RefreshControl,
  TextInput,
  TouchableOpacity,
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { getParticipants, getGroups, updateParticipantGroup } from '../api/api-endpoints';
import { translate as t } from '../i18n';
import {
  LoadingState,
  ErrorState,
  EmptyState,
  useToast,
} from '../components';
import { hasPermission } from '../utils/PermissionUtils';
import StorageUtils from '../utils/StorageUtils';
import { debugLog, debugError } from '../utils/DebugUtils';
import theme from '../theme';
import CONFIG from '../config';

const ParticipantsScreen = () => {
  const navigation = useNavigation();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [groups, setGroups] = useState([]);
  const [userPermissions, setUserPermissions] = useState([]);
  const [updatingParticipant, setUpdatingParticipant] = useState(null);

  const { showToast, ToastComponent } = useToast();

  // Calculate permissions-based access
  const canManage = hasPermission('participants.manage', userPermissions);

  // Configure navigation header
  useEffect(() => {
    navigation.setOptions({
      headerShown: true,
      title: t('manage_participants') || 'Assign Groups and Roles',
    });
  }, [navigation]);

  useEffect(() => {
    loadUserPermissions();
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [])
  );

  const loadUserPermissions = async () => {
    try {
      const permissions = await StorageUtils.getItem(CONFIG.STORAGE_KEYS.USER_PERMISSIONS);
      setUserPermissions(permissions || []);
    } catch (err) {
      debugError('Error loading permissions:', err);
    }
  };

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Load participants and groups in parallel
      const [participantsResponse, groupsResponse] = await Promise.all([
        getParticipants(),
        getGroups(),
      ]);

      if (participantsResponse.success) {
        setParticipants(participantsResponse.data || participantsResponse.participants || []);
      } else {
        throw new Error(participantsResponse.message || 'Failed to load participants');
      }

      if (groupsResponse.success) {
        setGroups(groupsResponse.data || groupsResponse.groups || []);
      }
    } catch (err) {
      debugError('Error loading data:', err);
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const handleGroupChange = async (participantId, groupId) => {
    if (!canManage) return;

    const participant = participants.find((p) => p.id === participantId);
    if (!participant) return;

    try {
      setUpdatingParticipant(participantId);

      const groupIdValue = groupId === 'none' ? null : parseInt(groupId, 10);

      const result = await updateParticipantGroup(
        participantId,
        groupIdValue,
        false, // Reset leader status when changing groups
        false, // Reset second leader status when changing groups
        null   // Reset additional roles when changing groups
      );

      if (result.success) {
        showToast(t('group_updated_successfully') || 'Group updated', 'success');
        await loadData();
      } else {
        throw new Error(result.message || t('error_updating_group') || 'Error updating group');
      }
    } catch (err) {
      debugError('Error updating group:', err);
      showToast(err.message || t('error_updating_group') || 'Error updating group', 'error');
    } finally {
      setUpdatingParticipant(null);
    }
  };

  const handleRoleChange = async (participantId, role) => {
    if (!canManage) return;

    const participant = participants.find((p) => p.id === participantId);
    if (!participant || !participant.group_id) {
      showToast(t('assign_group_before_role') || 'Assign a group first', 'error');
      return;
    }

    try {
      setUpdatingParticipant(participantId);

      const isLeader = role === 'leader';
      const isSecondLeader = role === 'second_leader';

      const result = await updateParticipantGroup(
        participantId,
        participant.group_id,
        isLeader,
        isSecondLeader,
        participant.roles || null
      );

      if (result.success) {
        showToast(t('role_updated_successfully') || 'Role updated', 'success');
        await loadData();
      } else {
        throw new Error(result.message || t('error_updating_role') || 'Error updating role');
      }
    } catch (err) {
      debugError('Error updating role:', err);
      showToast(err.message || t('error_updating_role') || 'Error updating role', 'error');
    } finally {
      setUpdatingParticipant(null);
    }
  };

  const handleRolesChange = async (participantId, roles) => {
    if (!canManage) return;

    const participant = participants.find((p) => p.id === participantId);
    if (!participant || !participant.group_id) {
      showToast(t('assign_group_before_role') || 'Assign a group first', 'error');
      return;
    }

    try {
      setUpdatingParticipant(participantId);

      const isLeader = participant.first_leader || false;
      const isSecondLeader = participant.second_leader || false;

      const result = await updateParticipantGroup(
        participantId,
        participant.group_id,
        isLeader,
        isSecondLeader,
        roles.trim() || null
      );

      if (result.success) {
        showToast(t('role_updated_successfully') || 'Roles updated', 'success');
        await loadData();
      } else {
        throw new Error(result.message || t('error_updating_role') || 'Error updating roles');
      }
    } catch (err) {
      debugError('Error updating roles:', err);
      showToast(err.message || t('error_updating_role') || 'Error updating roles', 'error');
    } finally {
      setUpdatingParticipant(null);
    }
  };

  const getCurrentRole = (participant) => {
    if (participant.first_leader) return 'leader';
    if (participant.second_leader) return 'second_leader';
    return 'none';
  };

  // Loading state
  if (loading) {
    return <LoadingState message={t('loading')} />;
  }

  // Error state
  if (error) {
    return <ErrorState message={error.message} onRetry={loadData} />;
  }

  // Empty state
  if (participants.length === 0) {
    return (
      <EmptyState
        icon="👥"
        title={t('no_participants') || 'No Participants'}
        message={t('add_first_participant') || 'Add participants to assign them to groups and roles.'}
      />
    );
  }

  return (
    <View style={styles.container}>
      {ToastComponent}

      <ScrollView
        style={styles.scrollView}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Header Row */}
        <View style={styles.headerRow}>
          <Text style={[styles.headerCell, styles.nameColumn]}>{t('name') || 'Name'}</Text>
          <Text style={[styles.headerCell, styles.groupColumn]}>{t('group') || 'Group'}</Text>
          <Text style={[styles.headerCell, styles.roleColumn]}>{t('role') || 'Role'}</Text>
          <Text style={[styles.headerCell, styles.additionalRolesColumn]}>
            {t('additional_roles') || 'Additional Roles'}
          </Text>
        </View>

        {/* Participant Rows */}
        {participants.map((participant) => {
          const isUpdating = updatingParticipant === participant.id;
          const hasGroup = participant.group_id != null;

          return (
            <View key={participant.id} style={styles.row}>
              {/* Name */}
              <View style={[styles.cell, styles.nameColumn]}>
                <Text style={styles.nameText} numberOfLines={2}>
                  {participant.first_name} {participant.last_name}
                </Text>
              </View>

              {/* Group Picker */}
              <View style={[styles.cell, styles.groupColumn]}>
                <View style={[styles.pickerContainer, isUpdating && styles.updating]}>
                  <Picker
                    selectedValue={participant.group_id?.toString() || 'none'}
                    onValueChange={(value) => handleGroupChange(participant.id, value)}
                    enabled={canManage && !isUpdating}
                    style={styles.picker}
                  >
                    <Picker.Item label={t('no_group') || 'No Group'} value="none" />
                    {groups.map((group) => (
                      <Picker.Item
                        key={group.id}
                        label={group.name}
                        value={group.id.toString()}
                      />
                    ))}
                  </Picker>
                </View>
              </View>

              {/* Role Picker */}
              <View style={[styles.cell, styles.roleColumn]}>
                <View style={[styles.pickerContainer, isUpdating && styles.updating]}>
                  <Picker
                    selectedValue={getCurrentRole(participant)}
                    onValueChange={(value) => handleRoleChange(participant.id, value)}
                    enabled={canManage && !isUpdating && hasGroup}
                    style={styles.picker}
                  >
                    <Picker.Item label={t('none') || 'None'} value="none" />
                    <Picker.Item label={t('leader') || 'Leader'} value="leader" />
                    <Picker.Item
                      label={t('second_leader') || 'Second Leader'}
                      value="second_leader"
                    />
                  </Picker>
                </View>
              </View>

              {/* Additional Roles */}
              <View style={[styles.cell, styles.additionalRolesColumn]}>
                <TextInput
                  style={[
                    styles.input,
                    !hasGroup && styles.disabled,
                    isUpdating && styles.updating,
                  ]}
                  value={participant.roles || ''}
                  onChangeText={(text) => {
                    // Update local state immediately
                    setParticipants((prev) =>
                      prev.map((p) =>
                        p.id === participant.id ? { ...p, roles: text } : p
                      )
                    );
                  }}
                  onBlur={() => handleRolesChange(participant.id, participant.roles || '')}
                  placeholder={t('additional_roles') || 'Additional roles'}
                  editable={canManage && !isUpdating && hasGroup}
                  multiline={false}
                />
              </View>
            </View>
          );
        })}
      </ScrollView>

      {!canManage && (
        <View style={styles.footer}>
          <Text style={styles.footerText}>
            {t('view_only_mode') || 'You have view-only access'}
          </Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  scrollView: {
    flex: 1,
  },
  headerRow: {
    flexDirection: 'row',
    backgroundColor: theme.colors.surfaceVariant,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.xs,
    borderBottomWidth: 2,
    borderBottomColor: theme.colors.border,
  },
  headerCell: {
    fontWeight: '600',
    fontSize: 12,
    color: theme.colors.textSecondary,
    textTransform: 'uppercase',
  },
  row: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    paddingVertical: theme.spacing.xs,
    paddingHorizontal: theme.spacing.xs,
    minHeight: 60,
    alignItems: 'center',
  },
  cell: {
    paddingHorizontal: theme.spacing.xs,
    justifyContent: 'center',
  },
  nameColumn: {
    flex: 2,
    minWidth: 100,
  },
  groupColumn: {
    flex: 2,
    minWidth: 120,
  },
  roleColumn: {
    flex: 2,
    minWidth: 120,
  },
  additionalRolesColumn: {
    flex: 2,
    minWidth: 120,
  },
  nameText: {
    fontSize: 14,
    fontWeight: '500',
    color: theme.colors.text,
  },
  pickerContainer: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.sm,
    backgroundColor: theme.colors.surface,
    height: 44,
    justifyContent: 'center',
  },
  picker: {
    height: 44,
  },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.sm,
    backgroundColor: theme.colors.surface,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
    fontSize: 14,
    color: theme.colors.text,
    height: 44,
  },
  disabled: {
    backgroundColor: theme.colors.surfaceVariant,
    color: theme.colors.textSecondary,
  },
  updating: {
    opacity: 0.5,
  },
  footer: {
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surfaceVariant,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  footerText: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    textAlign: 'center',
  },
});

export default ParticipantsScreen;
