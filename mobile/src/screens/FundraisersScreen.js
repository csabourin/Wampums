/**
 * Fundraisers Screen
 *
 * Mirrors spa/fundraisers.js functionality
 * Manage fundraising campaigns with calendar sales tracking
 */

import React, { useEffect } from 'react';
import { useSafeState } from '../hooks/useSafeState';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
} from 'react-native';
import { translate as t } from '../i18n';
import theme, { commonStyles } from '../theme';
import {
  LoadingSpinner,
  ErrorMessage,
  Card,
  FormField,
  Toast,
  useToast,
  Modal,
  ConfirmModal,
  EmptyState,
} from '../components';
import {
  canViewFundraisers,
  canManageFundraisers,
} from '../utils/PermissionUtils';
import {
  getFundraisers,
  createFundraiser,
  updateFundraiser,
  archiveFundraiser,
} from '../api/api-endpoints';
import { debugError } from '../utils/DebugUtils';

const FundraisersScreen = ({ navigation }) => {
  const [loading, setLoading] = useSafeState(true);
  const [refreshing, setRefreshing] = useSafeState(false);
  const [error, setError] = useSafeState('');

  const [fundraisers, setFundraisers] = useSafeState([]);
  const [archivedFundraisers, setArchivedFundraisers] = useSafeState([]);
  const [showArchived, setShowArchived] = useSafeState(false);

  // Modal state
  const [fundraiserModalVisible, setFundraiserModalVisible] = useSafeState(false);
  const [selectedFundraiser, setSelectedFundraiser] = useSafeState(null);
  const [deleteConfirmVisible, setDeleteConfirmVisible] = useSafeState(false);
  const [fundraiserToArchive, setFundraiserToArchive] = useSafeState(null);

  // Form state
  const [formData, setFormData] = useSafeState({
    name: '',
    start_date: '',
    end_date: '',
    objective: '',
  });

  const [saving, setSaving] = useSafeState(false);
  const [canManage, setCanManage] = useSafeState(false);
  const toast = useToast();

  useEffect(() => {
    // Check permission and load data
    const checkPermissionAndLoad = async () => {
      const hasPermission = await canViewFundraisers();
      if (!hasPermission) {
        navigation.goBack();
        return;
      }

      const hasManagePermission = await canManageFundraisers();
      setCanManage(hasManagePermission);

      loadData();
    };

    checkPermissionAndLoad();
  }, []);

  const loadData = async (forceRefresh = false) => {
    try {
      setError('');

      await loadFundraisers();
    } catch (err) {
      setError(err.message || t('error_loading_data'));
    } finally {
      setLoading(false);
    }
  };

  const loadFundraisers = async () => {
    try {
      const result = await getFundraisers(true);

      if (result.success && result.fundraisers) {
        const active = result.fundraisers
          .filter((f) => !f.archived)
          .sort((a, b) => new Date(b.start_date) - new Date(a.start_date));

        const archived = result.fundraisers
          .filter((f) => f.archived)
          .sort((a, b) => new Date(b.start_date) - new Date(a.start_date));

        setFundraisers(active);
        setArchivedFundraisers(archived);
      }
    } catch (err) {
      debugError('Error loading fundraisers:', err);
      setFundraisers([]);
      setArchivedFundraisers([]);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData(true);
    setRefreshing(false);
  };

  const handleAddFundraiser = () => {
    setSelectedFundraiser(null);
    setFormData({
      name: '',
      start_date: '',
      end_date: '',
      objective: '',
    });
    setFundraiserModalVisible(true);
  };

  const handleEditFundraiser = (fundraiser) => {
    setSelectedFundraiser(fundraiser);
    setFormData({
      name: fundraiser.name,
      start_date: fundraiser.start_date.split('T')[0],
      end_date: fundraiser.end_date.split('T')[0],
      objective: fundraiser.objective ? String(fundraiser.objective) : '',
    });
    setFundraiserModalVisible(true);
  };

  const handleArchiveFundraiser = (fundraiser) => {
    setFundraiserToArchive(fundraiser);
    setDeleteConfirmVisible(true);
  };

  const confirmArchiveFundraiser = async () => {
    if (!fundraiserToArchive) return;

    try {
      setSaving(true);
      setDeleteConfirmVisible(false);

      const isArchiving = !fundraiserToArchive.archived;

      const result = await archiveFundraiser(fundraiserToArchive.id, isArchiving);

      if (!result.success) {
        throw new Error(
          result.message ||
            (isArchiving ? t('error_archiving_fundraiser') : t('error_unarchiving_fundraiser'))
        );
      }

      toast.show(
        isArchiving ? t('fundraiser_archived') : t('fundraiser_unarchived'),
        'success'
      );
      setFundraiserToArchive(null);
      await loadData(true);
    } catch (err) {
      toast.show(
        err.message ||
          (fundraiserToArchive.archived
            ? t('error_unarchiving_fundraiser')
            : t('error_archiving_fundraiser')),
        'error'
      );
    } finally {
      setSaving(false);
    }
  };

  const handleSaveFundraiser = async () => {
    // Validate
    if (!formData.name || !formData.start_date || !formData.end_date) {
      toast.show(t('fill_required_fields'), 'warning');
      return;
    }

    try {
      setSaving(true);

      const payload = {
        name: formData.name,
        start_date: formData.start_date,
        end_date: formData.end_date,
        objective: formData.objective ? parseFloat(formData.objective) : null,
      };

      const result = selectedFundraiser
        ? await updateFundraiser(selectedFundraiser.id, payload)
        : await createFundraiser(payload);

      if (!result.success) {
        throw new Error(result.message || t('error_saving_fundraiser'));
      }

      toast.show(
        selectedFundraiser ? t('fundraiser_updated') : t('fundraiser_created'),
        'success'
      );
      setFundraiserModalVisible(false);
      await loadData(true);
    } catch (err) {
      toast.show(err.message || t('error_saving_fundraiser'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleViewCalendars = (fundraiser) => {
    navigation.navigate('Calendar', { fundraiserId: fundraiser.id });
  };

  const isActive = (fundraiser) => {
    const now = new Date();
    const start = new Date(fundraiser.start_date);
    const end = new Date(fundraiser.end_date);
    return now >= start && now <= end;
  };

  const renderFundraiserCard = (fundraiser) => {
    const startDate = new Date(fundraiser.start_date).toLocaleDateString();
    const endDate = new Date(fundraiser.end_date).toLocaleDateString();
    const active = isActive(fundraiser);
    const archived = fundraiser.archived;

    return (
      <Card key={fundraiser.id} style={styles.fundraiserCard}>
        <View style={styles.cardHeader}>
          <Text style={styles.fundraiserName}>{fundraiser.name}</Text>
          {archived ? (
            <View style={[styles.statusBadge, styles.statusBadgeArchived]}>
              <Text style={styles.statusBadgeText}>{t('archived')}</Text>
            </View>
          ) : active ? (
            <View style={[styles.statusBadge, styles.statusBadgeActive]}>
              <Text style={styles.statusBadgeText}>{t('active')}</Text>
            </View>
          ) : (
            <View style={[styles.statusBadge, styles.statusBadgeInactive]}>
              <Text style={styles.statusBadgeText}>{t('inactive')}</Text>
            </View>
          )}
        </View>

        <View style={styles.cardBody}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>{t('start_date')}:</Text>
            <Text style={styles.infoValue}>{startDate}</Text>
          </View>

          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>{t('end_date')}:</Text>
            <Text style={styles.infoValue}>{endDate}</Text>
          </View>

          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>{t('participants')}:</Text>
            <Text style={styles.infoValue}>{fundraiser.participant_count || 0}</Text>
          </View>

          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>{t('total_sold')}:</Text>
            <Text style={styles.infoValue}>{fundraiser.total_amount || 0}</Text>
          </View>

          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>{t('total_collected')}:</Text>
            <Text style={styles.infoValue}>
              ${parseFloat(fundraiser.total_paid || 0).toFixed(2)}
            </Text>
          </View>

          {fundraiser.objective && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>{t('objective')}:</Text>
              <Text style={styles.infoValue}>
                ${parseFloat(fundraiser.objective).toFixed(2)}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.cardFooter}>
          <TouchableOpacity
            style={[commonStyles.button, styles.footerButton]}
            onPress={() => handleViewCalendars(fundraiser)}
            activeOpacity={0.7}
          >
            <Text style={commonStyles.buttonText}>{t('view_fundraiser_entries')}</Text>
          </TouchableOpacity>

          {canManage && (
            <View style={styles.actionButtons}>
              <TouchableOpacity
                style={[commonStyles.buttonSecondary, styles.actionButton]}
                onPress={() => handleEditFundraiser(fundraiser)}
                activeOpacity={0.7}
              >
                <Text style={commonStyles.buttonSecondaryText}>{t('edit')}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  archived ? commonStyles.buttonSecondary : commonStyles.buttonDanger,
                  styles.actionButton,
                ]}
                onPress={() => handleArchiveFundraiser(fundraiser)}
                activeOpacity={0.7}
              >
                <Text
                  style={
                    archived
                      ? commonStyles.buttonSecondaryText
                      : commonStyles.buttonDangerText
                  }
                >
                  {archived ? t('unarchive') : t('archive')}
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </Card>
    );
  };

  if (loading && !refreshing) {
    return <LoadingSpinner message={t('loading')} />;
  }

  if (error && !loading) {
    return <ErrorMessage message={error} onRetry={loadData} />;
  }

  return (
    <View style={commonStyles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContainer}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>{t('fundraisers')}</Text>
        </View>

        {/* Add Button */}
        {canManage && (
          <TouchableOpacity
            style={[commonStyles.button, styles.addButton]}
            onPress={handleAddFundraiser}
            activeOpacity={0.7}
          >
            <Text style={commonStyles.buttonText}>{t('add_fundraiser')}</Text>
          </TouchableOpacity>
        )}

        {/* Active Fundraisers */}
        {fundraisers.length === 0 ? (
          <EmptyState message={t('no_fundraisers')} icon="📅" />
        ) : (
          <View style={styles.fundraisersList}>
            {fundraisers.map((fundraiser) => renderFundraiserCard(fundraiser))}
          </View>
        )}

        {/* Archived Section */}
        {archivedFundraisers.length > 0 && (
          <View style={styles.archivedSection}>
            <TouchableOpacity
              style={styles.toggleButton}
              onPress={() => setShowArchived(!showArchived)}
              activeOpacity={0.7}
            >
              <Text style={styles.toggleButtonText}>
                {showArchived ? t('hide_archived_fundraisers') : t('show_archived_fundraisers')}{' '}
                ({archivedFundraisers.length})
              </Text>
            </TouchableOpacity>

            {showArchived && (
              <View style={styles.archivedList}>
                {archivedFundraisers.map((fundraiser) => renderFundraiserCard(fundraiser))}
              </View>
            )}
          </View>
        )}
      </ScrollView>

      {/* Fundraiser Modal */}
      <Modal
        visible={fundraiserModalVisible}
        onClose={() => {
          setFundraiserModalVisible(false);
          setSelectedFundraiser(null);
        }}
        title={selectedFundraiser ? t('edit_fundraiser') : t('add_fundraiser')}
        footer={
          <View style={styles.modalFooter}>
            <TouchableOpacity
              style={commonStyles.buttonSecondary}
              onPress={() => {
                setFundraiserModalVisible(false);
                setSelectedFundraiser(null);
              }}
              activeOpacity={0.7}
            >
              <Text style={commonStyles.buttonSecondaryText}>{t('cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[commonStyles.button, saving && commonStyles.buttonDisabled]}
              onPress={handleSaveFundraiser}
              disabled={saving}
              activeOpacity={0.7}
            >
              <Text style={commonStyles.buttonText}>{saving ? t('saving') : t('save')}</Text>
            </TouchableOpacity>
          </View>
        }
      >
        <ScrollView>
          <FormField
            label={t('name')}
            value={formData.name}
            onChangeText={(value) => setFormData({ ...formData, name: value })}
            placeholder={t('enter_fundraiser_name')}
            required
          />

          <FormField
            label={t('start_date')}
            value={formData.start_date}
            onChangeText={(value) => setFormData({ ...formData, start_date: value })}
            placeholder="YYYY-MM-DD"
            required
          />

          <FormField
            label={t('end_date')}
            value={formData.end_date}
            onChangeText={(value) => setFormData({ ...formData, end_date: value })}
            placeholder="YYYY-MM-DD"
            required
          />

          <FormField
            label={t('objective')}
            value={formData.objective}
            onChangeText={(value) => setFormData({ ...formData, objective: value })}
            placeholder="0.00"
            keyboardType="decimal-pad"
          />
        </ScrollView>
      </Modal>

      {/* Archive Confirm Modal */}
      <ConfirmModal
        visible={deleteConfirmVisible}
        onClose={() => {
          setDeleteConfirmVisible(false);
          setFundraiserToArchive(null);
        }}
        onConfirm={confirmArchiveFundraiser}
        title={
          fundraiserToArchive?.archived
            ? t('confirm_unarchive_fundraiser')
            : t('confirm_archive_fundraiser')
        }
        message={
          fundraiserToArchive?.archived
            ? t('confirm_unarchive_fundraiser_message')
            : t('confirm_archive_fundraiser_message')
        }
        confirmText={fundraiserToArchive?.archived ? t('unarchive') : t('archive')}
        cancelText={t('cancel')}
      />

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
  scrollContainer: {
    padding: theme.spacing.md,
  },
  header: {
    marginBottom: theme.spacing.md,
    alignItems: 'center',
  },
  title: {
    fontSize: theme.fontSize.xxl,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.primary,
  },
  addButton: {
    marginBottom: theme.spacing.md,
  },
  fundraisersList: {
    gap: theme.spacing.md,
  },
  fundraiserCard: {
    marginBottom: 0,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.md,
  },
  fundraiserName: {
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.text,
    flex: 1,
  },
  statusBadge: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.borderRadius.sm,
  },
  statusBadgeActive: {
    backgroundColor: theme.colors.success,
  },
  statusBadgeInactive: {
    backgroundColor: theme.colors.textMuted,
  },
  statusBadgeArchived: {
    backgroundColor: theme.colors.warning,
  },
  statusBadgeText: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.white,
    textTransform: 'uppercase',
  },
  cardBody: {
    marginBottom: theme.spacing.md,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: theme.spacing.xs,
  },
  infoLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.text,
  },
  infoValue: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
  },
  cardFooter: {
    gap: theme.spacing.sm,
  },
  footerButton: {
    marginBottom: theme.spacing.sm,
  },
  actionButtons: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  actionButton: {
    flex: 1,
  },
  archivedSection: {
    marginTop: theme.spacing.lg,
  },
  toggleButton: {
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.md,
    backgroundColor: theme.colors.background,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: 'center',
    marginBottom: theme.spacing.md,
    minHeight: theme.touchTarget.min,
    justifyContent: 'center',
  },
  toggleButtonText: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.primary,
  },
  archivedList: {
    gap: theme.spacing.md,
  },
  modalFooter: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    justifyContent: 'flex-end',
  },
});

export default FundraisersScreen;