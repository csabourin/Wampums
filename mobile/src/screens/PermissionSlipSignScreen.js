/**
 * Permission Slip Sign Screen
 *
 * Mirrors spa/permission_slip_sign.js functionality
 * Allows parents/guardians to view and sign permission slips
 * Can be accessed via deep link from email
 * Supports both authenticated (slipId) and public (token) access
 */

import React, { useEffect } from 'react';
import { useSafeState } from '../hooks/useSafeState';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { translate as t } from '../i18n';
import theme, { commonStyles } from '../theme';
import {
  LoadingSpinner,
  ErrorMessage,
  Card,
  FormField,
  Checkbox,
  Toast,
  useToast,
} from '../components';
import DateUtils from '../utils/DateUtils';
import {
  viewPermissionSlipByToken,
  signPermissionSlipByToken,
  signPermissionSlip,
} from '../api/api-endpoints';
import { debugLog, debugError } from '../utils/DebugUtils';

const PermissionSlipSignScreen = ({ route, navigation }) => {
  const { slipId, token } = route.params || {};
  const [loading, setLoading] = useSafeState(true);
  const [error, setError] = useSafeState('');
  const [slip, setSlip] = useSafeState(null);
  const [guardianName, setGuardianName] = useSafeState('');
  const [consentChecked, setConsentChecked] = useSafeState(false);
  const [isSigning, setIsSigning] = useSafeState(false);
  const toast = useToast();

  // Determine if this is public (token-based) or authenticated (slipId-based) access
  const isPublicAccess = !!token;

  useEffect(() => {
    loadPermissionSlip();
  }, [slipId, token]);

  const loadPermissionSlip = async () => {
    try {
      setError('');
      debugLog('[PermissionSlipSign] Loading slip, isPublicAccess:', isPublicAccess);

      let response;
      if (isPublicAccess) {
        // Public token-based endpoint
        response = await viewPermissionSlipByToken(token);
      } else {
        // Authenticated endpoint (fallback for existing flow)
        response = await signPermissionSlip(slipId, { view_only: true });
      }

      if (!response.success) {
        throw new Error(response.message || t('failed_to_load_permission_slip'));
      }

      setSlip(response.data);
      debugLog('[PermissionSlipSign] Loaded slip:', response.data);
    } catch (err) {
      debugError('[PermissionSlipSign] Error loading slip:', err);
      setError(err.message || t('error_loading_permission_slip'));
    } finally {
      setLoading(false);
    }
  };

  const validateForm = () => {
    if (!guardianName.trim()) {
      toast.show(t('please_enter_name'), 'warning');
      return false;
    }

    if (!consentChecked) {
      toast.show(t('please_accept_consent'), 'warning');
      return false;
    }

    return true;
  };

  const handleSign = async () => {
    if (!validateForm()) {
      return;
    }

    try {
      setIsSigning(true);
      debugLog('[PermissionSlipSign] Signing slip, isPublicAccess:', isPublicAccess);

      const payload = {
        signed_by: guardianName.trim(),
        signed_at: new Date().toISOString(),
        consent: consentChecked,
      };

      let response;
      if (isPublicAccess) {
        // Public token-based endpoint
        response = await signPermissionSlipByToken(token, payload);
      } else {
        // Authenticated endpoint (fallback for existing flow)
        response = await signPermissionSlip(slipId, payload);
      }

      if (response.success) {
        toast.show(t('permission_slip_signed_successfully'), 'success');
        debugLog('[PermissionSlipSign] Slip signed successfully');
        // Reload to show success state
        await loadPermissionSlip();
        // Reset form
        setGuardianName('');
        setConsentChecked(false);
      } else {
        throw new Error(response.message || t('error_signing_slip'));
      }
    } catch (err) {
      debugError('[PermissionSlipSign] Error signing slip:', err);
      toast.show(err.message || t('error_signing_slip'), 'error');
    } finally {
      setIsSigning(false);
    }
  };

  if (loading) {
    return <LoadingSpinner message={t('loading')} />;
  }

  if (error && !slip) {
    return <ErrorMessage message={error} onRetry={loadPermissionSlip} />;
  }

  if (!slip) {
    return (
      <View style={commonStyles.container}>
        <Card style={styles.card}>
          <Text style={styles.errorTitle}>{t('error')}</Text>
          <Text style={styles.errorText}>{t('permission_slip_not_found')}</Text>
          <TouchableOpacity
            style={commonStyles.button}
            onPress={() => navigation.goBack()}
            activeOpacity={0.7}
          >
            <Text style={commonStyles.buttonText}>{t('go_back')}</Text>
          </TouchableOpacity>
        </Card>
      </View>
    );
  }

  const isSigned = slip.status === 'signed';
  const isPastDeadline =
    slip.deadline_date && new Date(slip.deadline_date) < new Date();
  const canSign = slip.status === 'pending' && !isPastDeadline;

  return (
    <View style={commonStyles.container}>
      <ScrollView contentContainerStyle={styles.scrollContainer}>
        {/* Permission Slip Header */}
        <Card style={styles.card}>
          <Text style={styles.headerTitle}>{t('permission_slip_title')}</Text>
        </Card>

        {/* Activity Details */}
        <Card style={styles.card}>
          <Text style={styles.activityTitle}>{slip.activity_title || t('activity')}</Text>

          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>{t('activity_date_label')}:</Text>
            <Text style={styles.detailValue}>
              {DateUtils.formatDate(new Date(slip.meeting_date))}
            </Text>
          </View>

          {slip.activity_description && (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>{t('activity_description_label')}:</Text>
              <Text style={styles.detailValue}>{slip.activity_description}</Text>
            </View>
          )}

          {slip.deadline_date && (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>{t('deadline_date')}:</Text>
              <Text
                style={[
                  styles.detailValue,
                  isPastDeadline && styles.deadlinePassed,
                ]}
              >
                {DateUtils.formatDate(new Date(slip.deadline_date))}
              </Text>
            </View>
          )}

          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>{t('participant')}:</Text>
            <Text style={styles.detailValue}>{slip.participant_name}</Text>
          </View>
        </Card>

        {/* Signed Status */}
        {isSigned && (
          <Card style={[styles.card, styles.successCard]}>
            <View style={styles.statusRow}>
              <Text style={styles.successIcon}>✅</Text>
              <View style={styles.statusTextContainer}>
                <Text style={styles.statusTitle}>{t('already_signed')}</Text>
                <Text style={styles.statusDetail}>
                  {t('signed_on')}:{' '}
                  {DateUtils.formatDate(new Date(slip.signed_at), undefined, 'YYYY-MM-DD HH:mm')}
                </Text>
                {slip.signed_by && (
                  <Text style={styles.statusDetail}>
                    {t('signed_by')}: {slip.signed_by}
                  </Text>
                )}
              </View>
            </View>
          </Card>
        )}

        {/* Signature Form */}
        {canSign && (
          <Card style={styles.card}>
            <View style={[styles.statusRow, styles.warningCard]}>
              <Text style={styles.warningIcon}>⚠️</Text>
              <Text style={styles.warningText}>{t('signature_required')}</Text>
            </View>

            <FormField
              label={t('your_name')}
              value={guardianName}
              onChangeText={setGuardianName}
              placeholder={t('enter_full_name')}
              required
            />

            <Checkbox
              label={t('permission_consent_text')}
              checked={consentChecked}
              onPress={() => setConsentChecked(!consentChecked)}
              style={styles.consentCheckbox}
            />

            <TouchableOpacity
              style={[
                commonStyles.button,
                styles.signButton,
                (!guardianName.trim() || !consentChecked || isSigning) &&
                  commonStyles.buttonDisabled,
              ]}
              onPress={handleSign}
              disabled={!guardianName.trim() || !consentChecked || isSigning}
              activeOpacity={0.7}
            >
              <Text style={commonStyles.buttonText}>
                {isSigning ? t('signing') : `✍️ ${t('sign_permission_slip')}`}
              </Text>
            </TouchableOpacity>
          </Card>
        )}

        {/* Deadline Passed */}
        {isPastDeadline && !isSigned && (
          <Card style={[styles.card, styles.errorCard]}>
            <View style={styles.statusRow}>
              <Text style={styles.errorIcon}>❌</Text>
              <Text style={styles.errorText}>{t('deadline_passed')}</Text>
            </View>
          </Card>
        )}

        {/* Info Note */}
        <Card style={styles.infoCard}>
          <Text style={styles.infoText}>
            {t('permission_slip_info_note')}
          </Text>
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
  card: {
    marginBottom: theme.spacing.md,
  },
  headerTitle: {
    fontSize: theme.fontSize.xl,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.primary,
    textAlign: 'center',
  },
  activityTitle: {
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.primary,
    marginBottom: theme.spacing.md,
  },
  detailRow: {
    marginBottom: theme.spacing.sm,
  },
  detailLabel: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.text,
    marginBottom: theme.spacing.xs,
  },
  detailValue: {
    fontSize: theme.fontSize.base,
    color: theme.colors.text,
    lineHeight: theme.fontSize.base * theme.lineHeight.relaxed,
  },
  deadlinePassed: {
    color: theme.colors.error,
    fontWeight: theme.fontWeight.semibold,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.sm,
  },
  statusTextContainer: {
    flex: 1,
  },
  statusTitle: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.text,
    marginBottom: theme.spacing.xs,
  },
  statusDetail: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
    marginBottom: theme.spacing.xs,
  },
  successCard: {
    backgroundColor: theme.colors.successLight || '#e8f5e9',
    borderLeftWidth: 4,
    borderLeftColor: theme.colors.success,
  },
  successIcon: {
    fontSize: 24,
  },
  warningCard: {
    backgroundColor: theme.colors.warningLight || '#fff9e6',
    padding: theme.spacing.md,
    borderRadius: theme.borderRadius.sm,
    borderLeftWidth: 4,
    borderLeftColor: theme.colors.warning,
    marginBottom: theme.spacing.md,
  },
  warningIcon: {
    fontSize: 24,
  },
  warningText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.text,
    flex: 1,
  },
  consentCheckbox: {
    marginVertical: theme.spacing.md,
  },
  signButton: {
    marginTop: theme.spacing.sm,
  },
  errorCard: {
    backgroundColor: theme.colors.errorLight || '#ffebee',
    borderLeftWidth: 4,
    borderLeftColor: theme.colors.error,
  },
  errorIcon: {
    fontSize: 24,
  },
  errorTitle: {
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.error,
    marginBottom: theme.spacing.sm,
  },
  errorText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.text,
    marginBottom: theme.spacing.md,
  },
  infoCard: {
    backgroundColor: theme.colors.secondary,
    borderLeftWidth: 4,
    borderLeftColor: theme.colors.info,
  },
  infoText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
    lineHeight: theme.fontSize.sm * theme.lineHeight.relaxed,
  },
});

export default PermissionSlipSignScreen;