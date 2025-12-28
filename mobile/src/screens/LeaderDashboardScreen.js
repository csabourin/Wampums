/**
 * LeaderDashboardScreen
 *
 * Dashboard for scout leaders/group leaders
 * Mirrors the web dashboard layout in spa/dashboard.js
 *
 * Features:
 * - Organization overview and branding
 * - Quick access to core leader tasks
 * - Sectioned navigation for daily operations
 * - Offline support with caching indicators
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Alert,
  TouchableOpacity,
  Image,
  useWindowDimensions,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';

// API and utilities
import { getOrganizationSettings } from '../api/api-endpoints';
import { translate as t } from '../i18n';
import StorageUtils from '../utils/StorageUtils';
import CacheManager from '../utils/CacheManager';
import SecurityUtils from '../utils/SecurityUtils';
import { hasPermission, hasAnyPermission } from '../utils/PermissionUtils';
import theme, { commonStyles } from '../theme';
import CONFIG from '../config';
import { debugError } from '../utils/DebugUtils';

// Components
import { LoadingSpinner, ErrorMessage } from '../components';

const FALLBACK_ORG_LOGO = require('../../assets/icon.png');
const ORGANIZATION_SETTINGS_KEY = 'organizationSettings';

/**
 * LeaderDashboardScreen Component
 */
const LeaderDashboardScreen = () => {
  const navigation = useNavigation();
  const { width: windowWidth } = useWindowDimensions();

  // Configure header with settings button
  useEffect(() => {
    navigation.setOptions({
      headerShown: true,
      title: t('dashboard_title'),
      headerRight: () => (
        <TouchableOpacity
          onPress={() => navigation.navigate('Settings')}
          style={{ paddingRight: 16 }}
          accessibilityLabel={t('settings')}
        >
          <Text style={{ fontSize: 24 }}>⚙️</Text>
        </TouchableOpacity>
      ),
    });
  }, [navigation]);

  // State
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [isOffline, setIsOffline] = useState(false);
  const [organizationName, setOrganizationName] = useState('');
  const [organizationLogo, setOrganizationLogo] = useState('');
  const [userPermissions, setUserPermissions] = useState([]);

  const gridColumns = 2;
  const gridGap = theme.spacing.sm;
  const gridHorizontalPadding = theme.spacing.lg;
  const gridItemWidth = useMemo(() => {
    const availableWidth =
      windowWidth - gridHorizontalPadding * 2 - gridGap * (gridColumns - 1);
    return Math.max(0, availableWidth / gridColumns);
  }, [windowWidth, gridGap, gridHorizontalPadding]);

  /**
   * Initialize screen
   */
  useEffect(() => {
    loadUserPermissions();

    // Listen for network state changes
    const networkListener = (online) => {
      setIsOffline(!online);
    };

    CacheManager.addNetworkListener(networkListener);

    return () => {
      CacheManager.removeNetworkListener(networkListener);
    };
  }, []);

  /**
   * Reload data when screen comes into focus
   */
  useFocusEffect(
    useCallback(() => {
      loadDashboardContext();
    }, [])
  );

  /**
   * Load user permissions from storage
   */
  const loadUserPermissions = async () => {
    try {
      const storedPermissions = await StorageUtils.getItem(
        CONFIG.STORAGE_KEYS.USER_PERMISSIONS
      );
      if (Array.isArray(storedPermissions)) {
        setUserPermissions(storedPermissions);
      }
    } catch (err) {
      debugError('Error loading user permissions:', err);
    }
  };

  /**
   * Load organization branding data for the dashboard
   */
  const loadDashboardContext = async () => {
    try {
      setLoading(true);
      setError(null);

      const cachedSettings = await StorageUtils.getItem(
        ORGANIZATION_SETTINGS_KEY
      );
      const cachedOrg = cachedSettings?.organization_info;

      if (cachedOrg) {
        setOrganizationName(
          SecurityUtils.sanitizeInput(cachedOrg.name || '')
        );
        setOrganizationLogo(SecurityUtils.sanitizeUrl(cachedOrg.logo || ''));
      }

      const settingsResponse = await getOrganizationSettings();
      if (settingsResponse.success && settingsResponse.data) {
        const orgInfo = settingsResponse.data.organization_info || {};
        const sanitizedName = SecurityUtils.sanitizeInput(orgInfo.name || '');
        const sanitizedLogo = SecurityUtils.sanitizeUrl(orgInfo.logo || '');

        setOrganizationName(sanitizedName);
        setOrganizationLogo(sanitizedLogo);
        await StorageUtils.setItem(
          ORGANIZATION_SETTINGS_KEY,
          settingsResponse.data
        );
      }

      if (settingsResponse.fromCache) {
        setIsOffline(true);
      }
    } catch (err) {
      debugError('Error loading dashboard context:', err);
      setError(t('error_loading_dashboard'));
    } finally {
      setLoading(false);
    }
  };

  /**
   * Handle pull-to-refresh
   */
  const onRefresh = async () => {
    setRefreshing(true);
    await loadDashboardContext();
    setRefreshing(false);
  };

  /**
   * Determine if a user can access an action
   *
   * @param {Object} action - Action definition
   * @returns {boolean} True when action should be visible
   */
  const canAccessAction = (action) => {
    if (!action) return false;
    if (!action.permission && !action.permissions) return true;

    if (action.permission) {
      return hasPermission(action.permission, userPermissions);
    }

    if (action.permissions) {
      return hasAnyPermission(action.permissions, userPermissions);
    }

    return true;
  };

  /**
   * Handle dashboard action selection
   *
   * @param {Object} action - Action definition
   */
  const handleActionPress = useCallback((action) => {
    if (!action) return;

    if (action.screen) {
      navigation.navigate(action.screen);
      return;
    }

    if (typeof action.onPress === 'function') {
      action.onPress();
      return;
    }

    Alert.alert(action.label, t('Coming soon'), [{ text: t('OK') }]);
  }, [navigation]);

  /**
   * Render grid of action buttons
   *
   * @param {Array<Object>} actions - Action definitions
   * @param {string} variant - Visual variant for cards
   * @returns {React.ReactElement|null}
   */
  const renderActionGrid = useCallback((actions, variant) => {
    if (!actions.length) return null;

    return (
      <View style={styles.actionGrid}>
        {actions.map((action) => (
          <TouchableOpacity
            key={action.key}
            style={[
              styles.actionCard,
              variant === 'primary'
                ? styles.actionCardPrimary
                : styles.actionCardSecondary,
              { width: gridItemWidth },
            ]}
            onPress={() => handleActionPress(action)}
            activeOpacity={0.85}
          >
            <Text
              style={
                variant === 'primary'
                  ? styles.actionIconPrimary
                  : styles.actionIconSecondary
              }
            >
              {action.icon}
            </Text>
            <Text
              style={
                variant === 'primary'
                  ? styles.actionLabelPrimary
                  : styles.actionLabelSecondary
              }
            >
              {action.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    );
  }, [gridItemWidth, handleActionPress]);

  // Compute menu items (must be before early returns per React hooks rules)
  // Quick access section - matches original dashboard.js top section
  const quickAccessItems = useMemo(() => [
    {
      key: 'managePoints',
      label: t('manage_points'),
      icon: '🪙',
      screen: 'ManagePoints',
      permission: 'points.manage',
    },
    {
      key: 'manageHonors',
      label: t('manage_honors'),
      icon: '🏅',
      screen: 'Honors',
      permission: 'honors.manage',
    },
    {
      key: 'attendance',
      label: t('attendance'),
      icon: '✅',
      screen: 'Attendance',
      permission: 'attendance.manage',
    },
    {
      key: 'upcomingMeeting',
      label: t('upcoming_meeting'),
      icon: '📅',
      screen: 'NextMeeting',
      permission: 'activities.view',
    },
  ].filter(canAccessAction), [userPermissions]);

  const dashboardSections = useMemo(() => [
    {
      key: 'dayToDay',
      title: t('dashboard_day_to_day_section'),
      items: [
        {
          key: 'approveBadges',
          label: t('approve_badges'),
          icon: '🎖️',
          screen: 'ApproveBadges',
          permissions: ['badges.approve', 'badges.view'],
        },
        {
          key: 'badgeDashboard',
          label: t('badge_dashboard_link'),
          icon: '📊',
          screen: 'BadgeDashboard',
          permissions: ['badges.view', 'badges.manage'],
        },
        {
          key: 'parentContact',
          label: t('parent_contact_list'),
          icon: '📒',
          screen: 'ParentContactList',
          permissions: ['participants.view', 'users.view'],
        },
        {
          key: 'medicationDistribution',
          label: t('medication_dispensing_link'),
          icon: '💊',
          screen: 'MedicationDistribution',
          permissions: ['medication.distribute', 'medication.manage', 'medication.view'],
        },
        {
          key: 'parentDashboard',
          label: t('vue_parents'),
          icon: '👨‍👩‍👧',
          screen: 'ParentDashboard',
          permissions: ['participants.view', 'communications.send'],
        },
      ].filter(canAccessAction),
    },
    {
      key: 'preparation',
      title: t('dashboard_preparation_section'),
      items: [
        {
          key: 'activitiesCalendar',
          label: t('activities_calendar'),
          icon: '🗓️',
          screen: 'Activities',
          permissions: ['activities.view', 'activities.manage'],
        },
        {
          key: 'carpoolCoordination',
          label: t('carpool_coordination'),
          icon: '🚗',
          screen: 'Carpool',
          permissions: ['carpools.view', 'carpools.manage'],
        },
        {
          key: 'meetingPrep',
          label: t('preparation_reunions'),
          icon: '📝',
          screen: 'MeetingPreparation',
          permissions: ['activities.manage', 'attendance.manage'],
        },
        {
          key: 'participantDocuments',
          label: t('view_participant_documents'),
          icon: '📄',
          screen: 'ParticipantDocuments',
          permissions: ['participants.view', 'participants.edit'],
        },
        {
          key: 'inventory',
          label: t('inventory_link'),
          icon: '📦',
          screen: 'Inventory',
          permissions: ['resources.view', 'resources.manage'],
        },
        {
          key: 'materialManagement',
          label: t('material_management_link'),
          icon: '🧰',
          screen: 'MaterialManagement',
          permissions: ['resources.view', 'resources.manage'],
        },
        {
          key: 'medicationPlanning',
          label: t('medication_planning_link'),
          icon: '🧪',
          screen: 'MedicationPlanning',
          permissions: ['medication.manage'],
        },
        {
          key: 'permissionSlips',
          label: t('manage_permission_slips'),
          icon: '📑',
          screen: 'PermissionSlips',
          permissions: ['permission_slips.view', 'permission_slips.manage'],
        },
      ].filter(canAccessAction),
    },
    {
      key: 'operations',
      title: t('dashboard_operations_section'),
      items: [
        {
          key: 'resources',
          label: t('resource_dashboard_link'),
          icon: '🗂️',
          screen: 'ResourceDashboard',
          permissions: ['resources.view', 'resources.manage'],
        },
        {
          key: 'permissionSlipsDashboard',
          label: t('permission_slip_dashboard_link'),
          icon: '📋',
          screen: 'PermissionSlips',
          permissions: ['permission_slips.view', 'permission_slips.manage'],
        },
      ].filter(canAccessAction),
    },
    {
      key: 'finance',
      title: t('dashboard_finance_section'),
      items: [
        {
          key: 'financeMemberships',
          label: t('finance_memberships_tab'),
          icon: '💰',
          screen: 'Finance',
          permission: 'finance.view',
        },
        {
          key: 'financeDefinitions',
          label: t('finance_definitions_tab'),
          icon: '💵',
          screen: 'Finance',
          permission: 'finance.view',
        },
        {
          key: 'financialReport',
          label: t('financial_report'),
          icon: '📈',
          screen: 'Finance',
          permission: 'finance.view',
        },
        {
          key: 'expenses',
          label: t('expense_tracking'),
          icon: '💸',
          screen: 'Expenses',
          permissions: ['finance.manage', 'finance.view'],
        },
        {
          key: 'externalRevenue',
          label: t('external_revenue'),
          icon: '💵',
          screen: 'ExternalRevenue',
          permissions: ['finance.manage', 'finance.view'],
        },
      ].filter(canAccessAction),
    },
    {
      key: 'admin',
      title: t('dashboard_admin_section'),
      items: [
        {
          key: 'manageParticipants',
          label: t('manage_names'),
          icon: '🪪',
          screen: 'Participants',
          permission: 'participants.view',
        },
        {
          key: 'manageGroups',
          label: t('manage_groups'),
          icon: '👥',
          screen: 'Groups',
          permission: 'groups.view',
        },
        {
          key: 'manageUsersParticipants',
          label: t('manage_users_participants'),
          icon: '⚙️',
          screen: 'UserParticipantLink',
          permission: 'users.view',
        },
        {
          key: 'accountInfo',
          label: t('account_info'),
          icon: '👤',
          screen: 'AccountInfo',
        },
        {
          key: 'mailingList',
          label: t('mailing_list'),
          icon: '✉️',
          screen: 'MailingList',
          permission: 'communications.send',
        },
        {
          key: 'fundraisers',
          label: t('fundraisers'),
          icon: '❤️',
          screen: 'Fundraisers',
          permission: 'fundraisers.view',
        },
        {
          key: 'revenueDashboard',
          label: t('revenue_dashboard'),
          icon: '📊',
          screen: 'RevenueDashboard',
          permissions: ['finance.view', 'fundraisers.view'],
        },
        {
          key: 'budgets',
          label: t('budget_management'),
          icon: '💼',
          screen: 'Budgets',
          permission: 'budget.view',
        },
        {
          key: 'reports',
          label: t('reports'),
          icon: '📋',
          screen: 'Reports',
          permissions: ['reports.view', 'reports.export'],
        },
        {
          key: 'groupParticipantReport',
          label: t('feuille_participants'),
          icon: '📑',
          screen: 'GroupParticipantReport',
          permissions: ['reports.view', 'reports.export'],
        },
      ].filter(canAccessAction),
    },
  ], [userPermissions]);

  // System Administration section
  const administrationItems = useMemo(() => [
    {
      key: 'roleManagement',
      label: t('role_management'),
      icon: '🏷️',
      screen: 'RoleManagement',
      permissions: ['roles.view', 'roles.manage'],
    },
    {
      key: 'districtManagement',
      label: t('district_management_title'),
      icon: '🗺️',
      screen: 'DistrictDashboard',
      permissions: ['roles.view', 'roles.manage'],
    },
    {
      key: 'formPermissions',
      label: t('form_permissions'),
      icon: '📝',
      screen: 'FormPermissions',
      permission: 'forms.manage_permissions',
    },
    {
      key: 'createOrganization',
      label: t('create_unit'),
      icon: '🏢',
      screen: 'CreateOrganization',
      permission: 'organizations.create',
    },
    {
      key: 'adminPanel',
      label: t('administration'),
      icon: '🛡️',
      screen: 'Admin',
      permission: 'admin.access',
    },
  ].filter(canAccessAction), [userPermissions]);

  // Filter out empty sections
  const visibleSections = useMemo(() => {
    return dashboardSections
      .map((section) => ({
        ...section,
        items: section.items.filter(canAccessAction),
      }))
      .filter((section) => section.items.length > 0);
  }, [dashboardSections, userPermissions]);

  // Only show Administration section if there are items
  const showAdministrationSection = administrationItems.length > 0;

  // Early returns after all hooks
  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <LoadingSpinner />
        <Text style={styles.loadingText}>{t('loading')}</Text>
      </View>
    );
  }

  if (error && !refreshing) {
    return (
      <View style={styles.centerContainer}>
        <ErrorMessage message={error} />
      </View>
    );
  }

  const logoSource = organizationLogo
    ? { uri: organizationLogo }
    : FALLBACK_ORG_LOGO;
  const displayName = organizationName || t('groups');

  return (
    <View style={styles.container}>
      {isOffline && (
        <View style={styles.offlineIndicator}>
          <Text style={styles.offlineText}>
            📡 {t('offline')} - {t('viewing_cached_data')}
          </Text>
        </View>
      )}

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* Header with Organization Name */}
        <View style={styles.header}>
          <Text style={styles.title}>{t('dashboard_title')}</Text>
          <Text style={styles.organizationName}>{displayName}</Text>
        </View>

        {/* Quick Access Section - matches original dashboard top buttons */}
        {quickAccessItems.length > 0 && (
          <View style={styles.quickAccessSection}>
            {renderActionGrid(quickAccessItems, 'primary')}
          </View>
        )}

        {/* Organization Logo - matches original dashboard placement */}
        <View style={styles.logoContainer}>
          <Image
            source={logoSource}
            style={styles.logo}
            resizeMode="contain"
            accessibilityLabel={displayName}
          />
        </View>

        {/* Dashboard Sections - Day-to-Day, Preparation, Operations, Finance, Admin */}
        {visibleSections.map((section) => (
          <View key={section.key} style={styles.section}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            {renderActionGrid(section.items, 'secondary')}
          </View>
        ))}

        {/* System Administration Section - matches original dashboard admin section */}
        {showAdministrationSection && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              {t('system_administration')}
            </Text>
            {renderActionGrid(administrationItems, 'secondary')}
          </View>
        )}

        <View style={styles.bottomSpacing} />
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    ...commonStyles.container,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: theme.spacing.lg,
    backgroundColor: theme.colors.background,
  },
  loadingText: {
    marginTop: theme.spacing.sm,
    fontSize: theme.fontSize.base,
    color: theme.colors.textLight,
  },
  offlineIndicator: {
    backgroundColor: theme.colors.warning,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    alignItems: 'center',
  },
  offlineText: {
    color: theme.colors.surface,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: theme.spacing.xl,
  },
  header: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.lg,
    paddingBottom: theme.spacing.md,
    alignItems: 'center',
  },
  title: {
    ...commonStyles.heading1,
    color: theme.colors.text,
    textAlign: 'center',
  },
  organizationName: {
    ...commonStyles.heading3,
    color: theme.colors.primary,
    marginTop: theme.spacing.xs,
    textAlign: 'center',
  },
  quickAccessSection: {
    marginBottom: theme.spacing.sm,
    marginTop: theme.spacing.sm,
  },
  actionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
  },
  actionCard: {
    borderRadius: theme.borderRadius.md,
    paddingVertical: theme.spacing.lg,
    paddingHorizontal: theme.spacing.sm,
    minHeight: 96,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing.sm,
    ...theme.shadows.sm,
  },
  actionCardPrimary: {
    backgroundColor: theme.colors.primary,
    borderWidth: 0,
  },
  actionCardSecondary: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  actionIconPrimary: {
    fontSize: theme.fontSize.xxl,
    marginBottom: theme.spacing.xs,
    color: theme.colors.surface,
  },
  actionIconSecondary: {
    fontSize: theme.fontSize.xxl,
    marginBottom: theme.spacing.xs,
    color: theme.colors.text,
  },
  actionLabelPrimary: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.surface,
    textAlign: 'center',
    lineHeight: theme.fontSize.base * 1.4,
  },
  actionLabelSecondary: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.text,
    textAlign: 'center',
    lineHeight: theme.fontSize.base * 1.4,
  },
  logoContainer: {
    alignItems: 'center',
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.lg,
  },
  logo: {
    width: '80%',
    maxWidth: 335,
    aspectRatio: 335 / 366,
    height: undefined,
  },
  section: {
    marginTop: theme.spacing.md,
  },
  sectionTitle: {
    paddingHorizontal: theme.spacing.lg,
    marginBottom: theme.spacing.sm,
    marginTop: theme.spacing.xs,
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.text,
  },
  bottomSpacing: {
    height: theme.spacing.xl,
  },
});

export default LeaderDashboardScreen;
