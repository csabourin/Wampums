/**
 * Calendar Screen
 *
 * Mirrors spa/calendars.js functionality
 * Track calendar sales for fundraisers with inline editing
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
} from 'react-native';
import { translate as t } from '../i18n';
import theme, { commonStyles } from '../theme';
import {
  LoadingSpinner,
  ErrorMessage,
  Card,
  StatCard,
  Checkbox,
  Toast,
  useToast,
  EmptyState,
} from '../components';
import { CONFIG } from '../config';
import { API } from '../api/api-core';
import StorageUtils from '../utils/StorageUtils';

const CalendarScreen = ({ route, navigation }) => {
  const { fundraiserId } = route.params || {};

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const [fundraiser, setFundraiser] = useState(null);
  const [calendars, setCalendars] = useState([]);
  const [sortBy, setSortBy] = useState('name'); // 'name' or 'paid'

  const toast = useToast();

  useEffect(() => {
    if (!fundraiserId) {
      setError(t('error_no_fundraiser_id'));
      setLoading(false);
      return;
    }

    loadData();
  }, [fundraiserId]);

  const loadData = async (forceRefresh = false) => {
    try {
      setError('');

      await Promise.all([loadFundraiser(), loadCalendars()]);
    } catch (err) {
      setError(err.message || t('error_loading_data'));
    } finally {
      setLoading(false);
    }
  };

  const loadFundraiser = async () => {
    try {
      const response = await fetch(`${API.baseURL}/v1/fundraisers/${fundraiserId}`, {
        headers: {
          Authorization: `Bearer ${await StorageUtils.getToken()}`,
        },
      });

      if (!response.ok) {
        throw new Error(t('error_fetching_fundraiser'));
      }

      const result = await response.json();
      if (result.success && result.fundraiser) {
        setFundraiser(result.fundraiser);
      }
    } catch (err) {
      console.error('Error loading fundraiser:', err);
      throw err;
    }
  };

  const loadCalendars = async () => {
    try {
      const response = await fetch(`${API.baseURL}/v1/fundraisers/${fundraiserId}/entries`, {
        headers: {
          Authorization: `Bearer ${await StorageUtils.getToken()}`,
        },
      });

      if (!response.ok) {
        throw new Error(t('error_fetching_fundraiser_entries'));
      }

      const result = await response.json();
      setCalendars(result.fundraiser_entries || []);
    } catch (err) {
      console.error('Error loading calendars:', err);
      setCalendars([]);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData(true);
    setRefreshing(false);
  };

  const sortedCalendars = useMemo(() => {
    const sorted = [...calendars];

    if (sortBy === 'name') {
      sorted.sort((a, b) => a.first_name.localeCompare(b.first_name));
    } else if (sortBy === 'paid') {
      // Sort by paid status (unpaid first), then by name
      sorted.sort((a, b) => {
        if (a.paid === b.paid) {
          return a.first_name.localeCompare(b.first_name);
        }
        return a.paid ? 1 : -1;
      });
    }

    return sorted;
  }, [calendars, sortBy]);

  const totalAmount = useMemo(() => {
    return calendars.reduce((sum, calendar) => sum + (parseInt(calendar.calendar_amount) || 0), 0);
  }, [calendars]);

  const totalPaid = useMemo(() => {
    return calendars.reduce((sum, calendar) => sum + (parseFloat(calendar.amount_paid) || 0), 0);
  }, [calendars]);

  const paidCount = useMemo(() => {
    return calendars.filter((calendar) => calendar.paid).length;
  }, [calendars]);

  const updateCalendarAmount = async (calendarId, amount) => {
    try {
      const response = await fetch(
        `${API.baseURL}/v1/fundraisers/${fundraiserId}/entries/${calendarId}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${await StorageUtils.getToken()}`,
          },
          body: JSON.stringify({ amount: parseInt(amount) || 0 }),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || t('error_updating_fundraiser_entry_amount'));
      }

      // Update local state
      setCalendars((prev) =>
        prev.map((c) =>
          c.id === calendarId ? { ...c, calendar_amount: parseInt(amount) || 0 } : c
        )
      );

      toast.show(t('fundraiser_entry_amount_updated'), 'success');
    } catch (err) {
      toast.show(err.message || t('error_updating_fundraiser_entry_amount'), 'error');
    }
  };

  const updateCalendarAmountPaid = async (calendarId, amountPaid) => {
    try {
      const response = await fetch(
        `${API.baseURL}/v1/fundraisers/${fundraiserId}/entries/${calendarId}/payment`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${await StorageUtils.getToken()}`,
          },
          body: JSON.stringify({ amount_paid: parseFloat(amountPaid) || 0 }),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || t('error_updating_fundraiser_entry_amount_paid'));
      }

      const result = await response.json();

      // Update local state
      setCalendars((prev) =>
        prev.map((c) =>
          c.id === calendarId
            ? {
                ...c,
                amount_paid: parseFloat(amountPaid) || 0,
                paid: result.data?.paid !== undefined ? result.data.paid : c.paid,
              }
            : c
        )
      );

      toast.show(t('fundraiser_entry_amount_paid_updated'), 'success');
    } catch (err) {
      toast.show(err.message || t('error_updating_fundraiser_entry_amount_paid'), 'error');
    }
  };

  const updateCalendarPaid = async (calendarId, paid) => {
    try {
      const response = await fetch(
        `${API.baseURL}/v1/fundraisers/${fundraiserId}/entries/${calendarId}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${await StorageUtils.getToken()}`,
          },
          body: JSON.stringify({ paid }),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || t('error_updating_fundraiser_entry_paid_status'));
      }

      // Update local state
      setCalendars((prev) => prev.map((c) => (c.id === calendarId ? { ...c, paid } : c)));

      toast.show(t('fundraiser_entry_paid_status_updated'), 'success');
    } catch (err) {
      toast.show(err.message || t('error_updating_fundraiser_entry_paid_status'), 'error');
    }
  };

  const renderCalendarItem = (calendar) => {
    return (
      <Card key={calendar.id} style={styles.calendarCard}>
        <View style={styles.calendarHeader}>
          <Text style={styles.calendarName}>
            {calendar.first_name} {calendar.last_name}
          </Text>
          {calendar.paid && <Text style={styles.paidBadge}>✓ {t('paid')}</Text>}
        </View>

        <Text style={styles.calendarGroup}>
          {calendar.group_name || t('no_group')}
        </Text>

        {/* Amount */}
        <View style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>{t('amount')}:</Text>
          <TextInput
            style={styles.fieldInput}
            value={String(calendar.calendar_amount || 0)}
            onChangeText={(value) => {
              // Update local state immediately for responsiveness
              setCalendars((prev) =>
                prev.map((c) =>
                  c.id === calendar.id ? { ...c, calendar_amount: value } : c
                )
              );
            }}
            onBlur={() => {
              // Save to server on blur
              updateCalendarAmount(calendar.id, calendar.calendar_amount);
            }}
            keyboardType="numeric"
            placeholder="0"
          />
        </View>

        {/* Amount Paid */}
        <View style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>{t('amount_paid')}:</Text>
          <TextInput
            style={styles.fieldInput}
            value={String(calendar.amount_paid || 0)}
            onChangeText={(value) => {
              // Update local state immediately for responsiveness
              setCalendars((prev) =>
                prev.map((c) =>
                  c.id === calendar.id ? { ...c, amount_paid: value } : c
                )
              );
            }}
            onBlur={() => {
              // Save to server on blur
              updateCalendarAmountPaid(calendar.id, calendar.amount_paid);
            }}
            keyboardType="decimal-pad"
            placeholder="0.00"
          />
        </View>

        {/* Paid Checkbox */}
        <View style={styles.checkboxRow}>
          <Checkbox
            checked={calendar.paid || false}
            onPress={() => updateCalendarPaid(calendar.id, !calendar.paid)}
            label={t('paid')}
          />
        </View>
      </Card>
    );
  };

  if (loading && !refreshing) {
    return <LoadingSpinner message={t('loading')} />;
  }

  if (error && !loading) {
    return <ErrorMessage message={error} onRetry={loadData} />;
  }

  if (!fundraiser) {
    return <EmptyState message={t('fundraiser_not_found')} icon="📅" />;
  }

  const startDate = new Date(fundraiser.start_date).toLocaleDateString();
  const endDate = new Date(fundraiser.end_date).toLocaleDateString();

  return (
    <View style={commonStyles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContainer}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Header */}
        <Card style={styles.headerCard}>
          <Text style={styles.title}>{fundraiser.name}</Text>
          <Text style={styles.dates}>
            {startDate} - {endDate}
          </Text>
        </Card>

        {/* Sort Controls */}
        <Card style={styles.sortCard}>
          <Text style={styles.sortTitle}>{t('sort_options')}</Text>
          <View style={styles.sortButtons}>
            <TouchableOpacity
              style={[styles.sortButton, sortBy === 'name' && styles.sortButtonActive]}
              onPress={() => setSortBy('name')}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.sortButtonText,
                  sortBy === 'name' && styles.sortButtonTextActive,
                ]}
              >
                👤 {t('name')}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.sortButton, sortBy === 'paid' && styles.sortButtonActive]}
              onPress={() => setSortBy('paid')}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.sortButtonText,
                  sortBy === 'paid' && styles.sortButtonTextActive,
                ]}
              >
                💰 {t('paid_status')}
              </Text>
            </TouchableOpacity>
          </View>
        </Card>

        {/* Summary Statistics */}
        <View style={styles.summaryCards}>
          <StatCard
            label={t('total_participants')}
            value={String(calendars.length)}
            icon="👥"
          />
          <StatCard label={t('total_sold')} value={String(totalAmount)} icon="📦" />
          <StatCard label={t('total_collected')} value={`$${totalPaid.toFixed(2)}`} icon="💰" />
          <StatCard
            label={t('participants_paid')}
            value={`${paidCount} / ${calendars.length}`}
            icon="✓"
          />
        </View>

        {/* Calendar List */}
        {sortedCalendars.length === 0 ? (
          <EmptyState message={t('no_fundraiser_entries_data')} icon="📅" />
        ) : (
          <View style={styles.calendarList}>
            {sortedCalendars.map((calendar) => renderCalendarItem(calendar))}
          </View>
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
    alignItems: 'center',
  },
  title: {
    fontSize: theme.fontSize.xxl,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.primary,
    marginBottom: theme.spacing.xs,
    textAlign: 'center',
  },
  dates: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
  },
  sortCard: {
    marginBottom: theme.spacing.md,
  },
  sortTitle: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.text,
    marginBottom: theme.spacing.sm,
  },
  sortButtons: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  sortButton: {
    flex: 1,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    backgroundColor: theme.colors.background,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: 'center',
    minHeight: theme.touchTarget.min,
    justifyContent: 'center',
  },
  sortButtonActive: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  sortButtonText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.text,
    fontWeight: theme.fontWeight.medium,
  },
  sortButtonTextActive: {
    color: theme.colors.white,
    fontWeight: theme.fontWeight.bold,
  },
  summaryCards: {
    marginBottom: theme.spacing.md,
    gap: theme.spacing.md,
  },
  calendarList: {
    gap: theme.spacing.md,
  },
  calendarCard: {
    marginBottom: 0,
  },
  calendarHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.sm,
  },
  calendarName: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.text,
    flex: 1,
  },
  paidBadge: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.white,
    backgroundColor: theme.colors.success,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.borderRadius.sm,
  },
  calendarGroup: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
    marginBottom: theme.spacing.md,
  },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: theme.spacing.sm,
  },
  fieldLabel: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.text,
    fontWeight: theme.fontWeight.medium,
    width: 120,
  },
  fieldInput: {
    flex: 1,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    backgroundColor: theme.colors.background,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    fontSize: theme.fontSize.base,
    color: theme.colors.text,
    minHeight: theme.touchTarget.min,
  },
  checkboxRow: {
    marginTop: theme.spacing.sm,
  },
});

export default CalendarScreen;
