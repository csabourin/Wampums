/**
 * Badge Tracker Screen
 *
 * Scout Badge Tracker with approval queue and delivery tracking
 * Workflow: Star submitted -> pending -> approved -> delivered
 *
 * Star types:
 * - proie: Individual accomplishment (single participant)
 * - battue: Group activity (multiple participants)
 */

import React, { useEffect, useMemo, useCallback, useRef } from 'react';
import { useSafeState } from '../hooks/useSafeState';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Alert,
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { useNavigation } from '@react-navigation/native';
import {
  getBadgeTrackerSummary,
  saveBadgeProgress,
  approveBadge,
  rejectBadge,
  markBadgeDelivered,
  markBadgesDeliveredBulk,
  getBadgeSystemSettings,
} from '../api/api-endpoints';
import { translate as t } from '../i18n';
import theme, { commonStyles } from '../theme';
import {
  LoadingSpinner,
  ErrorMessage,
  Card,
  EmptyState,
  Modal,
  useToast,
} from '../components';
import { canViewBadges, canApproveBadges, canManageBadges } from '../utils/PermissionUtils';
import { debugLog, debugError } from '../utils/DebugUtils';
import { formatDate } from '../utils/DateUtils';

// View modes for the tracker
const VIEW_MODES = {
  PARTICIPANTS: 'participants',
  PENDING: 'pending',
  DELIVERY: 'delivery',
};

const BadgeTrackerScreen = () => {
  const navigation = useNavigation();
  const toast = useToast();

  // Data state
  const [loading, setLoading] = useSafeState(true);
  const [refreshing, setRefreshing] = useSafeState(false);
  const [error, setError] = useSafeState('');
  const [participants, setParticipants] = useSafeState([]);
  const [templates, setTemplates] = useSafeState([]);
  const [badges, setBadges] = useSafeState([]);
  const [stats, setStats] = useSafeState(null);
  const [badgeSettings, setBadgeSettings] = useSafeState(null);

  // UI state
  const [viewMode, setViewMode] = useSafeState(VIEW_MODES.PARTICIPANTS);
  const [searchQuery, setSearchQuery] = useSafeState('');
  const [expandedParticipantId, setExpandedParticipantId] = useSafeState(null);
  const [selectedDeliveryItems, setSelectedDeliveryItems] = useSafeState(new Set());

  // Modal state
  const [addStarModalVisible, setAddStarModalVisible] = useSafeState(false);
  const [selectedParticipantForStar, setSelectedParticipantForStar] = useSafeState(null);
  const [starFormData, setStarFormData] = useSafeState({
    templateId: '',
    level: 1,
    objectif: '',
    description: '',
    fierte: '',
    starType: 'proie',
  });

  // Permissions state
  const [permissions, setPermissions] = useSafeState({
    canView: false,
    canApprove: false,
    canManage: false,
  });

  useEffect(() => {
    const checkPermissionsAndLoad = async () => {
      debugLog('[BadgeTracker] Checking permissions...');
      const hasViewPermission = await canViewBadges();
      const hasApprovePermission = await canApproveBadges();
      const hasManagePermission = await canManageBadges();

      setPermissions({
        canView: hasViewPermission,
        canApprove: hasApprovePermission,
        canManage: hasManagePermission,
      });

      debugLog('[BadgeTracker] Permissions:', { hasViewPermission, hasApprovePermission, hasManagePermission });

      if (!hasViewPermission && !hasApprovePermission && !hasManagePermission) {
        debugError('[BadgeTracker] No badge permissions, going back');
        toast.show(t('error_permission_denied'), 'error');
        setTimeout(() => navigation.goBack(), 100);
        return;
      }

      loadData();
    };

    checkPermissionsAndLoad();
  }, []);

  const loadData = async (forceRefresh = false) => {
    try {
      setError('');

      const [summaryResponse, settingsResponse] = await Promise.all([
        getBadgeTrackerSummary({ forceRefresh }),
        getBadgeSystemSettings({ forceRefresh }),
      ]);

      if (summaryResponse.success) {
        setParticipants(summaryResponse.data?.participants || []);
        setTemplates(summaryResponse.data?.templates || []);
        setBadges(summaryResponse.data?.badges || []);
        setStats(summaryResponse.data?.stats || null);
      }

      setBadgeSettings(settingsResponse?.data || null);
    } catch (err) {
      debugError('[BadgeTracker] Error loading data:', err);
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

  // Build participant records with their badges
  const participantRecords = useMemo(() => {
    const participantMap = new Map();

    // Initialize participants
    participants.forEach(p => {
      participantMap.set(p.id, {
        ...p,
        badges: [],
        totalStars: 0,
        pendingCount: 0,
        awaitingDelivery: 0,
      });
    });

    // Add badges to participants
    badges.forEach(badge => {
      const participant = participantMap.get(badge.participant_id);
      if (participant) {
        participant.badges.push(badge);
        if (badge.status === 'approved') {
          participant.totalStars++;
          if (!badge.delivered_at) {
            participant.awaitingDelivery++;
          }
        } else if (badge.status === 'pending') {
          participant.pendingCount++;
        }
      }
    });

    return Array.from(participantMap.values());
  }, [participants, badges]);

  // Filter participants by search query
  const filteredParticipants = useMemo(() => {
    if (!searchQuery.trim()) return participantRecords;

    const query = searchQuery.toLowerCase();
    return participantRecords.filter(p => {
      const fullName = `${p.first_name} ${p.last_name}`.toLowerCase();
      return fullName.includes(query);
    });
  }, [participantRecords, searchQuery]);

  // Get pending badges for approval queue
  const pendingBadges = useMemo(() => {
    return badges.filter(b => b.status === 'pending').map(badge => {
      const participant = participants.find(p => p.id === badge.participant_id);
      const template = templates.find(t => t.id === badge.badge_template_id);
      return {
        ...badge,
        participantName: participant ? `${participant.first_name} ${participant.last_name}` : t('unknown'),
        templateName: template?.name || badge.territoire_chasse || t('badge_unknown_label'),
      };
    });
  }, [badges, participants, templates]);

  // Get badges awaiting delivery
  const deliveryQueue = useMemo(() => {
    return badges
      .filter(b => b.status === 'approved' && !b.delivered_at)
      .map(badge => {
        const participant = participants.find(p => p.id === badge.participant_id);
        const template = templates.find(t => t.id === badge.badge_template_id);
        return {
          ...badge,
          participantName: participant ? `${participant.first_name} ${participant.last_name}` : t('unknown'),
          templateName: template?.name || badge.territoire_chasse || t('badge_unknown_label'),
        };
      });
  }, [badges, participants, templates]);

  // Handle star approval
  const handleApprove = async (badgeId) => {
    try {
      const result = await approveBadge(badgeId);
      if (result.success) {
        toast.show(t('badge_approved_success') || 'Star approved!', 'success');
        await loadData(true);
      } else {
        toast.show(result.message || t('error_generic'), 'error');
      }
    } catch (err) {
      debugError('[BadgeTracker] Error approving badge:', err);
      toast.show(err.message || t('error_generic'), 'error');
    }
  };

  // Handle star rejection
  const handleReject = async (badgeId) => {
    Alert.prompt(
      t('badge_reject_title') || 'Reject Star',
      t('badge_reject_reason_prompt') || 'Enter reason for rejection (optional):',
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('reject') || 'Reject',
          style: 'destructive',
          onPress: async (reason) => {
            try {
              const result = await rejectBadge(badgeId, reason || '');
              if (result.success) {
                toast.show(t('badge_rejected_success') || 'Star rejected', 'success');
                await loadData(true);
              } else {
                toast.show(result.message || t('error_generic'), 'error');
              }
            } catch (err) {
              debugError('[BadgeTracker] Error rejecting badge:', err);
              toast.show(err.message || t('error_generic'), 'error');
            }
          },
        },
      ],
      'plain-text'
    );
  };

  // Handle marking badge as delivered
  const handleMarkDelivered = async (badgeId) => {
    try {
      const result = await markBadgeDelivered(badgeId);
      if (result.success) {
        toast.show(t('badge_delivered_success') || 'Badge marked as delivered!', 'success');
        await loadData(true);
      } else {
        toast.show(result.message || t('error_generic'), 'error');
      }
    } catch (err) {
      debugError('[BadgeTracker] Error marking delivered:', err);
      toast.show(err.message || t('error_generic'), 'error');
    }
  };

  // Handle bulk delivery
  const handleBulkDelivery = async () => {
    if (selectedDeliveryItems.size === 0) {
      toast.show(t('badge_select_items_first') || 'Select items first', 'warning');
      return;
    }

    try {
      const badgeIds = Array.from(selectedDeliveryItems);
      const result = await markBadgesDeliveredBulk(badgeIds);
      if (result.success) {
        toast.show(
          t('badge_bulk_delivered_success', { count: badgeIds.length }) ||
          `${badgeIds.length} badges marked as delivered!`,
          'success'
        );
        setSelectedDeliveryItems(new Set());
        await loadData(true);
      } else {
        toast.show(result.message || t('error_generic'), 'error');
      }
    } catch (err) {
      debugError('[BadgeTracker] Error bulk marking delivered:', err);
      toast.show(err.message || t('error_generic'), 'error');
    }
  };

  // Toggle delivery item selection
  const toggleDeliverySelection = (badgeId) => {
    setSelectedDeliveryItems(prev => {
      const newSet = new Set(prev);
      if (newSet.has(badgeId)) {
        newSet.delete(badgeId);
      } else {
        newSet.add(badgeId);
      }
      return newSet;
    });
  };

  // Select all delivery items
  const selectAllDelivery = () => {
    setSelectedDeliveryItems(new Set(deliveryQueue.map(b => b.id)));
  };

  // Clear delivery selection
  const clearDeliverySelection = () => {
    setSelectedDeliveryItems(new Set());
  };

  // Open add star modal
  const openAddStarModal = (participant) => {
    setSelectedParticipantForStar(participant);
    setStarFormData({
      templateId: templates[0]?.id || '',
      level: 1,
      objectif: '',
      description: '',
      fierte: '',
      starType: 'proie',
    });
    setAddStarModalVisible(true);
  };

  // Submit new star
  const handleSubmitStar = async () => {
    if (!selectedParticipantForStar) return;

    if (!starFormData.objectif.trim()) {
      toast.show(t('badge_objectif_required') || 'Goal/objective is required', 'error');
      return;
    }

    try {
      const template = templates.find(t => t.id === Number(starFormData.templateId));

      const badgeData = {
        participant_id: selectedParticipantForStar.id,
        badge_template_id: starFormData.templateId || null,
        territoire_chasse: template?.name || t('badge_custom'),
        etoiles: starFormData.level,
        objectif: starFormData.objectif,
        description: starFormData.description,
        fierte: starFormData.fierte,
        star_type: starFormData.starType,
        status: 'pending',
      };

      const result = await saveBadgeProgress(badgeData);
      if (result.success) {
        toast.show(t('badge_submitted_success') || 'Star submitted for approval!', 'success');
        setAddStarModalVisible(false);
        await loadData(true);
      } else {
        toast.show(result.message || t('error_generic'), 'error');
      }
    } catch (err) {
      debugError('[BadgeTracker] Error submitting star:', err);
      toast.show(err.message || t('error_generic'), 'error');
    }
  };

  // Get template name by ID
  const getTemplateName = (templateId) => {
    const template = templates.find(t => t.id === templateId);
    return template?.name || t('badge_unknown_label');
  };

  // Render stats summary
  const renderStats = () => {
    if (!stats) return null;

    return (
      <View style={styles.statsContainer}>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{stats.totalParticipants || 0}</Text>
          <Text style={styles.statLabel}>{t('badge_participants') || 'Participants'}</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{stats.totalStars || 0}</Text>
          <Text style={styles.statLabel}>{t('badge_total_stars') || 'Total Stars'}</Text>
        </View>
        <View style={[styles.statCard, styles.statCardWarning]}>
          <Text style={styles.statValue}>{stats.pendingApproval || 0}</Text>
          <Text style={styles.statLabel}>{t('badge_pending') || 'Pending'}</Text>
        </View>
        <View style={[styles.statCard, styles.statCardInfo]}>
          <Text style={styles.statValue}>{stats.awaitingDelivery || 0}</Text>
          <Text style={styles.statLabel}>{t('badge_to_deliver') || 'To Deliver'}</Text>
        </View>
      </View>
    );
  };

  // Render view mode tabs
  const renderViewTabs = () => (
    <View style={styles.viewTabs}>
      <TouchableOpacity
        style={[styles.viewTab, viewMode === VIEW_MODES.PARTICIPANTS && styles.viewTabActive]}
        onPress={() => setViewMode(VIEW_MODES.PARTICIPANTS)}
      >
        <Text style={[styles.viewTabText, viewMode === VIEW_MODES.PARTICIPANTS && styles.viewTabTextActive]}>
          {t('badge_participants') || 'Participants'}
        </Text>
      </TouchableOpacity>

      {permissions.canApprove && (
        <TouchableOpacity
          style={[styles.viewTab, viewMode === VIEW_MODES.PENDING && styles.viewTabActive]}
          onPress={() => setViewMode(VIEW_MODES.PENDING)}
        >
          <Text style={[styles.viewTabText, viewMode === VIEW_MODES.PENDING && styles.viewTabTextActive]}>
            {t('badge_pending_queue') || 'Pending'} ({pendingBadges.length})
          </Text>
        </TouchableOpacity>
      )}

      {permissions.canManage && (
        <TouchableOpacity
          style={[styles.viewTab, viewMode === VIEW_MODES.DELIVERY && styles.viewTabActive]}
          onPress={() => setViewMode(VIEW_MODES.DELIVERY)}
        >
          <Text style={[styles.viewTabText, viewMode === VIEW_MODES.DELIVERY && styles.viewTabTextActive]}>
            {t('badge_delivery') || 'Delivery'} ({deliveryQueue.length})
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );

  // Render participant card
  const renderParticipantCard = ({ item: participant }) => {
    const isExpanded = expandedParticipantId === participant.id;

    return (
      <Card style={styles.participantCard}>
        <TouchableOpacity
          style={styles.participantHeader}
          onPress={() => setExpandedParticipantId(isExpanded ? null : participant.id)}
          activeOpacity={0.7}
        >
          <View style={styles.participantInfo}>
            <Text style={styles.participantName}>
              {participant.first_name} {participant.last_name}
            </Text>
            <View style={styles.participantStats}>
              <Text style={styles.starCount}>{participant.totalStars} {t('stars') || 'stars'}</Text>
              {participant.pendingCount > 0 && (
                <View style={styles.pendingBadge}>
                  <Text style={styles.pendingBadgeText}>{participant.pendingCount} {t('badge_pending_short') || 'pending'}</Text>
                </View>
              )}
              {participant.awaitingDelivery > 0 && (
                <View style={styles.deliveryBadge}>
                  <Text style={styles.deliveryBadgeText}>{participant.awaitingDelivery} {t('badge_to_deliver_short') || 'to deliver'}</Text>
                </View>
              )}
            </View>
          </View>
          <View style={styles.participantActions}>
            {permissions.canManage && (
              <TouchableOpacity
                style={styles.addButton}
                onPress={() => openAddStarModal(participant)}
                activeOpacity={0.7}
              >
                <Text style={styles.addButtonText}>+</Text>
              </TouchableOpacity>
            )}
            <Text style={styles.expandIcon}>{isExpanded ? '▼' : '▶'}</Text>
          </View>
        </TouchableOpacity>

        {isExpanded && (
          <View style={styles.badgesList}>
            {participant.badges.length === 0 ? (
              <Text style={styles.noBadgesText}>{t('badge_no_entries') || 'No badges yet'}</Text>
            ) : (
              participant.badges.map(badge => (
                <View key={badge.id} style={styles.badgeItem}>
                  <View style={styles.badgeInfo}>
                    <Text style={styles.badgeName}>
                      {getTemplateName(badge.badge_template_id) || badge.territoire_chasse}
                    </Text>
                    <Text style={styles.badgeLevel}>
                      {t('badge_level_label') || 'Level'} {badge.etoiles}
                    </Text>
                    {badge.star_type && (
                      <Text style={styles.starType}>
                        {badge.star_type === 'proie' ? t('badge_type_proie') || 'Individual' : t('badge_type_battue') || 'Group'}
                      </Text>
                    )}
                  </View>
                  <View style={[
                    styles.statusBadge,
                    badge.status === 'approved' && styles.statusApproved,
                    badge.status === 'pending' && styles.statusPending,
                    badge.status === 'rejected' && styles.statusRejected,
                  ]}>
                    <Text style={styles.statusText}>
                      {badge.status === 'approved' && badge.delivered_at
                        ? t('badge_delivered') || 'Delivered'
                        : t(`badge_status_${badge.status}`) || badge.status}
                    </Text>
                  </View>
                </View>
              ))
            )}
          </View>
        )}
      </Card>
    );
  };

  // Render pending approval item
  const renderPendingItem = ({ item: badge }) => (
    <Card style={styles.queueCard}>
      <View style={styles.queueHeader}>
        <Text style={styles.queueName}>{badge.participantName}</Text>
        <Text style={styles.queueBadge}>{badge.templateName}</Text>
      </View>

      <View style={styles.queueDetails}>
        <Text style={styles.queueLevel}>{t('badge_level_label') || 'Level'}: {badge.etoiles}</Text>
        {badge.star_type && (
          <Text style={styles.queueType}>
            {badge.star_type === 'proie' ? t('badge_type_proie') || 'Individual' : t('badge_type_battue') || 'Group'}
          </Text>
        )}
      </View>

      {badge.objectif && (
        <Text style={styles.queueObjectif} numberOfLines={2}>
          {t('badge_goal')}: {badge.objectif}
        </Text>
      )}

      <View style={styles.queueActions}>
        <TouchableOpacity
          style={[styles.actionButton, styles.approveButton]}
          onPress={() => handleApprove(badge.id)}
          activeOpacity={0.7}
        >
          <Text style={styles.actionButtonText}>{t('approve') || 'Approve'}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionButton, styles.rejectButton]}
          onPress={() => handleReject(badge.id)}
          activeOpacity={0.7}
        >
          <Text style={styles.actionButtonText}>{t('reject') || 'Reject'}</Text>
        </TouchableOpacity>
      </View>
    </Card>
  );

  // Render delivery queue item
  const renderDeliveryItem = ({ item: badge }) => {
    const isSelected = selectedDeliveryItems.has(badge.id);

    return (
      <Card style={[styles.queueCard, isSelected && styles.selectedCard]}>
        <TouchableOpacity
          style={styles.deliveryRow}
          onPress={() => toggleDeliverySelection(badge.id)}
          activeOpacity={0.7}
        >
          <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
            {isSelected && <Text style={styles.checkmark}>✓</Text>}
          </View>

          <View style={styles.deliveryInfo}>
            <Text style={styles.queueName}>{badge.participantName}</Text>
            <Text style={styles.queueBadge}>{badge.templateName}</Text>
            <Text style={styles.queueLevel}>
              {t('badge_level_label') || 'Level'}: {badge.etoiles}
              {badge.star_type && ` - ${badge.star_type === 'proie' ? t('badge_type_proie') || 'Individual' : t('badge_type_battue') || 'Group'}`}
            </Text>
            {badge.approval_date && (
              <Text style={styles.approvalDate}>
                {t('badge_approved_on') || 'Approved'}: {formatDate(badge.approval_date)}
              </Text>
            )}
          </View>

          <TouchableOpacity
            style={styles.deliverButton}
            onPress={() => handleMarkDelivered(badge.id)}
            activeOpacity={0.7}
          >
            <Text style={styles.deliverButtonText}>{t('badge_mark_delivered') || 'Deliver'}</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </Card>
    );
  };

  // Render content based on view mode
  const renderContent = () => {
    switch (viewMode) {
      case VIEW_MODES.PARTICIPANTS:
        return (
          <FlatList
            data={filteredParticipants}
            renderItem={renderParticipantCard}
            keyExtractor={item => `participant-${item.id}`}
            contentContainerStyle={styles.listContainer}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
            ListEmptyComponent={
              <EmptyState
                icon="👤"
                title={searchQuery ? t('no_search_results') || 'No results' : t('no_participants') || 'No participants'}
                message={searchQuery ? t('try_different_search') || 'Try a different search' : t('no_participants_description') || 'Add participants to track badges'}
              />
            }
          />
        );

      case VIEW_MODES.PENDING:
        return (
          <FlatList
            data={pendingBadges}
            renderItem={renderPendingItem}
            keyExtractor={item => `pending-${item.id}`}
            contentContainerStyle={styles.listContainer}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
            ListEmptyComponent={
              <EmptyState
                icon="✓"
                title={t('no_pending_badges') || 'No pending approvals'}
                message={t('no_pending_badges_description') || 'All badges have been reviewed'}
              />
            }
          />
        );

      case VIEW_MODES.DELIVERY:
        return (
          <>
            {deliveryQueue.length > 0 && (
              <View style={styles.bulkActions}>
                <TouchableOpacity style={styles.bulkButton} onPress={selectAllDelivery}>
                  <Text style={styles.bulkButtonText}>{t('select_all') || 'Select All'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.bulkButton} onPress={clearDeliverySelection}>
                  <Text style={styles.bulkButtonText}>{t('clear_selection') || 'Clear'}</Text>
                </TouchableOpacity>
                {selectedDeliveryItems.size > 0 && (
                  <TouchableOpacity
                    style={[styles.bulkButton, styles.bulkDeliverButton]}
                    onPress={handleBulkDelivery}
                  >
                    <Text style={styles.bulkDeliverText}>
                      {t('badge_deliver_selected') || 'Deliver'} ({selectedDeliveryItems.size})
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
            <FlatList
              data={deliveryQueue}
              renderItem={renderDeliveryItem}
              keyExtractor={item => `delivery-${item.id}`}
              contentContainerStyle={styles.listContainer}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
              ListEmptyComponent={
                <EmptyState
                  icon="📦"
                  title={t('no_delivery_pending') || 'No badges to deliver'}
                  message={t('no_delivery_pending_description') || 'All approved badges have been delivered'}
                />
              }
            />
          </>
        );

      default:
        return null;
    }
  };

  if (loading && !refreshing) {
    return <LoadingSpinner message={t('loading')} />;
  }

  if (error && !loading) {
    return <ErrorMessage message={error} onRetry={loadData} />;
  }

  return (
    <View style={commonStyles.container}>
      {/* Stats Summary */}
      {renderStats()}

      {/* View Mode Tabs */}
      {renderViewTabs()}

      {/* Search (only in participants view) */}
      {viewMode === VIEW_MODES.PARTICIPANTS && (
        <View style={styles.searchContainer}>
          <TextInput
            style={styles.searchInput}
            placeholder={t('search_placeholder') || 'Search participants...'}
            placeholderTextColor={theme.colors.textMuted}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity
              style={styles.clearSearch}
              onPress={() => setSearchQuery('')}
            >
              <Text style={styles.clearSearchText}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Content */}
      {renderContent()}

      {/* Add Star Modal */}
      <Modal
        visible={addStarModalVisible}
        onClose={() => setAddStarModalVisible(false)}
        title={t('badge_add_star') || 'Add Star'}
        scrollable={true}
      >
        {selectedParticipantForStar && (
          <View style={styles.modalContent}>
            <Text style={styles.modalParticipant}>
              {selectedParticipantForStar.first_name} {selectedParticipantForStar.last_name}
            </Text>

            {/* Template Selection */}
            <Text style={styles.inputLabel}>{t('badge_template') || 'Badge Type'}</Text>
            <View style={styles.pickerContainer}>
              <Picker
                selectedValue={starFormData.templateId}
                onValueChange={(value) => setStarFormData(prev => ({ ...prev, templateId: value }))}
                style={styles.picker}
              >
                {templates.map(template => (
                  <Picker.Item key={template.id} label={template.name} value={template.id} />
                ))}
              </Picker>
            </View>

            {/* Level */}
            <Text style={styles.inputLabel}>{t('badge_level_label') || 'Level'}</Text>
            <View style={styles.pickerContainer}>
              <Picker
                selectedValue={starFormData.level}
                onValueChange={(value) => setStarFormData(prev => ({ ...prev, level: value }))}
                style={styles.picker}
              >
                {[1, 2, 3, 4, 5].map(level => (
                  <Picker.Item key={level} label={`${level}`} value={level} />
                ))}
              </Picker>
            </View>

            {/* Star Type */}
            <Text style={styles.inputLabel}>{t('badge_star_type') || 'Star Type'}</Text>
            <View style={styles.pickerContainer}>
              <Picker
                selectedValue={starFormData.starType}
                onValueChange={(value) => setStarFormData(prev => ({ ...prev, starType: value }))}
                style={styles.picker}
              >
                <Picker.Item label={t('badge_type_proie') || 'Individual (Proie)'} value="proie" />
                <Picker.Item label={t('badge_type_battue') || 'Group (Battue)'} value="battue" />
              </Picker>
            </View>

            {/* Goal/Objective */}
            <Text style={styles.inputLabel}>{t('badge_goal') || 'Goal/Objective'} *</Text>
            <TextInput
              style={[styles.textInput, styles.textArea]}
              placeholder={t('badge_goal_placeholder') || 'What did they achieve?'}
              placeholderTextColor={theme.colors.textMuted}
              value={starFormData.objectif}
              onChangeText={(value) => setStarFormData(prev => ({ ...prev, objectif: value }))}
              multiline
              numberOfLines={3}
            />

            {/* Description */}
            <Text style={styles.inputLabel}>{t('badge_description') || 'Description'}</Text>
            <TextInput
              style={[styles.textInput, styles.textArea]}
              placeholder={t('badge_description_placeholder') || 'Additional details...'}
              placeholderTextColor={theme.colors.textMuted}
              value={starFormData.description}
              onChangeText={(value) => setStarFormData(prev => ({ ...prev, description: value }))}
              multiline
              numberOfLines={3}
            />

            {/* Pride/Achievement */}
            <Text style={styles.inputLabel}>{t('badge_fierte') || 'Pride/Achievement'}</Text>
            <TextInput
              style={[styles.textInput, styles.textArea]}
              placeholder={t('badge_fierte_placeholder') || 'What are they most proud of?'}
              placeholderTextColor={theme.colors.textMuted}
              value={starFormData.fierte}
              onChangeText={(value) => setStarFormData(prev => ({ ...prev, fierte: value }))}
              multiline
              numberOfLines={2}
            />

            {/* Submit Button */}
            <TouchableOpacity
              style={styles.submitButton}
              onPress={handleSubmitStar}
              activeOpacity={0.7}
            >
              <Text style={styles.submitButtonText}>{t('badge_submit_for_approval') || 'Submit for Approval'}</Text>
            </TouchableOpacity>
          </View>
        )}
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  // Stats
  statsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: theme.spacing.sm,
    gap: theme.spacing.sm,
  },
  statCard: {
    flex: 1,
    minWidth: 70,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.sm,
    padding: theme.spacing.sm,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  statCardWarning: {
    borderColor: theme.colors.warning,
  },
  statCardInfo: {
    borderColor: theme.colors.info,
  },
  statValue: {
    fontSize: theme.fontSize.xl,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.primary,
  },
  statLabel: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textMuted,
    textAlign: 'center',
  },

  // View Tabs
  viewTabs: {
    flexDirection: 'row',
    backgroundColor: theme.colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  viewTab: {
    flex: 1,
    paddingVertical: theme.spacing.md,
    alignItems: 'center',
  },
  viewTabActive: {
    borderBottomWidth: 2,
    borderBottomColor: theme.colors.primary,
  },
  viewTabText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
  },
  viewTabTextActive: {
    color: theme.colors.primary,
    fontWeight: theme.fontWeight.semibold,
  },

  // Search
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  searchInput: {
    flex: 1,
    height: theme.touchTarget.min,
    backgroundColor: theme.colors.background,
    borderRadius: theme.borderRadius.sm,
    paddingHorizontal: theme.spacing.md,
    fontSize: theme.fontSize.base,
    color: theme.colors.text,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  clearSearch: {
    marginLeft: theme.spacing.sm,
    padding: theme.spacing.sm,
  },
  clearSearchText: {
    fontSize: theme.fontSize.lg,
    color: theme.colors.textMuted,
  },

  // List
  listContainer: {
    padding: theme.spacing.md,
    paddingBottom: theme.spacing.xl,
  },

  // Participant Card
  participantCard: {
    marginBottom: theme.spacing.md,
  },
  participantHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  participantInfo: {
    flex: 1,
  },
  participantName: {
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.text,
    marginBottom: theme.spacing.xs,
  },
  participantStats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
    alignItems: 'center',
  },
  starCount: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.warning,
    fontWeight: theme.fontWeight.semibold,
  },
  pendingBadge: {
    backgroundColor: theme.colors.warning,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 2,
    borderRadius: theme.borderRadius.full,
  },
  pendingBadgeText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.selectedText,
  },
  deliveryBadge: {
    backgroundColor: theme.colors.info,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 2,
    borderRadius: theme.borderRadius.full,
  },
  deliveryBadgeText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.selectedText,
  },
  participantActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  addButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addButtonText: {
    fontSize: theme.fontSize.xl,
    color: theme.colors.selectedText,
    fontWeight: theme.fontWeight.bold,
  },
  expandIcon: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
    marginLeft: theme.spacing.sm,
  },

  // Badges List
  badgesList: {
    marginTop: theme.spacing.md,
    paddingTop: theme.spacing.md,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  noBadgesText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: theme.spacing.md,
  },
  badgeItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  badgeInfo: {
    flex: 1,
  },
  badgeName: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.text,
  },
  badgeLevel: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
  },
  starType: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.info,
    marginTop: 2,
  },
  statusBadge: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.border,
  },
  statusApproved: {
    backgroundColor: theme.colors.success,
  },
  statusPending: {
    backgroundColor: theme.colors.warning,
  },
  statusRejected: {
    backgroundColor: theme.colors.error,
  },
  statusText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.selectedText,
    fontWeight: theme.fontWeight.semibold,
    textTransform: 'capitalize',
  },

  // Queue Cards
  queueCard: {
    marginBottom: theme.spacing.md,
  },
  queueHeader: {
    marginBottom: theme.spacing.sm,
  },
  queueName: {
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.text,
  },
  queueBadge: {
    fontSize: theme.fontSize.base,
    color: theme.colors.primary,
  },
  queueDetails: {
    flexDirection: 'row',
    gap: theme.spacing.md,
    marginBottom: theme.spacing.sm,
  },
  queueLevel: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
  },
  queueType: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.info,
  },
  queueObjectif: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.text,
    marginBottom: theme.spacing.md,
  },
  queueActions: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  actionButton: {
    flex: 1,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.borderRadius.sm,
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
    fontWeight: theme.fontWeight.semibold,
    fontSize: theme.fontSize.base,
  },

  // Delivery
  selectedCard: {
    borderColor: theme.colors.primary,
    borderWidth: 2,
  },
  deliveryRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: theme.colors.border,
    marginRight: theme.spacing.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxSelected: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  checkmark: {
    color: theme.colors.selectedText,
    fontWeight: theme.fontWeight.bold,
  },
  deliveryInfo: {
    flex: 1,
  },
  approvalDate: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textMuted,
    marginTop: 4,
  },
  deliverButton: {
    backgroundColor: theme.colors.success,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.borderRadius.sm,
  },
  deliverButtonText: {
    color: theme.colors.selectedText,
    fontWeight: theme.fontWeight.semibold,
    fontSize: theme.fontSize.sm,
  },
  bulkActions: {
    flexDirection: 'row',
    padding: theme.spacing.md,
    gap: theme.spacing.sm,
    backgroundColor: theme.colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  bulkButton: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.borderRadius.sm,
    backgroundColor: theme.colors.background,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  bulkButtonText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.text,
  },
  bulkDeliverButton: {
    backgroundColor: theme.colors.success,
    borderColor: theme.colors.success,
  },
  bulkDeliverText: {
    color: theme.colors.selectedText,
    fontWeight: theme.fontWeight.semibold,
  },

  // Modal
  modalContent: {
    padding: theme.spacing.md,
  },
  modalParticipant: {
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.primary,
    marginBottom: theme.spacing.lg,
    textAlign: 'center',
  },
  inputLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.text,
    marginBottom: theme.spacing.xs,
    marginTop: theme.spacing.md,
  },
  pickerContainer: {
    backgroundColor: theme.colors.background,
    borderRadius: theme.borderRadius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: 'hidden',
  },
  picker: {
    height: 50,
    color: theme.colors.text,
  },
  textInput: {
    backgroundColor: theme.colors.background,
    borderRadius: theme.borderRadius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    fontSize: theme.fontSize.base,
    color: theme.colors.text,
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  submitButton: {
    backgroundColor: theme.colors.primary,
    paddingVertical: theme.spacing.md,
    borderRadius: theme.borderRadius.sm,
    alignItems: 'center',
    marginTop: theme.spacing.xl,
  },
  submitButtonText: {
    color: theme.colors.selectedText,
    fontWeight: theme.fontWeight.bold,
    fontSize: theme.fontSize.base,
  },
});

export default BadgeTrackerScreen;
