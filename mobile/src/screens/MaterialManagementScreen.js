/**
 * Material Management Screen
 *
 * Mirrors spa/material_management.js functionality
 * Bulk equipment reservation with conflict detection
 */

import React, { useEffect, useMemo } from 'react';
import { useSafeState } from '../hooks/useSafeState';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { translate as t } from '../i18n';
import theme, { commonStyles } from '../theme';
import {
  LoadingSpinner,
  Card,
  EmptyState,
  FormField,
  Checkbox,
  Toast,
  useToast,
} from '../components';
import { Picker } from '@react-native-picker/picker';
import { canViewInventory } from '../utils/PermissionUtils';
import API from '../api/api-core';
import CONFIG from '../config';
import StorageUtils from '../utils/StorageUtils';
import { debugError } from '../utils/DebugUtils';

const LOCATION_TYPES = [
  { label: () => t('location_type_local_scout_hall'), value: 'local_scout_hall' },
  { label: () => t('location_type_warehouse'), value: 'warehouse' },
  { label: () => t('location_type_leader_home'), value: 'leader_home' },
  { label: () => t('location_type_other'), value: 'other' },
];

const MaterialManagementScreen = ({ navigation }) => {
  const [loading, setLoading] = useSafeState(true);
  const [refreshing, setRefreshing] = useSafeState(false);
  const [equipment, setEquipment] = useSafeState([]);
  const [reservations, setReservations] = useSafeState([]);
  const [activities, setActivities] = useSafeState([]);
  const [selectedItems, setSelectedItems] = useSafeState(new Map()); // equipmentId -> quantity

  const [formData, setFormData] = useSafeState({
    activity_id: '',
    date_from: '',
    date_to: '',
    reserved_for: '',
    notes: '',
  });

  const [submitting, setSubmitting] = useSafeState(false);
  const toast = useToast();

  useEffect(() => {
    checkPermissionsAndLoad();
  }, []);

  const checkPermissionsAndLoad = async () => {
    try {
      if (!canViewInventory()) {
        Alert.alert(
          t('access_denied'),
          t('no_permission_to_view_inventory'),
          [
            {
              text: t('OK'),
              onPress: () => navigation.goBack(),
            },
          ]
        );
        return;
      }

      await loadData();
    } catch (err) {
      debugError('Error checking permissions:', err);
      setLoading(false);
    }
  };

  const loadData = async () => {
    try {
      const [equipmentResult, reservationsResult, activitiesResult] = await Promise.all([
        API.get('/v1/resources/equipment'),
        API.get('/v1/resources/equipment/reservations'),
        API.get('/v1/activities'),
      ]);

      if (equipmentResult.success) {
        setEquipment(equipmentResult.data?.equipment || equipmentResult.equipment || []);
      }

      if (reservationsResult.success) {
        setReservations(reservationsResult.data?.reservations || reservationsResult.reservations || []);
      }

      if (activitiesResult.success) {
        setActivities(activitiesResult.data?.activities || activitiesResult.activities || []);
      }
    } catch (err) {
      debugError('Error loading data:', err);
      toast.show(t('error_loading_data'), 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
  };

  // Get conflicting reservations for a specific equipment item and date range
  const getConflictingReservations = (equipmentId, dateFrom, dateTo) => {
    if (!dateFrom || !dateTo) {
      return [];
    }

    return reservations.filter((reservation) => {
      if (reservation.equipment_id !== equipmentId) {
        return false;
      }

      // Only show active reservations
      if (reservation.status !== 'reserved' && reservation.status !== 'confirmed') {
        return false;
      }

      // Check for date overlap
      const resFrom = reservation.date_from || reservation.meeting_date;
      const resTo = reservation.date_to || reservation.meeting_date;

      // Reservations overlap if: res.date_from <= selected.date_to AND res.date_to >= selected.date_from
      return resFrom <= dateTo && resTo >= dateFrom;
    });
  };

  const formatLocation = (item) => {
    const typeObj = LOCATION_TYPES.find((t) => t.value === item.location_type);
    const typeLabel = typeObj ? typeObj.label() : t('location_type_local_scout_hall');
    const details = item.location_details?.trim();
    return details ? `${typeLabel} — ${details}` : typeLabel;
  };

  const formatDate = (dateString) => {
    if (!dateString) return '-';
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-CA');
    } catch {
      return '-';
    }
  };

  const handleToggleItem = (equipmentId) => {
    const newSelectedItems = new Map(selectedItems);
    if (newSelectedItems.has(equipmentId)) {
      newSelectedItems.delete(equipmentId);
    } else {
      newSelectedItems.set(equipmentId, 1); // Default quantity of 1
    }
    setSelectedItems(newSelectedItems);
  };

  const handleQuantityChange = (equipmentId, quantity) => {
    const newSelectedItems = new Map(selectedItems);
    const parsedQuantity = parseInt(quantity, 10);
    if (parsedQuantity > 0) {
      newSelectedItems.set(equipmentId, parsedQuantity);
      setSelectedItems(newSelectedItems);
    }
  };

  const handleSubmit = async () => {
    // Check if activity is selected OR both dates are provided
    if (!formData.activity_id && (!formData.date_from || !formData.date_to)) {
      toast.show(t('date_required') || 'Please select an activity or enter reservation dates', 'warning');
      return;
    }

    if (!formData.reserved_for) {
      toast.show(t('fill_required_fields'), 'warning');
      return;
    }

    if (selectedItems.size === 0) {
      toast.show(t('no_items_selected'), 'warning');
      return;
    }

    try {
      setSubmitting(true);

      const payload = {
        reserved_for: formData.reserved_for,
        notes: formData.notes || '',
        items: Array.from(selectedItems.entries()).map(([equipment_id, quantity]) => ({
          equipment_id,
          quantity,
        })),
      };

      // Add activity_id if selected, otherwise add dates
      if (formData.activity_id) {
        payload.activity_id = parseInt(formData.activity_id, 10);
      } else {
        payload.date_from = formData.date_from;
        payload.date_to = formData.date_to;
      }

      const result = await API.post('/v1/resources/equipment/reservations/bulk', payload);

      if (result.success) {
        toast.show(t('bulk_reservation_saved'), 'success');
        setSelectedItems(new Map());
        setFormData({
          date_from: '',
          date_to: '',
          reserved_for: '',
          notes: '',
        });
        await loadData();
      } else {
        toast.show(result.message || t('error_saving_reservation'), 'error');
      }
    } catch (err) {
      debugError('Error saving bulk reservations:', err);
      toast.show(err.message || t('error_saving_reservation'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const selectedItemsList = useMemo(() => {
    return Array.from(selectedItems.entries())
      .map(([equipmentId, quantity]) => {
        const item = equipment.find((e) => e.id === parseInt(equipmentId));
        return item ? { ...item, selectedQuantity: quantity } : null;
      })
      .filter((item) => item !== null);
  }, [selectedItems, equipment]);

  if (loading && !refreshing) {
    return <LoadingSpinner message={t('loading')} />;
  }

  return (
    <View style={commonStyles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContainer}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Header */}
        <Card style={styles.headerCard}>
          <Text style={styles.kicker}>{t('inventory')}</Text>
          <Text style={styles.title}>{t('material_management_title')}</Text>
          <Text style={styles.subtitle}>{t('material_management_description')}</Text>
        </Card>

        {/* Reservation Form */}
        <Card>
          <Text style={styles.sectionTitle}>{t('reservation_form')}</Text>

          <View style={{ marginBottom: 16 }}>
            <Text style={commonStyles.inputLabel}>{t('select_activity_optional')}</Text>
            <Picker
              selectedValue={formData.activity_id}
              onValueChange={(value) => {
                if (value) {
                  const activity = activities.find((a) => a.id === parseInt(value, 10));
                  if (activity) {
                    setFormData({
                      ...formData,
                      activity_id: value,
                      date_from: activity.activity_date,
                      date_to: activity.activity_date,
                      reserved_for: activity.name,
                    });
                  }
                } else {
                  setFormData({
                    ...formData,
                    activity_id: '',
                    date_from: '',
                    date_to: '',
                    reserved_for: '',
                  });
                }
              }}
              style={[commonStyles.input]}
            >
              <Picker.Item label={t('manual_date_entry')} value="" />
              {activities.map((activity) => (
                <Picker.Item
                  key={activity.id}
                  label={`${activity.name} - ${activity.activity_date}`}
                  value={String(activity.id)}
                />
              ))}
            </Picker>
          </View>

          <View style={styles.row}>
            <View style={styles.halfWidth}>
              <FormField
                label={t('date_from')}
                value={formData.date_from}
                onChangeText={(value) => setFormData({ ...formData, date_from: value })}
                placeholder="YYYY-MM-DD"
                required
                editable={!formData.activity_id}
              />
            </View>
            <View style={styles.halfWidth}>
              <FormField
                label={t('date_to')}
                value={formData.date_to}
                onChangeText={(value) => setFormData({ ...formData, date_to: value })}
                placeholder="YYYY-MM-DD"
                required
                editable={!formData.activity_id}
              />
            </View>
          </View>

          <FormField
            label={t('activity_name')}
            value={formData.reserved_for}
            onChangeText={(value) => setFormData({ ...formData, reserved_for: value })}
            placeholder={t('activity_name')}
            required
            editable={!formData.activity_id}
          />

          <FormField
            label={t('reservation_notes')}
            value={formData.notes}
            onChangeText={(value) => setFormData({ ...formData, notes: value })}
            placeholder={t('reservation_notes')}
            multiline
            numberOfLines={3}
          />

          <TouchableOpacity
            style={[
              commonStyles.button,
              (submitting || selectedItems.size === 0) && commonStyles.buttonDisabled,
            ]}
            onPress={handleSubmit}
            disabled={submitting || selectedItems.size === 0}
            activeOpacity={0.7}
          >
            <Text style={commonStyles.buttonText}>
              {submitting ? t('saving') : t('reserve_selected')}
            </Text>
          </TouchableOpacity>
        </Card>

        {/* Equipment Selection */}
        <Card>
          <Text style={styles.sectionTitle}>{t('select_equipment')}</Text>

          {equipment.length === 0 ? (
            <EmptyState
              icon="📦"
              message={t('no_data_available')}
              description={t('add_equipment_first')}
            />
          ) : (
            equipment.map((item) => {
              const isSelected = selectedItems.has(item.id);
              const conflicts = getConflictingReservations(
                item.id,
                formData.date_from,
                formData.date_to
              );

              return (
                <View
                  key={item.id}
                  style={[
                    styles.equipmentItem,
                    isSelected && conflicts.length > 0 && styles.equipmentItemWithConflicts,
                  ]}
                >
                  <Checkbox
                    checked={isSelected}
                    onPress={() => handleToggleItem(item.id)}
                    label={
                      <View style={styles.equipmentInfo}>
                        <Text style={styles.equipmentName}>{item.name}</Text>
                        {item.category && (
                          <Text style={styles.equipmentCategory}>{item.category}</Text>
                        )}
                        <Text style={styles.equipmentAvailable}>
                          {t('equipment_available')}: {item.quantity_total ?? 0}
                        </Text>
                        <Text style={styles.equipmentLocation}>{formatLocation(item)}</Text>
                      </View>
                    }
                  />

                  {isSelected && (
                    <View style={styles.quantitySection}>
                      <FormField
                        label={t('reserved_quantity')}
                        value={String(selectedItems.get(item.id))}
                        onChangeText={(value) => handleQuantityChange(item.id, value)}
                        keyboardType="numeric"
                      />

                      {conflicts.length > 0 && (
                        <View style={styles.conflictWarning}>
                          <Text style={styles.conflictWarningTitle}>
                            ⚠️ {t('existing_reservations') || 'Existing reservations'}:
                          </Text>
                          {conflicts.map((conflict) => {
                            const dateRange =
                              conflict.date_from && conflict.date_to
                                ? `${formatDate(conflict.date_from)} - ${formatDate(conflict.date_to)}`
                                : formatDate(conflict.meeting_date);
                            return (
                              <Text key={conflict.id} style={styles.conflictText}>
                                • {dateRange} - {conflict.reserved_for || '-'} (
                                {conflict.organization_name || t('unknown')}, qty:{' '}
                                {conflict.reserved_quantity})
                              </Text>
                            );
                          })}
                        </View>
                      )}
                    </View>
                  )}
                </View>
              );
            })
          )}
        </Card>

        {/* Selected Items Summary */}
        <Card>
          <Text style={styles.sectionTitle}>{t('selected_items')}</Text>

          {selectedItemsList.length === 0 ? (
            <Text style={styles.emptyText}>{t('no_items_selected')}</Text>
          ) : (
            <View style={styles.selectedList}>
              {selectedItemsList.map((item) => (
                <View key={item.id} style={styles.selectedItem}>
                  <Text style={styles.selectedItemName}>{item.name}</Text>
                  <Text style={styles.selectedItemQuantity}>
                    {t('reserved_quantity')}: {item.selectedQuantity}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </Card>

        {/* Existing Reservations */}
        <Card>
          <Text style={styles.sectionTitle}>{t('equipment_reservations')}</Text>

          {reservations.length === 0 ? (
            <EmptyState
              icon="📋"
              message={t('no_data_available')}
              description={t('no_reservations_yet')}
            />
          ) : (
            <View style={styles.reservationsList}>
              {reservations.map((reservation) => {
                const dateRange =
                  reservation.date_from && reservation.date_to
                    ? `${formatDate(reservation.date_from)} - ${formatDate(reservation.date_to)}`
                    : formatDate(reservation.meeting_date);

                return (
                  <View key={reservation.id} style={styles.reservationCard}>
                    <Text style={styles.reservationEquipment}>
                      {reservation.equipment_name || '-'}
                    </Text>
                    <Text style={styles.reservationDate}>{dateRange}</Text>
                    <View style={styles.reservationDetails}>
                      <Text style={styles.reservationDetail}>
                        {t('reserved_quantity')}: {reservation.reserved_quantity || 0}
                      </Text>
                      <Text style={styles.reservationDetail}>
                        {t('reservation_for')}: {reservation.reserved_for || '-'}
                      </Text>
                      <Text style={styles.reservationDetail}>
                        {t('organization')}: {reservation.organization_name || '-'}
                      </Text>
                      <Text style={styles.reservationDetail}>
                        {t('reservation_status')}: {reservation.status}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </Card>
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
    marginBottom: theme.spacing.lg,
    alignItems: 'center',
  },
  kicker: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.primary,
    textTransform: 'uppercase',
    marginBottom: theme.spacing.xs,
  },
  title: {
    fontSize: theme.fontSize.xxl,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.text,
    marginBottom: theme.spacing.sm,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: theme.fontSize.base,
    color: theme.colors.textMuted,
    textAlign: 'center',
  },
  sectionTitle: {
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.text,
    marginBottom: theme.spacing.md,
  },
  row: {
    flexDirection: 'row',
    gap: theme.spacing.md,
  },
  halfWidth: {
    flex: 1,
  },
  equipmentItem: {
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.borderLight,
    paddingVertical: theme.spacing.md,
  },
  equipmentItemWithConflicts: {
    backgroundColor: '#FFF3CD',
    paddingHorizontal: theme.spacing.sm,
    borderRadius: theme.borderRadius.sm,
  },
  equipmentInfo: {
    flex: 1,
    marginLeft: theme.spacing.sm,
  },
  equipmentName: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.text,
    marginBottom: theme.spacing.xs,
  },
  equipmentCategory: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
    marginBottom: theme.spacing.xs,
  },
  equipmentAvailable: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
    marginBottom: theme.spacing.xs,
  },
  equipmentLocation: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
  },
  quantitySection: {
    marginTop: theme.spacing.md,
    paddingLeft: theme.spacing.xl + theme.spacing.sm,
  },
  conflictWarning: {
    backgroundColor: '#FFF3CD',
    padding: theme.spacing.sm,
    borderRadius: theme.borderRadius.sm,
    marginTop: theme.spacing.sm,
  },
  conflictWarningTitle: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.bold,
    color: '#856404',
    marginBottom: theme.spacing.xs,
  },
  conflictText: {
    fontSize: theme.fontSize.sm,
    color: '#856404',
    marginBottom: theme.spacing.xs,
  },
  emptyText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.textMuted,
    textAlign: 'center',
    padding: theme.spacing.lg,
  },
  selectedList: {
    gap: theme.spacing.sm,
  },
  selectedItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.borderLight,
  },
  selectedItemName: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.text,
    flex: 1,
  },
  selectedItemQuantity: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
  },
  reservationsList: {
    gap: theme.spacing.md,
  },
  reservationCard: {
    borderLeftWidth: 3,
    borderLeftColor: theme.colors.primary,
    paddingLeft: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  reservationEquipment: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.text,
    marginBottom: theme.spacing.xs,
  },
  reservationDate: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.primary,
    marginBottom: theme.spacing.sm,
  },
  reservationDetails: {
    gap: theme.spacing.xs,
  },
  reservationDetail: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
  },
});

export default MaterialManagementScreen;