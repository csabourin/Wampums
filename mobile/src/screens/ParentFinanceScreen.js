/**
 * Parent Finance Screen
 *
 * Port of spa/parent_finance.js
 * Parent-facing finance view showing consolidated balance and participant statements
 * Supports Stripe payment integration (when available)
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
  Alert,
  Linking,
} from 'react-native';
import {
  getParticipants,
  getParticipantStatement,
  getUserChildren,
  createStripePaymentIntent,
  getStripePaymentStatus,
} from '../api/api-endpoints';
import { translate as t } from '../i18n';
import theme, { commonStyles } from '../theme';
import {
  LoadingSpinner,
  ErrorMessage,
  Card,
  StatCard,
  EmptyState,
  Skeleton,
} from '../components';
import DateUtils from '../utils/DateUtils';
import FormatUtils from '../utils/FormatUtils';
import StorageUtils from '../utils/StorageUtils';
import CONFIG from '../config';
import { debugLog, debugError } from '../utils/DebugUtils';

const ParentFinanceScreen = ({ navigation }) => {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const [participants, setParticipants] = useState([]);
  const [participantStatements, setParticipantStatements] = useState(new Map());
  const [consolidatedTotals, setConsolidatedTotals] = useState({
    total_billed: 0,
    total_paid: 0,
    total_outstanding: 0,
  });

  // Stripe payment state
  const [paymentProcessing, setPaymentProcessing] = useState(false);

  /**
   * Load initial data
   */
  const loadData = useCallback(async (isRefresh = false) => {
    if (!isRefresh) {
      setLoading(true);
    }
    setError(null);

    try {
      debugLog('[ParentFinance] Loading participants...');

      const guardianParticipantIds = await StorageUtils.getItem(
        CONFIG.STORAGE_KEYS.GUARDIAN_PARTICIPANTS
      );
      let participantsList = [];

      const childrenResponse = await getUserChildren();
      if (childrenResponse?.success && Array.isArray(childrenResponse.data)) {
        participantsList = childrenResponse.data;
      } else {
        debugLog('[ParentFinance] Falling back to guardian participants from storage...');
        const participantsResponse = await getParticipants();
        const allParticipants = participantsResponse?.data || [];
        if (Array.isArray(guardianParticipantIds)) {
          participantsList = allParticipants.filter((participant) =>
            guardianParticipantIds.includes(participant.id)
          );
        }
      }

      // Remove duplicates
      const uniqueParticipants = Array.from(
        new Map(participantsList.map(p => [p.id, p])).values()
      );

      setParticipants(uniqueParticipants);
      debugLog('[ParentFinance] Loaded participants:', uniqueParticipants.length);

      // Fetch statements for each participant
      if (uniqueParticipants.length > 0) {
        debugLog('[ParentFinance] Loading statements...');
        const statementPromises = uniqueParticipants.map(async (participant) => {
          try {
            const response = await getParticipantStatement(participant.id);
            return {
              participantId: participant.id,
              statement: response?.data || response,
            };
          } catch (err) {
            debugError(`[ParentFinance] Error loading statement for ${participant.id}:`, err);
            return {
              participantId: participant.id,
              statement: null,
            };
          }
        });

        const statements = await Promise.all(statementPromises);

        // Build statements map
        const statementsMap = new Map();
        statements.forEach(({ participantId, statement }) => {
          if (statement) {
            statementsMap.set(participantId, statement);
          }
        });

        setParticipantStatements(statementsMap);
        debugLog('[ParentFinance] Loaded statements:', statementsMap.size);

        // Calculate consolidated totals
        const totals = {
          total_billed: 0,
          total_paid: 0,
          total_outstanding: 0,
        };

        statementsMap.forEach((statement) => {
          const statementTotals = statement?.totals || {};
          totals.total_billed += Number(statementTotals.total_billed) || 0;
          totals.total_paid += Number(statementTotals.total_paid) || 0;
          totals.total_outstanding += Number(statementTotals.total_outstanding) || 0;
        });

        setConsolidatedTotals(totals);
        debugLog('[ParentFinance] Consolidated totals:', totals);
      }

    } catch (err) {
      debugError('[ParentFinance] Error loading data:', err);
      setError(err.message || t('error_default'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadData(true);
  }, [loadData]);

  /**
   * Format currency
   */
  const formatCurrency = (amount = 0) => {
    return FormatUtils.formatCurrency(amount, 'CAD');
  };

  /**
   * Format year range
   */
  const formatYearRange = (start, end) => {
    const startYear = start ? new Date(start).getFullYear() : null;
    const endYear = end ? new Date(end).getFullYear() : null;

    if (startYear && endYear) {
      return startYear === endYear ? String(startYear) : `${startYear}-${endYear}`;
    }
    if (startYear || endYear) {
      return String(startYear || endYear);
    }
    return t('unknown');
  };

  /**
   * Handle payment (opens Stripe payment flow)
   * Note: This opens an external URL for Stripe checkout
   * For native Stripe integration, use @stripe/stripe-react-native
   */
  const handlePayNow = async (feeId, amount, participantName) => {
    Alert.alert(
      t('make_payment'),
      `${t('participant')}: ${participantName}\n${t('amount_to_pay')}: ${formatCurrency(amount)}`,
      [
        {
          text: t('cancel'),
          style: 'cancel',
        },
        {
          text: t('pay_now'),
          onPress: async () => {
            setPaymentProcessing(true);
            try {
              debugLog('[ParentFinance] Creating payment intent...', { feeId, amount });

              const response = await createStripePaymentIntent(feeId, amount);

              if (!response.success || !response.data) {
                throw new Error(response.message || 'Failed to create payment intent');
              }

              const { clientSecret, paymentIntentId } = response.data;

              // For now, show a message that native Stripe integration is coming
              // To implement: Use @stripe/stripe-react-native for native payment UI
              Alert.alert(
                t('payment_system'),
                t('stripe_integration_coming_soon'),
                [
                  {
                    text: t('ok'),
                    onPress: () => {
                      debugLog('[ParentFinance] Payment intent created:', paymentIntentId);
                    },
                  },
                ]
              );

              // TODO: Implement @stripe/stripe-react-native payment flow
              // Example:
              // const { error, paymentIntent } = await confirmPayment(clientSecret);
              // if (error) {
              //   Alert.alert(t('payment_failed'), error.message);
              // } else if (paymentIntent.status === 'succeeded') {
              //   Alert.alert(t('payment_successful'));
              //   loadData(true);
              // }

            } catch (err) {
              debugError('[ParentFinance] Payment error:', err);
              Alert.alert(t('payment_failed'), err.message || t('error_default'));
            } finally {
              setPaymentProcessing(false);
            }
          },
        },
      ]
    );
  };

  /**
   * Render consolidated summary card
   */
  const renderConsolidatedSummary = () => {
    if (participants.length === 0) {
      return null;
    }

    return (
      <Card style={styles.consolidatedCard}>
        <Text style={styles.consolidatedTitle}>{t('consolidated_balance')}</Text>
        <View style={styles.statsContainer}>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>{t('total_billed')}</Text>
            <Text style={styles.statValue}>{formatCurrency(consolidatedTotals.total_billed)}</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>{t('total_paid')}</Text>
            <Text style={styles.statValue}>{formatCurrency(consolidatedTotals.total_paid)}</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>{t('outstanding_balance')}</Text>
            <Text style={[styles.statValue, styles.statValueAlert]}>
              {formatCurrency(consolidatedTotals.total_outstanding)}
            </Text>
          </View>
        </View>
      </Card>
    );
  };

  /**
   * Render participant statement card
   */
  const renderParticipantStatement = (participant) => {
    const statement = participantStatements.get(participant.id);
    const totals = statement?.totals || {
      total_billed: 0,
      total_paid: 0,
      total_outstanding: 0,
    };

    const fees = statement?.fees || [];
    const hasOutstanding = totals.total_outstanding > 0;

    return (
      <Card key={participant.id} style={styles.participantCard}>
        <View style={styles.participantHeader}>
          <Text style={styles.participantName}>
            {participant.first_name} {participant.last_name}
          </Text>
          <View style={[
            styles.statusBadge,
            hasOutstanding ? styles.statusBadgeWarning : styles.statusBadgeSuccess
          ]}>
            <Text style={styles.statusBadgeText}>
              {hasOutstanding ? t('amount_due') : t('paid')}
            </Text>
          </View>
        </View>

        <View style={styles.participantStats}>
          <View style={styles.participantStatItem}>
            <Text style={styles.participantStatLabel}>{t('total_billed')}</Text>
            <Text style={styles.participantStatValue}>{formatCurrency(totals.total_billed)}</Text>
          </View>
          <View style={styles.participantStatItem}>
            <Text style={styles.participantStatLabel}>{t('total_paid')}</Text>
            <Text style={styles.participantStatValue}>{formatCurrency(totals.total_paid)}</Text>
          </View>
          <View style={styles.participantStatItem}>
            <Text style={styles.participantStatLabel}>{t('outstanding_balance')}</Text>
            <Text style={[styles.participantStatValue, styles.participantStatValueAlert]}>
              {formatCurrency(totals.total_outstanding)}
            </Text>
          </View>
        </View>

        {fees.length > 0 && (
          <View style={styles.feesSection}>
            <Text style={styles.feesSectionTitle}>{t('fee_details')}</Text>
            {fees.map((fee) => renderFeeDetail(fee, participant))}
          </View>
        )}
      </Card>
    );
  };

  /**
   * Render fee detail row
   */
  const renderFeeDetail = (fee, participant) => {
    const yearRange = formatYearRange(fee.year_start, fee.year_end);
    const statusLabel = t(fee.status) || fee.status;
    const hasOutstanding = fee.outstanding > 0;

    return (
      <View key={fee.id} style={styles.feeRow}>
        <View style={styles.feeInfo}>
          <Text style={styles.feeYear}>{yearRange}</Text>
          <Text style={styles.feeStatus}>{t('status')}: {statusLabel}</Text>
        </View>

        <View style={styles.feeAmounts}>
          <View style={styles.feeAmountRow}>
            <Text style={styles.feeAmountLabel}>{t('billed')}:</Text>
            <Text style={styles.feeAmountValue}>{formatCurrency(fee.total_amount)}</Text>
          </View>
          <View style={styles.feeAmountRow}>
            <Text style={styles.feeAmountLabel}>{t('paid')}:</Text>
            <Text style={styles.feeAmountValue}>{formatCurrency(fee.total_paid)}</Text>
          </View>
          <View style={styles.feeAmountRow}>
            <Text style={styles.feeAmountLabel}>{t('outstanding')}:</Text>
            <Text style={[styles.feeAmountValue, styles.feeAmountValueAlert]}>
              {formatCurrency(fee.outstanding)}
            </Text>
          </View>
        </View>

        {hasOutstanding && (
          <TouchableOpacity
            style={styles.payButton}
            onPress={() => handlePayNow(
              fee.id,
              fee.outstanding,
              `${participant.first_name} ${participant.last_name}`
            )}
            disabled={paymentProcessing}
          >
            <Text style={styles.payButtonText}>
              💳 {t('pay_now')} ({formatCurrency(fee.outstanding)})
            </Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  if (loading) {
    return (
      <View style={commonStyles.container}>
        <Skeleton.SkeletonDashboard />
      </View>
    );
  }

  if (error) {
    return (
      <View style={commonStyles.container}>
        <ErrorMessage
          message={error}
          onRetry={() => loadData()}
        />
      </View>
    );
  }

  return (
    <View style={commonStyles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        <View style={styles.header}>
          <Text style={styles.title}>{t('my_finances')}</Text>
          <Text style={styles.subtitle}>{t('view_your_financial_summary')}</Text>
        </View>

        {renderConsolidatedSummary()}

        {participants.length === 0 ? (
          <EmptyState
            icon="💰"
            title={t('no_participants')}
            message={t('no_participants_to_display')}
          />
        ) : (
          <View style={styles.participantsSection}>
            <Text style={styles.sectionTitle}>{t('by_participant')}</Text>
            {participants.map((participant) => renderParticipantStatement(participant))}
          </View>
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  header: {
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: theme.colors.text,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: theme.colors.textSecondary,
  },
  consolidatedCard: {
    marginBottom: 24,
    backgroundColor: theme.colors.primary + '10',
  },
  consolidatedTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: theme.colors.text,
    marginBottom: 16,
  },
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statLabel: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    marginBottom: 4,
    textAlign: 'center',
  },
  statValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: theme.colors.text,
  },
  statValueAlert: {
    color: theme.colors.error,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: theme.colors.text,
    marginBottom: 16,
  },
  participantsSection: {
    marginBottom: 24,
  },
  participantCard: {
    marginBottom: 16,
  },
  participantHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  participantName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: theme.colors.text,
    flex: 1,
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  statusBadgeWarning: {
    backgroundColor: theme.colors.warning + '20',
  },
  statusBadgeSuccess: {
    backgroundColor: theme.colors.success + '20',
  },
  statusBadgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  participantStats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  participantStatItem: {
    flex: 1,
    alignItems: 'center',
  },
  participantStatLabel: {
    fontSize: 11,
    color: theme.colors.textSecondary,
    marginBottom: 4,
    textAlign: 'center',
  },
  participantStatValue: {
    fontSize: 16,
    fontWeight: '600',
    color: theme.colors.text,
  },
  participantStatValueAlert: {
    color: theme.colors.error,
  },
  feesSection: {
    marginTop: 8,
  },
  feesSectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.colors.text,
    marginBottom: 12,
  },
  feeRow: {
    marginBottom: 16,
    padding: 12,
    backgroundColor: theme.colors.surface,
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: theme.colors.primary,
  },
  feeInfo: {
    marginBottom: 8,
  },
  feeYear: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.colors.text,
    marginBottom: 4,
  },
  feeStatus: {
    fontSize: 12,
    color: theme.colors.textSecondary,
  },
  feeAmounts: {
    marginBottom: 12,
  },
  feeAmountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  feeAmountLabel: {
    fontSize: 12,
    color: theme.colors.textSecondary,
  },
  feeAmountValue: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.colors.text,
  },
  feeAmountValueAlert: {
    color: theme.colors.error,
  },
  payButton: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  payButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
});

export default ParentFinanceScreen;
