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

import React, { useEffect, useMemo, useCallback } from 'react';
import { useSafeState } from '../hooks/useSafeState';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
  TextInput,
  Alert,
  Image,
  Platform,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
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
import badgeImages from '../../assets/images/_badgeImages';

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
  const [starFormData, setStarFormData] = useSafeState({
    participantId: '',
    templateId: '',
    level: 1,
    objectif: '',
    description: '',
    fierte: '',
    starType: 'proie',
    dateObtention: formatDate(new Date(), 'YYYY-MM-DD'),
  });
  const [showDatePicker, setShowDatePicker] = useSafeState(false);

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

  const templateMap = useMemo(() => {
    const map = new Map();
    templates.forEach(template => {
      map.set(template.id, template);
    });
    return map;
  }, [templates]);

  const getTemplateLevelCount = useCallback((template) => {
    if (!template) return 3;
    if (template.level_count) return template.level_count;
    if (Array.isArray(template.levels) && template.levels.length > 0) {
      return template.levels.length;
    }
    return 3;
  }, []);

  const getBadgeImageSource = useCallback((template) => {
    if (!template?.image) return null;
    if (badgeImages[template.image]) {
      return badgeImages[template.image];
    }
    if (typeof template.image === 'string' && template.image.startsWith('http')) {
      return { uri: template.image };
    }
    return null;
  }, []);

  const getNextStarInfo = useCallback((participantId, templateId) => {
    if (!participantId || !templateId) {
      return { nextStar: null, maxStars: null };
    }

    const template = templateMap.get(templateId);
    const maxStars = getTemplateLevelCount(template);
    const existingStars = badges.filter(
      badge => badge.participant_id === participantId && badge.badge_template_id === templateId
    );
    const existingLevels = existingStars.map(star => star.etoiles).filter(Boolean);
    const highestLevel = existingLevels.length > 0 ? Math.max(...existingLevels) : 0;
    const nextStar = Math.min(highestLevel + 1, maxStars);
    return { nextStar, maxStars };
  }, [badges, getTemplateLevelCount, templateMap]);

  // Build participant records with their badges
  const participantRecords = useMemo(() => {
    const participantMap = new Map();

    // Initialize participants
    participants.forEach(p => {
      participantMap.set(p.id, {
        ...p,
        badgeGroups: new Map(),
        totalStars: 0,
        pendingCount: 0,
        awaitingDelivery: 0,
      });
    });

    // Add badges to participants
    badges.forEach(badge => {
      const participant = participantMap.get(badge.participant_id);
      if (!participant) return;

      const template = templateMap.get(badge.badge_template_id);
      const templateId = badge.badge_template_id;

      if (!participant.badgeGroups.has(templateId)) {
        participant.badgeGroups.set(templateId, {
          template,
          stars: [],
        });
      }

      participant.badgeGroups.get(templateId).stars.push(badge);

      if (badge.status === 'approved') {
        participant.totalStars++;
        if (!badge.delivered_at) {
          participant.awaitingDelivery++;
        }
      } else if (badge.status === 'pending') {
        participant.pendingCount++;
      }
    });

    return Array.from(participantMap.values()).map(record => ({
      ...record,
      badgeGroups: Array.from(record.badgeGroups.values()).map(group => ({
        ...group,
        stars: group.stars.sort((a, b) => (a.etoiles || 0) - (b.etoiles || 0)),
      })),
    }));
  }, [participants, badges, templateMap]);

  // Filter participants by search query
  const filteredParticipants = useMemo(() => {
    if (!searchQuery.trim()) return participantRecords;

    const query = searchQuery.toLowerCase();
    return participantRecords.filter(p => {
      const fullName = `${p.first_name} ${p.last_name}`.toLowerCase();
      const totem = (p.totem || '').toLowerCase();
      return fullName.includes(query) || totem.includes(query);
    });
  }, [participantRecords, searchQuery]);

  // Get pending badges for approval queue
  const pendingBadges = useMemo(() => {
    return badges.filter(b => b.status === 'pending').map(badge => {
      const participant = participants.find(p => p.id === badge.participant_id);
      const template = templateMap.get(badge.badge_template_id);
      return {
        ...badge,
        participantName: participant ? `${participant.first_name} ${participant.last_name}` : t('unknown'),
        templateName: template?.name || badge.territoire_chasse || t('badge_unknown_label'),
      };
    });
  }, [badges, participants, templateMap]);

  // Get badges awaiting delivery
  const deliveryQueue = useMemo(() => {
    return badges
      .filter(b => b.status === 'approved' && !b.delivered_at)
      .map(badge => {
        const participant = participants.find(p => p.id === badge.participant_id);
        const template = templateMap.get(badge.badge_template_id);
        return {
          ...badge,
          participantName: participant ? `${participant.first_name} ${participant.last_name}` : t('unknown'),
          templateName: template?.name || badge.territoire_chasse || t('badge_unknown_label'),
        };
      });
  }, [badges, participants, templateMap]);

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
  const openAddStarModal = (participant = null, templateId = null, starNumber = null) => {
    const participantId = participant?.id || '';
    const defaultTemplateId = templateId || templates[0]?.id || '';
    const nextStarInfo = getNextStarInfo(participantId, defaultTemplateId);

    setStarFormData({
      participantId,
      templateId: defaultTemplateId,
      level: starNumber || nextStarInfo.nextStar || 1,
      objectif: '',
      description: '',
      fierte: '',
      starType: 'proie',
      dateObtention: formatDate(new Date(), 'YYYY-MM-DD'),
    });
    setAddStarModalVisible(true);
  };

  useEffect(() => {
    if (!starFormData.participantId || !starFormData.templateId) return;
    const { nextStar } = getNextStarInfo(starFormData.participantId, starFormData.templateId);
    if (nextStar && nextStar !== starFormData.level) {
      setStarFormData(prev => ({ ...prev, level: nextStar }));
    }
  }, [starFormData.participantId, starFormData.templateId, getNextStarInfo, starFormData.level]);

  // Submit new star
  const handleSubmitStar = async () => {
    if (!starFormData.participantId) {
      toast.show(t('missing_required_fields') || 'Missing required fields', 'error');
      return;
    }

    if (!starFormData.templateId) {
      toast.show(t('missing_required_fields') || 'Missing required fields', 'error');
      return;
    }

    if (!starFormData.objectif.trim()) {
      toast.show(t('badge_objectif_required') || 'Goal/objective is required', 'error');
      return;
    }

    try {
      const template = templateMap.get(Number(starFormData.templateId));
      const { maxStars } = getNextStarInfo(starFormData.participantId, starFormData.templateId);

      if (maxStars && starFormData.level > maxStars) {
        toast.show(t('badge_max_stars_reached') || 'Maximum stars reached', 'warning');
        return;
      }

      const badgeData = {
        participant_id: starFormData.participantId,
        badge_template_id: starFormData.templateId || null,
        territoire_chasse: template?.name || t('badge_custom'),
        etoiles: starFormData.level,
        objectif: starFormData.objectif,
        description: starFormData.description,
        fierte: starFormData.fierte,
        star_type: starFormData.starType,
        date_obtention: starFormData.dateObtention,
        status: 'pending',
      };

      const result = await saveBadgeProgress(badgeData);
      if (result.success) {
        toast.show(t('badge_star_added') || 'Star submitted for approval!', 'success');
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
    const template = templateMap.get(templateId);
    return template?.name || t('badge_unknown_label');
  };

  // Render stats summary
  const renderStats = () => {
    if (!stats) return null;

    return (
      <View style={styles.statsContainer}>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{stats.totalParticipants || 0}</Text>
          <Text style={styles.statLabel}>{t('badge_participants') || t('participants') || 'Participants'}</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{stats.totalApproved || stats.totalStars || 0}</Text>
          <Text style={styles.statLabel}>{t('badge_total_stars') || 'Total Stars'}</Text>
        </View>
        <View style={[styles.statCard, styles.statCardWarning]}>
          <Text style={styles.statValue}>{stats.pendingApproval || 0}</Text>
          <Text style={styles.statLabel}>{t('badge_status_pending') || 'Pending'}</Text>
        </View>
        <View style={[styles.statCard, styles.statCardInfo]}>
          <Text style={styles.statValue}>{stats.awaitingDelivery || 0}</Text>
          <Text style={styles.statLabel}>{t('badge_awaiting_delivery') || 'To Deliver'}</Text>
        </View>
      </View>
    );
  };

  const renderHeader = () => (
    <View style={styles.header}>
      <TouchableOpacity
        style={styles.backButton}
        onPress={() => navigation.goBack()}
        activeOpacity={0.7}
      >
        <Text style={styles.backButtonText}>← {t('back')}</Text>
      </TouchableOpacity>
      <Text style={styles.headerTitle}>
        {t('badge_tracker_title') || 'Badges de la Meute'}
      </Text>
    </View>
  );

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
            {t('badge_pending_approvals') || 'Pending'} ({pendingBadges.length})
          </Text>
        </TouchableOpacity>
      )}

      {permissions.canApprove && (
        <TouchableOpacity
          style={[styles.viewTab, viewMode === VIEW_MODES.DELIVERY && styles.viewTabActive]}
          onPress={() => setViewMode(VIEW_MODES.DELIVERY)}
        >
          <Text style={[styles.viewTabText, viewMode === VIEW_MODES.DELIVERY && styles.viewTabTextActive]}>
            {t('badge_awaiting_delivery') || 'Delivery'} ({deliveryQueue.length})
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );

  const renderBadgeImage = (template, style, placeholderStyle = null) => {
    const source = getBadgeImageSource(template);
    if (source) {
      return <Image source={source} style={style} resizeMode="contain" />;
    }
    return (
      <View style={[styles.badgeImageFallback, placeholderStyle]}>
        <Text style={styles.badgeImageFallbackText}>🏅</Text>
      </View>
    );
  };

  const renderBadgePreview = (badgeGroups) => {
    if (!badgeGroups || badgeGroups.length === 0) return null;

    const displayBadges = badgeGroups.slice(0, 3);
    const remaining = badgeGroups.length - 3;

    return (
      <View style={styles.badgePreview} accessible accessibilityLabel={t('badge_preview_label') || 'Badge preview'}>
        {displayBadges.map((group, index) => {
          const template = group.template;
          const maxStars = getTemplateLevelCount(template);
          const hasUndelivered = group.stars.some(star => star.status === 'approved' && !star.delivered_at);

          return (
            <View key={`${template?.id || index}`} style={styles.badgePreviewItem}>
              {renderBadgeImage(template, styles.badgePreviewImage, styles.badgePreviewImage)}
              {hasUndelivered && <View style={styles.badgePreviewDeliveryIndicator} />}
              <View style={styles.badgePreviewStars}>
                {Array.from({ length: maxStars }).map((_, starIndex) => {
                  const star = group.stars.find(s => s.etoiles === starIndex + 1);
                  const starStyle = [
                    styles.badgePreviewStar,
                    star?.status === 'pending' && styles.badgePreviewStarPending,
                    !star && styles.badgePreviewStarEmpty,
                  ];
                  return (
                    <Text key={`${template?.id || index}-star-${starIndex}`} style={starStyle}>
                      ★
                    </Text>
                  );
                })}
              </View>
            </View>
          );
        })}
        {remaining > 0 && (
          <View style={styles.badgePreviewMore}>
            <Text style={styles.badgePreviewMoreText}>+{remaining}</Text>
          </View>
        )}
      </View>
    );
  };

  const renderStarSlot = (participantId, templateId, starNumber, starData) => {
    if (!starData) {
      const isDisabled = !permissions.canManage;
      return (
        <TouchableOpacity
          key={`star-slot-${participantId}-${templateId}-${starNumber}`}
          style={[styles.addStarSlot, isDisabled && styles.addStarSlotDisabled]}
          onPress={() => openAddStarModal(participants.find(p => p.id === participantId), templateId, starNumber)}
          disabled={isDisabled}
        >
          <Text style={styles.addStarSlotText}>
            + {t('badge_star_label') || t('badge_star') || 'Star'} {starNumber}
          </Text>
        </TouchableOpacity>
      );
    }

    const isDelivered = starData.status === 'approved' && starData.delivered_at;
    const isApproved = starData.status === 'approved' && !starData.delivered_at;
    const isPending = starData.status === 'pending';

    return (
      <View
        key={`star-slot-${participantId}-${templateId}-${starNumber}`}
        style={[
          styles.starSlot,
          isDelivered && styles.starSlotDelivered,
          isApproved && styles.starSlotApproved,
          isPending && styles.starSlotPending,
        ]}
      >
        {isDelivered && <Text style={styles.starSlotDeliveryBadge}>✓</Text>}
        <Text style={[
          styles.starSlotIcon,
          (isDelivered || isApproved) && styles.starSlotIconFilled,
          isPending && styles.starSlotIconPending,
        ]}>
          ★
        </Text>
        {starData.star_type && (
          <View style={[
            styles.starSlotType,
            starData.star_type === 'proie' ? styles.starSlotTypeProie : styles.starSlotTypeBattue,
          ]}>
            <Text style={styles.starSlotTypeText}>
              {starData.star_type === 'proie'
                ? `🎯 ${t('badge_type_proie') || 'Proie'}`
                : `🐺 ${t('badge_type_battue') || 'Battue'}`}
            </Text>
          </View>
        )}
        {isPending && (
          <Text style={[styles.starSlotStatus, styles.starSlotStatusPending]}>
            {t('badge_status_pending') || 'Pending'}
          </Text>
        )}
        {isApproved && (
          <Text style={[styles.starSlotStatus, styles.starSlotStatusDelivery]}>
            {t('badge_awaiting_delivery') || 'To deliver'}
          </Text>
        )}
        {isDelivered && (
          <Text style={styles.starSlotDate}>{formatDate(starData.delivered_at)}</Text>
        )}
      </View>
    );
  };

  const renderBadgeCard = (participantId, badgeGroup) => {
    const template = badgeGroup.template;
    const stars = badgeGroup.stars;
    const maxStars = getTemplateLevelCount(template);
    const approvedCount = stars.filter(star => star.status === 'approved').length;
    const deliveredCount = stars.filter(star => star.delivered_at).length;
    const pendingCount = stars.filter(star => star.status === 'pending').length;

    return (
      <View key={`badge-${participantId}-${template?.id || 'unknown'}`} style={styles.badgeCard}>
        <View style={styles.badgeCardHeader}>
          <View style={styles.badgeCardImageContainer}>
            {renderBadgeImage(template, styles.badgeCardImage, styles.badgeCardImage)}
          </View>
          <View style={styles.badgeCardInfo}>
            <Text style={styles.badgeCardTitle}>
              {template?.name || t('badge_unknown_label')}
            </Text>
            <Text style={styles.badgeCardProgress}>
              {approvedCount}/{maxStars} {t('badge_status_approved') || 'Approved'}
              {deliveredCount > 0 ? ` • ${deliveredCount} ${t('badge_delivered') || 'Delivered'}` : ''}
              {pendingCount > 0 ? ` • ${pendingCount} ${t('badge_status_pending') || 'Pending'}` : ''}
            </Text>
          </View>
        </View>
        <View style={styles.starProgress}>
          {Array.from({ length: maxStars }).map((_, index) => {
            const starData = stars.find(star => star.etoiles === index + 1);
            return renderStarSlot(participantId, template?.id, index + 1, starData || null);
          })}
        </View>
      </View>
    );
  };

  // Render participant card
  const renderParticipantCard = ({ item: participant }) => {
    const isExpanded = expandedParticipantId === participant.id;
    const initials = `${participant.first_name?.[0] || ''}${participant.last_name?.[0] || ''}`.toUpperCase();
    const badgeGroups = participant.badgeGroups || [];
    const hasPending = participant.pendingCount > 0;
    const hasDelivery = participant.awaitingDelivery > 0;

    return (
      <Card style={styles.participantCard}>
        <TouchableOpacity
          style={styles.participantHeader}
          onPress={() => setExpandedParticipantId(isExpanded ? null : participant.id)}
          activeOpacity={0.7}
        >
          <View style={styles.participantAvatar}>
            <Text style={styles.participantAvatarText}>{initials}</Text>
          </View>
          <View style={styles.participantInfo}>
            <View style={styles.participantNameRow}>
              <Text style={styles.participantName}>
                {participant.first_name} {participant.last_name}
              </Text>
              {(hasPending || hasDelivery) && (
                <View style={styles.participantIndicators}>
                  {hasPending && <View style={[styles.indicatorDot, styles.indicatorDotPending]} />}
                  {hasDelivery && <View style={[styles.indicatorDot, styles.indicatorDotDelivery]} />}
                </View>
              )}
            </View>
            {participant.totem ? (
              <Text style={styles.participantTotem}>{participant.totem}</Text>
            ) : null}
          </View>
          {renderBadgePreview(badgeGroups)}
          <Text style={styles.expandIcon}>{isExpanded ? '▼' : '▶'}</Text>
        </TouchableOpacity>

        {isExpanded && (
          <View style={styles.badgeDetails}>
            {badgeGroups.length === 0 ? (
              <Text style={styles.noBadgesText}>{t('badge_no_entries') || 'No badges yet'}</Text>
            ) : (
              badgeGroups.map(group => renderBadgeCard(participant.id, group))
            )}
          </View>
        )}
      </Card>
    );
  };

  // Render pending approval item
  const renderPendingItem = ({ item: badge }) => {
    const template = templateMap.get(badge.badge_template_id);

    return (
      <Card style={styles.queueCard}>
        <View style={styles.queueRow}>
          <View style={styles.queueBadgeIcon}>
            {renderBadgeImage(template, styles.queueBadgeImage, styles.queueBadgeFallback)}
          </View>
          <View style={styles.queueContent}>
            <View style={styles.queueHeader}>
              <Text style={styles.queueName}>{badge.participantName}</Text>
              <Text style={styles.queueBadge}>{badge.templateName}</Text>
            </View>

            <View style={styles.queueDetails}>
              <Text style={styles.queueLevel}>{t('badge_level_label') || 'Level'}: {badge.etoiles}</Text>
              {badge.star_type && (
                <View style={[
                  styles.queueType,
                  badge.star_type === 'proie' ? styles.queueTypeProie : styles.queueTypeBattue,
                ]}>
                  <Text style={styles.queueTypeText}>
                    {badge.star_type === 'proie' ? t('badge_type_proie') || 'Proie' : t('badge_type_battue') || 'Battue'}
                  </Text>
                </View>
              )}
            </View>

            {badge.objectif && (
              <Text style={styles.queueObjectif} numberOfLines={2}>
                {t('badge_goal')}: {badge.objectif}
              </Text>
            )}
          </View>
        </View>

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
  };

  // Render delivery queue item
  const renderDeliveryItem = ({ item: badge }) => {
    const isSelected = selectedDeliveryItems.has(badge.id);
    const template = templateMap.get(badge.badge_template_id);

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

          <View style={styles.queueBadgeIcon}>
            {renderBadgeImage(template, styles.queueBadgeImage, styles.queueBadgeFallback)}
          </View>

          <View style={styles.deliveryInfo}>
            <Text style={styles.queueName}>{badge.participantName}</Text>
            <Text style={styles.queueBadge}>{badge.templateName}</Text>
            <Text style={styles.queueLevel}>
              {t('badge_level_label') || 'Level'}: {badge.etoiles}
              {badge.star_type && ` • ${badge.star_type === 'proie' ? t('badge_type_proie') || 'Proie' : t('badge_type_battue') || 'Battue'}`}
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
                title={searchQuery ? t('no_results_found') || 'No results' : t('no_participants') || 'No participants'}
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
                title={t('badge_no_pending_approvals') || 'No pending approvals'}
                message={t('badge_no_pending_approvals_description') || 'All badges have been reviewed'}
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
                title={t('badge_no_delivery_pending') || 'No badges to deliver'}
                message={t('badge_no_delivery_pending_description') || 'All approved badges have been delivered'}
              />
            }
          />
          </>
        );

      default:
        return null;
    }
  };

  const selectedParticipant = participants.find(p => p.id === starFormData.participantId) || null;
  const selectedStarInfo = getNextStarInfo(starFormData.participantId, starFormData.templateId);

  const handleDateChange = (event, selectedDate) => {
    if (Platform.OS !== 'ios') {
      setShowDatePicker(false);
    }
    if (event.type === 'dismissed') return;
    if (selectedDate) {
      setStarFormData(prev => ({
        ...prev,
        dateObtention: formatDate(selectedDate, 'YYYY-MM-DD'),
      }));
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
      {renderHeader()}

      {/* Stats Summary */}
      {renderStats()}

      {/* View Mode Tabs */}
      {renderViewTabs()}

      {/* Search (only in participants view) */}
      {viewMode === VIEW_MODES.PARTICIPANTS && (
        <View style={styles.searchContainer}>
          <TextInput
            style={styles.searchInput}
            placeholder={t('badge_search_placeholder') || t('search_participants') || 'Search participants...'}
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

      {permissions.canManage && (
        <TouchableOpacity
          style={styles.fab}
          onPress={() => openAddStarModal()}
          activeOpacity={0.8}
        >
          <Text style={styles.fabText}>＋</Text>
        </TouchableOpacity>
      )}

      {/* Add Star Modal */}
      <Modal
        visible={addStarModalVisible}
        onClose={() => setAddStarModalVisible(false)}
        title={t('badge_add_star') || 'Add Star'}
        scrollable={true}
      >
        <View style={styles.modalContent}>
          <Text style={styles.inputLabel}>{t('participant') || 'Participant'}</Text>
          <View style={styles.pickerContainer}>
            <Picker
              selectedValue={starFormData.participantId}
              onValueChange={(value) => setStarFormData(prev => ({ ...prev, participantId: value }))}
              style={styles.picker}
            >
              <Picker.Item label={t('select') || 'Select...'} value="" />
              {[...participants]
                .sort((a, b) => a.first_name.localeCompare(b.first_name, 'fr'))
                .map(participant => (
                  <Picker.Item
                    key={participant.id}
                    label={`${participant.first_name} ${participant.last_name}`}
                    value={participant.id}
                  />
                ))}
            </Picker>
          </View>

          {selectedParticipant && (
            <Text style={styles.modalParticipant}>
              {selectedParticipant.first_name} {selectedParticipant.last_name}
            </Text>
          )}

          <Text style={styles.inputLabel}>{t('badge_template') || t('badge') || 'Badge'}</Text>
          <View style={styles.badgeSelector}>
            {templates.map(template => {
              const isSelected = Number(starFormData.templateId) === template.id;
              return (
                <TouchableOpacity
                  key={template.id}
                  style={[styles.badgeOption, isSelected && styles.badgeOptionSelected]}
                  onPress={() => setStarFormData(prev => ({ ...prev, templateId: template.id }))}
                  activeOpacity={0.8}
                >
                  {renderBadgeImage(template, styles.badgeOptionImage, styles.badgeOptionPlaceholder)}
                  <Text style={styles.badgeOptionName}>{template.name.replace('comme ', '')}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {starFormData.participantId && starFormData.templateId && selectedStarInfo.maxStars && (
            <View style={styles.starInfo}>
              <Text style={styles.starInfoLabel}>{t('badge_star_label') || t('badge_star') || 'Star'}</Text>
              <Text style={styles.starInfoValue}>
                #{starFormData.level} {t('badge_star_of') || 'of'} {selectedStarInfo.maxStars}
              </Text>
            </View>
          )}

          <Text style={styles.inputLabel}>{t('badge_star_type') || 'Star Type'}</Text>
          <View style={styles.typeSelector}>
            <TouchableOpacity
              style={[styles.typeOption, starFormData.starType === 'proie' && styles.typeOptionSelected]}
              onPress={() => setStarFormData(prev => ({ ...prev, starType: 'proie' }))}
              activeOpacity={0.8}
            >
              <Text style={styles.typeOptionIcon}>🎯</Text>
              <Text style={styles.typeOptionLabel}>{t('badge_type_proie') || 'Proie'}</Text>
              <Text style={styles.typeOptionDesc}>{t('badge_type_proie_description') || t('individual') || 'Individuel'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.typeOption, starFormData.starType === 'battue' && styles.typeOptionSelected]}
              onPress={() => setStarFormData(prev => ({ ...prev, starType: 'battue' }))}
              activeOpacity={0.8}
            >
              <Text style={styles.typeOptionIcon}>🐺</Text>
              <Text style={styles.typeOptionLabel}>{t('badge_type_battue') || 'Battue'}</Text>
              <Text style={styles.typeOptionDesc}>{t('badge_type_battue_description') || t('group') || 'Groupe'}</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.inputLabel}>{t('badge_date_label') || t('badge_date') || 'Date'}</Text>
          <TouchableOpacity
            style={styles.dateInput}
            onPress={() => setShowDatePicker(true)}
            activeOpacity={0.8}
          >
            <Text style={styles.dateInputText}>
              {starFormData.dateObtention || t('badge_date_placeholder') || 'YYYY-MM-DD'}
            </Text>
          </TouchableOpacity>
          {showDatePicker && (
            <DateTimePicker
              value={starFormData.dateObtention ? new Date(`${starFormData.dateObtention}T00:00:00`) : new Date()}
              mode="date"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={handleDateChange}
            />
          )}

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

          <TouchableOpacity
            style={styles.submitButton}
            onPress={handleSubmitStar}
            activeOpacity={0.7}
          >
            <Text style={styles.submitButtonText}>{t('badge_submit_for_approval') || 'Submit for Approval'}</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  // Header
  header: {
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  backButton: {
    marginBottom: theme.spacing.sm,
  },
  backButtonText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.primary,
    fontWeight: theme.fontWeight.semibold,
  },
  headerTitle: {
    fontSize: theme.fontSize.xl,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.text,
  },

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
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  participantAvatar: {
    width: theme.touchTarget.min,
    height: theme.touchTarget.min,
    borderRadius: theme.touchTarget.min / 2,
    backgroundColor: theme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  participantAvatarText: {
    color: theme.colors.selectedText,
    fontWeight: theme.fontWeight.bold,
    fontSize: theme.fontSize.base,
  },
  participantInfo: {
    flex: 1,
  },
  participantNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
    flexWrap: 'wrap',
  },
  participantName: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.text,
  },
  participantIndicators: {
    flexDirection: 'row',
    gap: theme.spacing.xs,
  },
  indicatorDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  indicatorDotPending: {
    backgroundColor: theme.colors.warning,
  },
  indicatorDotDelivery: {
    backgroundColor: theme.colors.info,
  },
  participantTotem: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
    fontStyle: 'italic',
  },
  expandIcon: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
  },

  // Badge preview
  badgePreview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
  },
  badgeImageFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.background,
    borderRadius: theme.borderRadius.sm,
  },
  badgeImageFallbackText: {
    fontSize: theme.fontSize.lg,
  },
  badgePreviewItem: {
    width: 36,
    height: 36,
    position: 'relative',
  },
  badgePreviewImage: {
    width: 36,
    height: 36,
    borderRadius: theme.borderRadius.sm,
  },
  badgePreviewStars: {
    position: 'absolute',
    bottom: -4,
    left: '50%',
    transform: [{ translateX: -14 }],
    flexDirection: 'row',
    gap: 1,
    backgroundColor: theme.colors.surface,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 999,
  },
  badgePreviewStar: {
    fontSize: 8,
    color: theme.colors.warning,
  },
  badgePreviewStarPending: {
    color: theme.colors.warning,
  },
  badgePreviewStarEmpty: {
    color: theme.colors.border,
  },
  badgePreviewDeliveryIndicator: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: theme.colors.info,
    borderWidth: 2,
    borderColor: theme.colors.surface,
  },
  badgePreviewMore: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  badgePreviewMoreText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textMuted,
    fontWeight: theme.fontWeight.semibold,
  },

  // Badge Details
  badgeDetails: {
    marginTop: theme.spacing.md,
  },
  noBadgesText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: theme.spacing.md,
  },

  // Badge cards
  badgeCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.sm,
    padding: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginBottom: theme.spacing.sm,
  },
  badgeCardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.md,
    marginBottom: theme.spacing.md,
  },
  badgeCardImageContainer: {
    width: 56,
    height: 56,
  },
  badgeCardImage: {
    width: 56,
    height: 56,
    borderRadius: theme.borderRadius.sm,
  },
  badgeCardInfo: {
    flex: 1,
  },
  badgeCardTitle: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.text,
    marginBottom: theme.spacing.xs,
  },
  badgeCardProgress: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
  },
  starProgress: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  starSlot: {
    flex: 1,
    minWidth: 90,
    alignItems: 'center',
    gap: theme.spacing.xs,
    padding: theme.spacing.sm,
    borderRadius: theme.borderRadius.sm,
    borderWidth: 2,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.background,
    position: 'relative',
  },
  starSlotDelivered: {
    borderColor: theme.colors.info,
    backgroundColor: '#E3F2FD',
  },
  starSlotApproved: {
    borderColor: theme.colors.warning,
    backgroundColor: '#FFFBEB',
  },
  starSlotPending: {
    borderColor: theme.colors.warning,
    borderStyle: 'dashed',
    backgroundColor: '#FFF3E0',
  },
  starSlotIcon: {
    fontSize: theme.fontSize.xl,
    color: theme.colors.border,
  },
  starSlotIconFilled: {
    color: theme.colors.warning,
  },
  starSlotIconPending: {
    color: theme.colors.warning,
  },
  starSlotDeliveryBadge: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: theme.colors.info,
    color: theme.colors.selectedText,
    textAlign: 'center',
    fontSize: theme.fontSize.xs,
    lineHeight: 20,
  },
  starSlotType: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 2,
    borderRadius: theme.borderRadius.full,
  },
  starSlotTypeProie: {
    backgroundColor: '#EEF2FF',
  },
  starSlotTypeBattue: {
    backgroundColor: '#ECFDF5',
  },
  starSlotTypeText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.text,
  },
  starSlotStatus: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.semibold,
    textTransform: 'uppercase',
  },
  starSlotStatusPending: {
    color: theme.colors.warning,
  },
  starSlotStatusDelivery: {
    color: theme.colors.info,
  },
  starSlotDate: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textMuted,
  },
  addStarSlot: {
    flex: 1,
    minWidth: 90,
    padding: theme.spacing.sm,
    borderWidth: 2,
    borderColor: theme.colors.border,
    borderStyle: 'dashed',
    borderRadius: theme.borderRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addStarSlotDisabled: {
    opacity: 0.5,
  },
  addStarSlotText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
  },

  // Queue Cards
  queueCard: {
    marginBottom: theme.spacing.md,
  },
  queueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    marginBottom: theme.spacing.md,
  },
  queueBadgeIcon: {
    width: 48,
    height: 48,
    borderRadius: theme.borderRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  queueBadgeImage: {
    width: 48,
    height: 48,
    borderRadius: theme.borderRadius.sm,
  },
  queueBadgeFallback: {
    width: 48,
    height: 48,
  },
  queueContent: {
    flex: 1,
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
    alignItems: 'center',
  },
  queueLevel: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
  },
  queueType: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 2,
    borderRadius: theme.borderRadius.full,
  },
  queueTypeText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.text,
  },
  queueTypeProie: {
    backgroundColor: '#EEF2FF',
  },
  queueTypeBattue: {
    backgroundColor: '#ECFDF5',
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
    gap: theme.spacing.sm,
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
  badgeSelector: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  badgeOption: {
    width: '30%',
    alignItems: 'center',
    padding: theme.spacing.sm,
    borderWidth: 2,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.sm,
    backgroundColor: theme.colors.surface,
  },
  badgeOptionSelected: {
    borderColor: theme.colors.primary,
    backgroundColor: theme.colors.background,
  },
  badgeOptionImage: {
    width: 48,
    height: 48,
    borderRadius: theme.borderRadius.sm,
  },
  badgeOptionPlaceholder: {
    width: 48,
    height: 48,
  },
  badgeOptionName: {
    fontSize: theme.fontSize.xs,
    textAlign: 'center',
    color: theme.colors.text,
    marginTop: theme.spacing.xs,
  },
  starInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: theme.spacing.sm,
    marginTop: theme.spacing.sm,
    backgroundColor: theme.colors.background,
    borderRadius: theme.borderRadius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  starInfoLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.text,
  },
  starInfoValue: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.primary,
  },
  typeSelector: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  typeOption: {
    flex: 1,
    alignItems: 'center',
    padding: theme.spacing.md,
    borderWidth: 2,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.sm,
    backgroundColor: theme.colors.surface,
  },
  typeOptionSelected: {
    borderColor: theme.colors.primary,
    backgroundColor: theme.colors.background,
  },
  typeOptionIcon: {
    fontSize: theme.fontSize.xl,
  },
  typeOptionLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.text,
    marginTop: theme.spacing.xs,
  },
  typeOptionDesc: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textMuted,
    marginTop: theme.spacing.xs,
    textAlign: 'center',
  },
  dateInput: {
    backgroundColor: theme.colors.background,
    borderRadius: theme.borderRadius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  dateInputText: {
    fontSize: theme.fontSize.base,
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
  fab: {
    position: 'absolute',
    bottom: theme.spacing.lg,
    right: theme.spacing.lg,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: theme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: theme.colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  fabText: {
    color: theme.colors.selectedText,
    fontSize: theme.fontSize.xl,
    fontWeight: theme.fontWeight.bold,
  },
});

export default BadgeTrackerScreen;
