/**
 * Settings Screen
 *
 * App settings including:
 * - Language selection
 * - User profile
 * - App preferences
 * - Logout
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Switch,
} from 'react-native';
import StorageUtils from '../utils/StorageUtils';
import { translate as t, changeLanguage, getCurrentLanguage } from '../i18n';
import { logout, switchOrganization } from '../api/api-endpoints';
import CacheManager from '../utils/CacheManager';
import CONFIG from '../config';
import { Card } from '../components';
import theme, { commonStyles } from '../theme';
import { debugLog, debugError } from '../utils/DebugUtils.js';

const SettingsScreen = ({ navigation }) => {
  const [userName, setUserName] = useState('');
  const [userRole, setUserRole] = useState('');
  const [organizationUrl, setOrganizationUrl] = useState('');
  const [currentLanguage, setCurrentLanguage] = useState('fr');
  const [pushEnabled, setPushEnabled] = useState(false);
  const [switchingOrg, setSwitchingOrg] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    // Load user data
    const name = await StorageUtils.getItem(CONFIG.STORAGE_KEYS.USER_FULL_NAME);
    const role = await StorageUtils.getItem(CONFIG.STORAGE_KEYS.USER_ROLE);
    const orgUrl = await StorageUtils.getItem('organizationUrl');

    setUserName(name || '');
    setUserRole(role || '');
    setOrganizationUrl(orgUrl || t('organization_not_set'));
    setCurrentLanguage(getCurrentLanguage());

    // TODO: Load push notification preference when implemented
  };

  const handleLanguageChange = async (lang) => {
    const success = await changeLanguage(lang);
    if (success) {
      setCurrentLanguage(lang);
      // Show alert that app will reload
      Alert.alert(
        t('Language changed'),
        t('App restart required'),
        [
          {
            text: t('OK'),
            onPress: () => {
              // TODO: Force app reload/navigation reset
              // For now, just update the state
            },
          },
        ]
      );
    }
  };

  /**
   * Handle switching to a different organization
   * This will navigate back to OrganizationSelectScreen
   * and clear org-specific cached data
   */
  const handleSwitchOrganization = async () => {
    Alert.alert(
      t('organization_switch_organization'),
      t('Are you sure you want to switch to a different organization? You will need to log in again.'),
      [
        {
          text: t('cancel'),
          style: 'cancel',
        },
        {
          text: t('organization_continue'),
          style: 'default',
          onPress: async () => {
            setSwitchingOrg(true);
            try {
              // Clear organization-specific cache
              await clearOrganizationCaches();

              // Clear user session data but keep device token and language
              await StorageUtils.clearUserData();

              // Clear organization URL to force re-selection
              await StorageUtils.removeItem('organizationUrl');
              await StorageUtils.removeItem('organizationHostname');
              await StorageUtils.removeItem('dynamicApiBaseUrl');
              await StorageUtils.removeItem(CONFIG.STORAGE_KEYS.ORGANIZATION_ID);
              await StorageUtils.removeItem(CONFIG.STORAGE_KEYS.CURRENT_ORGANIZATION_ID);

              // Navigation will automatically switch to OrganizationSelectScreen
            } catch (error) {
              debugError('Switch organization error:', error);
              Alert.alert(
                t('Error'),
                t('organization_switch_error'),
                [{ text: t('OK') }]
              );
            } finally {
              setSwitchingOrg(false);
            }
          },
        },
      ]
    );
  };

  /**
   * Clear organization-specific caches
   * Called when switching organizations
   */
  const clearOrganizationCaches = async () => {
    try {
      // Clear all organization-specific cached data
      // This ensures fresh data when user switches to a new org
      await CacheManager.clearAllCaches();

      if (CONFIG.FEATURES.DEBUG_LOGGING) {
        debugLog('[SettingsScreen] Cleared organization caches');
      }
    } catch (error) {
      debugError('Error clearing organization caches:', error);
    }
  };

  const handleLogout = async () => {
    Alert.alert(
      t('Confirm Logout'),
      t('Are you sure you want to logout?'),
      [
        {
          text: t('cancel'),
          style: 'cancel',
        },
        {
          text: t('logout'),
          style: 'destructive',
          onPress: async () => {
            try {
              // Call logout API
              await logout();
            } catch (error) {
              debugError('Logout error:', error);
            } finally {
              // Clear local storage regardless of API result
              await StorageUtils.clearUserData();
              // Navigation will automatically switch to auth flow
            }
          },
        },
      ]
    );
  };

  return (
    <ScrollView style={styles.container}>
      {/* User Profile Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('profile')}</Text>
        <Card>
          <Text style={styles.profileName}>{userName}</Text>
          <Text style={styles.profileRole}>{userRole}</Text>
        </Card>
      </View>

      {/* Organization Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('organization_current')}</Text>
        <Card>
          <View style={styles.settingRow}>
            <View style={styles.orgInfo}>
              <Text style={styles.settingLabel}>{t('Organization')}</Text>
              <Text style={styles.orgUrl}>{organizationUrl}</Text>
            </View>
          </View>
          <View style={styles.separator} />
          <TouchableOpacity
            style={styles.settingRow}
            onPress={handleSwitchOrganization}
            disabled={switchingOrg}
          >
            <Text style={[styles.settingLabel, styles.switchOrgText]}>
              {switchingOrg ? t('organization_switching') : t('organization_switch_organization')}
            </Text>
            {!switchingOrg && <Text style={styles.chevron}>›</Text>}
          </TouchableOpacity>
        </Card>
        <Text style={styles.settingHelp}>
          {t('Switching organizations will log you out and require you to log in again')}
        </Text>
      </View>

      {/* Language Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('language')}</Text>
        <Card>
          <TouchableOpacity
            style={styles.settingRow}
            onPress={() => handleLanguageChange('en')}
          >
            <Text style={styles.settingLabel}>English</Text>
            {currentLanguage === 'en' && <Text style={styles.checkmark}>✓</Text>}
          </TouchableOpacity>
          <View style={styles.separator} />
          <TouchableOpacity
            style={styles.settingRow}
            onPress={() => handleLanguageChange('fr')}
          >
            <Text style={styles.settingLabel}>Français</Text>
            {currentLanguage === 'fr' && <Text style={styles.checkmark}>✓</Text>}
          </TouchableOpacity>
        </Card>
      </View>

      {/* Notifications Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('Notifications')}</Text>
        <Card>
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>{t('Push Notifications')}</Text>
            <Switch
              value={pushEnabled}
              onValueChange={setPushEnabled}
              trackColor={{ false: '#E5E5EA', true: '#34C759' }}
            />
          </View>
        </Card>
        <Text style={styles.settingHelp}>
          {t('Receive notifications about activities')}
        </Text>
      </View>

      {/* App Info Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('App Info')}</Text>
        <Card>
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>{t('Version')}</Text>
            <Text style={styles.settingValue}>{CONFIG.APP.VERSION}</Text>
          </View>
          <View style={styles.separator} />
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>{t('Build')}</Text>
            <Text style={styles.settingValue}>{CONFIG.APP.BUILD_NUMBER}</Text>
          </View>
        </Card>
      </View>

      {/* Account Actions */}
      <View style={styles.section}>
        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
          <Text style={styles.logoutButtonText}>{t('logout')}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          {t('Made with')} ❤️ {t('for Scouts')}
        </Text>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    ...commonStyles.container,
  },
  section: {
    ...commonStyles.section,
  },
  sectionTitle: {
    ...commonStyles.sectionTitle,
  },
  profileName: {
    fontSize: theme.fontSize.xl,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.text,
    marginBottom: theme.spacing.xs,
  },
  profileRole: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textLight,
    textTransform: 'capitalize',
  },
  settingRow: {
    ...commonStyles.row,
  },
  settingLabel: {
    fontSize: theme.fontSize.base,
    color: theme.colors.text,
  },
  settingValue: {
    fontSize: theme.fontSize.base,
    color: theme.colors.textMuted,
  },
  checkmark: {
    fontSize: theme.fontSize.xl,
    color: theme.colors.primary,
    fontWeight: theme.fontWeight.bold,
  },
  separator: {
    ...commonStyles.separator,
  },
  settingHelp: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
    marginTop: theme.spacing.sm,
    marginHorizontal: theme.spacing.md,
  },
  logoutButton: {
    backgroundColor: theme.colors.error,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.md,
    alignItems: 'center',
    minHeight: theme.touchTarget.min,
    justifyContent: 'center',
  },
  logoutButtonText: {
    color: theme.colors.surface,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
  },
  footer: {
    padding: theme.spacing.xl,
    alignItems: 'center',
  },
  footerText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
  },
  orgInfo: {
    flex: 1,
  },
  orgUrl: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
    marginTop: theme.spacing.xs,
  },
  switchOrgText: {
    color: theme.colors.primary,
  },
  chevron: {
    fontSize: theme.fontSize.xl,
    color: theme.colors.textMuted,
    fontWeight: theme.fontWeight.normal,
  },
});

export default SettingsScreen;
