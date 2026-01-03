/**
 * AccountInfoScreen (District-Level Integrations)
 *
 * District-level account integrations and configurations.
 * Accessible only to users with district permissions.
 *
 * Features:
 * - WhatsApp Business API (Baileys) connection management
 * - Google Workspace chat integration (placeholder)
 * - Stripe payment integration status (placeholder)
 */

import React, { useEffect } from 'react';
import { useSafeState } from '../hooks/useSafeState';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Alert,
  Linking,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { translate as t } from '../i18n';
import {
  Button,
  LoadingState,
  ErrorState,
  Toast,
  useToast,
  Card,
} from '../components';
import { hasPermission } from '../utils/PermissionUtils';
import theme from '../theme';
import CONFIG from '../config';
import { debugLog, debugError } from '../utils/DebugUtils';
import { makeApiRequest } from '../api/api-core';

const AccountInfoScreen = () => {
  const navigation = useNavigation();
  const [loading, setLoading] = useSafeState(true);
  const [refreshing, setRefreshing] = useSafeState(false);
  const [error, setError] = useSafeState(null);

  // Permissions
  const [canManageCommunications, setCanManageCommunications] = useSafeState(false);

  // WhatsApp Baileys state
  const [whatsappStatus, setWhatsappStatus] = useSafeState(null);
  const [whatsappLoading, setWhatsappLoading] = useSafeState(false);

  // Stripe state (placeholder)
  const [stripeConnected, setStripeConnected] = useSafeState(false);
  const [stripeAccountId, setStripeAccountId] = useSafeState(null);

  // Google Workspace state (placeholder)
  const [googleWorkspaceConnected, setGoogleWorkspaceConnected] = useSafeState(false);

  const toast = useToast();

  useEffect(() => {
    navigation.setOptions({
      headerShown: true,
      title: t('account_info') || 'Account Integrations',
    });
  }, [navigation]);

  useEffect(() => {
    checkPermissionsAndLoad();
  }, []);

  const checkPermissionsAndLoad = async () => {
    try {
      // Check if user has communications.send permission (district level)
      const hasCommunicationsPermission = await hasPermission('communications.send');
      setCanManageCommunications(hasCommunicationsPermission);

      if (!hasCommunicationsPermission) {
        setError(t('insufficient_permissions') || 'You do not have permission to access this page');
        setLoading(false);
        return;
      }

      await loadIntegrations();
    } catch (err) {
      debugError('Error checking permissions:', err);
      setError(err.message || t('error_loading_data'));
    } finally {
      setLoading(false);
    }
  };

  const loadIntegrations = async () => {
    try {
      // Load WhatsApp Baileys status
      await loadWhatsAppStatus();

      // Load Stripe status (placeholder - implement when ready)
      // await loadStripeStatus();

      // Load Google Workspace status (placeholder - implement when ready)
      // await loadGoogleWorkspaceStatus();
    } catch (err) {
      debugError('Error loading integrations:', err);
      throw err;
    }
  };

  const loadWhatsAppStatus = async () => {
    try {
      debugLog('Loading WhatsApp Baileys status');
      const response = await makeApiRequest('v1/whatsapp/baileys/status', {
        method: 'GET',
      });

      if (response.success) {
        setWhatsappStatus(response.data);
        debugLog('WhatsApp status loaded:', response.data);
      } else {
        debugError('Failed to load WhatsApp status:', response.message);
      }
    } catch (err) {
      debugError('Error loading WhatsApp status:', err);
      // Don't throw - this is not critical
    }
  };

  const handleDisconnectWhatsApp = async () => {
    Alert.alert(
      t('disconnect_whatsapp') || 'Disconnect WhatsApp',
      t('disconnect_whatsapp_confirm') || 'Are you sure you want to disconnect your WhatsApp account? You will need to scan the QR code again to reconnect.',
      [
        {
          text: t('cancel'),
          style: 'cancel',
        },
        {
          text: t('disconnect'),
          style: 'destructive',
          onPress: async () => {
            try {
              setWhatsappLoading(true);
              const response = await makeApiRequest('v1/whatsapp/baileys/disconnect', {
                method: 'POST',
              });

              if (response.success) {
                toast.show(t('whatsapp_disconnected') || 'WhatsApp disconnected successfully', 'success');
                await loadWhatsAppStatus();
              } else {
                toast.show(response.message || t('error_disconnecting_whatsapp'), 'error');
              }
            } catch (err) {
              debugError('Error disconnecting WhatsApp:', err);
              toast.show(err.message || t('error_disconnecting_whatsapp'), 'error');
            } finally {
              setWhatsappLoading(false);
            }
          },
        },
      ]
    );
  };

  const handleConnectWhatsAppWeb = () => {
    // Open web interface for QR code scanning
    // Since QR code scanning with Socket.io is complex in React Native,
    // direct users to the web interface
    const webUrl = `${CONFIG.API_BASE_URL.replace('/api', '')}/account-info`;

    Alert.alert(
      t('connect_via_web') || 'Connect via Web',
      t('whatsapp_connect_web_message') || 'To connect your WhatsApp account, please use the web interface to scan the QR code. Would you like to open the web page now?',
      [
        {
          text: t('cancel'),
          style: 'cancel',
        },
        {
          text: t('open_web'),
          onPress: () => {
            Linking.openURL(webUrl).catch(err => {
              debugError('Failed to open URL:', err);
              toast.show(t('error_opening_browser'), 'error');
            });
          },
        },
      ]
    );
  };

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await loadIntegrations();
    } catch (err) {
      debugError('Error refreshing:', err);
    } finally {
      setRefreshing(false);
    }
  };

  if (loading) {
    return <LoadingState message={t('loading') || 'Loading...'} />;
  }

  if (error) {
    return <ErrorState message={error} onRetry={checkPermissionsAndLoad} />;
  }

  if (!canManageCommunications) {
    return (
      <ErrorState
        message={t('district_permission_required') || 'This page is only accessible to users with district-level permissions'}
      />
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* WhatsApp Baileys Integration Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            {t('whatsapp_integration') || 'WhatsApp Business Integration'}
          </Text>
          <Text style={styles.sectionDescription}>
            {t('whatsapp_integration_description') || 'Connect your WhatsApp Business account to send automated messages and notifications to participants.'}
          </Text>

          <Card>
            <View style={styles.statusRow}>
              <Text style={styles.statusLabel}>{t('connection_status') || 'Connection Status'}:</Text>
              <View style={[
                styles.statusBadge,
                whatsappStatus?.isConnected ? styles.statusConnected : styles.statusDisconnected
              ]}>
                <Text style={styles.statusText}>
                  {whatsappStatus?.isConnected
                    ? (t('connected') || 'Connected')
                    : (t('disconnected') || 'Disconnected')}
                </Text>
              </View>
            </View>

            {whatsappStatus?.isConnected && whatsappStatus?.phoneNumber && (
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>{t('phone_number') || 'Phone Number'}:</Text>
                <Text style={styles.infoValue}>{whatsappStatus.phoneNumber}</Text>
              </View>
            )}

            {whatsappStatus?.isConnected ? (
              <Button
                title={t('disconnect_whatsapp') || 'Disconnect WhatsApp'}
                onPress={handleDisconnectWhatsApp}
                loading={whatsappLoading}
                variant="danger"
                style={styles.button}
              />
            ) : (
              <>
                <Text style={styles.helpText}>
                  {t('whatsapp_connect_help') || 'To connect your WhatsApp account, you need to scan a QR code using the WhatsApp mobile app. This feature is best accessed via the web interface.'}
                </Text>
                <Button
                  title={t('connect_via_web') || 'Connect via Web Interface'}
                  onPress={handleConnectWhatsAppWeb}
                  style={styles.button}
                />
              </>
            )}
          </Card>
        </View>

        {/* Google Workspace Integration Section (Placeholder) */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            {t('google_workspace_integration') || 'Google Workspace Chat Integration'}
          </Text>
          <Text style={styles.sectionDescription}>
            {t('google_workspace_description') || 'Integrate with Google Workspace to enable chat features and collaboration tools.'}
          </Text>

          <Card>
            <View style={styles.statusRow}>
              <Text style={styles.statusLabel}>{t('connection_status') || 'Connection Status'}:</Text>
              <View style={[styles.statusBadge, styles.statusDisconnected]}>
                <Text style={styles.statusText}>{t('not_configured') || 'Not Configured'}</Text>
              </View>
            </View>

            <Text style={styles.placeholderText}>
              {t('google_workspace_coming_soon') || 'Google Workspace integration is coming soon. This will allow you to connect your organization\'s Google Workspace account for enhanced chat and collaboration features.'}
            </Text>
          </Card>
        </View>

        {/* Stripe Integration Section (Placeholder) */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            {t('stripe_integration') || 'Stripe Payment Integration'}
          </Text>
          <Text style={styles.sectionDescription}>
            {t('stripe_description') || 'Connect your Stripe account to accept online payments for memberships, activities, and fundraisers.'}
          </Text>

          <Card>
            <View style={styles.statusRow}>
              <Text style={styles.statusLabel}>{t('connection_status') || 'Connection Status'}:</Text>
              <View style={[
                styles.statusBadge,
                stripeConnected ? styles.statusConnected : styles.statusDisconnected
              ]}>
                <Text style={styles.statusText}>
                  {stripeConnected
                    ? (t('connected') || 'Connected')
                    : (t('not_connected') || 'Not Connected')}
                </Text>
              </View>
            </View>

            {stripeAccountId && (
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>{t('account_id') || 'Account ID'}:</Text>
                <Text style={styles.infoValue}>{stripeAccountId}</Text>
              </View>
            )}

            <Text style={styles.placeholderText}>
              {t('stripe_coming_soon') || 'Stripe payment integration is coming soon. This will allow you to connect your organization\'s Stripe account to accept online payments.'}
            </Text>
          </Card>
        </View>
      </ScrollView>

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
  container: {
    flex: 1,
    backgroundColor: theme.colors.background.primary,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: theme.spacing.md,
  },
  section: {
    marginBottom: theme.spacing.lg,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: theme.colors.text.primary,
    marginBottom: theme.spacing.xs,
  },
  sectionDescription: {
    fontSize: 14,
    color: theme.colors.text.secondary,
    marginBottom: theme.spacing.md,
    lineHeight: 20,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.md,
  },
  statusLabel: {
    fontSize: 16,
    fontWeight: '500',
    color: theme.colors.text.primary,
  },
  statusBadge: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.borderRadius.md,
  },
  statusConnected: {
    backgroundColor: theme.colors.success + '20',
  },
  statusDisconnected: {
    backgroundColor: theme.colors.error + '20',
  },
  statusText: {
    fontSize: 14,
    fontWeight: '600',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border.light,
    marginBottom: theme.spacing.md,
  },
  infoLabel: {
    fontSize: 14,
    color: theme.colors.text.secondary,
    fontWeight: '500',
  },
  infoValue: {
    fontSize: 14,
    color: theme.colors.text.primary,
  },
  button: {
    marginTop: theme.spacing.sm,
  },
  helpText: {
    fontSize: 14,
    color: theme.colors.text.secondary,
    lineHeight: 20,
    marginVertical: theme.spacing.md,
    fontStyle: 'italic',
  },
  placeholderText: {
    fontSize: 14,
    color: theme.colors.text.secondary,
    lineHeight: 20,
    marginTop: theme.spacing.md,
    fontStyle: 'italic',
  },
});

export default AccountInfoScreen;