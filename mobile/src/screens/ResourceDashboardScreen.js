/**
 * Resource Dashboard Screen
 *
 * Mirrors spa/resource_dashboard.js functionality
 * Overview dashboard for resources and reservations for a specific meeting date
 */

import React, { useEffect } from 'react';
import { useSafeState } from '../hooks/useSafeState';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
} from 'react-native';
import { translate as t } from '../i18n';
import theme, { commonStyles } from '../theme';
import {
  LoadingSpinner,
  Card,
  EmptyState,
  FormField,
  Toast,
  useToast,
} from '../components';
import { Picker } from '@react-native-picker/picker';
import { canViewInventory } from '../utils/PermissionUtils';
import API from '../api/api-core';
import CONFIG from '../config';
import StorageUtils from '../utils/StorageUtils';
import { debugError } from '../utils/DebugUtils';

const ResourceDashboardScreen = ({ navigation }) => {
  const [loading, setLoading] = useSafeState(true);
  const [refreshing, setRefreshing] = useSafeState(false);

  const [meetingDate, setMeetingDate] = useSafeState(getTodayISO());
  const [equipment, setEquipment] = useSafeState([]);
  const [reservations, setReservations] = useSafeState([]);
  const [dashboardSummary, setDashboardSummary] = useSafeState({ reservations: [] });

  const [quickAddData, setQuickAddData] = useSafeState({
    name: '',
    category: '',
    quantity_total: '1',
  });

  const [quickReserveData, setQuickReserveData] = useSafeState({
    equipment_id: '',
    reserved_quantity: '1',
    reserved_for: '',
    notes: '',
  });

  const [submitting, setSubmitting] = useSafeState(false);
  const toast = useToast();

  function getTodayISO() {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  useEffect(() => {
    loadData();
  }, [meetingDate]);

  const loadData = async () => {
    try {
      const [equipmentResult, reservationsResult, summaryResult] = await Promise.all([
        API.get('/v1/resources/equipment'),
        API.get('/v1/resources/equipment/reservations', { meeting_date: meetingDate }),
        API.get('/v1/resources/status/dashboard', { meeting_date: meetingDate }),
      ]);

      if (equipmentResult.success) {
        setEquipment(equipmentResult.data?.equipment || equipmentResult.equipment || []);
      }

      if (reservationsResult.success) {
        setReservations(reservationsResult.data?.reservations || reservationsResult.reservations || []);
      }

      if (summaryResult.success) {
        setDashboardSummary(summaryResult.data || summaryResult || { reservations: [] });
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

  const handleQuickAddEquipment = async () => {
    if (!quickAddData.name) {
      toast.show(t('fill_required_fields'), 'warning');
      return;
    }

    try {
      setSubmitting(true);

      const payload = {
        name: quickAddData.name.trim(),
        category: quickAddData.category?.trim() || null,
        quantity_total: parseInt(quickAddData.quantity_total, 10) || 1,
      };

      const result = await API.post('/v1/resources/equipment', payload);

      if (result.success) {
        toast.show(t('inventory_saved'), 'success');
        setQuickAddData({
          name: '',
          category: '',
          quantity_total: '1',
        });
        await loadData();
      } else {
        toast.show(result.message || t('error_saving_equipment'), 'error');
      }
    } catch (err) {
      debugError('Error adding equipment:', err);
      toast.show(err.message || t('error_saving_equipment'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleQuickReserve = async () => {
    if (!quickReserveData.equipment_id || !quickReserveData.reserved_for) {
      toast.show(t('fill_required_fields'), 'warning');
      return;
    }

    try {
      setSubmitting(true);

      const payload = {
        meeting_date: meetingDate,
        equipment_id: parseInt(quickReserveData.equipment_id, 10),
        reserved_quantity: parseInt(quickReserveData.reserved_quantity, 10) || 1,
        reserved_for: quickReserveData.reserved_for.trim(),
        notes: quickReserveData.notes?.trim() || '',
      };

      const result = await API.post('/v1/resources/equipment/reservations', payload);

      if (result.success) {
        toast.show(t('reservation_saved'), 'success');
        setQuickReserveData({
          equipment_id: '',
          reserved_quantity: '1',
          reserved_for: '',
          notes: '',
        });
        await loadData();
      } else {
        toast.show(result.message || t('error_saving_reservation'), 'error');
      }
    } catch (err) {
      debugError('Error saving reservation:', err);
      toast.show(err.message || t('error_saving_reservation'), 'error');
    } finally {
      setSubmitting(false);
    }
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
          <Text style={styles.title}>{t('resource_dashboard_title')}</Text>
          <Text style={styles.subtitle}>{t('resource_dashboard_description')}</Text>

          <FormField
            label={t('meeting_date_label')}
            value={meetingDate}
            onChangeText={setMeetingDate}
            placeholder="YYYY-MM-DD"
          />
        </Card>

        {/* Dashboard Summary */}
        <Card>
          <Text style={styles.sectionTitle}>{t('dashboard_summary_title')}</Text>

          <View style={styles.summarySection}>
            <Text style={styles.summaryLabel}>{t('equipment_reservations')}</Text>
            {dashboardSummary.reservations?.length === 0 ? (
              <Text style={styles.emptyText}>{t('no_data_available')}</Text>
            ) : (
              <View style={styles.summaryList}>
                {dashboardSummary.reservations?.map((row, index) => (
                  <Text key={index} style={styles.summaryItem}>
                    • {row.name} ({row.status}): <Text style={styles.bold}>{row.reserved_quantity}</Text>
                  </Text>
                ))}
              </View>
            )}
          </View>
        </Card>

        {/* Quick Add Equipment */}
        <Card>
          <Text style={styles.sectionTitle}>{t('equipment_inventory_title')}</Text>

          <FormField
            label={t('equipment_name')}
            value={quickAddData.name}
            onChangeText={(value) => setQuickAddData({ ...quickAddData, name: value })}
            placeholder={t('equipment_name')}
          />

          <View style={styles.row}>
            <View style={styles.halfWidth}>
              <FormField
                label={t('equipment_category')}
                value={quickAddData.category}
                onChangeText={(value) => setQuickAddData({ ...quickAddData, category: value })}
                placeholder={t('equipment_category')}
              />
            </View>
            <View style={styles.halfWidth}>
              <FormField
                label={t('equipment_quantity_total')}
                value={quickAddData.quantity_total}
                onChangeText={(value) =>
                  setQuickAddData({ ...quickAddData, quantity_total: value })
                }
                keyboardType="numeric"
                placeholder="1"
              />
            </View>
          </View>

          <TouchableOpacity
            style={[commonStyles.button, submitting && commonStyles.buttonDisabled]}
            onPress={handleQuickAddEquipment}
            disabled={submitting}
            activeOpacity={0.7}
          >
            <Text style={commonStyles.buttonText}>
              {submitting ? t('saving') : t('save_equipment')}
            </Text>
          </TouchableOpacity>

          {/* Equipment Table */}
          {equipment.length === 0 ? (
            <EmptyState
              icon="📦"
              message={t('no_data_available')}
              description={t('add_equipment_first')}
            />
          ) : (
            <View style={styles.equipmentList}>
              <Text style={styles.listTitle}>{t('current_equipment')}</Text>
              {equipment.map((item) => (
                <View key={item.id} style={styles.equipmentRow}>
                  <Text style={styles.equipmentName}>{item.name}</Text>
                  <View style={styles.equipmentDetails}>
                    <Text style={styles.equipmentDetail}>
                      {item.category || '-'}
                    </Text>
                    <Text style={styles.equipmentDetail}>
                      {t('equipment_quantity_total')}: {item.quantity_total ?? 0}
                    </Text>
                    <Text style={styles.equipmentDetail}>
                      {t('equipment_reserved')}: {item.reserved_quantity ?? 0}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          )}
        </Card>

        {/* Quick Reserve Equipment */}
        <Card>
          <Text style={styles.sectionTitle}>{t('reservation_section_title')}</Text>

          <View style={{ marginBottom: 16 }}>
            <Text style={commonStyles.inputLabel}>{t('equipment_label')}</Text>
            <Picker
              selectedValue={quickReserveData.equipment_id}
              onValueChange={(value) =>
                setQuickReserveData({ ...quickReserveData, equipment_id: value })
              }
              style={[commonStyles.input]}
            >
              <Picker.Item label={t('reservation_equipment_placeholder')} value="" />
              {equipment.map((item) => (
                <Picker.Item
                  key={item.id}
                  label={item.name}
                  value={String(item.id)}
                />
              ))}
            </Picker>
          </View>

          <View style={styles.row}>
            <View style={styles.halfWidth}>
              <FormField
                label={t('reserved_quantity')}
                value={quickReserveData.reserved_quantity}
                onChangeText={(value) =>
                  setQuickReserveData({ ...quickReserveData, reserved_quantity: value })
                }
                keyboardType="numeric"
                placeholder="1"
              />
            </View>
            <View style={styles.halfWidth}>
              <FormField
                label={t('reservation_for')}
                value={quickReserveData.reserved_for}
                onChangeText={(value) =>
                  setQuickReserveData({ ...quickReserveData, reserved_for: value })
                }
                placeholder={t('reservation_for')}
              />
            </View>
          </View>

          <FormField
            label={t('reservation_notes')}
            value={quickReserveData.notes}
            onChangeText={(value) =>
              setQuickReserveData({ ...quickReserveData, notes: value })
            }
            placeholder={t('reservation_notes')}
            multiline
            numberOfLines={2}
          />

          <TouchableOpacity
            style={[commonStyles.button, submitting && commonStyles.buttonDisabled]}
            onPress={handleQuickReserve}
            disabled={submitting}
            activeOpacity={0.7}
          >
            <Text style={commonStyles.buttonText}>
              {submitting ? t('saving') : t('reservation_save')}
            </Text>
          </TouchableOpacity>

          {/* Reservations Table */}
          {reservations.length === 0 ? (
            <EmptyState
              icon="📋"
              message={t('no_data_available')}
              description={t('no_reservations_yet')}
            />
          ) : (
            <View style={styles.reservationsList}>
              <Text style={styles.listTitle}>{t('current_reservations')}</Text>
              {reservations.map((reservation) => (
                <View key={reservation.id} style={styles.reservationRow}>
                  <Text style={styles.reservationEquipment}>
                    {reservation.equipment_name || '-'}
                  </Text>
                  <View style={styles.reservationDetails}>
                    <Text style={styles.reservationDetail}>
                      {t('meeting_date_label')}: {formatDate(reservation.meeting_date)}
                    </Text>
                    <Text style={styles.reservationDetail}>
                      {t('reserved_quantity')}: {reservation.reserved_quantity || 0}
                    </Text>
                    <Text style={styles.reservationDetail}>
                      {t('reservation_for')}: {reservation.reserved_for || '-'}
                    </Text>
                    <Text style={styles.reservationDetail}>
                      {t('reservation_status')}: {reservation.status}
                    </Text>
                  </View>
                </View>
              ))}
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
    marginBottom: theme.spacing.md,
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
  summarySection: {
    marginBottom: theme.spacing.md,
  },
  summaryLabel: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.text,
    marginBottom: theme.spacing.sm,
  },
  summaryList: {
    gap: theme.spacing.xs,
  },
  summaryItem: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
  },
  bold: {
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.text,
  },
  emptyText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.textMuted,
    textAlign: 'center',
    padding: theme.spacing.lg,
  },
  equipmentList: {
    marginTop: theme.spacing.lg,
  },
  listTitle: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.text,
    marginBottom: theme.spacing.md,
  },
  equipmentRow: {
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.borderLight,
    paddingVertical: theme.spacing.sm,
  },
  equipmentName: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.text,
    marginBottom: theme.spacing.xs,
  },
  equipmentDetails: {
    gap: theme.spacing.xs,
  },
  equipmentDetail: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
  },
  reservationsList: {
    marginTop: theme.spacing.lg,
  },
  reservationRow: {
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.borderLight,
    paddingVertical: theme.spacing.sm,
  },
  reservationEquipment: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.text,
    marginBottom: theme.spacing.xs,
  },
  reservationDetails: {
    gap: theme.spacing.xs,
  },
  reservationDetail: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
  },
});

export default ResourceDashboardScreen;