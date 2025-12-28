/**
 * External Revenue Screen
 *
 * Mirrors spa/external-revenue.js functionality
 * Track donations, sponsorships, grants, and other external income
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
import { translate as t } from '../i18n';
import theme, { commonStyles } from '../theme';
import {
  LoadingSpinner,
  ErrorMessage,
  Card,
  StatCard,
  FormField,
  Select,
  Toast,
  useToast,
  Modal,
  ConfirmModal,
  EmptyState,
} from '../components';
import { canManageFinance, canApproveFinance } from '../utils/PermissionUtils';
import CONFIG from '../config';
import API from '../api/api-core';
import { getCurrentFiscalYear } from '../utils/DateUtils';
import { formatCurrency } from '../utils/FormatUtils';
import { debugError } from '../utils/DebugUtils';

const ExternalRevenueScreen = ({ navigation }) => {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [revenues, setRevenues] = useState([]);
  const [categories, setCategories] = useState([]);
  const [summary, setSummary] = useState(null);

  const fiscalYear = useMemo(() => getCurrentFiscalYear(), []);

  // Filters
  const [filters, setFilters] = useState({
    start_date: fiscalYear.start,
    end_date: fiscalYear.end,
    revenue_type: 'all',
    category_id: 'all',
  });

  // Modal state
  const [revenueModalVisible, setRevenueModalVisible] = useState(false);
  const [selectedRevenue, setSelectedRevenue] = useState(null);
  const [deleteConfirmVisible, setDeleteConfirmVisible] = useState(false);
  const [revenueToDelete, setRevenueToDelete] = useState(null);

  // Form state
  const [formData, setFormData] = useState({
    revenue_type: 'donation',
    revenue_date: new Date().toISOString().split('T')[0],
    description: '',
    amount: '',
    budget_category_id: '',
    reference_number: '',
    payment_method: '',
    receipt_url: '',
    notes: '',
  });

  const [saving, setSaving] = useState(false);
  const toast = useToast();

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async (forceRefresh = false) => {
    try {
      setError('');

      await Promise.all([loadCategories(), loadRevenues(), loadSummary()]);
    } catch (err) {
      setError(err.message || t('error_loading_data'));
    } finally {
      setLoading(false);
    }
  };

  const loadCategories = async () => {
    try {
      const result = await API.get('/v1/finance/budget-categories');

      setCategories(result.data || []);
    } catch (err) {
      debugError('Error loading categories:', err);
      setCategories([]);
    }
  };

  const loadRevenues = async () => {
    try {
      const params = {
        start_date: filters.start_date,
        end_date: filters.end_date,
      };

      if (filters.revenue_type !== 'all') {
        params.revenue_type = filters.revenue_type;
      }

      if (filters.category_id !== 'all') {
        params.category_id = filters.category_id;
      }

      const result = await API.get('/v1/finance/external-revenue', params);

      setRevenues(result.data || []);
    } catch (err) {
      debugError('Error loading revenues:', err);
      setRevenues([]);
    }
  };

  const loadSummary = async () => {
    try {
      const params = {
        start_date: filters.start_date,
        end_date: filters.end_date,
      };

      const result = await API.get('/v1/finance/external-revenue-summary', params);

      setSummary(result.data || null);
    } catch (err) {
      debugError('Error loading summary:', err);
      setSummary(null);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData(true);
    setRefreshing(false);
  };

  const applyFilters = async () => {
    setLoading(true);
    await Promise.all([loadRevenues(), loadSummary()]);
    setLoading(false);
  };

  const resetFilters = async () => {
    setFilters({
      start_date: fiscalYear.start,
      end_date: fiscalYear.end,
      revenue_type: 'all',
      category_id: 'all',
    });
    setLoading(true);
    await Promise.all([loadRevenues(), loadSummary()]);
    setLoading(false);
  };

  const getRevenueTypeLabel = (type) => {
    const types = {
      donation: t('donation'),
      sponsorship: t('sponsorship'),
      grant: t('grant'),
      other: t('other'),
    };
    return types[type] || type;
  };

  const getRevenueTypeBadgeColor = (type) => {
    const colors = {
      donation: theme.colors.success,
      sponsorship: theme.colors.primary,
      grant: theme.colors.warning,
      other: theme.colors.textMuted,
    };
    return colors[type] || theme.colors.textMuted;
  };

  const handleAddRevenue = () => {
    setSelectedRevenue(null);
    setFormData({
      revenue_type: 'donation',
      revenue_date: new Date().toISOString().split('T')[0],
      description: '',
      amount: '',
      budget_category_id: '',
      reference_number: '',
      payment_method: '',
      receipt_url: '',
      notes: '',
    });
    setRevenueModalVisible(true);
  };

  const handleEditRevenue = (revenue) => {
    setSelectedRevenue(revenue);
    setFormData({
      revenue_type: revenue.revenue_type,
      revenue_date: revenue.revenue_date,
      description: revenue.description,
      amount: String(revenue.amount),
      budget_category_id: revenue.budget_category_id ? String(revenue.budget_category_id) : '',
      reference_number: revenue.reference_number || '',
      payment_method: revenue.payment_method || '',
      receipt_url: revenue.receipt_url || '',
      notes: revenue.notes || '',
    });
    setRevenueModalVisible(true);
  };

  const handleDeleteRevenue = (revenue) => {
    setRevenueToDelete(revenue);
    setDeleteConfirmVisible(true);
  };

  const confirmDeleteRevenue = async () => {
    if (!revenueToDelete) return;

    try {
      setSaving(true);
      setDeleteConfirmVisible(false);

      await API.delete(`/v1/finance/external-revenue/${revenueToDelete.id}`);

      toast.show(t('external_revenue_deleted'), 'success');
      setRevenueToDelete(null);
      await loadData(true);
    } catch (err) {
      toast.show(err.message || t('error_deleting_external_revenue'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveRevenue = async () => {
    // Validate
    if (!formData.revenue_date || !formData.description || !formData.amount) {
      toast.show(t('fill_required_fields'), 'warning');
      return;
    }

    const amountValue = parseFloat(formData.amount);
    if (isNaN(amountValue) || amountValue <= 0) {
      toast.show(t('invalid_amount'), 'warning');
      return;
    }

    try {
      setSaving(true);

      const payload = {
        revenue_type: formData.revenue_type,
        revenue_date: formData.revenue_date,
        description: formData.description,
        amount: amountValue,
        budget_category_id: formData.budget_category_id
          ? parseInt(formData.budget_category_id)
          : null,
        reference_number: formData.reference_number || null,
        payment_method: formData.payment_method || null,
        receipt_url: formData.receipt_url || null,
        notes: formData.notes || null,
      };

      if (selectedRevenue) {
        await API.put(`/v1/finance/external-revenue/${selectedRevenue.id}`, payload);
      } else {
        await API.post('/v1/finance/external-revenue', payload);
      }

      toast.show(
        selectedRevenue ? t('external_revenue_updated') : t('external_revenue_created'),
        'success'
      );
      setRevenueModalVisible(false);
      await loadData(true);
    } catch (err) {
      toast.show(err.message || t('error_saving_external_revenue'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const renderSummaryCards = () => {
    if (!summary || !summary.totals) {
      return null;
    }

    const totals = summary.totals;

    return (
      <View style={styles.summaryCards}>
        <StatCard
          label={t('total_external_revenue')}
          value={formatCurrency(totals.total_amount)}
          detail={`${totals.entry_count} ${t('entries')}`}
          icon="💰"
        />
      </View>
    );
  };

  const renderFilters = () => {
    return (
      <Card style={styles.filtersCard}>
        <Text style={styles.filtersTitle}>{t('filters')}</Text>

        <FormField
          label={t('start_date')}
          value={filters.start_date}
          onChangeText={(value) => setFilters({ ...filters, start_date: value })}
          placeholder="YYYY-MM-DD"
        />

        <FormField
          label={t('end_date')}
          value={filters.end_date}
          onChangeText={(value) => setFilters({ ...filters, end_date: value })}
          placeholder="YYYY-MM-DD"
        />

        <Select
          label={t('revenue_type')}
          value={filters.revenue_type}
          onValueChange={(value) => setFilters({ ...filters, revenue_type: value })}
          options={[
            { label: t('all_types'), value: 'all' },
            { label: t('donation'), value: 'donation' },
            { label: t('sponsorship'), value: 'sponsorship' },
            { label: t('grant'), value: 'grant' },
            { label: t('other'), value: 'other' },
          ]}
        />

        <Select
          label={t('category')}
          value={filters.category_id}
          onValueChange={(value) => setFilters({ ...filters, category_id: value })}
          options={[
            { label: t('all_categories'), value: 'all' },
            ...categories.map((cat) => ({
              label: cat.name,
              value: String(cat.id),
            })),
          ]}
        />

        <View style={styles.filterActions}>
          <TouchableOpacity
            style={[commonStyles.button, styles.filterButton]}
            onPress={applyFilters}
            activeOpacity={0.7}
          >
            <Text style={commonStyles.buttonText}>{t('apply_filters')}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[commonStyles.buttonSecondary, styles.filterButton]}
            onPress={resetFilters}
            activeOpacity={0.7}
          >
            <Text style={commonStyles.buttonSecondaryText}>{t('reset')}</Text>
          </TouchableOpacity>
        </View>
      </Card>
    );
  };

  const renderRevenueList = () => {
    if (revenues.length === 0) {
      return <EmptyState message={t('no_external_revenue_entries')} icon="💰" />;
    }

    return (
      <View style={styles.revenueList}>
        {revenues.map((revenue) => (
          <Card key={revenue.id} style={styles.revenueCard}>
            <View style={styles.revenueHeader}>
              <Text style={styles.revenueDate}>{revenue.revenue_date}</Text>
              <View
                style={[
                  styles.revenueTypeBadge,
                  { backgroundColor: getRevenueTypeBadgeColor(revenue.revenue_type) },
                ]}
              >
                <Text style={styles.revenueTypeBadgeText}>
                  {getRevenueTypeLabel(revenue.revenue_type)}
                </Text>
              </View>
            </View>

            <Text style={styles.revenueDescription}>{revenue.description}</Text>

            <Text style={styles.revenueAmount}>{formatCurrency(revenue.amount)}</Text>

            <View style={styles.revenueDetails}>
              {revenue.category_name && (
                <Text style={styles.revenueDetailText}>
                  {t('category')}: {revenue.category_name}
                </Text>
              )}
              {revenue.reference_number && (
                <Text style={styles.revenueDetailText}>
                  {t('reference')}: {revenue.reference_number}
                </Text>
              )}
              {revenue.payment_method && (
                <Text style={styles.revenueDetailText}>
                  {t('payment_method')}: {revenue.payment_method}
                </Text>
              )}
            </View>

            {typeof canManageFinance === 'function' && canManageFinance() && (
              <View style={styles.revenueActions}>
                <TouchableOpacity
                  style={[commonStyles.buttonSecondary, styles.actionButton]}
                  onPress={() => handleEditRevenue(revenue)}
                  activeOpacity={0.7}
                >
                  <Text style={commonStyles.buttonSecondaryText}>{t('edit')}</Text>
                </TouchableOpacity>

                {typeof canApproveFinance === 'function' && canApproveFinance() && (
                  <TouchableOpacity
                    style={[commonStyles.buttonDanger, styles.actionButton]}
                    onPress={() => handleDeleteRevenue(revenue)}
                    activeOpacity={0.7}
                  >
                    <Text style={commonStyles.buttonDangerText}>{t('delete')}</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </Card>
        ))}
      </View>
    );
  };

  if (loading && !refreshing) {
    return <LoadingSpinner message={t('loading')} />;
  }

  if (error && !loading) {
    return <ErrorMessage message={error} onRetry={loadData} />;
  }

  return (
    <View style={commonStyles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContainer}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Header */}
        <Card style={styles.headerCard}>
          <Text style={styles.title}>{t('external_revenue')}</Text>
          <Text style={styles.fiscalYearLabel}>
            {t('fiscal_year')}: <Text style={styles.fiscalYearValue}>{fiscalYear.label}</Text>
          </Text>
        </Card>

        {/* Summary Cards */}
        {renderSummaryCards()}

        {/* Filters */}
        {renderFilters()}

        {/* Action Buttons */}
        {typeof canManageFinance === 'function' && canManageFinance() && (
          <View style={styles.actionButtons}>
            <TouchableOpacity
              style={commonStyles.button}
              onPress={handleAddRevenue}
              activeOpacity={0.7}
            >
              <Text style={commonStyles.buttonText}>{t('add_external_revenue')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Revenue List */}
        {renderRevenueList()}
      </ScrollView>

      {/* Revenue Modal */}
      <Modal
        visible={revenueModalVisible}
        onClose={() => {
          setRevenueModalVisible(false);
          setSelectedRevenue(null);
        }}
        title={selectedRevenue ? t('edit_external_revenue') : t('add_external_revenue')}
        footer={
          <View style={styles.modalFooter}>
            <TouchableOpacity
              style={commonStyles.buttonSecondary}
              onPress={() => {
                setRevenueModalVisible(false);
                setSelectedRevenue(null);
              }}
              activeOpacity={0.7}
            >
              <Text style={commonStyles.buttonSecondaryText}>{t('cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[commonStyles.button, saving && commonStyles.buttonDisabled]}
              onPress={handleSaveRevenue}
              disabled={saving}
              activeOpacity={0.7}
            >
              <Text style={commonStyles.buttonText}>{saving ? t('saving') : t('save')}</Text>
            </TouchableOpacity>
          </View>
        }
      >
        <ScrollView>
          <Select
            label={t('revenue_type')}
            value={formData.revenue_type}
            onValueChange={(value) => setFormData({ ...formData, revenue_type: value })}
            options={[
              { label: t('donation'), value: 'donation' },
              { label: t('sponsorship'), value: 'sponsorship' },
              { label: t('grant'), value: 'grant' },
              { label: t('other'), value: 'other' },
            ]}
            required
          />

          <FormField
            label={t('date')}
            value={formData.revenue_date}
            onChangeText={(value) => setFormData({ ...formData, revenue_date: value })}
            placeholder="YYYY-MM-DD"
            required
          />

          <FormField
            label={t('source_donor')}
            value={formData.description}
            onChangeText={(value) => setFormData({ ...formData, description: value })}
            placeholder={t('enter_source_donor_name')}
            required
          />

          <FormField
            label={t('amount')}
            value={formData.amount}
            onChangeText={(value) => setFormData({ ...formData, amount: value })}
            placeholder="0.00"
            keyboardType="numeric"
            required
          />

          <Select
            label={t('category')}
            value={formData.budget_category_id}
            onValueChange={(value) => setFormData({ ...formData, budget_category_id: value })}
            options={[
              { label: t('uncategorized'), value: '' },
              ...categories.map((cat) => ({
                label: cat.name,
                value: String(cat.id),
              })),
            ]}
          />

          <FormField
            label={t('reference_number')}
            value={formData.reference_number}
            onChangeText={(value) => setFormData({ ...formData, reference_number: value })}
            placeholder={t('check_number_transfer_id')}
          />

          <FormField
            label={t('payment_method')}
            value={formData.payment_method}
            onChangeText={(value) => setFormData({ ...formData, payment_method: value })}
            placeholder={t('cash_check_transfer')}
          />

          <FormField
            label={t('receipt_url')}
            value={formData.receipt_url}
            onChangeText={(value) => setFormData({ ...formData, receipt_url: value })}
            placeholder="https://"
          />

          <FormField
            label={t('notes')}
            value={formData.notes}
            onChangeText={(value) => setFormData({ ...formData, notes: value })}
            multiline
            numberOfLines={3}
          />
        </ScrollView>
      </Modal>

      {/* Delete Confirm Modal */}
      <ConfirmModal
        visible={deleteConfirmVisible}
        onClose={() => {
          setDeleteConfirmVisible(false);
          setRevenueToDelete(null);
        }}
        onConfirm={confirmDeleteRevenue}
        title={t('confirm_delete_external_revenue')}
        message={t('confirm_delete_external_revenue_message')}
        confirmText={t('delete')}
        cancelText={t('cancel')}
      />

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
    alignItems: 'center',
  },
  title: {
    fontSize: theme.fontSize.xxl,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.primary,
    marginBottom: theme.spacing.xs,
  },
  fiscalYearLabel: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
  },
  fiscalYearValue: {
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.text,
  },
  summaryCards: {
    marginBottom: theme.spacing.md,
  },
  filtersCard: {
    marginBottom: theme.spacing.md,
  },
  filtersTitle: {
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.primary,
    marginBottom: theme.spacing.md,
  },
  filterActions: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.md,
  },
  filterButton: {
    flex: 1,
  },
  actionButtons: {
    marginBottom: theme.spacing.md,
  },
  revenueList: {
    gap: theme.spacing.md,
  },
  revenueCard: {
    marginBottom: 0,
  },
  revenueHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.sm,
  },
  revenueDate: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
  },
  revenueTypeBadge: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.borderRadius.md,
  },
  revenueTypeBadgeText: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.white,
    textTransform: 'uppercase',
  },
  revenueDescription: {
    fontSize: theme.fontSize.base,
    color: theme.colors.text,
    marginBottom: theme.spacing.sm,
  },
  revenueAmount: {
    fontSize: theme.fontSize.xl,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.success,
    marginBottom: theme.spacing.sm,
  },
  revenueDetails: {
    marginBottom: theme.spacing.sm,
  },
  revenueDetailText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
    marginBottom: theme.spacing.xs,
  },
  revenueActions: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.sm,
  },
  actionButton: {
    flex: 1,
  },
  modalFooter: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    justifyContent: 'flex-end',
  },
});

export default ExternalRevenueScreen;
