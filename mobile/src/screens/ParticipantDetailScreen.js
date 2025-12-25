/**
 * ParticipantDetailScreen
 *
 * View and edit participant information
 * Includes offline support and cache invalidation
 *
 * Features:
 * - View participant profile
 * - Edit participant (admin/leaders only)
 * - Input validation and sanitization
 * - Offline support with cache invalidation
 * - Photo upload (Phase 2 enhancement)
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';

// API and utilities
import { getParticipant, updateParticipant } from '../api/api-endpoints';
import { translate as t } from '../i18n';
import StorageUtils from '../utils/StorageUtils';
import SecurityUtils from '../utils/SecurityUtils';
import DateUtils from '../utils/DateUtils';
import CacheManager from '../utils/CacheManager';

// Components
import { Card, LoadingSpinner, ErrorMessage } from '../components';

/**
 * ParticipantDetailScreen Component
 */
const ParticipantDetailScreen = () => {
  const navigation = useNavigation();
  const route = useRoute();
  const { participantId } = route.params || {};

  // State
  const [participant, setParticipant] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);
  const [isOffline, setIsOffline] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    birthdate: '',
    address: '',
    city: '',
    province: '',
    postalCode: '',
  });

  // User permissions
  const [userRole, setUserRole] = useState(null);
  const [canEdit, setCanEdit] = useState(false);

  /**
   * Load user role and permissions
   */
  useEffect(() => {
    loadUserRole();

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
   * Load participant data
   */
  useEffect(() => {
    if (participantId) {
      loadParticipant();
    }
  }, [participantId]);

  /**
   * Load user role from storage
   */
  const loadUserRole = async () => {
    try {
      const role = await StorageUtils.getItem('userRole');
      setUserRole(role);

      // Admin and leaders can edit
      const canEditParticipant = role === 'admin' || role === 'leader';
      setCanEdit(canEditParticipant);
    } catch (error) {
      console.error('Error loading user role:', error);
    }
  };

  /**
   * Load participant data from API
   */
  const loadParticipant = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const response = await getParticipant(participantId);

      if (response.success && response.data) {
        setParticipant(response.data);
        initializeFormData(response.data);

        // Check if data is from cache (offline)
        if (response.fromCache) {
          setIsOffline(true);
        }
      } else {
        setError(response.message || t('common.error'));
      }
    } catch (err) {
      console.error('Error loading participant:', err);
      setError(t('participants.errorLoading'));
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Initialize form data from participant object
   */
  const initializeFormData = (data) => {
    setFormData({
      firstName: data.firstName || '',
      lastName: data.lastName || '',
      email: data.email || '',
      phone: data.phone || '',
      birthdate: data.birthdate || '',
      address: data.address || '',
      city: data.city || '',
      province: data.province || '',
      postalCode: data.postalCode || '',
    });
  };

  /**
   * Handle form field changes
   */
  const handleFieldChange = (field, value) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  /**
   * Validate form data
   */
  const validateForm = () => {
    const errors = [];

    // Required fields
    if (!formData.firstName.trim()) {
      errors.push(t('participants.errorFirstNameRequired'));
    }
    if (!formData.lastName.trim()) {
      errors.push(t('participants.errorLastNameRequired'));
    }

    // Email validation (if provided)
    if (formData.email && !SecurityUtils.isValidEmail(formData.email)) {
      errors.push(t('participants.errorInvalidEmail'));
    }

    // Birthdate validation (if provided)
    if (formData.birthdate && !DateUtils.isValidDate(formData.birthdate)) {
      errors.push(t('participants.errorInvalidBirthdate'));
    }

    return errors;
  };

  /**
   * Save participant changes
   */
  const handleSave = async () => {
    // Validate form
    const errors = validateForm();
    if (errors.length > 0) {
      Alert.alert(t('common.error'), errors.join('\n'));
      return;
    }

    try {
      setIsSaving(true);
      setError(null);

      // Sanitize all input data
      const sanitizedData = SecurityUtils.deepSanitize(formData);

      // Update participant via API
      const response = await updateParticipant(participantId, sanitizedData);

      if (response.success) {
        // CRITICAL: Invalidate participant caches (following CLAUDE.md)
        await CacheManager.clearParticipantRelatedCaches();

        // Update local state
        setParticipant({ ...participant, ...sanitizedData });
        setIsEditing(false);

        // Show success message
        if (response.queued) {
          Alert.alert(
            t('common.queued'),
            t('common.willSyncWhenOnline'),
            [{ text: t('common.ok') }]
          );
        } else {
          Alert.alert(
            t('common.success'),
            t('participants.savedSuccessfully'),
            [{ text: t('common.ok') }]
          );
        }
      } else {
        setError(response.message || t('participants.errorSaving'));
      }
    } catch (err) {
      console.error('Error saving participant:', err);
      setError(t('participants.errorSaving'));
    } finally {
      setIsSaving(false);
    }
  };

  /**
   * Cancel editing
   */
  const handleCancel = () => {
    // Reset form data to original participant data
    initializeFormData(participant);
    setIsEditing(false);
  };

  /**
   * Start editing
   */
  const handleEdit = () => {
    if (!canEdit) {
      Alert.alert(
        t('common.permissionDenied'),
        t('participants.noEditPermission')
      );
      return;
    }
    setIsEditing(true);
  };

  /**
   * Calculate age from birthdate
   */
  const getAge = () => {
    if (!participant?.birthdate) return null;
    return DateUtils.calculateAge(participant.birthdate);
  };

  /**
   * Render loading state
   */
  if (isLoading) {
    return (
      <View style={styles.centerContainer}>
        <LoadingSpinner />
        <Text style={styles.loadingText}>{t('common.loading')}</Text>
      </View>
    );
  }

  /**
   * Render error state
   */
  if (error && !participant) {
    return (
      <View style={styles.centerContainer}>
        <ErrorMessage message={error} />
        <TouchableOpacity style={styles.retryButton} onPress={loadParticipant}>
          <Text style={styles.retryButtonText}>{t('common.retry')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  /**
   * Render form field
   */
  const renderField = (label, field, options = {}) => {
    const {
      placeholder = '',
      keyboardType = 'default',
      multiline = false,
      editable = true,
    } = options;

    return (
      <View style={styles.fieldContainer}>
        <Text style={styles.fieldLabel}>{label}</Text>
        {isEditing && editable ? (
          <TextInput
            style={[styles.input, multiline && styles.multilineInput]}
            value={formData[field]}
            onChangeText={(value) => handleFieldChange(field, value)}
            placeholder={placeholder}
            keyboardType={keyboardType}
            multiline={multiline}
            editable={!isSaving}
          />
        ) : (
          <Text style={styles.fieldValue}>
            {formData[field] || t('common.notProvided')}
          </Text>
        )}
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView style={styles.scrollView}>
        {/* Offline indicator */}
        {isOffline && (
          <View style={styles.offlineIndicator}>
            <Text style={styles.offlineText}>
              {t('common.offline')} - {t('common.viewingCachedData')}
            </Text>
          </View>
        )}

        {/* Error message */}
        {error && <ErrorMessage message={error} />}

        {/* Header Card */}
        <Card style={styles.headerCard}>
          <View style={styles.headerContent}>
            <View style={styles.avatarPlaceholder}>
              <Text style={styles.avatarText}>
                {participant?.firstName?.[0] || '?'}
                {participant?.lastName?.[0] || ''}
              </Text>
            </View>
            <View style={styles.headerInfo}>
              <Text style={styles.nameText}>
                {participant?.firstName} {participant?.lastName}
              </Text>
              {getAge() && (
                <Text style={styles.ageText}>
                  {getAge()} {t('participants.yearsOld')}
                </Text>
              )}
            </View>
          </View>
        </Card>

        {/* Basic Information Card */}
        <Card style={styles.card}>
          <Text style={styles.sectionTitle}>
            {t('participants.basicInformation')}
          </Text>

          {renderField(t('participants.firstName'), 'firstName', {
            placeholder: t('participants.enterFirstName'),
          })}

          {renderField(t('participants.lastName'), 'lastName', {
            placeholder: t('participants.enterLastName'),
          })}

          {renderField(t('participants.birthdate'), 'birthdate', {
            placeholder: 'YYYY-MM-DD',
          })}

          {renderField(t('participants.email'), 'email', {
            placeholder: t('participants.enterEmail'),
            keyboardType: 'email-address',
          })}

          {renderField(t('participants.phone'), 'phone', {
            placeholder: t('participants.enterPhone'),
            keyboardType: 'phone-pad',
          })}
        </Card>

        {/* Address Card */}
        <Card style={styles.card}>
          <Text style={styles.sectionTitle}>{t('participants.address')}</Text>

          {renderField(t('participants.streetAddress'), 'address', {
            placeholder: t('participants.enterAddress'),
          })}

          {renderField(t('participants.city'), 'city', {
            placeholder: t('participants.enterCity'),
          })}

          {renderField(t('participants.province'), 'province', {
            placeholder: t('participants.enterProvince'),
          })}

          {renderField(t('participants.postalCode'), 'postalCode', {
            placeholder: t('participants.enterPostalCode'),
          })}
        </Card>

        {/* Placeholder cards for future features */}
        <Card style={styles.placeholderCard}>
          <Text style={styles.placeholderText}>
            {t('participants.healthInformation')} - {t('common.comingSoon')}
          </Text>
        </Card>

        <Card style={styles.placeholderCard}>
          <Text style={styles.placeholderText}>
            {t('participants.guardianContacts')} - {t('common.comingSoon')}
          </Text>
        </Card>

        <Card style={styles.placeholderCard}>
          <Text style={styles.placeholderText}>
            {t('participants.badgeProgress')} - {t('common.comingSoon')}
          </Text>
        </Card>

        <Card style={styles.placeholderCard}>
          <Text style={styles.placeholderText}>
            {t('participants.financialStatus')} - {t('common.comingSoon')}
          </Text>
        </Card>

        {/* Bottom spacing */}
        <View style={styles.bottomSpacing} />
      </ScrollView>

      {/* Action buttons */}
      <View style={styles.actionBar}>
        {isEditing ? (
          <>
            <TouchableOpacity
              style={[styles.button, styles.cancelButton]}
              onPress={handleCancel}
              disabled={isSaving}
            >
              <Text style={styles.buttonText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, styles.saveButton, isSaving && styles.disabledButton]}
              onPress={handleSave}
              disabled={isSaving}
            >
              {isSaving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={[styles.buttonText, styles.saveButtonText]}>
                  {t('common.save')}
                </Text>
              )}
            </TouchableOpacity>
          </>
        ) : (
          canEdit && (
            <TouchableOpacity
              style={[styles.button, styles.editButton]}
              onPress={handleEdit}
            >
              <Text style={[styles.buttonText, styles.editButtonText]}>
                {t('common.edit')}
              </Text>
            </TouchableOpacity>
          )
        )}
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  scrollView: {
    flex: 1,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: '#666',
  },
  retryButton: {
    marginTop: 20,
    paddingVertical: 12,
    paddingHorizontal: 30,
    backgroundColor: '#007AFF',
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  offlineIndicator: {
    backgroundColor: '#FFA500',
    padding: 12,
    alignItems: 'center',
  },
  offlineText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  headerCard: {
    margin: 15,
    padding: 20,
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarPlaceholder: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 15,
  },
  avatarText: {
    color: '#fff',
    fontSize: 32,
    fontWeight: 'bold',
  },
  headerInfo: {
    flex: 1,
  },
  nameText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 5,
  },
  ageText: {
    fontSize: 16,
    color: '#666',
  },
  card: {
    margin: 15,
    marginTop: 0,
    padding: 15,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginBottom: 15,
  },
  fieldContainer: {
    marginBottom: 15,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
    marginBottom: 5,
  },
  fieldValue: {
    fontSize: 16,
    color: '#333',
    paddingVertical: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    backgroundColor: '#fff',
  },
  multilineInput: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  placeholderCard: {
    margin: 15,
    marginTop: 0,
    padding: 20,
    backgroundColor: '#f9f9f9',
    borderStyle: 'dashed',
    borderWidth: 1,
    borderColor: '#ddd',
  },
  placeholderText: {
    fontSize: 16,
    color: '#999',
    textAlign: 'center',
  },
  bottomSpacing: {
    height: 100,
  },
  actionBar: {
    flexDirection: 'row',
    padding: 15,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#eee',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
      },
      android: {
        elevation: 8,
      },
    }),
  },
  button: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 5,
    minHeight: 44, // Touch target size
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  cancelButton: {
    backgroundColor: '#f0f0f0',
    borderWidth: 1,
    borderColor: '#ddd',
  },
  saveButton: {
    backgroundColor: '#007AFF',
  },
  saveButtonText: {
    color: '#fff',
  },
  editButton: {
    backgroundColor: '#007AFF',
  },
  editButtonText: {
    color: '#fff',
  },
  disabledButton: {
    opacity: 0.6,
  },
});

export default ParticipantDetailScreen;
