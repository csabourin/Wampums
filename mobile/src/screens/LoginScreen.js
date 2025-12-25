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

const LoginScreen = ({ navigation, onLogin }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [trustDevice, setTrustDevice] = useState(false);
  const [organizationId, setOrganizationId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [requires2FA, setRequires2FA] = useState(false);

  useEffect(() => {
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
        setError(response.message || t('auth.loginFailed'));
      }
    } catch (err) {
      setError(err.message || t('auth.loginFailed'));
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
        setError(response.message || t('auth.invalidCode'));
      }
    } catch (err) {
      setError(err.message || t('auth.verificationFailed'));
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
    return (
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.form}>
          <Text style={styles.title}>{t('auth.twoFactorTitle')}</Text>
          <Text style={styles.subtitle}>{t('auth.enterCode')}</Text>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <TextInput
            style={styles.input}
            placeholder={t('auth.verificationCode')}
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
            <Text style={styles.checkboxLabel}>{t('auth.trustDevice')}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handle2FAVerification}
            disabled={loading || !twoFactorCode}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>{t('auth.verify')}</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity onPress={() => setRequires2FA(false)}>
            <Text style={styles.link}>{t('auth.backToLogin')}</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.form}>
        <Text style={styles.title}>{t('auth.loginTitle')}</Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TextInput
          style={styles.input}
          placeholder={t('auth.email')}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
        />

        <TextInput
          style={styles.input}
          placeholder={t('auth.password')}
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
            <Text style={styles.buttonText}>{t('auth.login')}</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity onPress={() => navigation.navigate('Register')}>
          <Text style={styles.link}>{t('auth.createAccount')}</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => navigation.navigate('ResetPassword')}>
          <Text style={styles.link}>{t('auth.forgotPassword')}</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    justifyContent: 'center',
  },
  form: {
    padding: 20,
    backgroundColor: '#fff',
    margin: 20,
    borderRadius: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    marginBottom: 20,
    textAlign: 'center',
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    fontSize: 16,
    minHeight: CONFIG.UI.TOUCH_TARGET_SIZE,
  },
  button: {
    backgroundColor: '#007AFF',
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
    marginBottom: 12,
    minHeight: CONFIG.UI.TOUCH_TARGET_SIZE,
    justifyContent: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  link: {
    color: '#007AFF',
    textAlign: 'center',
    marginTop: 12,
    fontSize: 14,
  },
  error: {
    color: '#FF3B30',
    marginBottom: 16,
    textAlign: 'center',
  },
  checkbox: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  checkboxBox: {
    width: 24,
    height: 24,
    borderWidth: 2,
    borderColor: '#007AFF',
    borderRadius: 4,
    marginRight: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: '#007AFF',
  },
  checkboxCheck: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  checkboxLabel: {
    fontSize: 14,
  },
});

export default LoginScreen;
