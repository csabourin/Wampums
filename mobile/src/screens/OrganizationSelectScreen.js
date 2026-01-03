/**
 * Organization Select Screen
 *
 * Pre-login screen where users enter their organization URL
 * to resolve organization_id before authentication.
 *
 * Flow:
 * 1. User enters organization URL (e.g., https://troupe123.wampums.ca)
 * 2. App validates and normalizes URL to hostname
 * 3. App calls /public/get_organization_id with hostname
 * 4. organizationId and organizationUrl are stored
 * 5. API base URL is updated to use organization URL
 * 6. User proceeds to LoginScreen
 */

import React, { useEffect } from 'react';
import { useSafeState } from '../hooks/useSafeState';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import StorageUtils from '../utils/StorageUtils';
import SecurityUtils from '../utils/SecurityUtils';
import { translate as t, initI18n, changeLanguage, getCurrentLanguage } from '../i18n';
import CONFIG from '../config';
import theme, { commonStyles } from '../theme';
import { getOrganizationId } from '../api/api-endpoints';
import { debugError, debugLog } from '../utils/DebugUtils.js';

const OrganizationSelectScreen = ({ navigation, onOrganizationSelected }) => {
  const [organizationUrl, setOrganizationUrl] = useSafeState('');
  const [loading, setLoading] = useSafeState(false);
  const [error, setError] = useSafeState('');
  const [hasStoredOrg, setHasStoredOrg] = useSafeState(false);
  const [translationsReady, setTranslationsReady] = useSafeState(false);
  const [selectedLanguage, setSelectedLanguage] = useSafeState(CONFIG.LOCALE.DEFAULT_LANGUAGE);

  useEffect(() => {
    // Initialize i18n and check for stored organization
    initializeScreen();
  }, []);

  const initializeScreen = async () => {
    try {
      // Initialize i18n system first
      const lang = await initI18n();
      setSelectedLanguage(lang);
      setTranslationsReady(true);
      debugLog('i18n initialized with language:', lang);

      // Then check if we already have a stored organization
      await checkStoredOrganization();
    } catch (error) {
      debugError('Error initializing OrganizationSelectScreen:', error);
      setTranslationsReady(true); // Still show UI even if initialization fails
    }
  };

  const checkStoredOrganization = async () => {
    const storedOrgId = await StorageUtils.getItem(CONFIG.STORAGE_KEYS.ORGANIZATION_ID);
    const storedOrgUrl = await StorageUtils.getItem('organizationUrl');

    if (storedOrgId && storedOrgUrl) {
      setHasStoredOrg(true);
      setOrganizationUrl(storedOrgUrl);
    }
  };

  /**
   * Validate and normalize organization URL
   * Extracts hostname and validates format
   */
  const validateOrganizationUrl = (url) => {
    if (!url || url.trim() === '') {
      return { isValid: false, error: t('organization_url_required') };
    }

    // Sanitize input
    const sanitized = SecurityUtils.sanitizeUrl(url.trim());

    if (!sanitized) {
      return { isValid: false, error: t('organization_invalid_url') };
    }

    try {
      // Ensure URL has protocol
      let fullUrl = sanitized;
      if (!sanitized.startsWith('http://') && !sanitized.startsWith('https://')) {
        fullUrl = `https://${sanitized}`;
      }

      const urlObj = new URL(fullUrl);
      const hostname = urlObj.hostname;

      // Basic domain validation
      if (!hostname.includes('.')) {
        return { isValid: false, error: t('organization_invalid_domain') };
      }

      return {
        isValid: true,
        fullUrl: fullUrl,
        hostname: hostname,
      };
    } catch (err) {
      return { isValid: false, error: t('organization_invalid_url_format') };
    }
  };

  /**
   * Handle organization URL submission
   * Resolves organization_id from URL and stores for later use
   */
  const handleSubmit = async () => {
    setError('');
    setLoading(true);

    try {
      // Validate and normalize URL
      const validation = validateOrganizationUrl(organizationUrl);

      if (!validation.isValid) {
        setError(validation.error);
        setLoading(false);
        return;
      }

      const { fullUrl, hostname } = validation;

      // Call API to resolve organization ID using hostname
      // Pass fullUrl to query the organization's own server
      const response = await getOrganizationId(hostname, fullUrl);

      if (response.success && response.data?.organization_id) {
        const orgId = response.data.organization_id;

        // Store organization information
        await StorageUtils.setStorageMultiple({
          [CONFIG.STORAGE_KEYS.ORGANIZATION_ID]: orgId,
          [CONFIG.STORAGE_KEYS.CURRENT_ORGANIZATION_ID]: orgId,
          organizationUrl: fullUrl,
          organizationHostname: hostname,
        });

        // Update dynamic API base URL
        // This will be used by api-core.js for subsequent requests
        await StorageUtils.setItem('dynamicApiBaseUrl', fullUrl);

        // Notify parent component
        if (onOrganizationSelected) {
          await onOrganizationSelected(orgId, fullUrl);
        }

        // Navigate to login
        navigation.replace('Login');
      } else {
        setError(response.message || t('organization_not_found'));
      }
    } catch (err) {
      debugError('Organization selection error:', err);
      setError(err.message || t('organization_resolution_failed'));
    } finally {
      setLoading(false);
    }
  };

  /**
   * Allow user to switch to a different organization
   */
  const handleSwitchOrganization = async () => {
    setHasStoredOrg(false);
    setOrganizationUrl('');
    setError('');
  };

  /**
   * Handle language change
   */
  const handleLanguageChange = async (lang) => {
    try {
      debugLog('Changing language to:', lang);
      const success = await changeLanguage(lang);
      if (success) {
        setSelectedLanguage(lang);
        // Force re-render by toggling translationsReady
        setTranslationsReady(false);
        setTimeout(() => setTranslationsReady(true), 10);
      }
    } catch (error) {
      debugError('Error changing language:', error);
    }
  };

  /**
   * Use stored organization and proceed to login
   */
  const handleUseStoredOrganization = async () => {
    const storedOrgId = await StorageUtils.getItem(CONFIG.STORAGE_KEYS.ORGANIZATION_ID);
    const storedOrgUrl = await StorageUtils.getItem('organizationUrl');

    if (storedOrgId && storedOrgUrl) {
      // Update dynamic API base URL
      await StorageUtils.setItem('dynamicApiBaseUrl', storedOrgUrl);

      if (onOrganizationSelected) {
        await onOrganizationSelected(storedOrgId, storedOrgUrl);
      }

      navigation.replace('Login');
    }
  };

  // Show loading state while translations are loading
  if (!translationsReady) {
    return (
      <View style={[styles.container, styles.centerContent]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.scrollContainer}>
        <View style={styles.form}>
          {/* Language Selector */}
          <View style={styles.languageSelector}>
            <Text style={styles.languageLabel}>
              {selectedLanguage === 'en' ? 'Language / Langue' : 'Langue / Language'}
            </Text>
            <View style={styles.pickerContainer}>
              <Picker
                selectedValue={selectedLanguage}
                onValueChange={handleLanguageChange}
                style={styles.picker}
              >
                <Picker.Item label="English" value="en" />
                <Picker.Item label="Français" value="fr" />
              </Picker>
            </View>
          </View>

          <Text style={styles.title}>{t('organization_select_title')}</Text>
          <Text style={styles.subtitle}>{t('organization_select_subtitle')}</Text>

          {error ? (
            <View style={[commonStyles.alert, commonStyles.alertError]}>
              <Text style={[commonStyles.alertText, commonStyles.alertTextError]}>
                {error}
              </Text>
            </View>
          ) : null}

          {hasStoredOrg ? (
            // Stored organization found - offer to use it or switch
            <View style={styles.storedOrgContainer}>
              <View style={[commonStyles.alert, commonStyles.alertInfo]}>
                <Text style={[commonStyles.alertText, commonStyles.alertTextInfo]}>
                  {t('organization_stored_found')}
                </Text>
                <Text style={[commonStyles.alertText, commonStyles.alertTextInfo, styles.storedUrl]}>
                  {organizationUrl}
                </Text>
              </View>

              <TouchableOpacity
                style={styles.button}
                onPress={handleUseStoredOrganization}
              >
                <Text style={styles.buttonText}>{t('organization_use_stored')}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.button, styles.buttonSecondary]}
                onPress={handleSwitchOrganization}
              >
                <Text style={[styles.buttonText, styles.buttonTextSecondary]}>
                  {t('organization_switch_organization')}
                </Text>
              </TouchableOpacity>
            </View>
          ) : (
            // No stored organization - prompt for URL
            <>
              <View style={styles.inputContainer}>
                <Text style={styles.label}>{t('organization_url_label')}</Text>
                <TextInput
                  style={styles.input}
                  placeholder={t('organization_url_placeholder')}
                  value={organizationUrl}
                  onChangeText={setOrganizationUrl}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  textContentType="URL"
                  autoFocus
                />
                <Text style={styles.helpText}>{t('organization_url_help')}</Text>
              </View>

              <TouchableOpacity
                style={[styles.button, loading && styles.buttonDisabled]}
                onPress={handleSubmit}
                disabled={loading || !organizationUrl}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.buttonText}>{t('organization_continue')}</Text>
                )}
              </TouchableOpacity>
            </>
          )}

          {/* Example text */}
          <View style={styles.exampleContainer}>
            <Text style={styles.exampleTitle}>{t('organization_examples_title')}</Text>
            <Text style={styles.exampleText}>• https://troupe123.wampums.ca</Text>
            <Text style={styles.exampleText}>• https://mygroup.example.com</Text>
            <Text style={styles.exampleText}>• troupe456.wampums.ca</Text>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  scrollContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: theme.spacing.md,
  },
  form: {
    padding: theme.spacing.lg,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.lg,
    ...theme.shadows.md,
  },
  centerContent: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  languageSelector: {
    marginBottom: theme.spacing.lg,
    paddingBottom: theme.spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.borderLight,
  },
  languageLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.text,
    marginBottom: theme.spacing.xs,
  },
  pickerContainer: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.background,
    overflow: 'hidden',
  },
  picker: {
    height: 50,
    width: '100%',
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
    lineHeight: theme.fontSize.sm * theme.lineHeight.relaxed,
  },
  inputContainer: {
    marginBottom: theme.spacing.lg,
  },
  label: {
    ...commonStyles.inputLabel,
  },
  input: {
    ...commonStyles.input,
    marginBottom: theme.spacing.xs,
  },
  helpText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textMuted,
    lineHeight: theme.fontSize.xs * theme.lineHeight.normal,
  },
  button: {
    ...commonStyles.button,
    marginBottom: theme.spacing.md,
  },
  buttonSecondary: {
    ...commonStyles.buttonSecondary,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    ...commonStyles.buttonText,
  },
  buttonTextSecondary: {
    ...commonStyles.buttonSecondaryText,
  },
  storedOrgContainer: {
    marginBottom: theme.spacing.md,
  },
  storedUrl: {
    fontWeight: theme.fontWeight.semibold,
    marginTop: theme.spacing.xs,
  },
  exampleContainer: {
    marginTop: theme.spacing.lg,
    paddingTop: theme.spacing.lg,
    borderTopWidth: 1,
    borderTopColor: theme.colors.borderLight,
  },
  exampleTitle: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.textLight,
    marginBottom: theme.spacing.sm,
  },
  exampleText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
    marginBottom: theme.spacing.xs,
  },
});

export default OrganizationSelectScreen;