/**
 * User Participant Link Screen
 *
 * Mirrors spa/manage_users_participants.js functionality
 * Manage associations between users (parents) and participants
 * For admin users
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
} from 'react-native';
import {
  getParticipantsWithUsers,
  getParentUsers,
  associateUser,
  removeParticipantFromOrganization,
} from '../api/api-endpoints';
import { translate as t } from '../i18n';
import theme, { commonStyles } from '../theme';
import {
  LoadingSpinner,
  ErrorMessage,
  Card,
  EmptyState,
  FilterBar,
  Modal,
  ConfirmModal,
  Toast,
  useToast,
  Select,
} from '../components';
import { canViewUsers } from '../utils/PermissionUtils';

const UserParticipantLinkScreen = ({ navigation }) => {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [participants, setParticipants] = useState([]);
  const [filteredParticipants, setFilteredParticipants] = useState([]);
  const [parentUsers, setParentUsers] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [linkModalVisible, setLinkModalVisible] = useState(false);
  const [selectedParticipant, setSelectedParticipant] = useState(null);
  const [selectedUserId, setSelectedUserId] = useState('');
  const toast = useToast();

  useEffect(() => {
    // Check permissions
    const checkPermissions = async () => {
      if (!(await canViewUsers())) {
        navigation.goBack();
        return;
      }

      loadData();
    };

    checkPermissions();
  }, []);

  useEffect(() => {
    filterParticipants();
  }, [searchQuery, participants]);

  const normalizeParticipants = (participantsData) => {
    if (!Array.isArray(participantsData)) {
      return [];
    }

    const participantMap = new Map();

    participantsData.forEach((participant) => {
      if (!participant || typeof participant !== 'object') return;

      const participantId = participant.id || participant.participant_id;
      if (!participantId) return;

      const existingEntry = participantMap.get(participantId) || {
        ...participant,
        associatedUsers: [],
      };

      // Parse associated_users if it's a comma-separated string
      if (
        !existingEntry.associatedUsers.length &&
        typeof participant.associated_users === 'string'
      ) {
        participant.associated_users
          .split(',')
          .map((name) => name.trim())
          .filter(Boolean)
          .forEach((name) => existingEntry.associatedUsers.push(name));
      }

      // Add individual user if exists
      const associatedName = (
        participant.user_full_name || participant.user_email || ''
      ).trim();
      if (associatedName && !existingEntry.associatedUsers.includes(associatedName)) {
        existingEntry.associatedUsers.push(associatedName);
      }

      participantMap.set(participantId, existingEntry);
    });

    return Array.from(participantMap.values()).map((participant) => ({
      ...participant,
      associated_users: participant.associatedUsers?.join(', ') || '',
    }));
  };

  const normalizeParentUsers = (parentUsersData) => {
    if (!Array.isArray(parentUsersData)) {
      return [];
    }

    const parentUserMap = new Map();

    parentUsersData.forEach((user) => {
      if (!user || typeof user !== 'object' || !user.id) return;
      if (!parentUserMap.has(user.id)) {
        parentUserMap.set(user.id, user);
      }
    });

    return Array.from(parentUserMap.values());
  };

  const loadData = async (forceRefresh = false) => {
    try {
      setError('');

      // Load participants and parent users in parallel
      const [participantsResponse, parentUsersResponse] = await Promise.all([
        getParticipantsWithUsers(forceRefresh),
        getParentUsers(forceRefresh),
      ]);

      // Process participants
      if (participantsResponse?.success) {
        const participantsData =
          participantsResponse.data?.participants ||
          participantsResponse.participants ||
          participantsResponse.data ||
          [];
        setParticipants(normalizeParticipants(participantsData));
      }

      // Process parent users
      if (parentUsersResponse?.success) {
        const parentUsersData =
          parentUsersResponse.data?.users ||
          parentUsersResponse.users ||
          parentUsersResponse.data ||
          [];
        setParentUsers(normalizeParentUsers(parentUsersData));
      }
    } catch (err) {
      setError(err.message || t('error_loading_data'));
    } finally {
      setLoading(false);
    }
  };

  const filterParticipants = () => {
    let filtered = [...participants];

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (p) =>
          p.first_name?.toLowerCase().includes(query) ||
          p.last_name?.toLowerCase().includes(query) ||
          p.associated_users?.toLowerCase().includes(query)
      );
    }

    // Sort by last name, first name
    filtered.sort((a, b) => {
      const aName = `${a.last_name} ${a.first_name}`.toLowerCase();
      const bName = `${b.last_name} ${b.first_name}`.toLowerCase();
      return aName.localeCompare(bName);
    });

    setFilteredParticipants(filtered);
  };

  const handleLinkUser = async () => {
    if (!selectedUserId) {
      toast.show(t('select_user_required'), 'warning');
      return;
    }

    try {
      setLoading(true);
      const result = await associateUser(selectedParticipant.id, selectedUserId);

      if (result.success) {
        toast.show(t('user_linked_successfully'), 'success');
        setLinkModalVisible(false);
        setSelectedParticipant(null);
        setSelectedUserId('');
        await loadData(true); // Force refresh
      } else {
        toast.show(result.message || t('error_linking_user'), 'error');
      }
    } catch (err) {
      toast.show(err.message || t('error_linking_user'), 'error');
    } finally {
      setLoading(false);
    }
  };

  const openLinkModal = (participant) => {
    setSelectedParticipant(participant);
    setLinkModalVisible(true);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData(true);
    setRefreshing(false);
  };

  const renderParticipant = ({ item }) => (
    <Card style={styles.participantCard}>
      <View style={styles.participantHeader}>
        <Text style={styles.participantName}>
          {item.first_name} {item.last_name}
        </Text>
      </View>

      {item.associated_users ? (
        <View style={styles.usersContainer}>
          <Text style={styles.usersLabel}>{t('associated_users')}:</Text>
          <Text style={styles.usersText}>{item.associated_users}</Text>
        </View>
      ) : (
        <Text style={styles.noUsersText}>{t('no_associated_users')}</Text>
      )}

      <TouchableOpacity
        style={styles.linkButton}
        onPress={() => openLinkModal(item)}
        activeOpacity={0.7}
      >
        <Text style={styles.linkButtonText}>{t('link_user')}</Text>
      </TouchableOpacity>
    </Card>
  );

  if (loading && !refreshing) {
    return <LoadingSpinner message={t('loading')} />;
  }

  if (error && !loading) {
    return <ErrorMessage message={error} onRetry={loadData} />;
  }

  const userOptions = parentUsers.map((user) => ({
    value: user.id,
    label: `${user.prenom} ${user.nom} (${user.courriel})`,
  }));

  return (
    <View style={commonStyles.container}>
      {/* Filter Bar */}
      <FilterBar
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder={t('search_participants')}
        showFilters={false}
      />

      {/* Participants List */}
      <FlatList
        data={filteredParticipants}
        renderItem={renderParticipant}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={styles.listContainer}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        ListEmptyComponent={
          <EmptyState
            icon="🔗"
            title={t('no_participants')}
            message={t('no_participants_to_link')}
          />
        }
      />

      {/* Link User Modal */}
      <Modal
        visible={linkModalVisible}
        onClose={() => {
          setLinkModalVisible(false);
          setSelectedParticipant(null);
          setSelectedUserId('');
        }}
        title={t('link_user_to_participant')}
        footer={
          <View style={styles.modalFooter}>
            <TouchableOpacity
              style={commonStyles.buttonSecondary}
              onPress={() => {
                setLinkModalVisible(false);
                setSelectedParticipant(null);
                setSelectedUserId('');
              }}
              activeOpacity={0.7}
            >
              <Text style={commonStyles.buttonSecondaryText}>{t('cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={commonStyles.button}
              onPress={handleLinkUser}
              activeOpacity={0.7}
            >
              <Text style={commonStyles.buttonText}>{t('link')}</Text>
            </TouchableOpacity>
          </View>
        }
      >
        {selectedParticipant && (
          <>
            <Text style={styles.modalLabel}>
              {t('participant')}: {selectedParticipant.first_name}{' '}
              {selectedParticipant.last_name}
            </Text>

            <Select
              label={t('select_user')}
              value={selectedUserId}
              onChange={setSelectedUserId}
              options={userOptions}
              placeholder={t('select_a_user')}
            />
          </>
        )}
      </Modal>

      {/* Toast Notifications */}
      <Toast
        visible={toast.toastState.visible}
        message={toast.toastState.message}
        type={toast.toastState.type}
        duration={toast.toastState.duration}
        onDismiss={toast.hide}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  listContainer: {
    padding: theme.spacing.md,
  },
  participantCard: {
    marginBottom: theme.spacing.md,
  },
  participantHeader: {
    marginBottom: theme.spacing.sm,
  },
  participantName: {
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.primary,
  },
  usersContainer: {
    marginBottom: theme.spacing.sm,
  },
  usersLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.textMuted,
    marginBottom: theme.spacing.xs,
  },
  usersText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.text,
  },
  noUsersText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
    fontStyle: 'italic',
    marginBottom: theme.spacing.sm,
  },
  linkButton: {
    backgroundColor: theme.colors.primary,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.sm,
    alignItems: 'center',
    minHeight: theme.touchTarget.min,
    justifyContent: 'center',
  },
  linkButtonText: {
    color: theme.colors.selectedText,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
  },
  modalFooter: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    justifyContent: 'flex-end',
  },
  modalLabel: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.text,
    marginBottom: theme.spacing.md,
  },
});

export default UserParticipantLinkScreen;
