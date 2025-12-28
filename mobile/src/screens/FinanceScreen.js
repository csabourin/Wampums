/**
 * Finance Screen
 *
 * Mirrors spa/finance.js functionality
 * Main finance management: fee definitions, participant fees, payments
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
} from 'react-native';
import {
  getFeeDefinitions,
  getParticipantFees,
  getParticipants,
  getFinanceReport,
  createFeeDefinition,
  updateFeeDefinition,
  deleteFeeDefinition,
  createParticipantFee,
  updateParticipantFee,
  createParticipantPayment,
} from '../api/api-endpoints';
import { translate as t } from '../i18n';
import theme, { commonStyles } from '../theme';
import {
  LoadingSpinner,
  ErrorMessage,
  Card,
  FormField,
  Select,
  Modal,
  ConfirmModal,
  Toast,
  useToast,
  Table,
  TableRow,
  TableHeader,
  TableCell,
  TableHeaderCell,
  StatCard,
  EmptyState,
} from '../components';
import { canManageFinance, canViewFinance } from '../utils/PermissionUtils';
import DateUtils from '../utils/DateUtils';
import SecurityUtils from '../utils/SecurityUtils';

const DEFAULT_CURRENCY = 'CAD';

const FinanceScreen = ({ navigation }) => {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [feeDefinitions, setFeeDefinitions] = useState([]);
  const [participantFees, setParticipantFees] = useState([]);
  const [canManage, setCanManage] = useState(false);
  const [participants, setParticipants] = useState([]);
  const [financeSummary, setFinanceSummary] = useState(null);
  const [activeTab, setActiveTab] = useState('memberships');
  const [sortField, setSortField] = useState('name');
  const [sortDirection, setSortDirection] = useState('asc');

  // Fee Definition modal
  const [feeDefModalVisible, setFeeDefModalVisible] = useState(false);
  const [editingFeeDef, setEditingFeeDef] = useState(null);
  const [feeDefForm, setFeeDefForm] = useState({
    name: '',
    description: '',
    default_amount: '',
    fee_type: 'membership',
    is_active: true,
  });

  // Payment modal
  const [paymentModalVisible, setPaymentModalVisible] = useState(false);
  const [selectedParticipantFee, setSelectedParticipantFee] = useState(null);
  const [paymentAmount, setPaymentAmount] = useState('');

  const [saving, setSaving] = useState(false);
  const toast = useToast();

  useEffect(() => {
    // Check permission and load data
    const checkPermissionAndLoad = async () => {
      const hasPermission = await canViewFinance();
      if (!hasPermission) {
        navigation.goBack();
        return;
      }

      const hasManagePermission = await canManageFinance();
      setCanManage(hasManagePermission);

      loadData();
    };

    checkPermissionAndLoad();
  }, []);

  const loadData = async (forceRefresh = false) => {
    try {
      setError('');

      const [feesResponse, feeDefsResponse, participantsResponse, summaryResponse] =
        await Promise.all([
          getParticipantFees({ forceRefresh }),
          getFeeDefinitions({ forceRefresh }),
          getParticipants(),
          getFinanceReport({ forceRefresh }),
        ]);

      setParticipantFees(feesResponse?.data || feesResponse?.participant_fees || []);
      setFeeDefinitions(feeDefsResponse?.data || feeDefsResponse?.fee_definitions || []);
      setParticipants(participantsResponse?.data || participantsResponse?.participants || []);
      setFinanceSummary(summaryResponse?.data || null);
    } catch (err) {
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

  const getOutstanding = (fee) => {
    if (!fee) return 0;
    const totalAmount = Number(fee.total_amount) || 0;
    const totalPaid = Number(fee.total_paid) || 0;
    return Math.max(totalAmount - totalPaid, 0);
  };

  const handleAddFeeDef = () => {
    setEditingFeeDef(null);
    setFeeDefForm({
      name: '',
      description: '',
      default_amount: '',
      fee_type: activeTab,
      is_active: true,
    });
    setFeeDefModalVisible(true);
  };

  const handleEditFeeDef = (feeDef) => {
    setEditingFeeDef(feeDef);
    setFeeDefForm({
      name: feeDef.name || '',
      description: feeDef.description || '',
      default_amount: String(feeDef.default_amount || ''),
      fee_type: feeDef.fee_type || activeTab,
      is_active: feeDef.is_active !== false,
    });
    setFeeDefModalVisible(true);
  };

  const handleSaveFeeDef = async () => {
    if (!feeDefForm.name.trim() || !feeDefForm.default_amount) {
      toast.show(t('fill_required_fields'), 'warning');
      return;
    }

    try {
      setSaving(true);

      const payload = {
        name: SecurityUtils.sanitizeInput(feeDefForm.name),
        description: SecurityUtils.sanitizeInput(feeDefForm.description),
        default_amount: Number(feeDefForm.default_amount),
        fee_type: feeDefForm.fee_type,
        is_active: feeDefForm.is_active,
      };

      let result;
      if (editingFeeDef) {
        result = await updateFeeDefinition(editingFeeDef.id, payload);
      } else {
        result = await createFeeDefinition(payload);
      }

      if (result.success) {
        toast.show(
          editingFeeDef ? t('fee_definition_updated') : t('fee_definition_created'),
          'success'
        );
        setFeeDefModalVisible(false);
        await loadData(true);
      } else {
        throw new Error(result.message || t('error_saving_fee_definition'));
      }
    } catch (err) {
      toast.show(err.message || t('error_saving_fee_definition'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleAddPayment = (participantFee) => {
    setSelectedParticipantFee(participantFee);
    setPaymentAmount('');
    setPaymentModalVisible(true);
  };

  const handleSavePayment = async () => {
    if (!paymentAmount || Number(paymentAmount) <= 0) {
      toast.show(t('enter_valid_amount'), 'warning');
      return;
    }

    try {
      setSaving(true);

      const payload = {
        participant_fee_id: selectedParticipantFee.id,
        participant_id: selectedParticipantFee.participant_id,
        amount: Number(paymentAmount),
        payment_date: DateUtils.formatDate(new Date(), 'en', 'YYYY-MM-DD'),
        payment_method: 'cash',
      };

      const result = await createParticipantPayment(payload);

      if (result.success) {
        toast.show(t('payment_recorded_successfully'), 'success');
        setPaymentModalVisible(false);
        await loadData(true);
      } else {
        throw new Error(result.message || t('error_recording_payment'));
      }
    } catch (err) {
      toast.show(err.message || t('error_recording_payment'), 'error');
    } finally {
      setSaving(false);
    }
  };

  // Merge participant fees with participant data
  const enrichedFees = useMemo(() => {
    return participantFees.map((fee) => {
      const participant = participants.find((p) => p.id === fee.participant_id);
      return {
        ...fee,
        participant_name: participant
          ? `${participant.first_name} ${participant.last_name}`
          : t('unknown'),
      };
    });
  }, [participantFees, participants]);

  // Filter by fee type (tab)
  const filteredFees = useMemo(() => {
    return enrichedFees.filter((fee) => fee.fee_type === activeTab);
  }, [enrichedFees, activeTab]);

  // Sort
  const sortedFees = useMemo(() => {
    const sorted = [...filteredFees];
    sorted.sort((a, b) => {
      let comparison = 0;
      if (sortField === 'name') {
        comparison = a.participant_name.localeCompare(b.participant_name);
      } else if (sortField === 'outstanding') {
        comparison = getOutstanding(a) - getOutstanding(b);
      } else if (sortField === 'total') {
        comparison = (a.total_amount || 0) - (b.total_amount || 0);
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });
    return sorted;
  }, [filteredFees, sortField, sortDirection]);

  const feeTypeOptions = [
    { label: t('memberships'), value: 'memberships' },
    { label: t('activities'), value: 'activities' },
    { label: t('fundraisers'), value: 'fundraisers' },
    { label: t('other'), value: 'other' },
  ];

  if (loading && !refreshing) {
    return <LoadingSpinner message={t('loading')} />;
  }

  if (error && !loading) {
    return <ErrorMessage message={error} onRetry={loadData} />;
  }

  const totalRevenue = financeSummary?.total_revenue || 0;
  const totalOutstanding = financeSummary?.total_outstanding || 0;
  const totalPaid = financeSummary?.total_paid || 0;

  return (
    <View style={commonStyles.container}>
      {/* Tab Navigation */}
      <View style={styles.tabNav}>
        {feeTypeOptions.map((option) => (
          <TouchableOpacity
            key={option.value}
            style={[styles.tabButton, activeTab === option.value && styles.tabButtonActive]}
            onPress={() => setActiveTab(option.value)}
            activeOpacity={0.7}
          >
            <Text
              style={[
                styles.tabButtonText,
                activeTab === option.value && styles.tabButtonTextActive,
              ]}
            >
              {option.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContainer}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Summary Stats */}
        <View style={styles.statsRow}>
          <StatCard
            label={t('total_revenue')}
            value={formatCurrency(totalRevenue)}
            style={styles.statCard}
          />
          <StatCard
            label={t('total_paid')}
            value={formatCurrency(totalPaid)}
            style={styles.statCard}
          />
          <StatCard
            label={t('outstanding')}
            value={formatCurrency(totalOutstanding)}
            style={styles.statCard}
          />
        </View>

        {/* Fee Definitions */}
        {canManage && (
          <Card style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.sectionTitle}>{t('fee_definitions')}</Text>
              <TouchableOpacity
                style={styles.addButton}
                onPress={handleAddFeeDef}
                activeOpacity={0.7}
              >
                <Text style={styles.addButtonText}>+ {t('add')}</Text>
              </TouchableOpacity>
            </View>

            {feeDefinitions.filter((fd) => fd.fee_type === activeTab).length === 0 ? (
              <Text style={styles.noDataText}>{t('no_fee_definitions')}</Text>
            ) : (
              feeDefinitions
                .filter((fd) => fd.fee_type === activeTab)
                .map((feeDef) => (
                  <View key={feeDef.id} style={styles.feeDefRow}>
                    <View style={styles.feeDefInfo}>
                      <Text style={styles.feeDefName}>{feeDef.name}</Text>
                      <Text style={styles.feeDefAmount}>
                        {formatCurrency(feeDef.default_amount)}
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={styles.editButton}
                      onPress={() => handleEditFeeDef(feeDef)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.editButtonText}>✏️</Text>
                    </TouchableOpacity>
                  </View>
                ))
            )}
          </Card>
        )}

        {/* Participant Fees */}
        <Card style={styles.card}>
          <Text style={styles.sectionTitle}>{t('participant_fees')}</Text>

          {sortedFees.length === 0 ? (
            <EmptyState
              icon="💰"
              title={t('no_fees')}
              message={t('no_fees_for_type')}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableHeaderCell>{t('participant')}</TableHeaderCell>
                <TableHeaderCell>{t('amount')}</TableHeaderCell>
                <TableHeaderCell>{t('paid')}</TableHeaderCell>
                <TableHeaderCell>{t('outstanding')}</TableHeaderCell>
                {canManage && <TableHeaderCell>{t('actions')}</TableHeaderCell>}
              </TableHeader>
              {sortedFees.map((fee) => (
                <TableRow key={fee.id}>
                  <TableCell>{fee.participant_name}</TableCell>
                  <TableCell>{formatCurrency(fee.total_amount)}</TableCell>
                  <TableCell>{formatCurrency(fee.total_paid)}</TableCell>
                  <TableCell>{formatCurrency(getOutstanding(fee))}</TableCell>
                  {canManage && (
                    <TableCell>
                      {getOutstanding(fee) > 0 && (
                        <TouchableOpacity
                          style={styles.payButton}
                          onPress={() => handleAddPayment(fee)}
                          activeOpacity={0.7}
                        >
                          <Text style={styles.payButtonText}>💳</Text>
                        </TouchableOpacity>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </Table>
          )}
        </Card>
      </ScrollView>

      {/* Fee Definition Modal */}
      <Modal
        visible={feeDefModalVisible}
        onClose={() => setFeeDefModalVisible(false)}
        title={editingFeeDef ? t('edit_fee_definition') : t('add_fee_definition')}
        footer={
          <View style={styles.modalFooter}>
            <TouchableOpacity
              style={commonStyles.buttonSecondary}
              onPress={() => setFeeDefModalVisible(false)}
              activeOpacity={0.7}
            >
              <Text style={commonStyles.buttonSecondaryText}>{t('cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[commonStyles.button, saving && commonStyles.buttonDisabled]}
              onPress={handleSaveFeeDef}
              disabled={saving}
              activeOpacity={0.7}
            >
              <Text style={commonStyles.buttonText}>
                {saving ? t('saving') : t('save')}
              </Text>
            </TouchableOpacity>
          </View>
        }
      >
        <FormField
          label={t('name')}
          value={feeDefForm.name}
          onChangeText={(val) => setFeeDefForm((prev) => ({ ...prev, name: val }))}
          required
        />

        <FormField
          label={t('description')}
          value={feeDefForm.description}
          onChangeText={(val) => setFeeDefForm((prev) => ({ ...prev, description: val }))}
          multiline
          numberOfLines={3}
        />

        <FormField
          label={t('default_amount')}
          value={feeDefForm.default_amount}
          onChangeText={(val) => setFeeDefForm((prev) => ({ ...prev, default_amount: val }))}
          keyboardType="decimal-pad"
          required
        />

        <Select
          label={t('fee_type')}
          value={feeDefForm.fee_type}
          onValueChange={(val) => setFeeDefForm((prev) => ({ ...prev, fee_type: val }))}
          options={feeTypeOptions}
        />
      </Modal>

      {/* Payment Modal */}
      <Modal
        visible={paymentModalVisible}
        onClose={() => setPaymentModalVisible(false)}
        title={t('record_payment')}
        footer={
          <View style={styles.modalFooter}>
            <TouchableOpacity
              style={commonStyles.buttonSecondary}
              onPress={() => setPaymentModalVisible(false)}
              activeOpacity={0.7}
            >
              <Text style={commonStyles.buttonSecondaryText}>{t('cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[commonStyles.button, saving && commonStyles.buttonDisabled]}
              onPress={handleSavePayment}
              disabled={saving}
              activeOpacity={0.7}
            >
              <Text style={commonStyles.buttonText}>
                {saving ? t('saving') : t('save')}
              </Text>
            </TouchableOpacity>
          </View>
        }
      >
        {selectedParticipantFee && (
          <>
            <Text style={styles.modalLabel}>{t('participant')}:</Text>
            <Text style={styles.modalValue}>
              {participants.find((p) => p.id === selectedParticipantFee.participant_id)
                ?.first_name || ''}{' '}
              {participants.find((p) => p.id === selectedParticipantFee.participant_id)
                ?.last_name || ''}
            </Text>

            <Text style={styles.modalLabel}>{t('outstanding')}:</Text>
            <Text style={styles.modalValue}>
              {formatCurrency(getOutstanding(selectedParticipantFee))}
            </Text>

            <FormField
              label={t('payment_amount')}
              value={paymentAmount}
              onChangeText={setPaymentAmount}
              keyboardType="decimal-pad"
              required
            />
          </>
        )}
      </Modal>

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
  tabNav: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  tabButton: {
    flex: 1,
    paddingVertical: theme.spacing.md,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabButtonActive: {
    borderBottomColor: theme.colors.primary,
  },
  tabButtonText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
  },
  tabButtonTextActive: {
    color: theme.colors.primary,
    fontWeight: theme.fontWeight.semibold,
  },
  scrollContainer: {
    padding: theme.spacing.md,
  },
  statsRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.md,
  },
  statCard: {
    flex: 1,
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
  addButton: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    backgroundColor: theme.colors.primary,
    borderRadius: theme.borderRadius.sm,
    minHeight: theme.touchTarget.min,
    justifyContent: 'center',
  },
  addButtonText: {
    color: theme.colors.selectedText,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
  },
  feeDefRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  feeDefInfo: {
    flex: 1,
  },
  feeDefName: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.text,
  },
  feeDefAmount: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
  },
  editButton: {
    width: theme.touchTarget.min,
    height: theme.touchTarget.min,
    justifyContent: 'center',
    alignItems: 'center',
  },
  editButtonText: {
    fontSize: theme.fontSize.lg,
  },
  payButton: {
    width: theme.touchTarget.min,
    height: theme.touchTarget.min,
    justifyContent: 'center',
    alignItems: 'center',
  },
  payButtonText: {
    fontSize: theme.fontSize.lg,
  },
  noDataText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.textMuted,
    textAlign: 'center',
    fontStyle: 'italic',
    paddingVertical: theme.spacing.md,
  },
  modalFooter: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    justifyContent: 'flex-end',
  },
  modalLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.textMuted,
    marginTop: theme.spacing.sm,
    marginBottom: theme.spacing.xs,
  },
  modalValue: {
    fontSize: theme.fontSize.base,
    color: theme.colors.text,
    marginBottom: theme.spacing.md,
  },
});

export default FinanceScreen;
