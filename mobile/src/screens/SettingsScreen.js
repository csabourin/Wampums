/**
 * Settings Screen
 *
 * App settings including:
 * - User profile (name, email, password)
 * - Language selection
 * - WhatsApp notifications
 * - Organization switching
 * - App preferences
 * - Logout
 */

import React, { useEffect } from 'react';
import { useSafeState } from '../hooks/useSafeState';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Switch,
  RefreshControl,
} from 'react-native';
import StorageUtils from '../utils/StorageUtils';
import SecurityUtils from '../utils/SecurityUtils';
import { translate as t, changeLanguage, getCurrentLanguage } from '../i18n';
import {
  logout,
  switchOrganization,
  getUserProfile,
  updateUserProfile,
  changePassword
} from '../api/api-endpoints';
import CacheManager from '../utils/CacheManager';
import CONFIG from '../config';
import {
  Card,
  FormField,
  Button,
  Toast,
  useToast,
} from '../components';
import theme, { commonStyles } from '../theme';
import { debugLog, debugError } from '../utils/DebugUtils.js';

const SettingsScreen = ({ navigation, route }) => {
  const [loading, setLoading] = useSafeState(true);
  const [refreshing, setRefreshing] = useSafeState(false);
  const [saving, setSaving] = useSafeState(false);

  // Get onLogout callback from route params or navigation
  const onLogout = route?.params?.onLogout;

  // User data
  const [userData, setUserData] = useSafeState(null);
  const [userRole, setUserRole] = useSafeState('');
  const [organizationUrl, setOrganizationUrl] = useSafeState('');
  const [currentLanguage, setCurrentLanguage] = useSafeState('fr');
  const [pushEnabled, setPushEnabled] = useSafeState(false);
  const [switchingOrg, setSwitchingOrg] = useSafeState(false);

  // Editable profile fields
  const [fullName, setFullName] = useSafeState('');
  const [email, setEmail] = useSafeState('');
  const [languagePreference, setLanguagePreference] = useSafeState('');
  const [whatsappPhone, setWhatsappPhone] = useSafeState('');

  // Password fields
  const [currentPassword, setCurrentPassword] = useSafeState('');
  const [newPassword, setNewPassword] = useSafeState('');
  const [confirmPassword, setConfirmPassword] = useSafeState('');

  const toast = useToast();

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      setLoading(true);

      // Load user profile from API
      const response = await getUserProfile();
      if (response.success) {
        const data = response.data;
        setUserData(data);
        setFullName(data.full_name || '');
        setEmail(data.email || '');
        setLanguagePreference(data.language_preference || '');
        setWhatsappPhone(data.whatsapp_phone_number || '');
        setUserRole(data.role || '');
      }

      // Load local storage data
      const role = await StorageUtils.getItem(CONFIG.STORAGE_KEYS.USER_ROLE);
      const orgUrl = await StorageUtils.getItem('organizationUrl');

      setUserRole(role || '');
      setOrganizationUrl(orgUrl || t('organization_not_set'));
      setCurrentLanguage(getCurrentLanguage());

      // TODO: Load push notification preference when implemented
    } catch (error) {
      debugError('Error loading settings:', error);
      toast.show(t('error_loading_data') || 'Error loading settings', 'error');
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadSettings();
    setRefreshing(false);
  };

  const handleSaveProfile = async () => {
    // Validate inputs
    if (!fullName.trim()) {
      toast.show(t('error_name_required') || 'Name is required', 'error');
      return;
    }

    if (!email.trim()) {
      toast.show(t('error_email_required') || 'Email is required', 'error');
      return;
    }

    if (!SecurityUtils.isValidEmail(email)) {
      toast.show(t('error_email_invalid') || 'Invalid email address', 'error');
      return;
    }

    try {
      setSaving(true);
      const response = await updateUserProfile({
        fullName: SecurityUtils.sanitizeInput(fullName.trim()),
        email: SecurityUtils.sanitizeInput(email.trim()),
        languagePreference,
        whatsappPhoneNumber: SecurityUtils.sanitizeInput(whatsappPhone.trim()),
      });

      if (response.success) {
        toast.show(t('success_profile_updated') || 'Profile updated successfully', 'success');

        // Update local storage
        await StorageUtils.setItem(CONFIG.STORAGE_KEYS.USER_FULL_NAME, fullName);

        // If email changed, warn about logout
        if (email !== userData.email) {
          Alert.alert(
            t('email_changed'),
            t('email_changed_logout_warning') || 'Your email has been updated. You will be logged out for security.',
            [
              {
                text: t('OK'),
                onPress: handleLogout,
              },
            ]
          );
        } else {
          await loadSettings(); // Reload to get fresh data
        }
      } else {
        toast.show(response.message || t('error_save_failed'), 'error');
      }
    } catch (err) {
      debugError('Error saving profile:', err);
      toast.show(err.message || t('error_save_failed'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    // Validate password inputs
    if (!currentPassword) {
      toast.show(t('error_current_password_required') || 'Current password is required', 'error');
      return;
    }

    if (!newPassword) {
      toast.show(t('error_new_password_required') || 'New password is required', 'error');
      return;
    }

    if (newPassword.length < 8) {
      toast.show(t('error_password_too_short') || 'Password must be at least 8 characters', 'error');
      return;
    }

    if (newPassword !== confirmPassword) {
      toast.show(t('error_passwords_dont_match') || 'Passwords do not match', 'error');
      return;
    }

    try {
      setSaving(true);
      const response = await changePassword({
        currentPassword,
        newPassword,
      });

      if (response.success) {
        toast.show(t('success_password_changed') || 'Password changed successfully', 'success');
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      } else {
        toast.show(response.message || t('error_password_change_failed'), 'error');
      }
    } catch (err) {
      debugError('Error changing password:', err);
      toast.show(err.message || t('error_password_change_failed'), 'error');
    } finally {
      setSaving(false);
    }
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
      t('confirm_switch_organization'),
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

              // Trigger navigation to auth flow by calling parent's onLogout
              if (onLogout) {
                onLogout();
              }
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
      t('confirm_logout'),
      t('confirm_logout_message'),
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

              // Trigger navigation to auth flow by calling parent's onLogout
              if (onLogout) {
                onLogout();
              }
            }
          },
        },
      ]
    );
  };

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Profile Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('profile')}</Text>
          <Card>
            <Text style={styles.profileName}>{fullName || userData?.full_name}</Text>
            <Text style={styles.profileRole}>{userRole}</Text>
          </Card>
        </View>

        {/* Profile Information Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('profile_information') || 'Profile Information'}</Text>

          <FormField
            label={t('full_name') || 'Full Name'}
            value={fullName}
            onChangeText={setFullName}
            placeholder={t('enter_full_name') || 'Enter your full name'}
            required
          />

          <FormField
            label={t('email') || 'Email'}
            value={email}
            onChangeText={setEmail}
            placeholder={t('enter_email') || 'Enter your email'}
            keyboardType="email-address"
            autoCapitalize="none"
            required
            helpText={t('account_info_email_warning') || 'Changing your email will log you out'}
          />

          <FormField
            label={t('whatsapp_phone') || 'WhatsApp Phone Number'}
            value={whatsappPhone}
            onChangeText={setWhatsappPhone}
            placeholder={t('enter_whatsapp_phone') || 'Enter WhatsApp number'}
            keyboardType="phone-pad"
            helpText={t('account_info_whatsapp_help') || 'For receiving notifications via WhatsApp'}
          />

          <Button
            title={t('save_profile') || 'Save Profile'}
            onPress={handleSaveProfile}
            loading={saving}
            style={styles.saveButton}
          />
        </View>

        {/* Password Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('change_password') || 'Change Password'}</Text>

          <FormField
            label={t('current_password') || 'Current Password'}
            value={currentPassword}
            onChangeText={setCurrentPassword}
            placeholder={t('enter_current_password') || 'Enter current password'}
            secureTextEntry
            required
          />

          <FormField
            label={t('new_password') || 'New Password'}
            value={newPassword}
            onChangeText={setNewPassword}
            placeholder={t('enter_new_password') || 'Enter new password (min 8 characters)'}
            secureTextEntry
            required
          />

          <FormField
            label={t('confirm_password') || 'Confirm New Password'}
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            placeholder={t('confirm_new_password') || 'Confirm new password'}
            secureTextEntry
            required
          />

          <Button
            title={t('change_password') || 'Change Password'}
            onPress={handleChangePassword}
            loading={saving}
            variant="secondary"
            style={styles.saveButton}
          />
        </View>

        {/* Organization Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('organization_current')}</Text>
          <Card>
            <View style={styles.settingRow}>
              <View style={styles.orgInfo}>
                <Text style={styles.settingLabel}>{t('organization')}</Text>
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
            {t('switching_organizations_warning')}
          </Text>
        </View>

        {/* Language Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('language').toUpperCase()}</Text>
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
          <Text style={styles.sectionTitle}>{t('notifications').toUpperCase()}</Text>
          <Card>
            <View style={styles.settingRow}>
              <Text style={styles.settingLabel}>{t('push_notifications')}</Text>
              <Switch
                value={pushEnabled}
                onValueChange={setPushEnabled}
                trackColor={{ false: '#E5E5EA', true: '#34C759' }}
              />
            </View>
          </Card>
          <Text style={styles.settingHelp}>
            {t('receive_notifications_about_activities')}
          </Text>
        </View>

        {/* App Info Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('app_info').toUpperCase()}</Text>
          <Card>
            <View style={styles.settingRow}>
              <Text style={styles.settingLabel}>{t('version')}</Text>
              <Text style={styles.settingValue}>{CONFIG.APP.VERSION}</Text>
            </View>
            <View style={styles.separator} />
            <View style={styles.settingRow}>
              <Text style={styles.settingLabel}>{t('build')}</Text>
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
  container: {
    flex: 1,
    backgroundColor: theme.colors.background.primary,
  },
  scrollView: {
    flex: 1,
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
  saveButton: {
    marginTop: theme.spacing.md,
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