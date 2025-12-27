/**
 * Login Screen
 *
 * Mirrors spa/login.js functionality
 * Handles:
 * - Username/password authentication
 * - 2FA verification
 * - Device trust
 * - Organization selection
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { login, verify2FA, getOrganizationId } from '../api/api-endpoints';
import StorageUtils from '../utils/StorageUtils';
import { translate as t } from '../i18n';
import CONFIG from '../config';
import theme, { commonStyles } from '../theme';
import { debugLog, debugError } from '../utils/DebugUtils.js';

const LoginScreen = ({ navigation, onLogin }) => {
  debugLog('🟠 [LoginScreen] Component initializing');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [trustDevice, setTrustDevice] = useState(false);
  const [organizationId, setOrganizationId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [requires2FA, setRequires2FA] = useState(false);

  useEffect(() => {
    debugLog('🟠 [LoginScreen] useEffect - loading organization ID');
    // Load organization ID or prompt user
    loadOrganizationId();
  }, []);

  const loadOrganizationId = async () => {
    // Try to get stored organization ID
    const storedOrgId = await StorageUtils.getItem(CONFIG.STORAGE_KEYS.ORGANIZATION_ID);
    if (storedOrgId) {
      setOrganizationId(storedOrgId);
    }
    // In a real app, you might want to fetch this based on a domain or let user select
  };

  const handleLogin = async () => {
    setError('');
    setLoading(true);

    try {
      const response = await login(email, password, organizationId);

      if (response.success) {
        // Check for 2FA requirement (backend uses snake_case)
        if (response.requires_2fa || response.data?.requires_2fa) {
          setRequires2FA(true);
        } else {
          // Login successful, store session data
          // Response is at top level, not nested in data
          await storeSessionData(response);

          // Notify parent that login succeeded
          if (onLogin) {
            await onLogin();
          }
        }
      } else {
        setError(response.message || t('invalid_email_or_password'));
      }
    } catch (err) {
      setError(err.message || t('invalid_email_or_password'));
    } finally {
      setLoading(false);
    }
  };

  const handle2FAVerification = async () => {
    setError('');
    setLoading(true);

    try {
      const response = await verify2FA(email, twoFactorCode, trustDevice);

      if (response.success) {
        // 2FA successful, store session data (response at top level)
        await storeSessionData(response);

        // Store device token if trust device was selected (backend uses snake_case)
        if (trustDevice && (response.device_token || response.deviceToken)) {
          await StorageUtils.setItem(
            CONFIG.STORAGE_KEYS.DEVICE_TOKEN,
            response.device_token || response.deviceToken
          );
        }

        // Notify parent that login succeeded
        if (onLogin) {
          await onLogin();
        }
      } else {
        setError(response.message || t('Invalid verification code'));
      }
    } catch (err) {
      setError(err.message || t('Verification failed'));
    } finally {
      setLoading(false);
    }
  };

  const storeSessionData = async (data) => {
    // Store session data similar to spa/login.js
    // Backend returns snake_case (user_id, user_role, etc.)
    await StorageUtils.setStorageMultiple({
      [CONFIG.STORAGE_KEYS.JWT_TOKEN]: data.token,
      [CONFIG.STORAGE_KEYS.USER_ID]: data.user_id || data.userId,
      [CONFIG.STORAGE_KEYS.USER_ROLE]: data.user_role || data.userRole,
      [CONFIG.STORAGE_KEYS.USER_ROLES]: data.user_roles || data.userRoles,
      [CONFIG.STORAGE_KEYS.USER_PERMISSIONS]: data.user_permissions || data.userPermissions,
      [CONFIG.STORAGE_KEYS.USER_FULL_NAME]: data.user_full_name || data.userFullName,
      [CONFIG.STORAGE_KEYS.ORGANIZATION_ID]: data.organization_id || organizationId,
      [CONFIG.STORAGE_KEYS.CURRENT_ORGANIZATION_ID]: data.organization_id || organizationId,
    });

    // Backend uses snake_case
    if (data.guardian_participants || data.guardianParticipants) {
      await StorageUtils.setItem(
        CONFIG.STORAGE_KEYS.GUARDIAN_PARTICIPANTS,
        data.guardian_participants || data.guardianParticipants
      );
    }
  };

  if (requires2FA) {
    debugLog('🟠 [LoginScreen] Rendering 2FA view');
    return (
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.form}>
          <Text style={styles.title}>{t('two_factor_email_heading')}</Text>
          <Text style={styles.subtitle}>{t('two_factor_message')}</Text>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <TextInput
            style={styles.input}
            placeholder={t('verification_code_sent')}
            value={twoFactorCode}
            onChangeText={setTwoFactorCode}
            keyboardType="number-pad"
            maxLength={6}
            autoFocus
          />

          <TouchableOpacity
            style={styles.checkbox}
            onPress={() => setTrustDevice(!trustDevice)}
          >
            <View style={[styles.checkboxBox, trustDevice && styles.checkboxChecked]}>
              {trustDevice && <Text style={styles.checkboxCheck}>✓</Text>}
            </View>
            <Text style={styles.checkboxLabel}>{t('Trust this device')}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handle2FAVerification}
            disabled={loading || !twoFactorCode}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>{t('verify')}</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity onPress={() => setRequires2FA(false)}>
            <Text style={styles.link}>{t('back_to_login')}</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    );
  }

  debugLog('🟠 [LoginScreen] Rendering main login view');
  debugLog('🟠 [LoginScreen] About to render KeyboardAvoidingView');

  try {
    return (
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.form}>
          <Text style={styles.title}>{t('login')}</Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TextInput
          style={styles.input}
          placeholder={t('email')}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
        />

        <TextInput
          style={styles.input}
          placeholder={t('password')}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
        />

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleLogin}
          disabled={loading || !email || !password}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>{t('login')}</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity onPress={() => navigation.navigate('Register')}>
          <Text style={styles.link}>{t('create_account')}</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => navigation.navigate('ResetPassword')}>
          <Text style={styles.link}>{t('forgot_password')}</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
    );
  } catch (error) {
    debugError('🔴 [LoginScreen] Error during render:', error);
    debugError('🔴 [LoginScreen] Error stack:', error.stack);
    throw error;
  }
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
    justifyContent: 'center',
  },
  form: {
    padding: theme.spacing.lg,
    backgroundColor: theme.colors.surface,
    margin: theme.spacing.lg,
    borderRadius: theme.borderRadius.lg,
    ...theme.shadows.md,
  },
  title: {
    ...commonStyles.heading2,
    marginBottom: theme.spacing.sm,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textLight,
    marginBottom: theme.spacing.lg,
    textAlign: 'center',
  },
  input: {
    ...commonStyles.input,
    marginBottom: theme.spacing.md,
  },
  button: {
    ...commonStyles.button,
    marginBottom: theme.spacing.md,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    ...commonStyles.buttonText,
  },
  link: {
    color: theme.colors.primary,
    textAlign: 'center',
    marginTop: theme.spacing.md,
    fontSize: theme.fontSize.sm,
  },
  error: {
    color: theme.colors.error,
    marginBottom: theme.spacing.md,
    textAlign: 'center',
  },
  checkbox: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: theme.spacing.md,
  },
  checkboxBox: {
    width: 24,
    height: 24,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    borderRadius: theme.borderRadius.sm,
    marginRight: theme.spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: theme.colors.primary,
  },
  checkboxCheck: {
    color: theme.colors.surface,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.bold,
  },
  checkboxLabel: {
    fontSize: theme.fontSize.sm,
  },
});

export default LoginScreen;
