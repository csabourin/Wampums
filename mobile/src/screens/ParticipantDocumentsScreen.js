/**
 * Participant Documents Screen
 *
 * Mirrors spa/view_participant_documents.js functionality
 * Shows document/form completion status for all participants
 * Allows viewing submitted forms
 */

import React, { useEffect } from 'react';
import { useSafeState } from '../hooks/useSafeState';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
} from 'react-native';
import {
  getParticipantsWithDocuments,
  getOrganizationFormFormats,
  getFormSubmission,
} from '../api/api-endpoints';
import { translate as t } from '../i18n';
import theme, { commonStyles } from '../theme';
import {
  LoadingSpinner,
  ErrorMessage,
  Card,
  Modal,
  EmptyState,
  FilterBar,
} from '../components';
import { canViewParticipants } from '../utils/PermissionUtils';

const ParticipantDocumentsScreen = ({ navigation }) => {
  const [loading, setLoading] = useSafeState(true);
  const [refreshing, setRefreshing] = useSafeState(false);
  const [error, setError] = useSafeState('');
  const [participants, setParticipants] = useSafeState([]);
  const [filteredParticipants, setFilteredParticipants] = useSafeState([]);
  const [formTypes, setFormTypes] = useSafeState([]);
  const [searchQuery, setSearchQuery] = useSafeState('');
  const [selectedForm, setSelectedForm] = useSafeState(null);
  const [modalVisible, setModalVisible] = useSafeState(false);

  useEffect(() => {
    // Check permissions
    const checkPermissions = async () => {
      if (!(await canViewParticipants())) {
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

  const loadData = async () => {
    try {
      setError('');

      // Load form formats and participant documents in parallel
      const [formFormatsResponse, participantsResponse] = await Promise.all([
        getOrganizationFormFormats(),
        getParticipantsWithDocuments(),
      ]);

      // Extract form types
      if (formFormatsResponse) {
        setFormTypes(Object.keys(formFormatsResponse));
      }

      // Set participants data
      if (participantsResponse?.participants) {
        setParticipants(participantsResponse.participants);
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
          p.last_name?.toLowerCase().includes(query)
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

  const handleViewForm = async (participantId, formType) => {
    try {
      setLoading(true);
      const formData = await getFormSubmission(participantId, formType);

      setSelectedForm({
        ...formData,
        formType,
      });
      setModalVisible(true);
    } catch (err) {
      setError(err.message || t('error_loading_form'));
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const renderFormStatus = (participant, formType) => {
    const hasForm = participant[`has_${formType}`];

    return (
      <View key={formType} style={styles.formStatusRow}>
        <Text style={styles.formTypeLabel}>{t(formType)}:</Text>
        <Text style={hasForm ? styles.statusFilled : styles.statusMissing}>
          {hasForm ? '✅' : '❌'}
        </Text>
        {hasForm && (
          <TouchableOpacity
            style={styles.viewButton}
            onPress={() => handleViewForm(participant.id, formType)}
            activeOpacity={0.7}
          >
            <Text style={styles.viewButtonText}>{t('view')}</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  const renderParticipant = ({ item }) => (
    <Card style={styles.participantCard}>
      <Text style={styles.participantName}>
        {item.first_name} {item.last_name}
      </Text>
      <View style={styles.formStatusList}>
        {formTypes.map((formType) => renderFormStatus(item, formType))}
      </View>
    </Card>
  );

  if (loading && !refreshing) {
    return <LoadingSpinner message={t('loading')} />;
  }

  if (error && !loading) {
    return <ErrorMessage message={error} onRetry={loadData} />;
  }

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
            icon="📋"
            title={t('no_participants')}
            message={t('no_participants_with_documents')}
          />
        }
      />

      {/* Form View Modal */}
      <Modal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        title={selectedForm ? t(selectedForm.formType) : t('form_view')}
        scrollable={true}
      >
        {selectedForm && (
          <View style={styles.formContent}>
            {/* Display form data - could use JSONFormRenderer equivalent */}
            <Text style={styles.formDataText}>
              {JSON.stringify(selectedForm, null, 2)}
            </Text>
          </View>
        )}
      </Modal>
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
  participantName: {
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.primary,
    marginBottom: theme.spacing.sm,
  },
  formStatusList: {
    gap: theme.spacing.sm,
  },
  formStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: theme.spacing.xs,
  },
  formTypeLabel: {
    flex: 1,
    fontSize: theme.fontSize.base,
    color: theme.colors.text,
  },
  statusFilled: {
    fontSize: theme.fontSize.lg,
    marginRight: theme.spacing.sm,
  },
  statusMissing: {
    fontSize: theme.fontSize.lg,
    marginRight: theme.spacing.sm,
  },
  viewButton: {
    backgroundColor: theme.colors.primary,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.borderRadius.sm,
    minHeight: theme.touchTarget.min,
    justifyContent: 'center',
  },
  viewButtonText: {
    color: theme.colors.selectedText,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
  },
  formContent: {
    padding: theme.spacing.md,
  },
  formDataText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.text,
    fontFamily: 'monospace',
  },
});

export default ParticipantDocumentsScreen;