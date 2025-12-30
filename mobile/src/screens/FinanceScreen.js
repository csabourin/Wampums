/**
 * Finance Screen - Payment & Memberships
 *
 * Mirrors spa/finance.js functionality
 * Complete fee management, participant fees, payments, and payment plans
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
  TextInput,
  Modal,
  Alert,
  FlatList,
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import {
  getFeeDefinitions,
  getParticipantFees,
  getParticipants,
  getFinanceSummary,
  createFeeDefinition,
  updateFeeDefinition,
  deleteFeeDefinition,
  createParticipantFee,
  updateParticipantFee,
  getParticipantPayments,
  createParticipantPayment,
  updatePayment,
  getPaymentPlans,
  createPaymentPlan,
  updatePaymentPlan,
  deletePaymentPlan,
} from '../api/api-endpoints';
import { translate as t } from '../i18n';
import theme, { commonStyles } from '../theme';
import {
  LoadingSpinner,
  ErrorMessage,
  Card,
  Button,
} from '../components';
import { canManageFinance, canViewFinance } from '../utils/PermissionUtils';
import DateUtils from '../utils/DateUtils';
import SecurityUtils from '../utils/SecurityUtils';
import { debugError, debugLog } from '../utils/DebugUtils';

const DEFAULT_CURRENCY = 'CAD';

const FinanceScreen = ({ navigation }) => {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [feeDefinitions, setFeeDefinitions] = useState([]);
  const [participantFees, setParticipantFees] = useState([]);
  const [canManage, setCanManage] = useState(false);
  const [canView, setCanView] = useState(false);
  const [participants, setParticipants] = useState([]);
  const [financeSummary, setFinanceSummary] = useState(null);
  const [activeTab, setActiveTab] = useState('memberships');
  const [sortField, setSortField] = useState('name');
  const [sortDirection, setSortDirection] = useState('asc');

  // Fee Definition modal
  const [feeDefModalVisible, setFeeDefModalVisible] = useState(false);
  const [editingFeeDef, setEditingFeeDef] = useState(null);
  const [feeDefForm, setFeeDefForm] = useState({
    year_start: '',
    year_end: '',
    registration_fee: '',
    membership_fee: '',
  });

  // Participant fee modal
  const [participantFeeModalVisible, setParticipantFeeModalVisible] = useState(false);
  const [editingParticipantFee, setEditingParticipantFee] = useState(null);
  const [participantFeeForm, setParticipantFeeForm] = useState({
    participant_id: '',
    fee_definition_id: '',
    total_registration_fee: '',
    total_membership_fee: '',
    notes: '',
    enable_plan: false,
    plan_number_of_payments: '',
    plan_amount_per_payment: '',
    plan_start_date: DateUtils.formatDate(new Date()),
    plan_frequency: 'monthly',
    plan_notes: '',
  });

  // Payment modal
  const [paymentModalVisible, setPaymentModalVisible] = useState(false);
  const [selectedParticipantFee, setSelectedParticipantFee] = useState(null);
  const [paymentRows, setPaymentRows] = useState([
    { amount: '', date: DateUtils.formatDate(new Date()), method: 'cash', reference: '' }
  ]);

  // Plan modal
  const [planModalVisible, setPlanModalVisible] = useState(false);
  const [selectedPlanFee, setSelectedPlanFee] = useState(null);
  const [existingPlan, setExistingPlan] = useState(null);
  const [planForm, setPlanForm] = useState({
    number_of_payments: '',
    amount_per_payment: '',
    start_date: DateUtils.formatDate(new Date()),
    frequency: 'monthly',
    notes: '',
  });

  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const checkPermissionAndLoad = async () => {
      const hasView = await canViewFinance();
      const hasManage = await canManageFinance();
      
      if (!hasView) {
        navigation.goBack();
        return;
      }

      setCanView(hasView);
      setCanManage(hasManage);
      await loadData();
    };

    checkPermissionAndLoad();
  }, [navigation]);

  const loadData = async (forceRefresh = false) => {
    try {
      setError('');

      const [feesResponse, feeDefsResponse, participantsResponse, summaryResponse] =
        await Promise.all([
          getParticipantFees({ forceRefresh }),
          getFeeDefinitions({ forceRefresh }),
          getParticipants(),
          getFinanceSummary(),
        ]);

      setParticipantFees(feesResponse?.data || feesResponse?.participant_fees || []);
      setFeeDefinitions(feeDefsResponse?.data || feeDefsResponse?.fee_definitions || []);
      setParticipants(participantsResponse?.data || participantsResponse?.participants || []);
      setFinanceSummary(summaryResponse?.data || null);
    } catch (err) {
      debugError('Error loading finance data:', err);
      setError(err.message || t('error_loading_data'));
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData(true);
    setRefreshing(false);
  };

  const formatCurrency = (amount) => {
    const value = Number(amount) || 0;
    return new Intl.NumberFormat('en', {
      style: 'currency',
      currency: DEFAULT_CURRENCY,
      maximumFractionDigits: 2,
    }).format(value);
  };

  const extractYear = (dateValue) => {
    if (!dateValue) return null;
    const parsedDate = new Date(dateValue);
    if (!Number.isNaN(parsedDate.getTime())) {
      return parsedDate.getFullYear();
    }
    const match = String(dateValue).match(/\d{4}/);
    return match ? Number(match[0]) : null;
  };

  const formatYearRange = (start, end) => {
    const startYear = extractYear(start);
    const endYear = extractYear(end);

    if (startYear && endYear) {
      return `${startYear} - ${endYear}`;
    }
    if (startYear || endYear) {
      return String(startYear || endYear);
    }
    return t('unknown');
  };

  const getOutstanding = (fee) => {
    if (!fee) return 0;
    const totalAmount = Number(fee.total_amount) || 0;
    const totalPaid = Number(fee.total_paid) || 0;
    return Math.max(totalAmount - totalPaid, 0);
  };

  const getDefaultFeeDefinitionId = () => {
    const today = new Date(DateUtils.formatDate(new Date(), 'en', 'YYYY-MM-DD'));
    const active = feeDefinitions.find((def) => {
      const start = new Date(def.year_start);
      const end = new Date(def.year_end);
      return start <= today && today <= end;
    });
    return active ? String(active.id) : '';
  };

  const getSortedFeeDefinitions = () => {
    return [...feeDefinitions].sort((a, b) => {
      const bYear = extractYear(b.year_end || b.year_start) || -Infinity;
      const aYear = extractYear(a.year_end || a.year_start) || -Infinity;
      return bYear - aYear;
    });
  };

  // Handle Fee Definition operations
  const handleAddFeeDef = () => {
    setEditingFeeDef(null);
    setFeeDefForm({
      year_start: '',
      year_end: '',
      registration_fee: '',
      membership_fee: '',
    });
    setFeeDefModalVisible(true);
  };

  const handleEditFeeDef = (feeDef) => {
    setEditingFeeDef(feeDef);
    setFeeDefForm({
      year_start: feeDef.year_start?.split('T')[0] || feeDef.year_start || '',
      year_end: feeDef.year_end?.split('T')[0] || feeDef.year_end || '',
      registration_fee: String(feeDef.registration_fee || ''),
      membership_fee: String(feeDef.membership_fee || ''),
    });
    setFeeDefModalVisible(true);
  };

  const handleSaveFeeDef = async () => {
    if (!feeDefForm.year_start || !feeDefForm.year_end || !feeDefForm.registration_fee || !feeDefForm.membership_fee) {
      Alert.alert(t('error'), t('fill_required_fields'));
      return;
    }

    try {
      setSaving(true);

      const payload = {
        year_start: feeDefForm.year_start,
        year_end: feeDefForm.year_end,
        registration_fee: Number(feeDefForm.registration_fee),
        membership_fee: Number(feeDefForm.membership_fee),
      };

      let result;
      if (editingFeeDef) {
        result = await updateFeeDefinition(editingFeeDef.id, payload);
      } else {
        result = await createFeeDefinition(payload);
      }

      if (result.success) {
        Alert.alert(t('success'), editingFeeDef ? t('updated') : t('created'));
        setFeeDefModalVisible(false);
        await loadData(true);
      } else {
        throw new Error(result.message || t('error_saving_changes'));
      }
    } catch (err) {
      debugError('Error saving fee definition:', err);
      Alert.alert(t('error'), err.message || t('error_saving_changes'));
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteFeeDef = (feeDef) => {
    Alert.alert(t('confirm_delete'), formatYearRange(feeDef.year_start, feeDef.year_end), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            setSaving(true);
            const result = await deleteFeeDefinition(feeDef.id);
            if (result.success) {
              Alert.alert(t('success'), t('deleted'));
              await loadData(true);
            }
          } catch (err) {
            debugError('Error deleting fee definition:', err);
            Alert.alert(t('error'), t('error_deleting'));
          } finally {
            setSaving(false);
          }
        },
      },
    ]);
  };

  // Handle Participant Fee operations
  const handleAddParticipantFee = () => {
    setEditingParticipantFee(null);
    setParticipantFeeForm({
      participant_id: '',
      fee_definition_id: getDefaultFeeDefinitionId(),
      total_registration_fee: '',
      total_membership_fee: '',
      notes: '',
      enable_plan: false,
      plan_number_of_payments: '',
      plan_amount_per_payment: '',
      plan_start_date: DateUtils.formatDate(new Date()),
      plan_frequency: 'monthly',
      plan_notes: '',
    });
    setParticipantFeeModalVisible(true);
  };

  const handleEditParticipantFee = (fee) => {
    setEditingParticipantFee(fee);
    setParticipantFeeForm({
      participant_id: String(fee.participant_id || ''),
      fee_definition_id: String(fee.fee_definition_id || ''),
      total_registration_fee: String(fee.total_registration_fee || ''),
      total_membership_fee: String(fee.total_membership_fee || ''),
      notes: fee.notes || '',
      enable_plan: false,
      plan_number_of_payments: '',
      plan_amount_per_payment: '',
      plan_start_date: DateUtils.formatDate(new Date()),
      plan_frequency: 'monthly',
      plan_notes: '',
    });
    setParticipantFeeModalVisible(true);
  };

  const handleSaveParticipantFee = async () => {
    if (!participantFeeForm.participant_id || !participantFeeForm.fee_definition_id || 
        !participantFeeForm.total_registration_fee || !participantFeeForm.total_membership_fee) {
      Alert.alert(t('error'), t('fill_required_fields'));
      return;
    }

    try {
      setSaving(true);

      const payload = {
        participant_id: Number(participantFeeForm.participant_id),
        fee_definition_id: Number(participantFeeForm.fee_definition_id),
        total_registration_fee: Number(participantFeeForm.total_registration_fee),
        total_membership_fee: Number(participantFeeForm.total_membership_fee),
        notes: SecurityUtils.sanitizeInput(participantFeeForm.notes),
      };

      let result;
      if (editingParticipantFee) {
        result = await updateParticipantFee(editingParticipantFee.id, payload);
      } else {
        result = await createParticipantFee(payload);
      }

      if (!result.success) {
        throw new Error(result.message || t('error_saving_changes'));
      }

      // Create payment plan if enabled
      if (participantFeeForm.enable_plan && !editingParticipantFee) {
        const planPayload = {
          participant_fee_id: result.data?.id || editingParticipantFee?.id,
          number_of_payments: Number(participantFeeForm.plan_number_of_payments),
          amount_per_payment: Number(participantFeeForm.plan_amount_per_payment),
          start_date: participantFeeForm.plan_start_date,
          frequency: participantFeeForm.plan_frequency,
          notes: SecurityUtils.sanitizeInput(participantFeeForm.plan_notes),
        };
        await createPaymentPlan(planPayload.participant_fee_id, planPayload);
      }

      Alert.alert(t('success'), editingParticipantFee ? t('updated') : t('created'));
      setParticipantFeeModalVisible(false);
      await loadData(true);
    } catch (err) {
      debugError('Error saving participant fee:', err);
      Alert.alert(t('error'), err.message || t('error_saving_changes'));
    } finally {
      setSaving(false);
    }
  };

  const handleOpenPaymentModal = (fee) => {
    setSelectedParticipantFee(fee);
    setPaymentRows([
      { amount: '', date: DateUtils.formatDate(new Date()), method: 'cash', reference: '' }
    ]);
    setPaymentModalVisible(true);
  };

  const handleSavePayment = async () => {
    const validRows = paymentRows.filter(r => r.amount && Number(r.amount) > 0);
    if (validRows.length === 0) {
      Alert.alert(t('error'), t('enter_valid_amount'));
      return;
    }

    try {
      setSaving(true);

      for (const row of validRows) {
        const payload = {
          participant_fee_id: selectedParticipantFee.id,
          amount: Number(row.amount),
          payment_date: row.date,
          payment_method: row.method,
          reference_number: row.reference || '',
        };
        const result = await createParticipantPayment(selectedParticipantFee.id, payload);
        if (!result.success) {
          throw new Error(result.message || t('error_recording_payment'));
        }
      }

      Alert.alert(t('success'), t('payment_recorded_successfully'));
      setPaymentModalVisible(false);
      await loadData(true);
    } catch (err) {
      debugError('Error saving payment:', err);
      Alert.alert(t('error'), err.message || t('error_recording_payment'));
    } finally {
      setSaving(false);
    }
  };

  const handleOpenPlanModal = async (fee) => {
    setSelectedPlanFee(fee);
    try {
      const plans = await getPaymentPlans(fee.id);
      const plan = plans.data?.[0] || null;
      setExistingPlan(plan);
      setPlanForm({
        number_of_payments: String(plan?.number_of_payments || ''),
        amount_per_payment: String(plan?.amount_per_payment || ''),
        start_date: plan?.start_date?.split('T')[0] || DateUtils.formatDate(new Date()),
        frequency: plan?.frequency || 'monthly',
        notes: plan?.notes || '',
      });
    } catch (err) {
      debugError('Error loading plan:', err);
    }
    setPlanModalVisible(true);
  };

  const handleSavePlan = async () => {
    if (!planForm.number_of_payments || !planForm.amount_per_payment) {
      Alert.alert(t('error'), t('fill_required_fields'));
      return;
    }

    try {
      setSaving(true);

      const payload = {
        number_of_payments: Number(planForm.number_of_payments),
        amount_per_payment: Number(planForm.amount_per_payment),
        start_date: planForm.start_date,
        frequency: planForm.frequency,
        notes: SecurityUtils.sanitizeInput(planForm.notes),
      };

      let result;
      if (existingPlan) {
        result = await updatePaymentPlan(existingPlan.id, payload);
      } else {
        result = await createPaymentPlan(selectedPlanFee.id, payload);
      }

      if (!result.success) {
        throw new Error(result.message || t('error_saving_changes'));
      }

      Alert.alert(t('success'), existingPlan ? t('updated') : t('created'));
      setPlanModalVisible(false);
      await loadData(true);
    } catch (err) {
      debugError('Error saving plan:', err);
      Alert.alert(t('error'), err.message || t('error_saving_changes'));
    } finally {
      setSaving(false);
    }
  };

  const handleDeletePlan = () => {
    Alert.alert(t('confirm_delete'), t('delete_payment_plan'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            setSaving(true);
            const result = await deletePaymentPlan(existingPlan.id);
            if (result.success) {
              Alert.alert(t('success'), t('deleted'));
              setPlanModalVisible(false);
              await loadData(true);
            }
          } catch (err) {
            debugError('Error deleting plan:', err);
            Alert.alert(t('error'), t('error_deleting'));
          } finally {
            setSaving(false);
          }
        },
      },
    ]);
  };

  const getSortedParticipantFees = () => {
    const fees = [...participantFees];
    fees.sort((a, b) => {
      let valA, valB;

      switch (sortField) {
        case 'name':
          const participantA = participants.find(p => p.id === a.participant_id);
          const participantB = participants.find(p => p.id === b.participant_id);
          valA = `${participantA?.first_name || ''} ${participantA?.last_name || ''}`.toLowerCase();
          valB = `${participantB?.first_name || ''} ${participantB?.last_name || ''}`.toLowerCase();
          break;
        case 'outstanding':
          valA = getOutstanding(a);
          valB = getOutstanding(b);
          break;
        case 'total':
          valA = Number(a.total_amount) || 0;
          valB = Number(b.total_amount) || 0;
          break;
        case 'paid':
          valA = Number(a.total_paid) || 0;
          valB = Number(b.total_paid) || 0;
          break;
        default:
          return 0;
      }

      if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
      if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
    return fees;
  };

  if (loading && !refreshing) {
    return <LoadingSpinner message={t('loading')} />;
  }

  if (error && !loading) {
    return <ErrorMessage message={error} onRetry={loadData} />;
  }

  const summary = financeSummary || {};
  const sortedFees = getSortedParticipantFees();

  return (
    <View style={commonStyles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContainer}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Summary Stats */}
        <View style={styles.summaryRow}>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>{t('total_billed')}</Text>
            <Text style={styles.summaryValue}>{formatCurrency(summary.total_billed)}</Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>{t('total_paid')}</Text>
            <Text style={styles.summaryValue}>{formatCurrency(summary.total_paid)}</Text>
          </View>
          <View style={[styles.summaryCard, styles.summaryCardAlert]}>
            <Text style={styles.summaryLabel}>{t('outstanding_balance')}</Text>
            <Text style={[styles.summaryValue, styles.summaryValueAlert]}>
              {formatCurrency(summary.total_outstanding)}
            </Text>
          </View>
        </View>

        {/* Fee Definitions Section */}
        {canManage && (
          <Card style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.sectionTitle}>{t('fee_definitions')}</Text>
              <Button title={`+ ${t('add')}`} onPress={handleAddFeeDef} size="small" />
            </View>
            {getSortedFeeDefinitions().length === 0 ? (
              <Text style={styles.noDataText}>{t('no_definitions')}</Text>
            ) : (
              getSortedFeeDefinitions().map((def) => (
                <View key={def.id} style={styles.feeDefItem}>
                  <View style={styles.feeDefContent}>
                    <Text style={styles.feeDefTitle}>{formatYearRange(def.year_start, def.year_end)}</Text>
                    <Text style={styles.feeDefPill}>
                      {formatCurrency(def.registration_fee)} / {formatCurrency(def.membership_fee)}
                    </Text>
                  </View>
                  <View style={styles.feeDefActions}>
                    <TouchableOpacity
                      onPress={() => handleEditFeeDef(def)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.actionButton}>✏️</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => handleDeleteFeeDef(def)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.actionButton}>🗑️</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))
            )}
          </Card>
        )}

        {/* Participant Fees Section */}
        <Card style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.sectionTitle}>{t('participant_fees')}</Text>
            {canManage && <Button title={`+ ${t('add')}`} onPress={handleAddParticipantFee} size="small" />}
          </View>

          {/* Sort Buttons */}
          <View style={styles.sortRow}>
            {['name', 'total', 'paid', 'outstanding'].map((field) => (
              <TouchableOpacity
                key={field}
                style={[styles.sortButton, sortField === field && styles.sortButtonActive]}
                onPress={() => {
                  if (sortField === field) {
                    setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
                  } else {
                    setSortField(field);
                    setSortDirection('asc');
                  }
                }}
                activeOpacity={0.7}
              >
                <Text style={[styles.sortButtonText, sortField === field && styles.sortButtonTextActive]}>
                  {t(field)} {sortField === field && (sortDirection === 'asc' ? '▲' : '▼')}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {sortedFees.length === 0 ? (
            <Text style={styles.noDataText}>{t('no_participant_fees')}</Text>
          ) : (
            sortedFees.map((fee) => {
              const participant = participants.find(p => p.id === fee.participant_id);
              const outstanding = getOutstanding(fee);
              return (
                <View key={fee.id} style={styles.feeRow}>
                  <View style={styles.feeInfo}>
                    <Text style={styles.feeName}>
                      {participant?.first_name} {participant?.last_name}
                    </Text>
                    <View style={styles.feeStats}>
                      <Text style={styles.feeStat}>{t('total')}: {formatCurrency(fee.total_amount)}</Text>
                      <Text style={styles.feeStat}>{t('paid')}: {formatCurrency(fee.total_paid)}</Text>
                      <Text style={[styles.feeStat, outstanding > 0 && styles.feeStatAlert]}>
                        {t('outstanding')}: {formatCurrency(outstanding)}
                      </Text>
                    </View>
                  </View>
                  {canManage && (
                    <View style={styles.feeActions}>
                      {outstanding > 0 && (
                        <TouchableOpacity
                          style={styles.feeButton}
                          onPress={() => handleOpenPaymentModal(fee)}
                          activeOpacity={0.7}
                        >
                          <Text style={styles.feeButtonText}>💳 {t('payment')}</Text>
                        </TouchableOpacity>
                      )}
                      <TouchableOpacity
                        style={styles.feeButton}
                        onPress={() => handleOpenPlanModal(fee)}
                        activeOpacity={0.7}
                      >
                        <Text style={styles.feeButtonText}>📋 {t('plan')}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.feeButton}
                        onPress={() => handleEditParticipantFee(fee)}
                        activeOpacity={0.7}
                      >
                        <Text style={styles.feeButtonText}>✏️</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              );
            })
          )}
        </Card>
      </ScrollView>

      {/* Fee Definition Modal */}
      <Modal visible={feeDefModalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {editingFeeDef ? t('edit_fee_definition') : t('add_fee_definition')}
              </Text>
              <TouchableOpacity onPress={() => setFeeDefModalVisible(false)}>
                <Text style={styles.closeButton}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody}>
              <Text style={styles.label}>{t('year_start')}</Text>
              <TextInput
                style={styles.input}
                placeholder="YYYY-MM-DD"
                value={feeDefForm.year_start}
                onChangeText={(val) => setFeeDefForm({...feeDefForm, year_start: val})}
              />

              <Text style={styles.label}>{t('year_end')}</Text>
              <TextInput
                style={styles.input}
                placeholder="YYYY-MM-DD"
                value={feeDefForm.year_end}
                onChangeText={(val) => setFeeDefForm({...feeDefForm, year_end: val})}
              />

              <Text style={styles.label}>{t('registration_fee_label')}</Text>
              <TextInput
                style={styles.input}
                placeholder="0.00"
                keyboardType="decimal-pad"
                value={feeDefForm.registration_fee}
                onChangeText={(val) => setFeeDefForm({...feeDefForm, registration_fee: val})}
              />

              <Text style={styles.label}>{t('membership_fee_label')}</Text>
              <TextInput
                style={styles.input}
                placeholder="0.00"
                keyboardType="decimal-pad"
                value={feeDefForm.membership_fee}
                onChangeText={(val) => setFeeDefForm({...feeDefForm, membership_fee: val})}
              />
            </ScrollView>

            <View style={styles.modalFooter}>
              <Button
                title={t('cancel')}
                onPress={() => setFeeDefModalVisible(false)}
                variant="secondary"
              />
              <Button
                title={saving ? t('saving') : t('save')}
                onPress={handleSaveFeeDef}
                disabled={saving}
              />
            </View>
          </View>
        </View>
      </Modal>

      {/* Participant Fee Modal */}
      <Modal visible={participantFeeModalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t('assign_membership_fee')}</Text>
              <TouchableOpacity onPress={() => setParticipantFeeModalVisible(false)}>
                <Text style={styles.closeButton}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody}>
              <Text style={styles.label}>{t('select_participant')}</Text>
              <View style={styles.pickerContainer}>
                <Picker
                  selectedValue={participantFeeForm.participant_id}
                  onValueChange={(val) => setParticipantFeeForm({...participantFeeForm, participant_id: val})}
                >
                  <Picker.Item label={t('select_participant')} value="" />
                  {participants.map((p) => (
                    <Picker.Item
                      key={p.id}
                      label={`${p.first_name} ${p.last_name}`}
                      value={String(p.id)}
                    />
                  ))}
                </Picker>
              </View>

              <Text style={styles.label}>{t('select_fee_definition')}</Text>
              <View style={styles.pickerContainer}>
                <Picker
                  selectedValue={participantFeeForm.fee_definition_id}
                  onValueChange={(val) => setParticipantFeeForm({...participantFeeForm, fee_definition_id: val})}
                >
                  <Picker.Item label={t('select_fee_definition')} value="" />
                  {getSortedFeeDefinitions().map((def) => (
                    <Picker.Item
                      key={def.id}
                      label={formatYearRange(def.year_start, def.year_end)}
                      value={String(def.id)}
                    />
                  ))}
                </Picker>
              </View>

              <Text style={styles.label}>{t('registration_fee_label')}</Text>
              <TextInput
                style={styles.input}
                placeholder="0.00"
                keyboardType="decimal-pad"
                value={participantFeeForm.total_registration_fee}
                onChangeText={(val) => setParticipantFeeForm({...participantFeeForm, total_registration_fee: val})}
              />

              <Text style={styles.label}>{t('membership_fee_label')}</Text>
              <TextInput
                style={styles.input}
                placeholder="0.00"
                keyboardType="decimal-pad"
                value={participantFeeForm.total_membership_fee}
                onChangeText={(val) => setParticipantFeeForm({...participantFeeForm, total_membership_fee: val})}
              />

              <Text style={styles.label}>{t('notes')}</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                placeholder={t('notes')}
                multiline
                numberOfLines={3}
                value={participantFeeForm.notes}
                onChangeText={(val) => setParticipantFeeForm({...participantFeeForm, notes: val})}
              />
            </ScrollView>

            <View style={styles.modalFooter}>
              <Button
                title={t('cancel')}
                onPress={() => setParticipantFeeModalVisible(false)}
                variant="secondary"
              />
              <Button
                title={saving ? t('saving') : t('save')}
                onPress={handleSaveParticipantFee}
                disabled={saving}
              />
            </View>
          </View>
        </View>
      </Modal>

      {/* Payment Modal */}
      <Modal visible={paymentModalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t('record_payment')}</Text>
              <TouchableOpacity onPress={() => setPaymentModalVisible(false)}>
                <Text style={styles.closeButton}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody}>
              {selectedParticipantFee && (
                <>
                  <Text style={styles.infoLabel}>{t('outstanding')}: {formatCurrency(getOutstanding(selectedParticipantFee))}</Text>

                  {paymentRows.map((row, idx) => (
                    <View key={idx} style={styles.paymentRow}>
                      <Text style={styles.rowTitle}>{t('payment')} {idx + 1}</Text>
                      
                      <Text style={styles.label}>{t('amount')}</Text>
                      <TextInput
                        style={styles.input}
                        placeholder="0.00"
                        keyboardType="decimal-pad"
                        value={row.amount}
                        onChangeText={(val) => {
                          const newRows = [...paymentRows];
                          newRows[idx].amount = val;
                          setPaymentRows(newRows);
                        }}
                      />

                      <Text style={styles.label}>{t('payment_date')}</Text>
                      <TextInput
                        style={styles.input}
                        placeholder="YYYY-MM-DD"
                        value={row.date}
                        onChangeText={(val) => {
                          const newRows = [...paymentRows];
                          newRows[idx].date = val;
                          setPaymentRows(newRows);
                        }}
                      />

                      <Text style={styles.label}>{t('payment_method')}</Text>
                      <View style={styles.pickerContainer}>
                        <Picker
                          selectedValue={row.method}
                          onValueChange={(val) => {
                            const newRows = [...paymentRows];
                            newRows[idx].method = val;
                            setPaymentRows(newRows);
                          }}
                        >
                          <Picker.Item label={t('cash')} value="cash" />
                          <Picker.Item label={t('card')} value="card" />
                          <Picker.Item label={t('etransfer')} value="etransfer" />
                          <Picker.Item label={t('cheque')} value="cheque" />
                        </Picker>
                      </View>

                      <Text style={styles.label}>{t('reference_number')}</Text>
                      <TextInput
                        style={styles.input}
                        placeholder={t('optional')}
                        value={row.reference}
                        onChangeText={(val) => {
                          const newRows = [...paymentRows];
                          newRows[idx].reference = val;
                          setPaymentRows(newRows);
                        }}
                      />
                    </View>
                  ))}

                  <Button
                    title={t('add_payment_row')}
                    onPress={() => setPaymentRows([...paymentRows, { amount: '', date: DateUtils.formatDate(new Date()), method: 'cash', reference: '' }])}
                    variant="secondary"
                  />
                </>
              )}
            </ScrollView>

            <View style={styles.modalFooter}>
              <Button
                title={t('cancel')}
                onPress={() => setPaymentModalVisible(false)}
                variant="secondary"
              />
              <Button
                title={saving ? t('saving') : t('save')}
                onPress={handleSavePayment}
                disabled={saving}
              />
            </View>
          </View>
        </View>
      </Modal>

      {/* Plan Modal */}
      <Modal visible={planModalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t('manage_installments')}</Text>
              <TouchableOpacity onPress={() => setPlanModalVisible(false)}>
                <Text style={styles.closeButton}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody}>
              <Text style={styles.label}>{t('number_of_payments')}</Text>
              <TextInput
                style={styles.input}
                placeholder="1"
                keyboardType="number-pad"
                value={planForm.number_of_payments}
                onChangeText={(val) => setPlanForm({...planForm, number_of_payments: val})}
              />

              <Text style={styles.label}>{t('amount_per_payment')}</Text>
              <TextInput
                style={styles.input}
                placeholder="0.00"
                keyboardType="decimal-pad"
                value={planForm.amount_per_payment}
                onChangeText={(val) => setPlanForm({...planForm, amount_per_payment: val})}
              />

              <Text style={styles.label}>{t('start_date')}</Text>
              <TextInput
                style={styles.input}
                placeholder="YYYY-MM-DD"
                value={planForm.start_date}
                onChangeText={(val) => setPlanForm({...planForm, start_date: val})}
              />

              <Text style={styles.label}>{t('frequency')}</Text>
              <View style={styles.pickerContainer}>
                <Picker
                  selectedValue={planForm.frequency}
                  onValueChange={(val) => setPlanForm({...planForm, frequency: val})}
                >
                  <Picker.Item label={t('monthly')} value="monthly" />
                  <Picker.Item label={t('biweekly')} value="biweekly" />
                  <Picker.Item label={t('weekly')} value="weekly" />
                </Picker>
              </View>

              <Text style={styles.label}>{t('notes')}</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                placeholder={t('notes')}
                multiline
                numberOfLines={3}
                value={planForm.notes}
                onChangeText={(val) => setPlanForm({...planForm, notes: val})}
              />
            </ScrollView>

            <View style={styles.modalFooter}>
              {existingPlan && (
                <Button
                  title={t('delete')}
                  onPress={handleDeletePlan}
                  variant="danger"
                />
              )}
              <Button
                title={t('cancel')}
                onPress={() => setPlanModalVisible(false)}
                variant="secondary"
              />
              <Button
                title={saving ? t('saving') : t('save')}
                onPress={handleSavePlan}
                disabled={saving}
              />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  scrollContainer: {
    padding: theme.spacing.md,
  },
  summaryRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.md,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: theme.colors.surfaceVariant,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.md,
    alignItems: 'center',
  },
  summaryCardAlert: {
    backgroundColor: theme.colors.errorLight,
  },
  summaryLabel: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textMuted,
    marginBottom: theme.spacing.xs,
  },
  summaryValue: {
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.text,
  },
  summaryValueAlert: {
    color: theme.colors.error,
  },
  card: {
    marginBottom: theme.spacing.md,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.md,
  },
  sectionTitle: {
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.primary,
  },
  feeDefItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  feeDefContent: {
    flex: 1,
  },
  feeDefTitle: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.text,
  },
  feeDefPill: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
    marginTop: theme.spacing.xs,
  },
  feeDefActions: {
    flexDirection: 'row',
    gap: theme.spacing.md,
  },
  actionButton: {
    fontSize: theme.fontSize.lg,
    padding: theme.spacing.sm,
  },
  sortRow: {
    flexDirection: 'row',
    gap: theme.spacing.xs,
    marginBottom: theme.spacing.md,
    flexWrap: 'wrap',
  },
  sortButton: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.borderRadius.sm,
    backgroundColor: theme.colors.surfaceVariant,
  },
  sortButtonActive: {
    backgroundColor: theme.colors.primary,
  },
  sortButtonText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textMuted,
  },
  sortButtonTextActive: {
    color: theme.colors.selectedText,
    fontWeight: theme.fontWeight.semibold,
  },
  feeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  feeInfo: {
    flex: 1,
  },
  feeName: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.text,
    marginBottom: theme.spacing.xs,
  },
  feeStats: {
    gap: theme.spacing.xs,
  },
  feeStat: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textMuted,
  },
  feeStatAlert: {
    color: theme.colors.error,
    fontWeight: theme.fontWeight.semibold,
  },
  feeActions: {
    flexDirection: 'row',
    gap: theme.spacing.xs,
    marginLeft: theme.spacing.md,
  },
  feeButton: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
    backgroundColor: theme.colors.primary,
    borderRadius: theme.borderRadius.sm,
    minHeight: theme.touchTarget.min,
    justifyContent: 'center',
  },
  feeButtonText: {
    color: theme.colors.selectedText,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.semibold,
  },
  noDataText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.textMuted,
    textAlign: 'center',
    fontStyle: 'italic',
    paddingVertical: theme.spacing.lg,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: theme.colors.surface,
    borderTopLeftRadius: theme.borderRadius.lg,
    borderTopRightRadius: theme.borderRadius.lg,
    maxHeight: '90%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  modalTitle: {
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.text,
  },
  closeButton: {
    fontSize: theme.fontSize.xl,
    color: theme.colors.textMuted,
  },
  modalBody: {
    padding: theme.spacing.md,
    maxHeight: '70%',
  },
  modalFooter: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    justifyContent: 'flex-end',
    padding: theme.spacing.md,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  label: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.text,
    marginBottom: theme.spacing.xs,
    marginTop: theme.spacing.md,
  },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.sm,
    padding: theme.spacing.md,
    fontSize: theme.fontSize.base,
    color: theme.colors.text,
  },
  textArea: {
    textAlignVertical: 'top',
  },
  pickerContainer: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.sm,
    overflow: 'hidden',
  },
  paymentRow: {
    marginVertical: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  rowTitle: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.primary,
    marginBottom: theme.spacing.md,
  },
  infoLabel: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.text,
    marginBottom: theme.spacing.md,
  },
});

export default FinanceScreen;
