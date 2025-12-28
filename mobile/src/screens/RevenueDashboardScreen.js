/**
 * Revenue Dashboard Screen
 *
 * Mirrors spa/revenue-dashboard.js functionality
 * Comprehensive view of all revenue sources aggregated
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
  Toast,
  useToast,
  EmptyState,
} from '../components';
import { CONFIG } from '../config';
import { API } from '../api/api-core';
import StorageUtils from '../utils/StorageUtils';

const DEFAULT_CURRENCY = 'CAD';

function getCurrentFiscalYear() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();

  if (month >= 8) {
    // September or later
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

const RevenueDashboardScreen = ({ navigation }) => {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const [dashboardData, setDashboardData] = useState(null);
  const [bySourceData, setBySourceData] = useState([]);
  const [byCategoryData, setByCategoryData] = useState([]);
  const [comparisonData, setComparisonData] = useState(null);

  const fiscalYear = useMemo(() => getCurrentFiscalYear(), []);

  // Date range
  const [dateRange, setDateRange] = useState({
    start: fiscalYear.start,
    end: fiscalYear.end,
  });

  // Active tab
  const [activeTab, setActiveTab] = useState('overview'); // overview, by-source, by-category, comparison

  const toast = useToast();

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async (forceRefresh = false) => {
    try {
      setError('');

      await Promise.all([
        loadDashboardData(),
        loadBySourceData(),
        loadByCategoryData(),
        loadComparisonData(),
      ]);
    } catch (err) {
      setError(err.message || t('error_loading_data'));
    } finally {
      setLoading(false);
    }
  };

  const loadDashboardData = async () => {
    try {
      const params = new URLSearchParams({
        start_date: dateRange.start,
        end_date: dateRange.end,
      });

      const response = await fetch(`${API.baseURL}/v1/finance/revenue-dashboard?${params}`, {
        headers: {
          Authorization: `Bearer ${await StorageUtils.getToken()}`,
        },
      });

      if (!response.ok) {
        throw new Error(t('failed_to_load_dashboard_data'));
      }

      const result = await response.json();
      setDashboardData(result.data || null);
    } catch (err) {
      console.error('Error loading dashboard data:', err);
      setDashboardData(null);
    }
  };

  const loadBySourceData = async () => {
    try {
      const params = new URLSearchParams({
        start_date: dateRange.start,
        end_date: dateRange.end,
      });

      const response = await fetch(`${API.baseURL}/v1/finance/revenue-by-source?${params}`, {
        headers: {
          Authorization: `Bearer ${await StorageUtils.getToken()}`,
        },
      });

      if (!response.ok) {
        throw new Error(t('failed_to_load_by_source_data'));
      }

      const result = await response.json();
      setBySourceData(result.data || []);
    } catch (err) {
      console.error('Error loading by source data:', err);
      setBySourceData([]);
    }
  };

  const loadByCategoryData = async () => {
    try {
      const params = new URLSearchParams({
        start_date: dateRange.start,
        end_date: dateRange.end,
      });

      const response = await fetch(`${API.baseURL}/v1/finance/revenue-by-category?${params}`, {
        headers: {
          Authorization: `Bearer ${await StorageUtils.getToken()}`,
        },
      });

      if (!response.ok) {
        throw new Error(t('failed_to_load_by_category_data'));
      }

      const result = await response.json();
      setByCategoryData(result.data || []);
    } catch (err) {
      console.error('Error loading by category data:', err);
      setByCategoryData([]);
    }
  };

  const loadComparisonData = async () => {
    try {
      const params = new URLSearchParams({
        start_date: fiscalYear.start,
        end_date: fiscalYear.end,
      });

      const response = await fetch(`${API.baseURL}/v1/finance/revenue-comparison?${params}`, {
        headers: {
          Authorization: `Bearer ${await StorageUtils.getToken()}`,
        },
      });

      if (!response.ok) {
        throw new Error(t('failed_to_load_comparison_data'));
      }

      const result = await response.json();
      setComparisonData(result.data || null);
    } catch (err) {
      console.error('Error loading comparison data:', err);
      setComparisonData(null);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData(true);
    setRefreshing(false);
  };

  const applyDateRange = async () => {
    setLoading(true);
    await Promise.all([loadDashboardData(), loadBySourceData(), loadByCategoryData()]);
    setLoading(false);
  };

  const resetToFiscalYear = async () => {
    setDateRange({
      start: fiscalYear.start,
      end: fiscalYear.end,
    });
    setLoading(true);
    await Promise.all([loadDashboardData(), loadBySourceData(), loadByCategoryData()]);
    setLoading(false);
  };

  const formatCurrency = (amount) => {
    const value = Number(amount) || 0;
    return new Intl.NumberFormat('en', {
      style: 'currency',
      currency: DEFAULT_CURRENCY,
      maximumFractionDigits: 2,
    }).format(value);
  };

  const getSourceLabel = (source) => {
    const labels = {
      participant_fee: t('participant_fees'),
      fees: t('participant_fees'),
      fundraiser: t('fundraisers'),
      fundraisers: t('fundraisers'),
      calendar_sale: t('calendar_sales'),
      calendar_sales: t('calendar_sales'),
      external: t('external_revenue'),
      other: t('other'),
    };
    return labels[source] || source;
  };

  const renderSummaryCards = () => {
    if (!dashboardData || !dashboardData.totals) {
      return null;
    }

    const totals = dashboardData.totals;

    return (
      <View style={styles.summaryCards}>
        <StatCard
          label={t('total_revenue')}
          value={formatCurrency(totals.total_revenue)}
          detail={`${totals.total_transactions} ${t('transactions')}`}
          icon="💰"
        />
        <StatCard
          label={t('revenue_sources')}
          value={String(totals.sources_count)}
          detail={t('active_sources')}
          icon="📊"
        />
      </View>
    );
  };

  const renderDateRangeSelector = () => {
    return (
      <Card style={styles.dateRangeCard}>
        <Text style={styles.dateRangeTitle}>{t('date_range')}</Text>

        <FormField
          label={t('start_date')}
          value={dateRange.start}
          onChangeText={(value) => setDateRange({ ...dateRange, start: value })}
          placeholder="YYYY-MM-DD"
        />

        <FormField
          label={t('end_date')}
          value={dateRange.end}
          onChangeText={(value) => setDateRange({ ...dateRange, end: value })}
          placeholder="YYYY-MM-DD"
        />

        <View style={styles.dateRangeActions}>
          <TouchableOpacity
            style={[commonStyles.button, styles.dateRangeButton]}
            onPress={applyDateRange}
            activeOpacity={0.7}
          >
            <Text style={commonStyles.buttonText}>{t('apply')}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[commonStyles.buttonSecondary, styles.dateRangeButton]}
            onPress={resetToFiscalYear}
            activeOpacity={0.7}
          >
            <Text style={commonStyles.buttonSecondaryText}>{t('reset_to_fiscal_year')}</Text>
          </TouchableOpacity>
        </View>
      </Card>
    );
  };

  const renderOverview = () => {
    if (!dashboardData || !dashboardData.breakdown) {
      return <EmptyState message={t('no_data_available')} icon="📊" />;
    }

    // Group breakdown by source
    const sourceGroups = {};
    dashboardData.breakdown.forEach((item) => {
      const source = item.revenue_source || 'other';
      if (!sourceGroups[source]) {
        sourceGroups[source] = {
          source: source,
          items: [],
          total: 0,
          count: 0,
        };
      }
      sourceGroups[source].items.push(item);
      sourceGroups[source].total += item.total_amount;
      sourceGroups[source].count += item.transaction_count;
    });

    return (
      <View style={styles.overviewSection}>
        <Text style={styles.sectionTitle}>{t('revenue_by_source_and_category')}</Text>

        {Object.values(sourceGroups).map((group) => (
          <Card key={group.source} style={styles.sourceGroupCard}>
            <Text style={styles.sourceGroupTitle}>{getSourceLabel(group.source)}</Text>

            <View style={styles.sourceGroupSummary}>
              <Text style={styles.sourceGroupTotal}>{formatCurrency(group.total)}</Text>
              <Text style={styles.sourceGroupCount}>
                {group.count} {t('transactions')}
              </Text>
            </View>

            {group.items.map((item, index) => {
              const percentage = group.total > 0 ? (item.total_amount / group.total) * 100 : 0;
              return (
                <View key={index} style={styles.sourceGroupItem}>
                  <View style={styles.sourceGroupItemRow}>
                    <Text style={styles.sourceGroupItemCategory}>
                      {item.category_name || t('uncategorized')}
                    </Text>
                    <Text style={styles.sourceGroupItemAmount}>
                      {formatCurrency(item.total_amount)}
                    </Text>
                  </View>

                  <View style={styles.sourceGroupItemStats}>
                    <Text style={styles.sourceGroupItemCount}>
                      {item.transaction_count} {t('transactions')}
                    </Text>
                    <Text style={styles.sourceGroupItemPercentage}>{percentage.toFixed(1)}%</Text>
                  </View>
                </View>
              );
            })}
          </Card>
        ))}
      </View>
    );
  };

  const renderBySource = () => {
    if (!bySourceData || bySourceData.length === 0) {
      return <EmptyState message={t('no_data_available')} icon="📊" />;
    }

    const totalRevenue = bySourceData.reduce((sum, item) => sum + item.total_amount, 0);

    return (
      <View style={styles.bySourceSection}>
        <Text style={styles.sectionTitle}>{t('revenue_breakdown_by_source')}</Text>

        {/* Horizontal Bar Chart */}
        <Card style={styles.chartCard}>
          {bySourceData.map((item) => {
            const percentage = totalRevenue > 0 ? (item.total_amount / totalRevenue) * 100 : 0;
            return (
              <View key={item.revenue_source} style={styles.chartBarItem}>
                <View style={styles.chartLabelRow}>
                  <Text style={styles.chartLabel}>{getSourceLabel(item.revenue_source)}</Text>
                  <Text style={styles.chartValue}>{formatCurrency(item.total_amount)}</Text>
                </View>
                <View style={styles.chartBarContainer}>
                  <View style={[styles.chartBar, { width: `${percentage}%` }]} />
                </View>
                <Text style={styles.chartPercentage}>{percentage.toFixed(1)}%</Text>
              </View>
            );
          })}
        </Card>

        {/* Data Table */}
        {bySourceData.map((item) => {
          const percentage = totalRevenue > 0 ? (item.total_amount / totalRevenue) * 100 : 0;
          return (
            <Card key={`table-${item.revenue_source}`} style={styles.dataCard}>
              <Text style={styles.dataCardTitle}>{getSourceLabel(item.revenue_source)}</Text>

              <View style={styles.dataRow}>
                <Text style={styles.dataLabel}>{t('transactions')}:</Text>
                <Text style={styles.dataValue}>{item.transaction_count}</Text>
              </View>

              <View style={styles.dataRow}>
                <Text style={styles.dataLabel}>{t('total_amount')}:</Text>
                <Text style={[styles.dataValue, styles.dataAmountText]}>
                  {formatCurrency(item.total_amount)}
                </Text>
              </View>

              <View style={styles.dataRow}>
                <Text style={styles.dataLabel}>{t('percentage_of_total')}:</Text>
                <Text style={styles.dataValue}>{percentage.toFixed(1)}%</Text>
              </View>
            </Card>
          );
        })}

        {/* Total */}
        <Card style={styles.totalCard}>
          <View style={styles.dataRow}>
            <Text style={styles.totalLabel}>{t('total')}:</Text>
            <Text style={[styles.totalValue, styles.dataAmountText]}>
              {formatCurrency(totalRevenue)}
            </Text>
          </View>
        </Card>
      </View>
    );
  };

  const renderByCategory = () => {
    if (!byCategoryData || byCategoryData.length === 0) {
      return <EmptyState message={t('no_data_available')} icon="📊" />;
    }

    const totalRevenue = byCategoryData.reduce((sum, item) => sum + item.total_amount, 0);

    return (
      <View style={styles.byCategorySection}>
        <Text style={styles.sectionTitle}>{t('revenue_breakdown_by_category')}</Text>

        {/* Horizontal Bar Chart */}
        <Card style={styles.chartCard}>
          {byCategoryData.map((item) => {
            const percentage = totalRevenue > 0 ? (item.total_amount / totalRevenue) * 100 : 0;
            return (
              <View key={item.category_id || 'uncategorized'} style={styles.chartBarItem}>
                <View style={styles.chartLabelRow}>
                  <Text style={styles.chartLabel}>
                    {item.category_name || t('uncategorized')}
                  </Text>
                  <Text style={styles.chartValue}>{formatCurrency(item.total_amount)}</Text>
                </View>
                <View style={styles.chartBarContainer}>
                  <View style={[styles.chartBar, { width: `${percentage}%` }]} />
                </View>
                <Text style={styles.chartPercentage}>{percentage.toFixed(1)}%</Text>
              </View>
            );
          })}
        </Card>

        {/* Data Table */}
        {byCategoryData.map((item) => {
          const percentage = totalRevenue > 0 ? (item.total_amount / totalRevenue) * 100 : 0;
          return (
            <Card
              key={`table-${item.category_id || 'uncategorized'}`}
              style={styles.dataCard}
            >
              <Text style={styles.dataCardTitle}>
                {item.category_name || t('uncategorized')}
              </Text>

              <View style={styles.dataRow}>
                <Text style={styles.dataLabel}>{t('transactions')}:</Text>
                <Text style={styles.dataValue}>{item.transaction_count}</Text>
              </View>

              <View style={styles.dataRow}>
                <Text style={styles.dataLabel}>{t('total_amount')}:</Text>
                <Text style={[styles.dataValue, styles.dataAmountText]}>
                  {formatCurrency(item.total_amount)}
                </Text>
              </View>

              <View style={styles.dataRow}>
                <Text style={styles.dataLabel}>{t('percentage_of_total')}:</Text>
                <Text style={styles.dataValue}>{percentage.toFixed(1)}%</Text>
              </View>
            </Card>
          );
        })}

        {/* Total */}
        <Card style={styles.totalCard}>
          <View style={styles.dataRow}>
            <Text style={styles.totalLabel}>{t('total')}:</Text>
            <Text style={[styles.totalValue, styles.dataAmountText]}>
              {formatCurrency(totalRevenue)}
            </Text>
          </View>
        </Card>
      </View>
    );
  };

  const renderComparison = () => {
    if (!comparisonData || !comparisonData.comparison) {
      return <EmptyState message={t('no_comparison_data')} icon="📊" />;
    }

    const comparison = comparisonData.comparison;
    const totals = comparisonData.totals;

    return (
      <View style={styles.comparisonSection}>
        <Text style={styles.sectionTitle}>{t('budgeted_vs_actual_revenue')}</Text>
        <Text style={styles.sectionSubtitle}>
          {t('fiscal_year')}: {fiscalYear.label}
        </Text>

        {/* Summary Cards */}
        <View style={styles.comparisonSummary}>
          <Card style={styles.comparisonCard}>
            <Text style={styles.comparisonLabel}>{t('budgeted_revenue')}</Text>
            <Text style={styles.comparisonValue}>{formatCurrency(totals.budgeted_revenue)}</Text>
          </Card>

          <Card style={styles.comparisonCard}>
            <Text style={styles.comparisonLabel}>{t('actual_revenue')}</Text>
            <Text style={[styles.comparisonValue, styles.dataAmountText]}>
              {formatCurrency(totals.actual_revenue)}
            </Text>
          </Card>

          <Card
            style={[
              styles.comparisonCard,
              totals.variance >= 0 ? styles.positiveCard : styles.negativeCard,
            ]}
          >
            <Text style={styles.comparisonLabel}>{t('variance')}</Text>
            <Text style={styles.comparisonValue}>
              {formatCurrency(Math.abs(totals.variance))}
            </Text>
            <Text style={styles.comparisonPercentage}>
              {totals.variance_percent.toFixed(1)}%
            </Text>
          </Card>
        </View>

        {/* Comparison Table */}
        {comparison.map((item) => (
          <Card key={item.category_id || 'uncategorized'} style={styles.comparisonItemCard}>
            <Text style={styles.comparisonItemTitle}>
              {item.category_name || t('uncategorized')}
            </Text>

            <View style={styles.dataRow}>
              <Text style={styles.dataLabel}>{t('budgeted')}:</Text>
              <Text style={styles.dataValue}>{formatCurrency(item.budgeted_revenue)}</Text>
            </View>

            <View style={styles.dataRow}>
              <Text style={styles.dataLabel}>{t('actual')}:</Text>
              <Text style={[styles.dataValue, styles.dataAmountText]}>
                {formatCurrency(item.actual_revenue)}
              </Text>
            </View>

            <View style={styles.dataRow}>
              <Text style={styles.dataLabel}>{t('variance')}:</Text>
              <Text
                style={[
                  styles.dataValue,
                  item.variance >= 0 ? styles.positiveText : styles.negativeText,
                ]}
              >
                {formatCurrency(Math.abs(item.variance))}
              </Text>
            </View>

            <View style={styles.dataRow}>
              <Text style={styles.dataLabel}>{t('variance_percentage')}:</Text>
              <Text
                style={[
                  styles.dataValue,
                  item.variance >= 0 ? styles.positiveText : styles.negativeText,
                ]}
              >
                {Math.abs(item.variance_percent).toFixed(1)}%
              </Text>
            </View>
          </Card>
        ))}
      </View>
    );
  };

  const renderTabContent = () => {
    switch (activeTab) {
      case 'overview':
        return renderOverview();
      case 'by-source':
        return renderBySource();
      case 'by-category':
        return renderByCategory();
      case 'comparison':
        return renderComparison();
      default:
        return null;
    }
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
          <Text style={styles.title}>{t('revenue_dashboard')}</Text>
          <Text style={styles.fiscalYearLabel}>
            {t('fiscal_year')}: <Text style={styles.fiscalYearValue}>{fiscalYear.label}</Text>
          </Text>
        </Card>

        {/* Date Range Selector */}
        {renderDateRangeSelector()}

        {/* Summary Cards */}
        {renderSummaryCards()}

        {/* Tab Navigation */}
        <View style={styles.tabNavigation}>
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
            style={[styles.tabButton, activeTab === 'by-source' && styles.tabButtonActive]}
            onPress={() => setActiveTab('by-source')}
            activeOpacity={0.7}
          >
            <Text
              style={[
                styles.tabButtonText,
                activeTab === 'by-source' && styles.tabButtonTextActive,
              ]}
            >
              {t('by_source')}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tabButton, activeTab === 'by-category' && styles.tabButtonActive]}
            onPress={() => setActiveTab('by-category')}
            activeOpacity={0.7}
          >
            <Text
              style={[
                styles.tabButtonText,
                activeTab === 'by-category' && styles.tabButtonTextActive,
              ]}
            >
              {t('by_category')}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tabButton, activeTab === 'comparison' && styles.tabButtonActive]}
            onPress={() => setActiveTab('comparison')}
            activeOpacity={0.7}
          >
            <Text
              style={[
                styles.tabButtonText,
                activeTab === 'comparison' && styles.tabButtonTextActive,
              ]}
            >
              {t('budget_comparison')}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Tab Content */}
        {renderTabContent()}
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
  dateRangeCard: {
    marginBottom: theme.spacing.md,
  },
  dateRangeTitle: {
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.primary,
    marginBottom: theme.spacing.md,
  },
  dateRangeActions: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.md,
  },
  dateRangeButton: {
    flex: 1,
  },
  summaryCards: {
    marginBottom: theme.spacing.md,
    gap: theme.spacing.md,
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
    fontSize: theme.fontSize.xs,
    color: theme.colors.text,
    fontWeight: theme.fontWeight.medium,
    textAlign: 'center',
  },
  tabButtonTextActive: {
    color: theme.colors.white,
    fontWeight: theme.fontWeight.bold,
  },
  sectionTitle: {
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.primary,
    marginBottom: theme.spacing.md,
  },
  sectionSubtitle: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
    marginBottom: theme.spacing.md,
  },
  overviewSection: {
    gap: theme.spacing.md,
  },
  sourceGroupCard: {
    marginBottom: 0,
  },
  sourceGroupTitle: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.text,
    marginBottom: theme.spacing.sm,
  },
  sourceGroupSummary: {
    marginBottom: theme.spacing.md,
  },
  sourceGroupTotal: {
    fontSize: theme.fontSize.xl,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.success,
    marginBottom: theme.spacing.xs,
  },
  sourceGroupCount: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
  },
  sourceGroupItem: {
    marginBottom: theme.spacing.sm,
    paddingBottom: theme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  sourceGroupItemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: theme.spacing.xs,
  },
  sourceGroupItemCategory: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.text,
  },
  sourceGroupItemAmount: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.primary,
  },
  sourceGroupItemStats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  sourceGroupItemCount: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textMuted,
  },
  sourceGroupItemPercentage: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textMuted,
  },
  bySourceSection: {
    gap: theme.spacing.md,
  },
  chartCard: {
    marginBottom: 0,
  },
  chartBarItem: {
    marginBottom: theme.spacing.md,
  },
  chartLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: theme.spacing.xs,
  },
  chartLabel: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.text,
    flex: 1,
  },
  chartValue: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.primary,
  },
  chartBarContainer: {
    height: 20,
    backgroundColor: theme.colors.border,
    borderRadius: theme.borderRadius.sm,
    overflow: 'hidden',
    marginBottom: theme.spacing.xs,
  },
  chartBar: {
    height: '100%',
    backgroundColor: theme.colors.success,
    borderRadius: theme.borderRadius.sm,
  },
  chartPercentage: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textMuted,
    textAlign: 'right',
  },
  dataCard: {
    marginBottom: 0,
  },
  dataCardTitle: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.text,
    marginBottom: theme.spacing.md,
  },
  dataRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: theme.spacing.xs,
  },
  dataLabel: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
  },
  dataValue: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.text,
    fontWeight: theme.fontWeight.medium,
  },
  dataAmountText: {
    color: theme.colors.success,
    fontWeight: theme.fontWeight.bold,
  },
  totalCard: {
    backgroundColor: theme.colors.secondary,
    marginBottom: 0,
  },
  totalLabel: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.text,
  },
  totalValue: {
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.primary,
  },
  byCategorySection: {
    gap: theme.spacing.md,
  },
  comparisonSection: {
    gap: theme.spacing.md,
  },
  comparisonSummary: {
    gap: theme.spacing.md,
  },
  comparisonCard: {
    marginBottom: 0,
    alignItems: 'center',
  },
  positiveCard: {
    backgroundColor: theme.colors.successLight || '#e8f5e9',
  },
  negativeCard: {
    backgroundColor: theme.colors.errorLight || '#ffebee',
  },
  comparisonLabel: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
    marginBottom: theme.spacing.xs,
  },
  comparisonValue: {
    fontSize: theme.fontSize.xl,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.text,
    marginBottom: theme.spacing.xs,
  },
  comparisonPercentage: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
  },
  comparisonItemCard: {
    marginBottom: 0,
  },
  comparisonItemTitle: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.text,
    marginBottom: theme.spacing.md,
  },
  positiveText: {
    color: theme.colors.success,
  },
  negativeText: {
    color: theme.colors.error,
  },
});

export default RevenueDashboardScreen;
