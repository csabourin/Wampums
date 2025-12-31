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
import { Ionicons, MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';

// API and utilities
import { getOrganizationSettings } from '../api/api-endpoints';
import { translate as t } from '../i18n';
import StorageUtils from '../utils/StorageUtils';
import CacheManager from '../utils/CacheManager';
import SecurityUtils from '../utils/SecurityUtils';
import { hasPermission, hasAnyPermission } from '../utils/PermissionUtils';
import theme, { commonStyles } from '../theme';
// Static St-Paul image (relative to /mobile/src/screens)
const StPaulImage = require('../../assets/images/6eASt-Paul.webp');
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
  const scrollViewRef = React.useRef(null);
  const SCROLL_KEY = 'LeaderDashboardScrollY';
  const [initialScrollY, setInitialScrollY] = useState(0);
  const [scrollReady, setScrollReady] = useState(false);
  const scrollPositionRef = React.useRef(0);
  const saveScrollTimeoutRef = React.useRef(null);

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
          <Ionicons name="settings-outline" size={24} color={theme.colors.text} />
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
      // Save scroll position on unmount
      if (saveScrollTimeoutRef.current) {
        clearTimeout(saveScrollTimeoutRef.current);
      }
      if (scrollPositionRef.current > 0) {
        StorageUtils.setItem(SCROLL_KEY, String(scrollPositionRef.current)).catch(() => {});
      }
    };
  }, []);

  /**
   * Reload data when screen comes into focus
   */
  useFocusEffect(
    useCallback(() => {
      loadDashboardContext();
      setScrollReady(false);
      (async () => {
        try {
          const y = await StorageUtils.getItem(SCROLL_KEY);
          const scrollY = y ? parseInt(y, 10) : 0;
          setInitialScrollY(scrollY);
        } catch {}
        setScrollReady(true);
      })();
      return () => {};
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
      if (err?.status === 403) {
        setError(t('no_permission_for_screen'));
      } else {
        setError(t('error_loading_dashboard'));
      }
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
   * Render icon based on icon family
   */
  const renderIcon = (iconFamily, iconName, color, size = 32) => {
    const IconComponent = iconFamily === 'MaterialCommunityIcons'
      ? MaterialCommunityIcons
      : iconFamily === 'MaterialIcons'
      ? MaterialIcons
      : Ionicons;

    return <IconComponent name={iconName} size={size} color={color} />;
  };

  /**
   * Render grid of action buttons
   *
   * @param {Array<Object>} actions - Action definitions
   * @param {string} variant - Visual variant for cards
   * @returns {React.ReactElement|null}
   */
  const renderActionGrid = useCallback((actions, variant) => {
    if (!actions.length) return null;

    const iconColor = theme.colors.surface;

    return (
      <View style={styles.actionGrid}>
        {actions.map((action) => (
          <TouchableOpacity
            key={action.key}
            style={[
              styles.actionCard,
              styles.actionCardPrimary,
              { width: gridItemWidth },
            ]}
            onPress={() => handleActionPress(action)}
            activeOpacity={0.85}
          >
            <View
              style={styles.actionIconPrimary}
            >
              {renderIcon(action.iconFamily, action.iconName, iconColor)}
            </View>
            <Text
              style={styles.actionLabelPrimary}
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
      iconFamily: 'MaterialCommunityIcons',
      iconName: 'star-four-points-circle',
      screen: 'ManagePoints',
      permission: 'points.manage',
    },
    {
      key: 'manageHonors',
      label: t('manage_honors'),
      iconFamily: 'MaterialCommunityIcons',
      iconName: 'medal',
      screen: 'Honors',
      permission: 'honors.manage',
    },
    {
      key: 'attendance',
      label: t('attendance'),
      iconFamily: 'MaterialIcons',
      iconName: 'check-circle',
      screen: 'Attendance',
      permission: 'attendance.manage',
    },
    {
      key: 'upcomingMeeting',
      label: t('upcoming_meeting'),
      iconFamily: 'Ionicons',
      iconName: 'calendar-outline',
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
          iconFamily: 'MaterialCommunityIcons',
          iconName: 'medal-outline',
          screen: 'ApproveBadges',
          permissions: ['badges.approve', 'badges.view'],
        },
        {
          key: 'badgeDashboard',
          label: t('badge_dashboard_link'),
          iconFamily: 'MaterialCommunityIcons',
          iconName: 'tablet-dashboard',
          screen: 'BadgeDashboard',
          permissions: ['badges.view', 'badges.manage'],
        },
        {
          key: 'parentContact',
          label: t('parent_contact_list'),
          iconFamily: 'MaterialCommunityIcons',
          iconName: 'ambulance',
          screen: 'ParentContactList',
          permissions: ['participants.view', 'users.view'],
        },
        {
          key: 'medicationDistribution',
          label: t('medication_dispensing_link'),
          iconFamily: 'MaterialCommunityIcons',
          iconName: 'pill',
          screen: 'MedicationDistribution',
          permissions: ['medication.distribute', 'medication.manage', 'medication.view'],
        },
        {
          key: 'parentDashboard',
          label: t('vue_parents'),
          iconFamily: 'Ionicons',
          iconName: 'people',
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
          iconFamily: 'MaterialCommunityIcons',
          iconName: 'calendar-multiple',
          screen: 'Activities',
          permissions: ['activities.view', 'activities.manage'],
        },
        {
          key: 'carpoolCoordination',
          label: t('carpool_coordination'),
          iconFamily: 'Ionicons',
          iconName: 'car-outline',
          screen: 'Carpool',
          permissions: ['carpools.view', 'carpools.manage'],
        },
        {
          key: 'meetingPrep',
          label: t('preparation_reunions'),
          iconFamily: 'Ionicons',
          iconName: 'create-outline',
          screen: 'MeetingPreparation',
          permissions: ['activities.manage', 'attendance.manage'],
        },
        {
          key: 'participantDocuments',
          label: t('view_participant_documents'),
          iconFamily: 'Ionicons',
          iconName: 'document-outline',
          screen: 'ParticipantDocuments',
          permissions: ['participants.view', 'participants.edit'],
        },
        {
          key: 'inventory',
          label: t('inventory_link'),
          iconFamily: 'MaterialCommunityIcons',
          iconName: 'warehouse',
          screen: 'Inventory',
          permissions: ['resources.view', 'resources.manage'],
        },
        {
          key: 'materialManagement',
          label: t('material_management_link'),
          iconFamily: 'MaterialCommunityIcons',
          iconName: 'toolbox',
          screen: 'MaterialManagement',
          permissions: ['resources.view', 'resources.manage'],
        },
        {
          key: 'medicationPlanning',
          label: t('medication_planning_link'),
          iconFamily: 'MaterialCommunityIcons',
          iconName: 'test-tube',
          screen: 'MedicationPlanning',
          permissions: ['medication.manage'],
        },
        {
          key: 'permissionSlips',
          label: t('manage_permission_slips'),
          iconFamily: 'Ionicons',
          iconName: 'documents-outline',
          screen: 'PermissionSlips',
          permissions: ['communications.send', 'participants.view'],
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
          iconFamily: 'MaterialCommunityIcons',
          iconName: 'shipping-pallet',
          screen: 'ResourceDashboard',
          permissions: ['resources.view', 'resources.manage'],
        },
         {
          key: 'reports',
          label: t('reports'),
          iconFamily: 'Ionicons',
          iconName: 'clipboard-outline',
          screen: 'Reports',
          permissions: ['reports.view', 'reports.export'],
        },
        {
          key: 'permissionSlipsDashboard',
          label: t('permission_slip_dashboard_link'),
          iconFamily: 'Ionicons',
          iconName: 'clipboard-outline',
          screen: 'PermissionSlips',
          permissions: ['communications.send', 'participants.view'],
        },
        {
          key: 'fundraisers',
          label: t('fundraisers'),
          iconFamily: 'MaterialCommunityIcons',
          iconName: 'hand-heart',
          screen: 'Fundraisers',
          permission: 'fundraisers.view',
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
          iconFamily: 'Ionicons',
          iconName: 'cash-outline',
          screen: 'Finance',
          permission: 'finance.view',
        },
        {
          key: 'financeDefinitions',
          label: t('finance_definitions_tab'),
          iconFamily: 'MaterialCommunityIcons',
          iconName: 'cash-100',
          screen: 'Finance',
          permission: 'finance.view',
        },
        {
          key: 'financialReport',
          label: t('financial_report'),
          iconFamily: 'Ionicons',
          iconName: 'trending-up',
          screen: 'Finance',
          permission: 'finance.view',
        },
        {
          key: 'expenses',
          label: t('expense_tracking'),
          iconFamily: 'MaterialCommunityIcons',
          iconName: 'cash-minus',
          screen: 'Expenses',
          permissions: ['finance.manage', 'finance.view'],
        },
        {
          key: 'externalRevenue',
          label: t('external_revenue'),
          iconFamily: 'MaterialCommunityIcons',
          iconName: 'cash-plus',
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
          iconFamily: 'Ionicons',
          iconName: 'id-card-outline',
          screen: 'Participants',
          permission: 'participants.view',
        },
        {
          key: 'manageGroups',
          label: t('manage_groups'),
          iconFamily: 'Ionicons',
          iconName: 'people-outline',
          screen: 'Groups',
          permission: 'groups.view',
        },
        {
          key: 'manageUsersParticipants',
          label: t('manage_users_participants'),
          iconFamily: 'Ionicons',
          iconName: 'settings-outline',
          screen: 'UserParticipantLink',
          permission: 'users.view',
        },
        {
          key: 'accountInfo',
          label: t('account_info'),
          iconFamily: 'Ionicons',
          iconName: 'person-outline',
          screen: 'AccountInfo',
        },
        {
          key: 'mailingList',
          label: t('mailing_list'),
          iconFamily: 'Ionicons',
          iconName: 'mail-outline',
          screen: 'MailingList',
          permission: 'communications.send',
        },
        {
          key: 'revenueDashboard',
          label: t('revenue_dashboard'),
          iconFamily: 'Ionicons',
          iconName: 'stats-chart',
          screen: 'RevenueDashboard',
          permissions: ['finance.view', 'fundraisers.view'],
        },
        {
          key: 'budgets',
          label: t('budget_management'),
          iconFamily: 'Ionicons',
          iconName: 'briefcase-outline',
          screen: 'Budgets',
          permission: 'budget.view',
        },
        {
          key: 'groupParticipantReport',
          label: t('feuille_participants'),
          iconFamily: 'Ionicons',
          iconName: 'document-text-outline',
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
      iconFamily: 'Ionicons',
      iconName: 'pricetag-outline',
      screen: 'RoleManagement',
      permissions: ['roles.view', 'roles.manage'],
    },
    {
      key: 'districtManagement',
      label: t('district_management_title'),
      iconFamily: 'Ionicons',
      iconName: 'map-outline',
      screen: 'DistrictDashboard',
      permissions: ['roles.view', 'roles.manage'],
    },
    {
      key: 'formPermissions',
      label: t('form_permissions'),
      iconFamily: 'Ionicons',
      iconName: 'create-outline',
      screen: 'FormPermissions',
      permission: 'forms.manage_permissions',
    },
    {
      key: 'createOrganization',
      label: t('create_unit'),
      iconFamily: 'Ionicons',
      iconName: 'business-outline',
      screen: 'CreateOrganization',
      permission: 'organizations.create',
    },
    {
      key: 'adminPanel',
      label: t('administration'),
      iconFamily: 'Ionicons',
      iconName: 'shield-outline',
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

  if (!scrollReady) {
    return <LoadingSpinner message={t('loading')} />;
  }

  return (
    <View style={styles.container}>
      {isOffline && (
        <View style={styles.offlineIndicator}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <MaterialCommunityIcons name="wifi-off" size={20} color={theme.colors.surface} />
            <Text style={styles.offlineText}>
              {t('offline')} - {t('viewing_cached_data')}
            </Text>
          </View>
        </View>
      )}

      <ScrollView
        ref={scrollViewRef}
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        onScroll={e => {
          const y = Math.round(e.nativeEvent.contentOffset.y);
          scrollPositionRef.current = y;

          // Debounce AsyncStorage writes to avoid excessive I/O
          if (saveScrollTimeoutRef.current) {
            clearTimeout(saveScrollTimeoutRef.current);
          }
          saveScrollTimeoutRef.current = setTimeout(() => {
            StorageUtils.setItem(SCROLL_KEY, String(y)).catch(() => {});
          }, 500); // Save 500ms after user stops scrolling
        }}
        scrollEventThrottle={16}
        onLayout={() => {
          if (scrollViewRef.current && initialScrollY > 0) {
            scrollViewRef.current.scrollTo({ y: initialScrollY, animated: false });
          }
        }}
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
            source={StPaulImage}
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
    marginBottom: theme.spacing.xs,
  },
  actionIconSecondary: {
    marginBottom: theme.spacing.xs,
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
