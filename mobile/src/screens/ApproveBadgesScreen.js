/**
 * Approve Badges Screen
 *
 * Mirrors spa/approve_badges.js functionality
 * Shows pending badge submissions for leader approval
 * Approve or reject badge progress entries
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { getPendingBadges, updateBadgeStatus } from '../api/api-endpoints';
import { translate as t } from '../i18n';
import theme, { commonStyles } from '../theme';
import {
  LoadingSpinner,
  ErrorMessage,
  Card,
  ConfirmModal,
  Toast,
  useToast,
  EmptyState,
} from '../components';
import { canApproveBadges } from '../utils/PermissionUtils';
import DateUtils from '../utils/DateUtils';

const ApproveBadgesScreen = ({ navigation }) => {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [pendingBadges, setPendingBadges] = useState([]);
  const [confirmModalVisible, setConfirmModalVisible] = useState(false);
  const [selectedBadge, setSelectedBadge] = useState(null);
  const [selectedAction, setSelectedAction] = useState(null);
  const toast = useToast();

  useEffect(() => {
    // Check permissions and load data
    const checkPermissionsAndLoad = async () => {
      const hasPermission = await canApproveBadges();
      if (!hasPermission) {
        navigation.goBack();
        return;
      }

      loadData();
    };

    checkPermissionsAndLoad();
  }, []);

  const loadData = async (forceRefresh = false) => {
    try {
      setError('');

      const response = await getPendingBadges({ forceRefresh });
      const badges = response?.data || response || [];

      if (!Array.isArray(badges)) {
        setPendingBadges([]);
      } else {
        setPendingBadges(badges);
      }
    } catch (err) {
      setError(err.message || t('error_loading_data'));
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData(true);
    setRefreshing(false);
  };

  const getBadgeLabel = (badge) => {
    return (
      t(badge.translation_key) ||
      badge.badge_name ||
      badge.territoire_chasse ||
      t('badge_unknown_label')
    );
  };

  const handleActionPress = (badge, action) => {
    setSelectedBadge(badge);
    setSelectedAction(action);
    setConfirmModalVisible(true);
  };

  const handleConfirmAction = async () => {
    if (!selectedBadge || !selectedAction) {
      return;
    }

    try {
      setLoading(true);
      setConfirmModalVisible(false);

      const result = await updateBadgeStatus(selectedBadge.id, selectedAction);

      if (result.success) {
        toast.show(t('badge_status_updated'), 'success');
        await loadData(true); // Force refresh to get updated data
      } else {
        throw new Error(result.message || t('error_updating_badge_status'));
      }
    } catch (err) {
      toast.show(err.message || t('error_updating_badge_status'), 'error');
    } finally {
      setLoading(false);
      setSelectedBadge(null);
      setSelectedAction(null);
    }
  };

  const renderBadgeRequest = ({ item: badge }) => {
    const badgeLabel = getBadgeLabel(badge);
    const levelLabel = t('badge_level_label') || t('badge_star_label') || t('stars');

    return (
      <Card style={styles.badgeCard}>
        <Text style={styles.participantName}>
          {badge.first_name} {badge.last_name}
        </Text>

        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>{t('badge_select_badge') || t('badge')}:</Text>
          <Text style={styles.detailValue}>{badgeLabel}</Text>
        </View>

        {badge.badge_section && (
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>
              {t('badge_section_label') || t('section')}:
            </Text>
            <Text style={styles.detailValue}>{badge.badge_section}</Text>
          </View>
        )}

        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>{levelLabel}:</Text>
          <Text style={styles.detailValue}>{badge.etoiles}</Text>
        </View>

        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>{t('objectif')}:</Text>
          <Text style={styles.detailValue}>{badge.objectif}</Text>
        </View>

        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>{t('description')}:</Text>
          <Text style={styles.detailValue}>{badge.description}</Text>
        </View>

        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>{t('date')}:</Text>
          <Text style={styles.detailValue}>
            {DateUtils.formatDate(new Date(badge.date_obtention))}
          </Text>
        </View>

        {badge.fierte && (
          <View style={styles.fierteRow}>
            <Text style={styles.fierteIcon}>⭐</Text>
            <Text style={styles.fierteText}>{t('fierte')}</Text>
          </View>
        )}

        {badge.raison && (
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>{t('raison')}:</Text>
            <Text style={styles.detailValue}>{badge.raison}</Text>
          </View>
        )}

        <View style={styles.actionButtons}>
          <TouchableOpacity
            style={[styles.actionButton, styles.approveButton]}
            onPress={() => handleActionPress(badge, 'approved')}
            activeOpacity={0.7}
          >
            <Text style={styles.actionButtonText}>{t('approve')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, styles.rejectButton]}
            onPress={() => handleActionPress(badge, 'rejected')}
            activeOpacity={0.7}
          >
            <Text style={styles.actionButtonText}>{t('reject')}</Text>
          </TouchableOpacity>
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

  const confirmMessage =
    selectedAction === 'approved'
      ? t('confirm_approve_badge')
      : t('confirm_reject_badge');

  return (
    <View style={commonStyles.container}>
      {pendingBadges.length === 0 ? (
        <ScrollView
          contentContainerStyle={styles.scrollContainer}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          <EmptyState
            icon="🏆"
            title={t('no_pending_badges')}
            message={t('no_pending_badges_description')}
          />
        </ScrollView>
      ) : (
        <FlatList
          data={pendingBadges}
          renderItem={renderBadgeRequest}
          keyExtractor={(item) => `badge-${item.id}`}
          contentContainerStyle={styles.listContainer}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        />
      )}

      {/* Confirm Modal */}
      <ConfirmModal
        visible={confirmModalVisible}
        onClose={() => {
          setConfirmModalVisible(false);
          setSelectedBadge(null);
          setSelectedAction(null);
        }}
        onConfirm={handleConfirmAction}
        title={t('confirm_action')}
        message={confirmMessage}
        confirmText={selectedAction === 'approved' ? t('approve') : t('reject')}
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
    flexGrow: 1,
    padding: theme.spacing.md,
  },
  listContainer: {
    padding: theme.spacing.md,
  },
  badgeCard: {
    marginBottom: theme.spacing.md,
  },
  participantName: {
    fontSize: theme.fontSize.xl,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.primary,
    marginBottom: theme.spacing.md,
  },
  detailRow: {
    marginBottom: theme.spacing.sm,
  },
  detailLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.textMuted,
    marginBottom: theme.spacing.xs,
  },
  detailValue: {
    fontSize: theme.fontSize.base,
    color: theme.colors.text,
    lineHeight: theme.fontSize.base * theme.lineHeight.relaxed,
  },
  fierteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    marginVertical: theme.spacing.sm,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    backgroundColor: theme.colors.warningLight || '#fff9e6',
    borderRadius: theme.borderRadius.sm,
    borderLeftWidth: 4,
    borderLeftColor: theme.colors.warning,
  },
  fierteIcon: {
    fontSize: 24,
  },
  fierteText: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.text,
  },
  actionButtons: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.md,
  },
  actionButton: {
    flex: 1,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.borderRadius.sm,
    minHeight: theme.touchTarget.min,
    justifyContent: 'center',
    alignItems: 'center',
  },
  approveButton: {
    backgroundColor: theme.colors.success,
  },
  rejectButton: {
    backgroundColor: theme.colors.error,
  },
  actionButtonText: {
    color: theme.colors.selectedText,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
  },
});

export default ApproveBadgesScreen;
