/**
 * Participants Screen
 *
 * Mirrors spa/manage_participants.js functionality
 * Allows assignment of groups and roles to participants
 * For admin and leader users
 */

import React, { useEffect, useCallback } from 'react';
import { useSafeState } from '../hooks/useSafeState';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  RefreshControl,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
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
import { hasPermission, canViewParticipants } from '../utils/PermissionUtils';
import StorageUtils from '../utils/StorageUtils';
import { debugLog, debugError } from '../utils/DebugUtils';
import theme from '../theme';
import CONFIG from '../config';
import { useIsMounted } from '../hooks/useIsMounted';

const ParticipantsScreen = () => {
  const navigation = useNavigation();
  const isMounted = useIsMounted();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [groups, setGroups] = useState([]);
  const [userPermissions, setUserPermissions] = useState([]);
  const [expandedId, setExpandedId] = useState(null);
  const [updatingParticipant, setUpdatingParticipant] = useState(null);

  const { showToast, ToastComponent } = useToast();

  // Check for edit permission (for editing group/role assignments)
  // Uses participants.edit as per backend requirement at routes/participants.js:327
  const canManage = hasPermission('participants.edit', userPermissions);

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
      if (!isMounted()) return;
      setUserPermissions(permissions || []);
    } catch (err) {
      debugError('Error loading permissions:', err);
    }
  };

  const loadData = async () => {
    try {
      if (!isMounted()) return;
      setLoading(true);
      setError(null);

      // Check view permission
      const hasViewPermission = await canViewParticipants();
      if (!isMounted()) return;
      if (!hasViewPermission) {
        navigation.navigate('Dashboard');
        return;
      }

      // Load participants and groups in parallel
      const [participantsResponse, groupsResponse] = await Promise.all([
        getParticipants(),
        getGroups(),
      ]);

      if (!isMounted()) return;
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
      if (!isMounted()) return;
      setError(err);
    } finally {
      if (isMounted()) {
        setLoading(false);
      }
    }
  };

  const onRefresh = async () => {
    if (!isMounted()) return;
    setRefreshing(true);
    await loadData();
    if (isMounted()) {
      setRefreshing(false);
    }
  };

  const handleGroupChange = async (participantId, groupId) => {
    if (!canManage) return;
    if (!isMounted()) return;

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

      if (!isMounted()) return;
      if (result.success) {
        showToast(t('group_updated_successfully') || 'Group updated', 'success');
        await loadData();
      } else {
        throw new Error(result.message || t('error_updating_group') || 'Error updating group');
      }
    } catch (err) {
      debugError('Error updating group:', err);
      if (!isMounted()) return;
      showToast(err.message || t('error_updating_group') || 'Error updating group', 'error');
    } finally {
      if (isMounted()) {
        setUpdatingParticipant(null);
      }
    }
  };

  const handleRoleChange = async (participantId, role) => {
    if (!canManage) return;
    if (!isMounted()) return;

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

      if (!isMounted()) return;
      if (result.success) {
        showToast(t('role_updated_successfully') || 'Role updated', 'success');
        await loadData();
      } else {
        throw new Error(result.message || t('error_updating_role') || 'Error updating role');
      }
    } catch (err) {
      debugError('Error updating role:', err);
      if (!isMounted()) return;
      showToast(err.message || t('error_updating_role') || 'Error updating role', 'error');
    } finally {
      if (isMounted()) {
        setUpdatingParticipant(null);
      }
    }
  };

  const handleRolesChange = async (participantId, roles) => {
    if (!canManage) return;
    if (!isMounted()) return;

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

      if (!isMounted()) return;
      if (result.success) {
        showToast(t('role_updated_successfully') || 'Roles updated', 'success');
        await loadData();
      } else {
        throw new Error(result.message || t('error_updating_role') || 'Error updating roles');
      }
    } catch (err) {
      debugError('Error updating roles:', err);
      if (!isMounted()) return;
      showToast(err.message || t('error_updating_role') || 'Error updating roles', 'error');
    } finally {
      if (isMounted()) {
        setUpdatingParticipant(null);
      }
    }
  };

  const getCurrentRole = (participant) => {
    if (participant.first_leader) return 'leader';
    if (participant.second_leader) return 'second_leader';
    return 'none';
  };

  const getGroupName = (groupId) => {
    if (!groupId) return t('no_group') || 'No Group';
    const group = groups.find((g) => g.id === groupId);
    return group ? group.name : t('no_group') || 'No Group';
  };

  const getRoleLabel = (participant) => {
    if (participant.first_leader) return t('leader') || 'Leader';
    if (participant.second_leader) return t('second_leader') || 'Second Leader';
    return t('none') || 'None';
  };

  const toggleExpanded = (participantId) => {
    if (!canManage) return; // Only allow expansion if can manage
    setExpandedId(expandedId === participantId ? null : participantId);
  };

  const renderParticipantCard = ({ item: participant }) => {
    const isExpanded = expandedId === participant.id;
    const isUpdating = updatingParticipant === participant.id;
    const hasGroup = participant.group_id != null;

    return (
      <View style={styles.card}>
        {/* Card Header - Always Visible */}
        <TouchableOpacity
          style={styles.cardHeader}
          onPress={() => toggleExpanded(participant.id)}
          activeOpacity={canManage ? 0.7 : 1}
        >
          <View style={styles.cardHeaderLeft}>
            <Text style={styles.participantName}>
              {participant.first_name} {participant.last_name}
            </Text>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>{t('group') || 'Group'}:</Text>
              <Text style={styles.infoValue}>{getGroupName(participant.group_id)}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>{t('role') || 'Role'}:</Text>
              <Text style={styles.infoValue}>{getRoleLabel(participant)}</Text>
            </View>
            {participant.roles && (
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>{t('additional_roles') || 'Additional'}:</Text>
                <Text style={styles.infoValue}>{participant.roles}</Text>
              </View>
            )}
          </View>
          {canManage && (
            <View style={styles.cardHeaderRight}>
              <Text style={styles.expandIcon}>{isExpanded ? '▼' : '▶'}</Text>
            </View>
          )}
        </TouchableOpacity>

        {/* Expanded Edit Section - Only visible when expanded */}
        {isExpanded && canManage && (
          <View style={styles.editSection}>
            {isUpdating && (
              <View style={styles.loadingOverlay}>
                <ActivityIndicator size="large" color={theme.colors.primary} />
              </View>
            )}

            {/* Group Selection */}
            <View style={styles.formField}>
              <Text style={styles.fieldLabel}>{t('group') || 'Group'}</Text>
              <View style={styles.pickerContainer}>
                <Picker
                  selectedValue={participant.group_id?.toString() || 'none'}
                  onValueChange={(value) => handleGroupChange(participant.id, value)}
                  enabled={!isUpdating}
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

            {/* Role Selection */}
            <View style={styles.formField}>
              <Text style={styles.fieldLabel}>{t('role') || 'Role'}</Text>
              <View style={[styles.pickerContainer, !hasGroup && styles.disabled]}>
                <Picker
                  selectedValue={getCurrentRole(participant)}
                  onValueChange={(value) => handleRoleChange(participant.id, value)}
                  enabled={!isUpdating && hasGroup}
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
            <View style={styles.formField}>
              <Text style={styles.fieldLabel}>
                {t('additional_roles') || 'Additional Roles'}
              </Text>
              <TextInput
                style={[
                  styles.input,
                  !hasGroup && styles.disabled,
                ]}
                value={participant.roles || ''}
                onChangeText={(text) => {
                  // Update local state immediately for responsive UI
                  setParticipants((prev) =>
                    prev.map((p) =>
                      p.id === participant.id ? { ...p, roles: text } : p
                    )
                  );
                }}
                onBlur={() => handleRolesChange(participant.id, participant.roles || '')}
                placeholder={t('additional_roles') || 'e.g., Treasurer, Historian'}
                editable={!isUpdating && hasGroup}
                multiline={false}
              />
              {!hasGroup && (
                <Text style={styles.helperText}>
                  {t('assign_group_first') || 'Assign a group first'}
                </Text>
              )}
            </View>
          </View>
        )}
      </View>
    );
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

      {!canManage && (
        <View style={styles.warningBanner}>
          <Text style={styles.warningText}>
            {t('view_only_mode') || 'View only - you do not have permission to edit'}
          </Text>
        </View>
      )}

      <FlatList
        data={participants}
        renderItem={renderParticipantCard}
        keyExtractor={(item) => item.id.toString()}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={styles.listContent}
        initialNumToRender={20}
        maxToRenderPerBatch={10}
        windowSize={10}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  warningBanner: {
    backgroundColor: theme.colors.warning + '20',
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.warning,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
  },
  warningText: {
    fontSize: 13,
    color: theme.colors.warning,
    textAlign: 'center',
    fontWeight: '500',
  },
  listContent: {
    padding: theme.spacing.md,
    paddingBottom: theme.spacing.xl,
  },
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.md,
    marginBottom: theme.spacing.md,
    overflow: 'hidden',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    padding: theme.spacing.md,
    alignItems: 'flex-start',
  },
  cardHeaderLeft: {
    flex: 1,
  },
  cardHeaderRight: {
    marginLeft: theme.spacing.sm,
    justifyContent: 'center',
  },
  participantName: {
    fontSize: 16,
    fontWeight: '600',
    color: theme.colors.text,
    marginBottom: theme.spacing.xs,
  },
  infoRow: {
    flexDirection: 'row',
    marginTop: theme.spacing.xs,
  },
  infoLabel: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    marginRight: theme.spacing.xs,
    fontWeight: '500',
  },
  infoValue: {
    fontSize: 13,
    color: theme.colors.text,
    flex: 1,
  },
  expandIcon: {
    fontSize: 16,
    color: theme.colors.primary,
  },
  editSection: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surfaceVariant,
    position: 'relative',
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  formField: {
    marginBottom: theme.spacing.md,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.colors.text,
    marginBottom: theme.spacing.xs,
  },
  pickerContainer: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface,
    overflow: 'hidden',
  },
  picker: {
    height: 50,
  },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    fontSize: 15,
    color: theme.colors.text,
    minHeight: 50,
  },
  disabled: {
    backgroundColor: theme.colors.surfaceVariant,
    opacity: 0.6,
  },
  helperText: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    marginTop: theme.spacing.xs,
    fontStyle: 'italic',
  },
});

export default ParticipantsScreen;