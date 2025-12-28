/**
 * Budgets Screen
 *
 * Mirrors spa/budgets.js functionality
 * Budget management with categories, items, and expense tracking
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
} from 'react-native';
import {
  getBudgetCategories,
  getBudgetItems,
  getBudgetExpenses,
  getBudgetSummaryReport,
  createBudgetCategory,
  updateBudgetCategory,
  createBudgetItem,
  updateBudgetItem,
  createBudgetExpense,
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
  Toast,
  useToast,
  StatCard,
  EmptyState,
} from '../components';
import { canViewBudget } from '../utils/PermissionUtils';
import DateUtils from '../utils/DateUtils';
import SecurityUtils from '../utils/SecurityUtils';

const DEFAULT_CURRENCY = 'CAD';

const BudgetsScreen = ({ navigation }) => {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [categories, setCategories] = useState([]);
  const [items, setItems] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [summaryReport, setSummaryReport] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [fiscalYear, setFiscalYear] = useState(getCurrentFiscalYear());

  const [categoryModalVisible, setCategoryModalVisible] = useState(false);
  const [categoryForm, setCategoryForm] = useState({ name: '', description: '' });
  const [editingCategory, setEditingCategory] = useState(null);

  const [itemModalVisible, setItemModalVisible] = useState(false);
  const [itemForm, setItemForm] = useState({
    category_id: '',
    name: '',
    budgeted_amount: '',
    description: '',
  });
  const [editingItem, setEditingItem] = useState(null);

  const [saving, setSaving] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (!canViewBudget()) {
      navigation.navigate('Dashboard');
      return;
    }

    loadData();
  }, []);

  function getCurrentFiscalYear() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();

    if (month >= 8) {
      return {
        start: `${year}-09-01`,
        end: `${year + 1}-08-31`,
        label: `${year}-${year + 1}`,
      };
    } else {
      return {
        start: `${year - 1}-09-01`,
        end: `${year}-08-31`,
        label: `${year - 1}-${year}`,
      };
    }
  }

  const loadData = async (forceRefresh = false) => {
    try {
      setError('');

      const [categoriesRes, itemsRes, expensesRes, summaryRes] = await Promise.all([
        getBudgetCategories({}, { forceRefresh }),
        getBudgetItems(null, { forceRefresh }),
        getBudgetExpenses(
          { start_date: fiscalYear.start, end_date: fiscalYear.end },
          { forceRefresh }
        ),
        getBudgetSummaryReport(fiscalYear.start, fiscalYear.end, { forceRefresh }),
      ]);

      setCategories(categoriesRes?.data || []);
      setItems(itemsRes?.data || []);
      setExpenses(expensesRes?.data || []);
      setSummaryReport(summaryRes?.data || null);
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

  const handleAddCategory = () => {
    setEditingCategory(null);
    setCategoryForm({ name: '', description: '' });
    setCategoryModalVisible(true);
  };

  const handleSaveCategory = async () => {
    if (!categoryForm.name.trim()) {
      toast.show(t('category_name_required'), 'warning');
      return;
    }

    try {
      setSaving(true);

      const payload = {
        name: SecurityUtils.sanitizeInput(categoryForm.name),
        description: SecurityUtils.sanitizeInput(categoryForm.description),
      };

      let result;
      if (editingCategory) {
        result = await updateBudgetCategory(editingCategory.id, payload);
      } else {
        result = await createBudgetCategory(payload);
      }

      if (result.success) {
        toast.show(
          editingCategory ? t('category_updated') : t('category_created'),
          'success'
        );
        setCategoryModalVisible(false);
        await loadData(true);
      } else {
        throw new Error(result.message || t('error_saving_category'));
      }
    } catch (err) {
      toast.show(err.message || t('error_saving_category'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleAddItem = () => {
    setEditingItem(null);
    setItemForm({
      category_id: categories[0]?.id || '',
      name: '',
      budgeted_amount: '',
      description: '',
    });
    setItemModalVisible(true);
  };

  const handleSaveItem = async () => {
    if (!itemForm.name.trim() || !itemForm.budgeted_amount) {
      toast.show(t('fill_required_fields'), 'warning');
      return;
    }

    try {
      setSaving(true);

      const payload = {
        category_id: parseInt(itemForm.category_id, 10),
        name: SecurityUtils.sanitizeInput(itemForm.name),
        budgeted_amount: Number(itemForm.budgeted_amount),
        description: SecurityUtils.sanitizeInput(itemForm.description),
      };

      let result;
      if (editingItem) {
        result = await updateBudgetItem(editingItem.id, payload);
      } else {
        result = await createBudgetItem(payload);
      }

      if (result.success) {
        toast.show(editingItem ? t('item_updated') : t('item_created'), 'success');
        setItemModalVisible(false);
        await loadData(true);
      } else {
        throw new Error(result.message || t('error_saving_item'));
      }
    } catch (err) {
      toast.show(err.message || t('error_saving_item'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const categoryOptions = categories.map((c) => ({ label: c.name, value: String(c.id) }));

  if (loading && !refreshing) {
    return <LoadingSpinner message={t('loading')} />;
  }

  if (error && !loading) {
    return <ErrorMessage message={error} onRetry={loadData} />;
  }

  const totalBudgeted = summaryReport?.total_budgeted || 0;
  const totalSpent = summaryReport?.total_spent || 0;
  const remaining = totalBudgeted - totalSpent;

  return (
    <View style={commonStyles.container}>
      <View style={styles.tabNav}>
        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'overview' && styles.tabButtonActive]}
          onPress={() => setActiveTab('overview')}
          activeOpacity={0.7}
        >
          <Text
            style={[
              styles.tabButtonText,
              activeTab === 'overview' && styles.tabButtonTextActive,
            ]}
          >
            {t('overview')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'categories' && styles.tabButtonActive]}
          onPress={() => setActiveTab('categories')}
          activeOpacity={0.7}
        >
          <Text
            style={[
              styles.tabButtonText,
              activeTab === 'categories' && styles.tabButtonTextActive,
            ]}
          >
            {t('categories')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'items' && styles.tabButtonActive]}
          onPress={() => setActiveTab('items')}
          activeOpacity={0.7}
        >
          <Text
            style={[styles.tabButtonText, activeTab === 'items' && styles.tabButtonTextActive]}
          >
            {t('items')}
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContainer}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {activeTab === 'overview' && (
          <>
            <Card style={styles.card}>
              <Text style={styles.fiscalYearText}>
                {t('fiscal_year')}: {fiscalYear.label}
              </Text>
            </Card>

            <View style={styles.statsRow}>
              <StatCard
                label={t('total_budgeted')}
                value={formatCurrency(totalBudgeted)}
                style={styles.statCard}
              />
              <StatCard
                label={t('total_spent')}
                value={formatCurrency(totalSpent)}
                style={styles.statCard}
              />
              <StatCard
                label={t('remaining')}
                value={formatCurrency(remaining)}
                style={styles.statCard}
              />
            </View>

            <Card style={styles.card}>
              <Text style={styles.sectionTitle}>{t('budget_by_category')}</Text>
              {categories.length === 0 ? (
                <EmptyState icon="📊" title={t('no_categories')} message="" />
              ) : (
                categories.map((category) => {
                  const categoryItems = items.filter((i) => i.category_id === category.id);
                  const categoryBudget = categoryItems.reduce(
                    (sum, item) => sum + (Number(item.budgeted_amount) || 0),
                    0
                  );
                  const categorySpent = expenses
                    .filter((e) =>
                      categoryItems.some((item) => item.id === e.budget_item_id)
                    )
                    .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

                  return (
                    <View key={category.id} style={styles.categoryRow}>
                      <Text style={styles.categoryName}>{category.name}</Text>
                      <View style={styles.categoryAmounts}>
                        <Text style={styles.categoryBudget}>
                          {formatCurrency(categoryBudget)}
                        </Text>
                        <Text style={styles.categorySpent}>
                          {formatCurrency(categorySpent)}
                        </Text>
                      </View>
                    </View>
                  );
                })
              )}
            </Card>
          </>
        )}

        {activeTab === 'categories' && (
          <Card style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.sectionTitle}>{t('budget_categories')}</Text>
              <TouchableOpacity
                style={styles.addButton}
                onPress={handleAddCategory}
                activeOpacity={0.7}
              >
                <Text style={styles.addButtonText}>+ {t('add')}</Text>
              </TouchableOpacity>
            </View>

            {categories.length === 0 ? (
              <EmptyState
                icon="📂"
                title={t('no_categories')}
                actionLabel={t('add_category')}
                onAction={handleAddCategory}
              />
            ) : (
              categories.map((category) => (
                <View key={category.id} style={styles.listItem}>
                  <View style={styles.listItemInfo}>
                    <Text style={styles.listItemName}>{category.name}</Text>
                    {category.description && (
                      <Text style={styles.listItemDescription}>{category.description}</Text>
                    )}
                  </View>
                </View>
              ))
            )}
          </Card>
        )}

        {activeTab === 'items' && (
          <Card style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.sectionTitle}>{t('budget_items')}</Text>
              <TouchableOpacity
                style={styles.addButton}
                onPress={handleAddItem}
                activeOpacity={0.7}
              >
                <Text style={styles.addButtonText}>+ {t('add')}</Text>
              </TouchableOpacity>
            </View>

            {items.length === 0 ? (
              <EmptyState
                icon="📝"
                title={t('no_items')}
                actionLabel={t('add_item')}
                onAction={handleAddItem}
              />
            ) : (
              items.map((item) => {
                const category = categories.find((c) => c.id === item.category_id);
                return (
                  <View key={item.id} style={styles.listItem}>
                    <View style={styles.listItemInfo}>
                      <Text style={styles.listItemName}>{item.name}</Text>
                      <Text style={styles.listItemCategory}>
                        {category?.name || t('unknown')}
                      </Text>
                      <Text style={styles.listItemAmount}>
                        {formatCurrency(item.budgeted_amount)}
                      </Text>
                    </View>
                  </View>
                );
              })
            )}
          </Card>
        )}
      </ScrollView>

      {/* Category Modal */}
      <Modal
        visible={categoryModalVisible}
        onClose={() => setCategoryModalVisible(false)}
        title={editingCategory ? t('edit_category') : t('add_category')}
        footer={
          <View style={styles.modalFooter}>
            <TouchableOpacity
              style={commonStyles.buttonSecondary}
              onPress={() => setCategoryModalVisible(false)}
              activeOpacity={0.7}
            >
              <Text style={commonStyles.buttonSecondaryText}>{t('cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[commonStyles.button, saving && commonStyles.buttonDisabled]}
              onPress={handleSaveCategory}
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
          value={categoryForm.name}
          onChangeText={(val) => setCategoryForm((prev) => ({ ...prev, name: val }))}
          required
        />
        <FormField
          label={t('description')}
          value={categoryForm.description}
          onChangeText={(val) => setCategoryForm((prev) => ({ ...prev, description: val }))}
          multiline
          numberOfLines={3}
        />
      </Modal>

      {/* Item Modal */}
      <Modal
        visible={itemModalVisible}
        onClose={() => setItemModalVisible(false)}
        title={editingItem ? t('edit_item') : t('add_item')}
        footer={
          <View style={styles.modalFooter}>
            <TouchableOpacity
              style={commonStyles.buttonSecondary}
              onPress={() => setItemModalVisible(false)}
              activeOpacity={0.7}
            >
              <Text style={commonStyles.buttonSecondaryText}>{t('cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[commonStyles.button, saving && commonStyles.buttonDisabled]}
              onPress={handleSaveItem}
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
        <Select
          label={t('category')}
          value={itemForm.category_id}
          onValueChange={(val) => setItemForm((prev) => ({ ...prev, category_id: val }))}
          options={categoryOptions}
          required
        />
        <FormField
          label={t('name')}
          value={itemForm.name}
          onChangeText={(val) => setItemForm((prev) => ({ ...prev, name: val }))}
          required
        />
        <FormField
          label={t('budgeted_amount')}
          value={itemForm.budgeted_amount}
          onChangeText={(val) => setItemForm((prev) => ({ ...prev, budgeted_amount: val }))}
          keyboardType="decimal-pad"
          required
        />
        <FormField
          label={t('description')}
          value={itemForm.description}
          onChangeText={(val) => setItemForm((prev) => ({ ...prev, description: val }))}
          multiline
          numberOfLines={3}
        />
      </Modal>

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
  card: {
    marginBottom: theme.spacing.md,
  },
  fiscalYearText: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.primary,
    textAlign: 'center',
  },
  statsRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.md,
  },
  statCard: {
    flex: 1,
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
  categoryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  categoryName: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.text,
    flex: 1,
  },
  categoryAmounts: {
    flexDirection: 'row',
    gap: theme.spacing.md,
  },
  categoryBudget: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.primary,
  },
  categorySpent: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
  },
  listItem: {
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  listItemInfo: {
    gap: theme.spacing.xs,
  },
  listItemName: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.text,
  },
  listItemDescription: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
  },
  listItemCategory: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.primary,
    fontStyle: 'italic',
  },
  listItemAmount: {
    fontSize: theme.fontSize.base,
    color: theme.colors.success,
    fontWeight: theme.fontWeight.semibold,
  },
  modalFooter: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    justifyContent: 'flex-end',
  },
});

export default BudgetsScreen;
