/**
 * Expenses Screen
 *
 * Mirrors spa/expenses.js functionality
 * Enhanced expense tracking with tax calculation, filtering, and reporting
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  } from 'react-native';
  import { Picker } from '@react-native-picker/picker';
import { translate as t } from '../i18n';
import theme, { commonStyles } from '../theme';
import {
  LoadingState,
  ErrorState,
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

const ExpensesScreen = ({ navigation }) => {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [expenses, setExpenses] = useState([]);
  const [categories, setCategories] = useState([]);
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState(null);
  const [monthlyData, setMonthlyData] = useState([]);

  const fiscalYear = useMemo(() => getCurrentFiscalYear(), []);

  // Filters
  const [filters, setFilters] = useState({
    start_date: fiscalYear.start,
    end_date: fiscalYear.end,
    category_id: 'all',
  });

  // Active tab
  const [activeTab, setActiveTab] = useState('list'); // list, summary, monthly

  // Modal state
  const [expenseModalVisible, setExpenseModalVisible] = useState(false);
  const [selectedExpense, setSelectedExpense] = useState(null);
  const [deleteConfirmVisible, setDeleteConfirmVisible] = useState(false);
  const [expenseToDelete, setExpenseToDelete] = useState(null);

  // Form state
  const [formData, setFormData] = useState({
    expense_date: new Date().toISOString().split('T')[0],
    budget_category_id: '',
    budget_item_id: '',
    description: '',
    amount: '',
    payment_method: '',
    reference_number: '',
    receipt_url: '',
    notes: '',
  });

  // Tax calculator state
  const [subtotal, setSubtotal] = useState('');
  const [taxBreakdown, setTaxBreakdown] = useState(null);

  const [saving, setSaving] = useState(false);
  const [canManage, setCanManage] = useState(false);
  const [canApprove, setCanApprove] = useState(false);
  const toast = useToast();

  useEffect(() => {
    const init = async () => {
      const [hasManage, hasApprove] = await Promise.all([
        canManageFinance(),
        canApproveFinance(),
      ]);
      setCanManage(hasManage);
      setCanApprove(hasApprove);
      loadData();
    };
    init();
  }, []);

  const loadData = async (forceRefresh = false) => {
    try {
      setError('');

      await Promise.all([
        loadCategories(),
        loadItems(),
        loadExpenses(),
        loadSummary(),
        loadMonthlyData(),
      ]);
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

  const loadItems = async () => {
    try {
      const result = await API.get('/v1/finance/budget-items');

      setItems(result.data || []);
    } catch (err) {
      debugError('Error loading items:', err);
      setItems([]);
    }
  };

  const loadExpenses = async () => {
    try {
      const params = {
        start_date: filters.start_date,
        end_date: filters.end_date,
      };

      if (filters.category_id !== 'all') {
        params.category_id = filters.category_id;
      }

      const result = await API.get('/v1/finance/budget-expenses', params);

      setExpenses(result.data || []);
    } catch (err) {
      debugError('Error loading expenses:', err);
      setExpenses([]);
    }
  };

  const loadSummary = async () => {
    try {
      const params = {
        start_date: filters.start_date,
        end_date: filters.end_date,
      };

      if (filters.category_id !== 'all') {
        params.category_id = filters.category_id;
      }

      const result = await API.get('/v1/finance/expense-summary', params);

      setSummary(result.data || null);
    } catch (err) {
      debugError('Error loading summary:', err);
      setSummary(null);
    }
  };

  const loadMonthlyData = async () => {
    try {
      const params = {
        start_date: fiscalYear.start,
        end_date: fiscalYear.end,
      };

      if (filters.category_id !== 'all') {
        params.category_id = filters.category_id;
      }

      const result = await API.get('/v1/finance/expenses-monthly', params);

      setMonthlyData(result.data || []);
    } catch (err) {
      debugError('Error loading monthly data:', err);
      setMonthlyData([]);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData(true);
    setRefreshing(false);
  };

  const applyFilters = async () => {
    setLoading(true);
    await Promise.all([loadExpenses(), loadSummary(), loadMonthlyData()]);
    setLoading(false);
  };

  const resetFilters = async () => {
    setFilters({
      start_date: fiscalYear.start,
      end_date: fiscalYear.end,
      category_id: 'all',
    });
    setLoading(true);
    await Promise.all([loadExpenses(), loadSummary(), loadMonthlyData()]);
    setLoading(false);
  };

  const calculateTaxes = (subtotalValue) => {
    const gst = subtotalValue * CONFIG.TAX.GST_RATE;
    const qst = subtotalValue * CONFIG.TAX.QST_RATE;
    const total = subtotalValue + gst + qst;
    return { subtotal: subtotalValue, gst, qst, total };
  };

  const handleCalculateTaxes = () => {
    const subtotalValue = parseFloat(subtotal) || 0;
    if (subtotalValue <= 0) {
      toast.show(t('enter_valid_subtotal'), 'warning');
      return;
    }

    const breakdown = calculateTaxes(subtotalValue);
    setTaxBreakdown(breakdown);
    setFormData({ ...formData, amount: breakdown.total.toFixed(2) });
  };

  const handleAddExpense = () => {
    setSelectedExpense(null);
    setFormData({
      expense_date: new Date().toISOString().split('T')[0],
      budget_category_id: '',
      budget_item_id: '',
      description: '',
      amount: '',
      payment_method: '',
      reference_number: '',
      receipt_url: '',
      notes: '',
    });
    setTaxBreakdown(null);
    setSubtotal('');
    setExpenseModalVisible(true);
  };

  const handleEditExpense = (expense) => {
    setSelectedExpense(expense);
    setFormData({
      expense_date: expense.expense_date,
      budget_category_id: expense.budget_category_id ? String(expense.budget_category_id) : '',
      budget_item_id: expense.budget_item_id ? String(expense.budget_item_id) : '',
      description: expense.description,
      amount: String(expense.amount),
      payment_method: expense.payment_method || '',
      reference_number: expense.reference_number || '',
      receipt_url: expense.receipt_url || '',
      notes: expense.notes || '',
    });
    setTaxBreakdown(null);
    setSubtotal('');
    setExpenseModalVisible(true);
  };

  const handleDeleteExpense = (expense) => {
    setExpenseToDelete(expense);
    setDeleteConfirmVisible(true);
  };

  const confirmDeleteExpense = async () => {
    if (!expenseToDelete) return;

    try {
      setSaving(true);
      setDeleteConfirmVisible(false);

      await API.delete(`/v1/finance/budget-expenses/${expenseToDelete.id}`);

      toast.show(t('expense_deleted'), 'success');
      setExpenseToDelete(null);
      await loadData(true);
    } catch (err) {
      toast.show(err.message || t('error_deleting_expense'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveExpense = async () => {
    // Validate
    if (!formData.expense_date || !formData.description || !formData.amount) {
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
        expense_date: formData.expense_date,
        budget_category_id: formData.budget_category_id ? parseInt(formData.budget_category_id) : null,
        budget_item_id: formData.budget_item_id ? parseInt(formData.budget_item_id) : null,
        description: formData.description,
        amount: amountValue,
        payment_method: formData.payment_method || null,
        reference_number: formData.reference_number || null,
        receipt_url: formData.receipt_url || null,
        notes: formData.notes || null,
      };

      if (selectedExpense) {
        await API.put(`/v1/finance/budget-expenses/${selectedExpense.id}`, payload);
      } else {
        await API.post('/v1/finance/budget-expenses', payload);
      }

      toast.show(
        selectedExpense ? t('expense_updated') : t('expense_created'),
        'success'
      );
      setExpenseModalVisible(false);
      await loadData(true);
    } catch (err) {
      toast.show(err.message || t('error_saving_expense'), 'error');
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
          label={t('total_expenses')}
          value={formatCurrency(totals.total_amount)}
          detail={`${totals.expense_count} ${t('entries')}`}
          icon="📊"
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

      <Picker
        label={t('category')}
        selectedValue={filters.category_id}
        onValueChange={(value) => setFilters({ ...filters, category_id: value })}
        items={[
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

  const renderExpenseList = () => {
    if (expenses.length === 0) {
      return <EmptyState message={t('no_expenses_found')} icon="📊" />;
    }

    return (
      <View style={styles.expenseList}>
        {expenses.map((expense) => (
          <Card key={expense.id} style={styles.expenseCard}>
            <View style={styles.expenseHeader}>
              <Text style={styles.expenseDate}>{expense.expense_date}</Text>
              <Text style={styles.expenseAmount}>{formatCurrency(expense.amount)}</Text>
            </View>

            <Text style={styles.expenseDescription}>{expense.description}</Text>

            <View style={styles.expenseDetails}>
              {expense.category_name && (
                <Text style={styles.expenseDetailText}>
                  {t('category')}: {expense.category_name}
                </Text>
              )}
              {expense.item_name && (
                <Text style={styles.expenseDetailText}>
                  {t('item')}: {expense.item_name}
                </Text>
              )}
              {expense.payment_method && (
                <Text style={styles.expenseDetailText}>
                  {t('payment_method')}: {expense.payment_method}
                </Text>
              )}
              {expense.reference_number && (
                <Text style={styles.expenseDetailText}>
                  {t('reference')}: {expense.reference_number}
                </Text>
              )}
            </View>

            {typeof canManageFinance === 'function' && canManageFinance() && (
              <View style={styles.expenseActions}>
                <TouchableOpacity
                  style={[commonStyles.buttonSecondary, styles.actionButton]}
                  onPress={() => handleEditExpense(expense)}
                  activeOpacity={0.7}
                >
                  <Text style={commonStyles.buttonSecondaryText}>{t('edit')}</Text>
                </TouchableOpacity>

                {typeof canApproveFinance === 'function' && canApproveFinance() && (
                  <TouchableOpacity
                    style={[commonStyles.buttonDanger, styles.actionButton]}
                    onPress={() => handleDeleteExpense(expense)}
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

  const renderSummaryView = () => {
    if (!summary || !summary.summary || summary.summary.length === 0) {
      return <EmptyState message={t('no_data_available')} icon="📊" />;
    }

    const summaryData = summary.summary;

    return (
      <View style={styles.summaryView}>
        <Text style={styles.summaryViewTitle}>{t('expense_summary_by_category')}</Text>

        {summaryData.map((cat) => (
          <Card key={cat.category_id || 'uncategorized'} style={styles.summaryCard}>
            <Text style={styles.summaryCategoryName}>
              {cat.category_name || t('uncategorized')}
            </Text>

            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>{t('expense_count')}:</Text>
              <Text style={styles.summaryValue}>{cat.expense_count}</Text>
            </View>

            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>{t('total_amount')}:</Text>
              <Text style={[styles.summaryValue, styles.summaryAmountText]}>
                {formatCurrency(cat.total_amount)}
              </Text>
            </View>

            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>{t('average_amount')}:</Text>
              <Text style={styles.summaryValue}>{formatCurrency(cat.average_amount)}</Text>
            </View>

            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>{t('date_range')}:</Text>
              <Text style={styles.summaryValue}>
                {cat.first_expense_date} - {cat.last_expense_date}
              </Text>
            </View>
          </Card>
        ))}

        <Card style={styles.summaryTotalCard}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryTotalLabel}>{t('total')}:</Text>
            <Text style={[styles.summaryTotalValue, styles.summaryAmountText]}>
              {formatCurrency(summary.totals.total_amount)}
            </Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>{t('entries')}:</Text>
            <Text style={styles.summaryValue}>{summary.totals.expense_count}</Text>
          </View>
        </Card>
      </View>
    );
  };

  const renderMonthlyView = () => {
    if (!monthlyData || monthlyData.length === 0) {
      return <EmptyState message={t('no_data_available')} icon="📊" />;
    }

    // Group by month
    const monthlyMap = new Map();
    monthlyData.forEach((item) => {
      const monthKey = item.month;
      if (!monthlyMap.has(monthKey)) {
        monthlyMap.set(monthKey, {
          month: monthKey,
          categories: [],
          total: 0,
        });
      }
      const monthData = monthlyMap.get(monthKey);
      monthData.categories.push(item);
      monthData.total += item.total_amount;
    });

    const months = Array.from(monthlyMap.values()).sort(
      (a, b) => new Date(b.month) - new Date(a.month)
    );

    return (
      <View style={styles.monthlyView}>
        <Text style={styles.monthlyViewTitle}>{t('monthly_expense_breakdown')}</Text>

        {months.map((monthData) => {
          const monthDate = new Date(monthData.month);
          const monthLabel = monthDate.toLocaleDateString('en', {
            year: 'numeric',
            month: 'long',
          });

          return (
            <Card key={monthData.month} style={styles.monthCard}>
              <Text style={styles.monthTitle}>{monthLabel}</Text>

              {monthData.categories.map((cat) => (
                <View
                  key={cat.category_id || 'uncategorized'}
                  style={styles.monthCategoryRow}
                >
                  <Text style={styles.monthCategoryName}>
                    {cat.category_name || t('uncategorized')}
                  </Text>
                  <View style={styles.monthCategoryStats}>
                    <Text style={styles.monthCategoryCount}>
                      {cat.expense_count} {t('entries')}
                    </Text>
                    <Text style={styles.monthCategoryAmount}>
                      {formatCurrency(cat.total_amount)}
                    </Text>
                  </View>
                </View>
              ))}

              <View style={styles.monthTotal}>
                <Text style={styles.monthTotalLabel}>{t('month_total')}:</Text>
                <Text style={styles.monthTotalValue}>{formatCurrency(monthData.total)}</Text>
              </View>
            </Card>
          );
        })}
      </View>
    );
  };

  const renderTabContent = () => {
    switch (activeTab) {
      case 'list':
        return (
          <>
            {renderFilters()}
            {typeof canManageFinance === 'function' && canManageFinance() && (
              <View style={styles.actionButtons}>
                <TouchableOpacity
                  style={commonStyles.button}
                  onPress={handleAddExpense}
                  activeOpacity={0.7}
                >
                  <Text style={commonStyles.buttonText}>{t('add_expense')}</Text>
                </TouchableOpacity>
              </View>
            )}
            {renderExpenseList()}
          </>
        );
      case 'summary':
        return renderSummaryView();
      case 'monthly':
        return renderMonthlyView();
      default:
        return null;
    }
  };

  if (loading && !refreshing) {
    return <LoadingState message={t('loading')} />;
  }

  if (error && !loading) {
    return <ErrorState message={error} onRetry={loadData} />;
  }

  return (
    <View style={commonStyles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContainer}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Header */}
        <Card style={styles.headerCard}>
          <Text style={styles.title}>{t('expense_tracking')}</Text>
          <Text style={styles.fiscalYearLabel}>
            {t('fiscal_year')}: <Text style={styles.fiscalYearValue}>{fiscalYear.label}</Text>
          </Text>
        </Card>

        {/* Summary Cards */}
        {renderSummaryCards()}

        {/* Tab Navigation */}
        <View style={styles.tabNavigation}>
          <TouchableOpacity
            style={[styles.tabButton, activeTab === 'list' && styles.tabButtonActive]}
            onPress={() => setActiveTab('list')}
            activeOpacity={0.7}
          >
            <Text
              style={[styles.tabButtonText, activeTab === 'list' && styles.tabButtonTextActive]}
            >
              {t('expense_list')}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tabButton, activeTab === 'summary' && styles.tabButtonActive]}
            onPress={() => setActiveTab('summary')}
            activeOpacity={0.7}
          >
            <Text
              style={[
                styles.tabButtonText,
                activeTab === 'summary' && styles.tabButtonTextActive,
              ]}
            >
              {t('summary')}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tabButton, activeTab === 'monthly' && styles.tabButtonActive]}
            onPress={() => setActiveTab('monthly')}
            activeOpacity={0.7}
          >
            <Text
              style={[
                styles.tabButtonText,
                activeTab === 'monthly' && styles.tabButtonTextActive,
              ]}
            >
              {t('monthly_breakdown')}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Tab Content */}
        {renderTabContent()}
      </ScrollView>

      {/* Expense Modal */}
      <Modal
        visible={expenseModalVisible}
        onClose={() => {
          setExpenseModalVisible(false);
          setSelectedExpense(null);
          setTaxBreakdown(null);
        }}
        title={selectedExpense ? t('edit_expense') : t('add_expense')}
        footer={
          <View style={styles.modalFooter}>
            <TouchableOpacity
              style={commonStyles.buttonSecondary}
              onPress={() => {
                setExpenseModalVisible(false);
                setSelectedExpense(null);
                setTaxBreakdown(null);
                }}
                activeOpacity={0.7}
              >
                <Text style={commonStyles.buttonSecondaryText}>{t('cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[commonStyles.button, saving && commonStyles.buttonDisabled]}
                onPress={handleSaveExpense}
                disabled={saving}
                activeOpacity={0.7}
              >
                <Text style={commonStyles.buttonText}>{saving ? t('saving') : t('save')}</Text>
              </TouchableOpacity>
              </View>
            }
            >
            <ScrollView>
              <FormField
              label={t('date')}
              value={formData.expense_date}
              onChangeText={(value) => setFormData({ ...formData, expense_date: value })}
              placeholder="YYYY-MM-DD"
              required
              />

              <Picker
              label={t('category')}
              selectedValue={formData.budget_category_id}
              onValueChange={(value) => setFormData({ ...formData, budget_category_id: value })}
              items={[
                { label: t('uncategorized'), value: '' },
                ...categories.map((cat) => ({
                label: cat.name,
                value: String(cat.id),
                })),
              ]}
              />

              <Picker
              label={t('budget_item')}
              selectedValue={formData.budget_item_id}
              onValueChange={(value) => setFormData({ ...formData, budget_item_id: value })}
              items={[
                { label: t('select_item'), value: '' },
                ...items.map((item) => ({
                label: item.name,
                value: String(item.id),
                })),
              ]}
              />

              <FormField
              label={t('description')}
              value={formData.description}
              onChangeText={(value) => setFormData({ ...formData, description: value })}
              placeholder={t('enter_expense_description')}
              required
              />

              {/* Tax Calculator */}
          <Card style={styles.taxCalculatorCard}>
            <Text style={styles.taxCalculatorTitle}>{t('amount_and_taxes')}</Text>

            <FormField
              label={t('subtotal_before_tax')}
              value={subtotal}
              onChangeText={setSubtotal}
              placeholder="0.00"
              keyboardType="numeric"
            />

            <TouchableOpacity
              style={commonStyles.buttonSecondary}
              onPress={handleCalculateTaxes}
              activeOpacity={0.7}
            >
              <Text style={commonStyles.buttonSecondaryText}>{t('calculate_taxes')}</Text>
            </TouchableOpacity>

            {taxBreakdown && (
              <View style={styles.taxBreakdown}>
                <View style={styles.taxRow}>
                  <Text style={styles.taxLabel}>{t('gst')} (5%):</Text>
                  <Text style={styles.taxValue}>{formatCurrency(taxBreakdown.gst)}</Text>
                </View>
                <View style={styles.taxRow}>
                  <Text style={styles.taxLabel}>{t('qst')} (9.975%):</Text>
                  <Text style={styles.taxValue}>{formatCurrency(taxBreakdown.qst)}</Text>
                </View>
                <View style={styles.taxRow}>
                  <Text style={styles.taxLabelBold}>{t('total_with_taxes')}:</Text>
                  <Text style={styles.taxValueBold}>{formatCurrency(taxBreakdown.total)}</Text>
                </View>
              </View>
            )}
          </Card>

          <FormField
            label={t('final_amount')}
            value={formData.amount}
            onChangeText={(value) => setFormData({ ...formData, amount: value })}
            placeholder="0.00"
            keyboardType="numeric"
            required
          />

          <FormField
            label={t('payment_method')}
            value={formData.payment_method}
            onChangeText={(value) => setFormData({ ...formData, payment_method: value })}
            placeholder={t('cash_check_card')}
          />

          <FormField
            label={t('reference_number')}
            value={formData.reference_number}
            onChangeText={(value) => setFormData({ ...formData, reference_number: value })}
            placeholder={t('invoice_check_number')}
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
          setExpenseToDelete(null);
        }}
        onConfirm={confirmDeleteExpense}
        title={t('confirm_delete_expense')}
        message={t('confirm_delete_expense_message')}
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
  tabNavigation: {
    flexDirection: 'row',
    marginBottom: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
    overflow: 'hidden',
    backgroundColor: theme.colors.border,
  },
  tabButton: {
    flex: 1,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.xs,
    backgroundColor: theme.colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabButtonActive: {
    backgroundColor: theme.colors.primary,
  },
  tabButtonText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.text,
    fontWeight: theme.fontWeight.medium,
  },
  tabButtonTextActive: {
    color: theme.colors.white,
    fontWeight: theme.fontWeight.bold,
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
  expenseList: {
    gap: theme.spacing.md,
  },
  expenseCard: {
    marginBottom: 0,
  },
  expenseHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.sm,
  },
  expenseDate: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
  },
  expenseAmount: {
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.primary,
  },
  expenseDescription: {
    fontSize: theme.fontSize.base,
    color: theme.colors.text,
    marginBottom: theme.spacing.sm,
  },
  expenseDetails: {
    marginBottom: theme.spacing.sm,
  },
  expenseDetailText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
    marginBottom: theme.spacing.xs,
  },
  expenseActions: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.sm,
  },
  actionButton: {
    flex: 1,
  },
  summaryView: {
    gap: theme.spacing.md,
  },
  summaryViewTitle: {
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.primary,
    marginBottom: theme.spacing.md,
  },
  summaryCard: {
    marginBottom: 0,
  },
  summaryCategoryName: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.text,
    marginBottom: theme.spacing.sm,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: theme.spacing.xs,
  },
  summaryLabel: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
  },
  summaryValue: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.text,
    fontWeight: theme.fontWeight.medium,
  },
  summaryAmountText: {
    color: theme.colors.primary,
    fontWeight: theme.fontWeight.bold,
  },
  summaryTotalCard: {
    backgroundColor: theme.colors.secondary,
    marginBottom: 0,
  },
  summaryTotalLabel: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.text,
  },
  summaryTotalValue: {
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.primary,
  },
  monthlyView: {
    gap: theme.spacing.md,
  },
  monthlyViewTitle: {
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.primary,
    marginBottom: theme.spacing.md,
  },
  monthCard: {
    marginBottom: 0,
  },
  monthTitle: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.text,
    marginBottom: theme.spacing.md,
  },
  monthCategoryRow: {
    marginBottom: theme.spacing.sm,
    paddingBottom: theme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  monthCategoryName: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.text,
    marginBottom: theme.spacing.xs,
  },
  monthCategoryStats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  monthCategoryCount: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textMuted,
  },
  monthCategoryAmount: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.primary,
  },
  monthTotal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: theme.spacing.sm,
    paddingTop: theme.spacing.sm,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  monthTotalLabel: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.text,
  },
  monthTotalValue: {
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.primary,
  },
  modalFooter: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    justifyContent: 'flex-end',
  },
  taxCalculatorCard: {
    backgroundColor: theme.colors.secondary,
    marginBottom: theme.spacing.md,
  },
  taxCalculatorTitle: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.text,
    marginBottom: theme.spacing.md,
  },
  taxBreakdown: {
    marginTop: theme.spacing.md,
    paddingTop: theme.spacing.md,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  taxRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: theme.spacing.xs,
  },
  taxLabel: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
  },
  taxValue: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.text,
    fontWeight: theme.fontWeight.medium,
  },
  taxLabelBold: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.text,
  },
  taxValueBold: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.primary,
  },
});

export default ExpensesScreen;
