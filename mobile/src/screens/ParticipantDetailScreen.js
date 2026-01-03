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

import React, { useEffect } from 'react';
import { useSafeState } from '../hooks/useSafeState';
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
import {
  getParticipant,
  updateParticipant,
  createParticipant,
  deleteParticipant,
  getGroups,
} from '../api/api-endpoints';
import { translate as t } from '../i18n';
import { Picker } from '@react-native-picker/picker';
import StorageUtils from '../utils/StorageUtils';
import SecurityUtils from '../utils/SecurityUtils';
import DateUtils from '../utils/DateUtils';
import CacheManager from '../utils/CacheManager';

// Components
import { Card, LoadingSpinner, ErrorMessage } from '../components';
import { debugError } from '../utils/DebugUtils.js';

/**
 * ParticipantDetailScreen Component
 */
const ParticipantDetailScreen = () => {
  const navigation = useNavigation();
  const route = useRoute();
  const { id } = route.params || {};
  const participantId = id;
  const isNewParticipant = participantId === 'new';

  // State
  const [participant, setParticipant] = useSafeState(null);
  const [groups, setGroups] = useSafeState([]);
  const [isLoading, setIsLoading] = useSafeState(!isNewParticipant);
  const [isEditing, setIsEditing] = useSafeState(isNewParticipant);
  const [isSaving, setIsSaving] = useSafeState(false);
  const [error, setError] = useSafeState(null);
  const [isOffline, setIsOffline] = useSafeState(false);

  // Form state
  const [formData, setFormData] = useSafeState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    birthdate: '',
    address: '',
    city: '',
    province: '',
    postalCode: '',
    group_id: null,
    first_leader: false,
    second_leader: false,
  });

  // User permissions
  const [userRole, setUserRole] = useSafeState(null);
  const [canEdit, setCanEdit] = useSafeState(false);

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
   * Load groups
   */
  useEffect(() => {
    loadGroups();
  }, []);

  /**
   * Load participant data
   */
  useEffect(() => {
    if (participantId && participantId !== 'new') {
      loadParticipant();
    } else if (isNewParticipant) {
      // For new participants, just set header
      navigation.setOptions({
        title: t('create_participant') || 'New Participant',
      });
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
      debugError('Error loading user role:', error);
    }
  };

  /**
   * Load groups list
   */
  const loadGroups = async () => {
    try {
      const response = await getGroups();
      if (response.success && response.data) {
        setGroups(response.data);
      }
    } catch (error) {
      debugError('Error loading groups:', error);
      // Non-critical error, continue
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
        setError(response.message || t('error'));
      }
    } catch (err) {
      debugError('Error loading participant:', err);
      setError(t('error_loading_manage_participants'));
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Initialize form data from participant object
   */
  const initializeFormData = (data) => {
    setFormData({
      firstName: data.firstName || data.first_name || '',
      lastName: data.lastName || data.last_name || '',
      email: data.email || '',
      phone: data.phone || '',
      birthdate: data.birthdate || '',
      address: data.address || '',
      city: data.city || '',
      province: data.province || '',
      postalCode: data.postalCode || data.postal_code || '',
      group_id: data.group_id || null,
      first_leader: data.first_leader || false,
      second_leader: data.second_leader || false,
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
      errors.push(t('First name is required'));
    }
    if (!formData.lastName.trim()) {
      errors.push(t('Last name is required'));
    }

    // Email validation (if provided)
    if (formData.email && !SecurityUtils.isValidEmail(formData.email)) {
      errors.push(t('account_info_email_invalid'));
    }

    // Birthdate validation (if provided)
    if (formData.birthdate && !DateUtils.isValidDate(formData.birthdate)) {
      errors.push(t('Invalid birthdate'));
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
      Alert.alert(t('error'), errors.join('\n'));
      return;
    }

    try {
      setIsSaving(true);
      setError(null);

      // Sanitize all input data
      const sanitizedData = SecurityUtils.deepSanitize(formData);

      // Ensure role logic: only one leader role per participant
      if (sanitizedData.first_leader && sanitizedData.second_leader) {
        sanitizedData.second_leader = false;
      }

      let response;
      if (isNewParticipant) {
        // Create new participant
        response = await createParticipant(sanitizedData);
      } else {
        // Update existing participant
        response = await updateParticipant(participantId, sanitizedData);
      }

      if (response.success) {
        // CRITICAL: Invalidate participant caches (following CLAUDE.md)
        await CacheManager.clearParticipantRelatedCaches();

        if (isNewParticipant) {
          // Navigate back with success message
          Alert.alert(
            t('success'),
            t('participant_created'),
            [
              {
                text: t('OK'),
                onPress: () => navigation.goBack(),
              },
            ]
          );
        } else {
          // Update local state
          setParticipant({ ...participant, ...sanitizedData });
          setIsEditing(false);

          // Show success message
          if (response.queued) {
            Alert.alert(t('Queued'), t('Will sync when online'), [{ text: t('OK') }]);
          } else {
            Alert.alert(t('success'), t('data_saved'), [{ text: t('OK') }]);
          }
        }
      } else {
        setError(response.message || t('error_saving_participant'));
        Alert.alert(t('error'), response.message || t('error_saving_participant'));
      }
    } catch (err) {
      debugError('Error saving participant:', err);
      setError(t('error_saving_participant'));
      Alert.alert(t('error'), t('error_saving_participant'));
    } finally {
      setIsSaving(false);
    }
  };

  /**
   * Delete participant
   */
  const handleDelete = () => {
    if (isNewParticipant) return;

    Alert.alert(
      t('confirm_delete'),
      t('confirm_delete_participant_message'),
      [
        {
          text: t('cancel'),
          style: 'cancel',
        },
        {
          text: t('delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              setIsSaving(true);
              const response = await deleteParticipant(participantId);

              if (response.success) {
                // CRITICAL: Invalidate participant caches
                await CacheManager.clearParticipantRelatedCaches();

                Alert.alert(
                  t('success'),
                  t('participant_deleted'),
                  [
                    {
                      text: t('OK'),
                      onPress: () => navigation.goBack(),
                    },
                  ]
                );
              } else {
                Alert.alert(t('error'), response.message || t('error_deleting_participant'));
              }
            } catch (err) {
              debugError('Error deleting participant:', err);
              Alert.alert(t('error'), t('error_deleting_participant'));
            } finally {
              setIsSaving(false);
            }
          },
        },
      ]
    );
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
        t('Permission denied'),
        t("You don't have permission to edit")
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
        <Text style={styles.loadingText}>{t('loading')}</Text>
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
          <Text style={styles.retryButtonText}>{t('retry')}</Text>
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
            {formData[field] || t('Not provided')}
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
              {t('Offline')} - {t('Viewing cached data')}
            </Text>
          </View>
        )}

        {/* Error message */}
        {error && <ErrorMessage message={error} />}

        {/* Header Card - only show for existing participants */}
        {!isNewParticipant && participant && (
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
                    {getAge()} {t('years')}
                  </Text>
                )}
              </View>
            </View>
          </Card>
        )}

        {/* Basic Information Card */}
        <Card style={styles.card}>
          <Text style={styles.sectionTitle}>
            {t('Basic Information')}
          </Text>

          {renderField(t('first_name'), 'firstName', {
            placeholder: t('Enter first name'),
          })}

          {renderField(t('last_name'), 'lastName', {
            placeholder: t('Enter last name'),
          })}

          {renderField(t('date_naissance'), 'birthdate', {
            placeholder: 'YYYY-MM-DD',
          })}

          {renderField(t('email'), 'email', {
            placeholder: t('Enter email'),
            keyboardType: 'email-address',
          })}

          {renderField(t('Phone'), 'phone', {
            placeholder: t('Enter phone'),
            keyboardType: 'phone-pad',
          })}
        </Card>

        {/* Address Card */}
        <Card style={styles.card}>
          <Text style={styles.sectionTitle}>{t('Address')}</Text>

          {renderField(t('Street Address'), 'address', {
            placeholder: t('Enter address'),
          })}

          {renderField(t('City'), 'city', {
            placeholder: t('Enter city'),
          })}

          {renderField(t('Province'), 'province', {
            placeholder: t('Enter province'),
          })}

          {renderField(t('postal_code'), 'postalCode', {
            placeholder: t('Enter postal code'),
          })}
        </Card>

        {/* Group & Role Card */}
        <Card style={styles.card}>
          <Text style={styles.sectionTitle}>{t('Group & Role')}</Text>

          {/* Group Picker */}
          <View style={styles.fieldContainer}>
            <Text style={styles.fieldLabel}>{t('group')}</Text>
            {isEditing ? (
              <Picker
                selectedValue={formData.group_id}
                onValueChange={(value) => {
                  handleFieldChange('group_id', value);
                  // Reset role when changing group
                  if (!value) {
                    handleFieldChange('first_leader', false);
                    handleFieldChange('second_leader', false);
                  }
                }}
                style={styles.picker}
                enabled={!isSaving}
              >
                <Picker.Item label={t('no_group')} value={null} />
                {groups.map((group) => (
                  <Picker.Item
                    key={group.id}
                    label={group.name}
                    value={group.id}
                  />
                ))}
              </Picker>
            ) : (
              <Text style={styles.fieldValue}>
                {formData.group_id
                  ? groups.find((g) => g.id === formData.group_id)?.name || t('no_group')
                  : t('no_group')}
              </Text>
            )}
          </View>

          {/* Role Picker - Only enabled when group is selected */}
          <View style={styles.fieldContainer}>
            <Text style={styles.fieldLabel}>{t('role')}</Text>
            {isEditing ? (
              <Picker
                selectedValue={
                  formData.first_leader
                    ? 'leader'
                    : formData.second_leader
                      ? 'second_leader'
                      : 'none'
                }
                onValueChange={(value) => {
                  handleFieldChange('first_leader', value === 'leader');
                  handleFieldChange('second_leader', value === 'second_leader');
                }}
                style={styles.picker}
                enabled={!isSaving && formData.group_id !== null}
              >
                <Picker.Item label={t('none')} value="none" />
                <Picker.Item label={t('leader')} value="leader" />
                <Picker.Item label={t('second_leader')} value="second_leader" />
              </Picker>
            ) : (
              <Text style={styles.fieldValue}>
                {formData.first_leader
                  ? t('leader')
                  : formData.second_leader
                    ? t('second_leader')
                    : t('none')}
              </Text>
            )}
            {!formData.group_id && isEditing && (
              <Text style={styles.helpText}>
                {t('Select a group to assign a role')}
              </Text>
            )}
          </View>
        </Card>

        {/* Placeholder cards for future features */}
        <Card style={styles.placeholderCard}>
          <Text style={styles.placeholderText}>
            {t('Health Information')} - {t('Coming soon')}
          </Text>
        </Card>

        <Card style={styles.placeholderCard}>
          <Text style={styles.placeholderText}>
            {t('Guardian Contacts')} - {t('Coming soon')}
          </Text>
        </Card>

        <Card style={styles.placeholderCard}>
          <Text style={styles.placeholderText}>
            {t('badge_progress')} - {t('Coming soon')}
          </Text>
        </Card>

        <Card style={styles.placeholderCard}>
          <Text style={styles.placeholderText}>
            {t('Financial Status')} - {t('Coming soon')}
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
              <Text style={styles.buttonText}>
                {isNewParticipant ? t('back') : t('cancel')}
              </Text>
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
                  {isNewParticipant ? t('create') : t('save')}
                </Text>
              )}
            </TouchableOpacity>
          </>
        ) : (
          canEdit && (
            <>
              <TouchableOpacity
                style={[styles.button, styles.editButton]}
                onPress={handleEdit}
              >
                <Text style={[styles.buttonText, styles.editButtonText]}>
                  {t('edit')}
                </Text>
              </TouchableOpacity>
              {!isNewParticipant && (
                <TouchableOpacity
                  style={[styles.button, styles.deleteButton]}
                  onPress={handleDelete}
                  disabled={isSaving}
                >
                  <Text style={[styles.buttonText, styles.deleteButtonText]}>
                    {t('delete')}
                  </Text>
                </TouchableOpacity>
              )}
            </>
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
  deleteButton: {
    backgroundColor: '#FF3B30',
  },
  deleteButtonText: {
    color: '#fff',
  },
  disabledButton: {
    opacity: 0.6,
  },
  picker: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    backgroundColor: '#fff',
    marginTop: 5,
  },
  helpText: {
    fontSize: 12,
    color: '#999',
    fontStyle: 'italic',
    marginTop: 5,
  },
});

export default ParticipantDetailScreen;