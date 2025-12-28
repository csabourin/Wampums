/**
 * AccountInfoScreen
 *
 * Mirrors spa/modules/account-info.js functionality.
 * Allows users to view and edit their account settings.
 * Includes profile information, password change, and guardian info for parents.
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { translate as t } from '../i18n';
import {
  FormField,
  Button,
  LoadingState,
  ErrorState,
  useToast,
} from '../components';
import { getUserProfile, updateUserProfile, changePassword } from '../api/api-endpoints';
import StorageUtils from '../utils/StorageUtils';
import SecurityUtils from '../utils/SecurityUtils';
import { hasPermission } from '../utils/PermissionUtils';
import theme from '../theme';
import CONFIG from '../config';
import { debugLog, debugError } from '../utils/DebugUtils';

const AccountInfoScreen = () => {
  const navigation = useNavigation();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [userData, setUserData] = useState(null);
  const [saving, setSaving] = useState(false);
  
  // Form states
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [languagePreference, setLanguagePreference] = useState('en');
  const [whatsappPhone, setWhatsappPhone] = useState('');
  
  // Password change states
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  
  const { showToast, ToastComponent } = useToast();

  useEffect(() => {
    navigation.setOptions({
      headerShown: true,
      title: t('account_settings') || 'Account Settings',
    });
  }, [navigation]);

  useEffect(() => {
    loadUserData();
  }, []);

  const loadUserData = async () => {
    try {
      setError(null);
      const response = await getUserProfile();
      
      if (response.success) {
        const data = response.data;
        setUserData(data);
        setFullName(data.full_name || '');
        setEmail(data.email || '');
        setLanguagePreference(data.language_preference || 'en');
        setWhatsappPhone(data.whatsapp_phone_number || '');
      } else {
        setError(response.message || t('error_loading_data'));
      }
    } catch (err) {
      debugError('Error loading user data:', err);
      setError(err.message || t('error_loading_data'));
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadUserData();
    setRefreshing(false);
  };

  const handleSaveProfile = async () => {
    // Validate inputs
    if (!fullName.trim()) {
      showToast(t('error_name_required') || 'Name is required', 'error');
      return;
    }

    if (!email.trim()) {
      showToast(t('error_email_required') || 'Email is required', 'error');
      return;
    }

    if (!SecurityUtils.isValidEmail(email)) {
      showToast(t('error_email_invalid') || 'Invalid email address', 'error');
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
        showToast(t('success_profile_updated') || 'Profile updated successfully', 'success');
        await loadUserData(); // Reload to get fresh data
      } else {
        showToast(response.message || t('error_save_failed'), 'error');
      }
    } catch (err) {
      debugError('Error saving profile:', err);
      showToast(err.message || t('error_save_failed'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    // Validate password inputs
    if (!currentPassword) {
      showToast(t('error_current_password_required') || 'Current password is required', 'error');
      return;
    }

    if (!newPassword) {
      showToast(t('error_new_password_required') || 'New password is required', 'error');
      return;
    }

    if (newPassword.length < 8) {
      showToast(t('error_password_too_short') || 'Password must be at least 8 characters', 'error');
      return;
    }

    if (newPassword !== confirmPassword) {
      showToast(t('error_passwords_dont_match') || 'Passwords do not match', 'error');
      return;
    }

    try {
      setSaving(true);
      const response = await changePassword({
        currentPassword,
        newPassword,
      });

      if (response.success) {
        showToast(t('success_password_changed') || 'Password changed successfully', 'success');
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      } else {
        showToast(response.message || t('error_password_change_failed'), 'error');
      }
    } catch (err) {
      debugError('Error changing password:', err);
      showToast(err.message || t('error_password_change_failed'), 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <LoadingState message={t('loading_profile') || 'Loading profile...'} />;
  }

  if (error) {
    return <ErrorState message={error} onRetry={loadUserData} />;
  }

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Profile Section */}
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
          />

          <FormField
            label={t('language_preference') || 'Language Preference'}
            value={languagePreference}
            onChangeText={setLanguagePreference}
            type="select"
            options={[
              { value: 'en', label: t('english') || 'English' },
              { value: 'fr', label: t('french') || 'French' },
            ]}
          />

          <FormField
            label={t('whatsapp_phone') || 'WhatsApp Phone Number'}
            value={whatsappPhone}
            onChangeText={setWhatsappPhone}
            placeholder={t('enter_whatsapp_phone') || 'Enter WhatsApp number'}
            keyboardType="phone-pad"
          />

          <Button
            title={t('save_profile') || 'Save Profile'}
            onPress={handleSaveProfile}
            loading={saving}
            style={styles.button}
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
            style={styles.button}
          />
        </View>

        {/* Account Info */}
        {userData && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('account_information') || 'Account Information'}</Text>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>{t('user_id') || 'User ID'}:</Text>
              <Text style={styles.infoValue}>{userData.id}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>{t('role') || 'Role'}:</Text>
              <Text style={styles.infoValue}>{userData.role || '-'}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>{t('organization') || 'Organization'}:</Text>
              <Text style={styles.infoValue}>{userData.organization_name || '-'}</Text>
            </View>
          </View>
        )}
      </ScrollView>

      <ToastComponent />
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
  scrollContent: {
    padding: theme.spacing.md,
  },
  section: {
    backgroundColor: theme.colors.background.secondary,
    padding: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
    marginBottom: theme.spacing.md,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: theme.colors.text.primary,
    marginBottom: theme.spacing.md,
  },
  button: {
    marginTop: theme.spacing.md,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border.light,
  },
  infoLabel: {
    fontSize: 14,
    color: theme.colors.text.secondary,
    fontWeight: '500',
  },
  infoValue: {
    fontSize: 14,
    color: theme.colors.text.primary,
  },
});

export default AccountInfoScreen;
