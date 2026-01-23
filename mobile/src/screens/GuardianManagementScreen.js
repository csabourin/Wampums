/**
 * Guardian Management Screen
 *
 * Allows viewing, editing, and removing guardians for a participant
 * Addresses P0 critical gap: dedicated guardian management post-registration
 */

import React, { useEffect } from 'react';
import { useSafeState } from '../hooks/useSafeState';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { translate as t } from '../i18n';
import theme, { commonStyles } from '../theme';
import {
  LoadingSpinner,
  ErrorMessage,
  Card,
  FormField,
  Toast,
  useToast,
} from '../components';
import {
  getGuardians,
  saveGuardian,
  removeGuardians,
} from '../api/api-endpoints';
import { debugLog, debugError } from '../utils/DebugUtils';
import SecurityUtils from '../utils/SecurityUtils';

const GuardianManagementScreen = ({ route, navigation }) => {
  const { participantId, participantName } = route.params;
  const [loading, setLoading] = useSafeState(true);
  const [error, setError] = useSafeState('');
  const [guardians, setGuardians] = useSafeState([]);
  const [editingGuardianId, setEditingGuardianId] = useSafeState(null);
  const [editingGuardian, setEditingGuardian] = useSafeState(null);
  const [isAdding, setIsAdding] = useSafeState(false);
  const [newGuardian, setNewGuardian] = useSafeState(null);
  const toast = useToast();

  useEffect(() => {
    loadGuardians();
  }, [participantId]);

  const loadGuardians = async () => {
    try {
      setLoading(true);
      setError('');
      debugLog('[GuardianManagement] Loading guardians for participant:', participantId);

      const response = await getGuardians({ participant_id: participantId });

      if (response.success) {
        setGuardians(response.data || []);
        debugLog('[GuardianManagement] Loaded guardians:', response.data?.length || 0);
      } else {
        throw new Error(response.message || t('failed_to_load_guardians'));
      }
    } catch (err) {
      debugError('[GuardianManagement] Error loading guardians:', err);
      setError(err.message || t('error_loading_guardians'));
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (guardian) => {
    debugLog('[GuardianManagement] Editing guardian:', guardian.id);
    setEditingGuardianId(guardian.id);
    setEditingGuardian({ ...guardian });
  };

  const handleCancelEdit = () => {
    setEditingGuardianId(null);
    setEditingGuardian(null);
  };

  const validateGuardian = (guardian) => {
    if (!guardian.prenom?.trim()) {
      toast.show(t('first_name_required'), 'warning');
      return false;
    }
    if (!guardian.nom?.trim()) {
      toast.show(t('last_name_required'), 'warning');
      return false;
    }
    if (!guardian.lien?.trim()) {
      toast.show(t('relationship_required'), 'warning');
      return false;
    }
    if (guardian.courriel && !SecurityUtils.isValidEmail(guardian.courriel)) {
      toast.show(t('invalid_email'), 'warning');
      return false;
    }
    return true;
  };

  const handleSaveEdit = async () => {
    if (!validateGuardian(editingGuardian)) {
      return;
    }

    try {
      debugLog('[GuardianManagement] Saving guardian:', editingGuardian.id);

      const guardianData = {
        ...editingGuardian,
        participant_id: participantId,
      };

      const response = await saveGuardian(guardianData);

      if (response.success) {
        toast.show(t('guardian_updated_successfully'), 'success');
        setEditingGuardianId(null);
        setEditingGuardian(null);
        await loadGuardians();
      } else {
        throw new Error(response.message || t('error_saving_guardian'));
      }
    } catch (err) {
      debugError('[GuardianManagement] Error saving guardian:', err);
      toast.show(err.message || t('error_saving_guardian'), 'error');
    }
  };

  const handleRemove = (guardian) => {
    if (guardians.length === 1) {
      toast.show(t('cannot_remove_last_guardian'), 'warning');
      return;
    }

    Alert.alert(
      t('confirm_removal'),
      t('confirm_remove_guardian', { name: `${guardian.prenom} ${guardian.nom}` }),
      [
        {
          text: t('cancel'),
          style: 'cancel',
        },
        {
          text: t('remove'),
          style: 'destructive',
          onPress: async () => {
            try {
              debugLog('[GuardianManagement] Removing guardian:', guardian.id);

              const response = await removeGuardians({
                participant_id: participantId,
                guardian_id: guardian.id,
              });

              if (response.success) {
                toast.show(t('guardian_removed_successfully'), 'success');
                await loadGuardians();
              } else {
                throw new Error(response.message || t('error_removing_guardian'));
              }
            } catch (err) {
              debugError('[GuardianManagement] Error removing guardian:', err);
              toast.show(err.message || t('error_removing_guardian'), 'error');
            }
          },
        },
      ]
    );
  };

  const handleAddNew = () => {
    setIsAdding(true);
    setNewGuardian({
      prenom: '',
      nom: '',
      lien: '',
      courriel: '',
      telephone_cellulaire: '',
      telephone_residence: '',
      telephone_travail: '',
      is_primary: false,
      is_emergency_contact: false,
    });
  };

  const handleCancelAdd = () => {
    setIsAdding(false);
    setNewGuardian(null);
  };

  const handleSaveNew = async () => {
    if (!validateGuardian(newGuardian)) {
      return;
    }

    try {
      debugLog('[GuardianManagement] Adding new guardian');

      const guardianData = {
        ...newGuardian,
        participant_id: participantId,
      };

      const response = await saveGuardian(guardianData);

      if (response.success) {
        toast.show(t('guardian_added_successfully'), 'success');
        setIsAdding(false);
        setNewGuardian(null);
        await loadGuardians();
      } else {
        throw new Error(response.message || t('error_adding_guardian'));
      }
    } catch (err) {
      debugError('[GuardianManagement] Error adding guardian:', err);
      toast.show(err.message || t('error_adding_guardian'), 'error');
    }
  };

  const updateEditingField = (field, value) => {
    setEditingGuardian({ ...editingGuardian, [field]: value });
  };

  const updateNewField = (field, value) => {
    setNewGuardian({ ...newGuardian, [field]: value });
  };

  const renderGuardianCard = (guardian) => {
    const isEditing = editingGuardianId === guardian.id;

    if (isEditing) {
      return (
        <Card key={guardian.id} style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>{t('edit_guardian')}</Text>
          </View>

          <FormField
            label={t('first_name')}
            value={editingGuardian.prenom}
            onChangeText={(value) => updateEditingField('prenom', value)}
            placeholder={t('enter_first_name')}
            required
          />

          <FormField
            label={t('last_name')}
            value={editingGuardian.nom}
            onChangeText={(value) => updateEditingField('nom', value)}
            placeholder={t('enter_last_name')}
            required
          />

          <FormField
            label={t('relationship')}
            value={editingGuardian.lien}
            onChangeText={(value) => updateEditingField('lien', value)}
            placeholder={t('enter_relationship')}
            required
          />

          <FormField
            label={t('email')}
            value={editingGuardian.courriel}
            onChangeText={(value) => updateEditingField('courriel', value)}
            placeholder={t('enter_email')}
            keyboardType="email-address"
            autoCapitalize="none"
          />

          <FormField
            label={t('cell_phone')}
            value={editingGuardian.telephone_cellulaire}
            onChangeText={(value) => updateEditingField('telephone_cellulaire', value)}
            placeholder={t('enter_phone')}
            keyboardType="phone-pad"
          />

          <FormField
            label={t('home_phone')}
            value={editingGuardian.telephone_residence}
            onChangeText={(value) => updateEditingField('telephone_residence', value)}
            placeholder={t('enter_phone')}
            keyboardType="phone-pad"
          />

          <FormField
            label={t('work_phone')}
            value={editingGuardian.telephone_travail}
            onChangeText={(value) => updateEditingField('telephone_travail', value)}
            placeholder={t('enter_phone')}
            keyboardType="phone-pad"
          />

          <View style={styles.actionButtons}>
            <TouchableOpacity
              style={[commonStyles.button, styles.cancelButton]}
              onPress={handleCancelEdit}
              activeOpacity={0.7}
            >
              <Text style={commonStyles.buttonText}>{t('cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[commonStyles.button, styles.saveButton]}
              onPress={handleSaveEdit}
              activeOpacity={0.7}
            >
              <Text style={commonStyles.buttonText}>{t('save')}</Text>
            </TouchableOpacity>
          </View>
        </Card>
      );
    }

    return (
      <Card key={guardian.id} style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>
            {guardian.prenom} {guardian.nom}
          </Text>
          {guardian.is_primary && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{t('primary')}</Text>
            </View>
          )}
        </View>

        <View style={styles.infoRow}>
          <Text style={styles.label}>{t('relationship')}:</Text>
          <Text style={styles.value}>{guardian.lien || '-'}</Text>
        </View>

        {guardian.courriel && (
          <View style={styles.infoRow}>
            <Text style={styles.label}>{t('email')}:</Text>
            <Text style={styles.value}>{guardian.courriel}</Text>
          </View>
        )}

        {guardian.telephone_cellulaire && (
          <View style={styles.infoRow}>
            <Text style={styles.label}>{t('cell_phone')}:</Text>
            <Text style={styles.value}>{guardian.telephone_cellulaire}</Text>
          </View>
        )}

        {guardian.telephone_residence && (
          <View style={styles.infoRow}>
            <Text style={styles.label}>{t('home_phone')}:</Text>
            <Text style={styles.value}>{guardian.telephone_residence}</Text>
          </View>
        )}

        {guardian.telephone_travail && (
          <View style={styles.infoRow}>
            <Text style={styles.label}>{t('work_phone')}:</Text>
            <Text style={styles.value}>{guardian.telephone_travail}</Text>
          </View>
        )}

        <View style={styles.actionButtons}>
          <TouchableOpacity
            style={[commonStyles.button, styles.editButton]}
            onPress={() => handleEdit(guardian)}
            activeOpacity={0.7}
          >
            <Text style={commonStyles.buttonText}>{t('edit')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[commonStyles.button, styles.removeButton]}
            onPress={() => handleRemove(guardian)}
            activeOpacity={0.7}
            disabled={guardians.length === 1}
          >
            <Text style={commonStyles.buttonText}>{t('remove')}</Text>
          </TouchableOpacity>
        </View>
      </Card>
    );
  };

  const renderAddGuardianForm = () => {
    if (!isAdding) {
      return null;
    }

    return (
      <Card style={[styles.card, styles.addCard]}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>{t('add_guardian')}</Text>
        </View>

        <FormField
          label={t('first_name')}
          value={newGuardian.prenom}
          onChangeText={(value) => updateNewField('prenom', value)}
          placeholder={t('enter_first_name')}
          required
        />

        <FormField
          label={t('last_name')}
          value={newGuardian.nom}
          onChangeText={(value) => updateNewField('nom', value)}
          placeholder={t('enter_last_name')}
          required
        />

        <FormField
          label={t('relationship')}
          value={newGuardian.lien}
          onChangeText={(value) => updateNewField('lien', value)}
          placeholder={t('enter_relationship')}
          required
        />

        <FormField
          label={t('email')}
          value={newGuardian.courriel}
          onChangeText={(value) => updateNewField('courriel', value)}
          placeholder={t('enter_email')}
          keyboardType="email-address"
          autoCapitalize="none"
        />

        <FormField
          label={t('cell_phone')}
          value={newGuardian.telephone_cellulaire}
          onChangeText={(value) => updateNewField('telephone_cellulaire', value)}
          placeholder={t('enter_phone')}
          keyboardType="phone-pad"
        />

        <FormField
          label={t('home_phone')}
          value={newGuardian.telephone_residence}
          onChangeText={(value) => updateNewField('telephone_residence', value)}
          placeholder={t('enter_phone')}
          keyboardType="phone-pad"
        />

        <FormField
          label={t('work_phone')}
          value={newGuardian.telephone_travail}
          onChangeText={(value) => updateNewField('telephone_travail', value)}
          placeholder={t('enter_phone')}
          keyboardType="phone-pad"
        />

        <View style={styles.actionButtons}>
          <TouchableOpacity
            style={[commonStyles.button, styles.cancelButton]}
            onPress={handleCancelAdd}
            activeOpacity={0.7}
          >
            <Text style={commonStyles.buttonText}>{t('cancel')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[commonStyles.button, styles.saveButton]}
            onPress={handleSaveNew}
            activeOpacity={0.7}
          >
            <Text style={commonStyles.buttonText}>{t('add')}</Text>
          </TouchableOpacity>
        </View>
      </Card>
    );
  };

  if (loading) {
    return <LoadingSpinner message={t('loading_guardians')} />;
  }

  if (error && guardians.length === 0) {
    return <ErrorMessage message={error} onRetry={loadGuardians} />;
  }

  return (
    <View style={commonStyles.container}>
      <ScrollView contentContainerStyle={styles.scrollContainer}>
        {/* Header */}
        <Card style={styles.headerCard}>
          <Text style={styles.headerTitle}>{t('guardian_management')}</Text>
          <Text style={styles.headerSubtitle}>
            {t('for_participant')}: {participantName}
          </Text>
        </Card>

        {/* Add Guardian Button */}
        {!isAdding && !editingGuardianId && (
          <TouchableOpacity
            style={[commonStyles.button, styles.addButton]}
            onPress={handleAddNew}
            activeOpacity={0.7}
          >
            <Text style={commonStyles.buttonText}>➕ {t('add_guardian')}</Text>
          </TouchableOpacity>
        )}

        {/* Add Guardian Form */}
        {renderAddGuardianForm()}

        {/* Guardians List */}
        {guardians.length === 0 ? (
          <Card style={styles.card}>
            <Text style={styles.emptyText}>{t('no_guardians_found')}</Text>
          </Card>
        ) : (
          guardians.map((guardian) => renderGuardianCard(guardian))
        )}
      </ScrollView>

      {/* Toast Notifications */}
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
  scrollContainer: {
    padding: theme.spacing.md,
  },
  headerCard: {
    marginBottom: theme.spacing.md,
  },
  headerTitle: {
    fontSize: theme.fontSize.xl,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.primary,
    marginBottom: theme.spacing.xs,
  },
  headerSubtitle: {
    fontSize: theme.fontSize.base,
    color: theme.colors.textMuted,
  },
  card: {
    marginBottom: theme.spacing.md,
  },
  addCard: {
    borderColor: theme.colors.primary,
    borderWidth: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.md,
  },
  cardTitle: {
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.primary,
  },
  badge: {
    backgroundColor: theme.colors.primary,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.borderRadius.sm,
  },
  badgeText: {
    color: theme.colors.white,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
  },
  infoRow: {
    flexDirection: 'row',
    marginBottom: theme.spacing.sm,
  },
  label: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.text,
    width: 120,
  },
  value: {
    fontSize: theme.fontSize.base,
    color: theme.colors.text,
    flex: 1,
  },
  actionButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.md,
  },
  editButton: {
    flex: 1,
    backgroundColor: theme.colors.info,
  },
  removeButton: {
    flex: 1,
    backgroundColor: theme.colors.error,
  },
  cancelButton: {
    flex: 1,
    backgroundColor: theme.colors.textMuted,
  },
  saveButton: {
    flex: 1,
    backgroundColor: theme.colors.success,
  },
  addButton: {
    marginBottom: theme.spacing.md,
    backgroundColor: theme.colors.success,
  },
  emptyText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.textMuted,
    textAlign: 'center',
    padding: theme.spacing.lg,
  },
});

export default GuardianManagementScreen;
