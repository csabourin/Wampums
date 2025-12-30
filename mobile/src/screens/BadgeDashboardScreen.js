/**
 * Badge Dashboard Screen
 *
 * Mirrors spa/badge_dashboard.js functionality
 * Shows badge progress summary for all participants
 * View earned badges, stars, and completion progress
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
  Image,
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { useNavigation } from '@react-navigation/native';
import {
  getBadgeSummary,
  getBadgeSystemSettings,
  getGroups,
  getParticipants,
} from '../api/api-endpoints';
import { translate as t } from '../i18n';
import theme, { commonStyles } from '../theme';
import badgeImages from '../../assets/images/_badgeImages';
import {
  LoadingSpinner,
  ErrorMessage,
  Card,
  Select,
  EmptyState,
  Modal,
  useToast,
} from '../components';
import { canViewBadges, canApproveBadges, canManageBadges } from '../utils/PermissionUtils';
import { debugLog, debugError } from '../utils/DebugUtils';

const BadgeDashboardScreen = () => {
  const navigation = useNavigation();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [groups, setGroups] = useState([]);
  const [participants, setParticipants] = useState([]);
  const [badgeEntries, setBadgeEntries] = useState([]);
  const [badgeSettings, setBadgeSettings] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [sortKey, setSortKey] = useState('group');
  const [sortDirection, setSortDirection] = useState('asc');
  const [selectedBadge, setSelectedBadge] = useState(null);
  const [badgeModalVisible, setBadgeModalVisible] = useState(false);

  useEffect(() => {
    // Check permissions and load data
    const checkPermissionsAndLoad = async () => {
      debugLog('[BadgeDashboard] Checking permissions...');
      const hasViewPermission = await canViewBadges();
      const hasApprovePermission = await canApproveBadges();
      const hasManagePermission = await canManageBadges();
      debugLog('[BadgeDashboard] Permissions:', { hasViewPermission, hasApprovePermission, hasManagePermission });
      
      if (!hasViewPermission && !hasApprovePermission && !hasManagePermission) {
        debugError('[BadgeDashboard] No badge permissions, going back');
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

      const [groupsResponse, participantsResponse, badgeSummaryResponse, badgeSettingsResponse] =
        await Promise.all([
          getGroups(),
          getParticipants(),
          getBadgeSummary({ forceRefresh }),
          getBadgeSystemSettings({ forceRefresh }),
        ]);

      setGroups(groupsResponse.data || groupsResponse.groups || []);
      setParticipants(participantsResponse.data || participantsResponse.participants || []);
      setBadgeEntries(badgeSummaryResponse.data || []);

      const settings = badgeSettingsResponse?.data || null;
      setBadgeSettings(settings);
      setTemplates(settings?.templates || []);
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

  const getTemplateById = (templateId) => {
    const normalizedId = Number.isFinite(Number(templateId)) ? Number(templateId) : templateId;
    return templates.find((template) => template.id === normalizedId);
  };

  const getBadgeLabel = (template, entry = {}) => {
    if (!template) {
      return (
        t(entry.translation_key) ||
        entry.badge_name ||
        entry.territoire_chasse ||
        t('badge_unknown_label')
      );
    }
    return t(template.translation_key) || template.name || t('badge_unknown_label');
  };

  const getObtainableStars = (badgeName, currentStars = 0, templateId = null) => {
    const template = templateId ? getTemplateById(templateId) : null;
    if (template) {
      const levelCount = template.level_count || template.levels?.length || 0;
      return Math.max(levelCount || 0, currentStars, 3);
    }

    if (!badgeSettings) return Math.max(3, currentStars);

    const starFieldMax = badgeSettings?.badge_structure?.fields?.find(
      (field) => field.name === 'etoiles'
    )?.max;
    const explicitMax = parseInt(starFieldMax, 10);

    const territory = (badgeSettings.territoires || []).find(
      (territoire) => territoire.name?.toLowerCase() === badgeName.toLowerCase()
    );

    const maxFromTerritory = territory?.maxStars || territory?.max_etoiles;
    const globalMax =
      explicitMax ||
      badgeSettings.maxStarsPerBadge ||
      badgeSettings.maxStars ||
      badgeSettings.max_etoiles ||
      3;

    return Math.max(maxFromTerritory || 0, globalMax || 0, currentStars, 3);
  };

  const buildRecords = useMemo(() => {
    const groupMap = new Map(groups.map((group) => [group.id, group]));
    const participantMap = new Map(
      participants.map((participant) => {
        const group = groupMap.get(participant.group_id);
        const section = participant.group_section || group?.section || 'general';
        return [
          participant.id,
          {
            id: participant.id,
            firstName: participant.first_name,
            lastName: participant.last_name,
            groupId: participant.group_id,
            groupName: group?.name || t('no_group'),
            section,
            badges: new Map(),
            totalStars: 0,
          },
        ];
      })
    );

    badgeEntries.forEach((entry) => {
      const participant = participantMap.get(entry.participant_id);
      if (!participant) return;

      const template = getTemplateById(entry.badge_template_id);
      const badgeName = getBadgeLabel(template, entry);
      const templateLevels = template?.levels || entry.template_levels || [];
      const levelCount =
        template?.level_count ||
        (Array.isArray(templateLevels) ? templateLevels.length : 0) ||
        entry.level_count ||
        getObtainableStars(badgeName, 0, entry.badge_template_id);
      const badgeKey = entry.badge_template_id
        ? `template-${entry.badge_template_id}`
        : (badgeName || '').toLowerCase();

      if (!participant.badges.has(badgeKey)) {
        participant.badges.set(badgeKey, {
          id: entry.badge_template_id,
          name: badgeName,
          translationKey: template?.translation_key || entry.translation_key,
          section: template?.section || entry.badge_section || participant.section,
          levelCount,
          levels: Array.isArray(templateLevels) ? templateLevels : [],
          image: template?.image || entry.image,
          statuses: new Set(),
          entries: [],
        });
      }

      const badge = participant.badges.get(badgeKey);
      badge.statuses.add(entry.status || 'pending');
      badge.entries.push({
        ...entry,
        badge_name: badgeName,
        badge_template_id: entry.badge_template_id,
        badge_section: badge.section,
      });
    });

    const records = Array.from(participantMap.values()).map((record) => {
      const badges = Array.from(record.badges.values()).map((badge) => {
        // Sort badge entries by level
        const entries = badge.entries.sort((a, b) => (a.etoiles || 0) - (b.etoiles || 0));
        // Count completed levels
        const completedLevels = entries.filter((e) => e.status === 'approved').length;

        return {
          ...badge,
          stars: completedLevels,
          obtainable:
            badge.levelCount || getObtainableStars(badge.name, completedLevels, badge.id),
          entries,
        };
      });

      const totalStars = badges.reduce((sum, badge) => sum + (badge.stars || 0), 0);

      return {
        ...record,
        badges: Array.from(badges),
        totalStars,
      };
    });

    return records;
  }, [groups, participants, badgeEntries, templates, badgeSettings]);

  const sortedRecords = useMemo(() => {
    const sorted = [...buildRecords];

    sorted.sort((a, b) => {
      let comparison = 0;

      switch (sortKey) {
        case 'group':
          comparison = a.groupName.localeCompare(b.groupName);
          if (comparison === 0) {
            comparison = a.lastName.localeCompare(b.lastName);
          }
          break;
        case 'name':
          comparison = a.lastName.localeCompare(b.lastName);
          if (comparison === 0) {
            comparison = a.firstName.localeCompare(b.firstName);
          }
          break;
        case 'stars':
          comparison = (a.totalStars || 0) - (b.totalStars || 0);
          if (comparison === 0) {
            comparison = a.lastName.localeCompare(b.lastName);
          }
          break;
        default:
          comparison = 0;
      }

      return sortDirection === 'asc' ? comparison : -comparison;
    });

    return sorted;
  }, [buildRecords, sortKey, sortDirection]);

  const handleBadgePress = (badge) => {
    setSelectedBadge(badge);
    setBadgeModalVisible(true);
  };

  const renderBadgeChip = (badge) => {
    debugLog('[BadgeDashboard] badge object:', badge);
    const totalLevels = Math.max(1, badge.obtainable);
    const percent = Math.min(100, Math.round((badge.stars / totalLevels) * 100));

    // Render stars
    const stars = Array.from({ length: totalLevels }, (_, index) => {
      const starIndex = index + 1;
      const isEarned = starIndex <= badge.stars;
      return (
        <Text key={`star-${index}`} style={styles.starIcon}>
          {isEarned ? '★' : '☆'}
        </Text>
      );
    });

    // Status pills
    const statusPills = Array.from(badge.statuses).map((status) => (
      <View
        key={status}
        style={[
          styles.statusPill,
          status === 'approved' && styles.statusApproved,
          status === 'pending' && styles.statusPending,
          status === 'rejected' && styles.statusRejected,
        ]}
      >
        <Text style={styles.statusPillText}>{t(`badge_status_${status}`)}</Text>
      </View>
    ));

    // Determine image source
    let imageSource = null;
    if (badge.image && badgeImages[badge.image]) {
      imageSource = badgeImages[badge.image];
    } else if (badge.image && typeof badge.image === 'string' && badge.image.startsWith('http')) {
      imageSource = { uri: badge.image };
    }

    return (
      <TouchableOpacity
        key={badge.name}
        style={styles.badgeChip}
        onPress={() => handleBadgePress(badge)}
        activeOpacity={0.7}
      >
        <View style={styles.badgeChipContent}>
          {imageSource && (
            <Image
              source={imageSource}
              style={styles.badgeImage}
              resizeMode="contain"
            />
          )}
          <Text style={styles.badgeName}>{badge.name}</Text>
          <View style={styles.badgeStars}>{stars}</View>
          <View style={styles.badgeStatusRow}>{statusPills}</View>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: `${percent}%` }]} />
          </View>
          <Text style={styles.badgeProgress}>
            {badge.stars} / {badge.obtainable} {t('badge_stars_label') || t('stars')}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  const renderParticipantRow = ({ item: record }) => {
    return (
      <Card style={styles.participantCard}>
        <View style={styles.participantHeader}>
          <View style={styles.participantInfo}>
            <Text style={styles.participantName}>
              {record.firstName} {record.lastName}
            </Text>
            {sortKey !== 'group' && (
              <Text style={styles.groupTag}>{record.groupName}</Text>
            )}
          </View>
          <View style={styles.participantActions}>
            <Text style={styles.totalStars}>
              {record.totalStars}⭐
            </Text>
            <TouchableOpacity
              style={styles.editButton}
              onPress={() => navigation.navigate('BadgeForm', { participantId: record.id })}
              activeOpacity={0.7}
            >
              <Text style={styles.editButtonText}>✏️</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.badgesContainer}>
          {record.badges.length > 0 ? (
            record.badges.map((badge) => renderBadgeChip(badge))
          ) : (
            <Text style={styles.noBadgesText}>{t('badge_no_entries')}</Text>
          )}
        </View>
      </Card>
    );
  };

  const renderGroupHeader = ({ section }) => {
    if (sortKey !== 'group') return null;

    return (
      <View style={styles.groupHeader}>
        <Text style={styles.groupHeaderText}>{section.title}</Text>
      </View>
    );
  };

  // Group records by group name for SectionList when sorting by group
  const sectionedData = useMemo(() => {
    if (sortKey !== 'group') {
      return [{ title: '', data: sortedRecords }];
    }

    const sections = [];
    let currentGroup = null;
    let currentData = [];

    sortedRecords.forEach((record) => {
      if (record.groupName !== currentGroup) {
        if (currentGroup !== null) {
          sections.push({ title: currentGroup, data: currentData });
        }
        currentGroup = record.groupName;
        currentData = [record];
      } else {
        currentData.push(record);
      }
    });

    if (currentGroup !== null) {
      sections.push({ title: currentGroup, data: currentData });
    }

    return sections;
  }, [sortedRecords, sortKey]);

  const flattenedData = useMemo(() => {
    const flattened = [];
    sectionedData.forEach((section) => {
      if (sortKey === 'group') {
        flattened.push({ type: 'header', title: section.title });
      }
      section.data.forEach((record) => {
        flattened.push({ type: 'record', ...record });
      });
    });
    return flattened;
  }, [sectionedData, sortKey]);

  const sortOptions = [
    { label: t('badge_sort_group'), value: 'group' },
    { label: t('badge_sort_name'), value: 'name' },
    { label: t('badge_sort_stars'), value: 'stars' },
  ];

  if (loading && !refreshing) {
    return <LoadingSpinner message={t('loading')} />;
  }

  if (error && !loading) {
    return <ErrorMessage message={error} onRetry={loadData} />;
  }

  return (
    <View style={commonStyles.container}>
      {/* Controls */}
      <View style={styles.controls}>
        <View style={styles.sortSelect}>
          <Text style={styles.pickerLabel}>{t('badge_sort_label')}</Text>
          <Picker
        selectedValue={sortKey}
        onValueChange={setSortKey}
        style={styles.picker}
          >
        {sortOptions.map((option) => (
          <Picker.Item key={option.value} label={option.label} value={option.value} />
        ))}
          </Picker>
        </View>
        <TouchableOpacity
          style={styles.sortDirectionButton}
          onPress={() => setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))}
          activeOpacity={0.7}
        >
          <Text style={styles.sortDirectionText}>{sortDirection === 'asc' ? '↑' : '↓'}</Text>
        </TouchableOpacity>
      </View>

      {/* Records List */}
      {sortedRecords.length === 0 ? (
        <EmptyState
          icon="🏆"
          title={t('no_badge_data')}
          message={t('no_badge_data_description')}
        />
      ) : (
        <FlatList
          data={flattenedData}
          renderItem={({ item }) => {
            if (item.type === 'header') {
              return (
                <View style={styles.groupHeader}>
                  <Text style={styles.groupHeaderText}>{item.title}</Text>
                </View>
              );
            }
            return renderParticipantRow({ item });
          }}
          keyExtractor={(item, index) =>
            item.type === 'header' ? `header-${item.title}` : `record-${item.id}-${index}`
          }
          contentContainerStyle={styles.listContainer}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        />
      )}

      {/* Badge Detail Modal */}
      {selectedBadge && (
        <Modal
          visible={badgeModalVisible}
          onClose={() => {
            setBadgeModalVisible(false);
            setSelectedBadge(null);
          }}
          title={selectedBadge.name}
          scrollable={true}
        >
          <Text style={styles.modalLabel}>{t('badge_section_label')}:</Text>
          <Text style={styles.modalValue}>{selectedBadge.section}</Text>

          <Text style={styles.modalLabel}>
            {t('badge_stars_label') || t('stars')}:
          </Text>
          <Text style={styles.modalValue}>
            {selectedBadge.stars} / {selectedBadge.obtainable}
          </Text>

          <Text style={styles.modalLabel}>{t('badge_entries_label')}:</Text>
          {selectedBadge.entries.map((entry, index) => (
            <View key={`entry-${index}`} style={styles.entryRow}>
              <Text style={styles.entryText}>
                {t('badge_level_label')} {entry.etoiles}: {entry.objectif}
              </Text>
              <Text
                style={[
                  styles.entryStatus,
                  entry.status === 'approved' && styles.entryStatusApproved,
                  entry.status === 'pending' && styles.entryStatusPending,
                  entry.status === 'rejected' && styles.entryStatusRejected,
                ]}
              >
                {t(`badge_status_${entry.status}`)}
              </Text>
            </View>
          ))}
        </Modal>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  controls: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    padding: theme.spacing.md,
    alignItems: 'flex-end',
  },
  sortSelect: {
    flex: 1,
  },
  sortDirectionButton: {
    width: theme.touchTarget.min,
    height: theme.touchTarget.min,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  sortDirectionText: {
    fontSize: theme.fontSize.xl,
    color: theme.colors.text,
  },
  listContainer: {
    padding: theme.spacing.md,
  },
  groupHeader: {
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    backgroundColor: theme.colors.secondary,
    marginBottom: theme.spacing.sm,
    borderRadius: theme.borderRadius.sm,
  },
  groupHeaderText: {
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.primary,
  },
  participantCard: {
    marginBottom: theme.spacing.md,
  },
  participantHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: theme.spacing.md,
  },
  participantInfo: {
    flex: 1,
  },
  participantName: {
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.primary,
    marginBottom: theme.spacing.xs,
  },
  groupTag: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
    fontStyle: 'italic',
  },
  participantActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  totalStars: {
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.text,
  },
  editButton: {
    width: theme.touchTarget.min,
    height: theme.touchTarget.min,
    justifyContent: 'center',
    alignItems: 'center',
  },
  editButtonText: {
    fontSize: theme.fontSize.lg,
  },
  badgesContainer: {
    gap: theme.spacing.sm,
  },
  badgeChip: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.sm,
    marginBottom: theme.spacing.sm,
  },
  badgeChipContent: {
    gap: theme.spacing.xs,
  },
  badgeName: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.text,
  },
  badgeStars: {
    flexDirection: 'row',
    gap: theme.spacing.xs,
  },
  starIcon: {
    fontSize: theme.fontSize.lg,
    color: theme.colors.warning,
  },
  badgeStatusRow: {
    flexDirection: 'row',
    gap: theme.spacing.xs,
    flexWrap: 'wrap',
  },
  statusPill: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.borderRadius.full,
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
  badgeImage: {
    width: 40,
    height: 40,
    marginBottom: 4,
  },
  statusPillText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.selectedText,
    fontWeight: theme.fontWeight.semibold,
    textTransform: 'capitalize',
  },
  progressBar: {
    height: 8,
    backgroundColor: theme.colors.border,
    borderRadius: theme.borderRadius.full,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: theme.colors.success,
  },
  badgeProgress: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
  },
  noBadgesText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.textMuted,
    fontStyle: 'italic',
  },
  modalLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.textMuted,
    marginTop: theme.spacing.sm,
    marginBottom: theme.spacing.xs,
  },
  modalValue: {
    fontSize: theme.fontSize.base,
    color: theme.colors.text,
  },
  entryRow: {
    padding: theme.spacing.sm,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.sm,
    marginBottom: theme.spacing.xs,
  },
  entryText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.text,
    marginBottom: theme.spacing.xs,
  },
  entryStatus: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.semibold,
    textTransform: 'capitalize',
  },
  entryStatusApproved: {
    color: theme.colors.success,
  },
  entryStatusPending: {
    color: theme.colors.warning,
  },
  entryStatusRejected: {
    color: theme.colors.error,
  },
});

export default BadgeDashboardScreen;
