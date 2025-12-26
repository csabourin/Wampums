/**
 * Settings Screen
 *
 * App settings including:
 * - Language selection
 * - User profile
 * - App preferences
 * - Logout
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Switch,
} from 'react-native';
import StorageUtils from '../utils/StorageUtils';
import { translate as t, changeLanguage, getCurrentLanguage } from '../i18n';
import { logout } from '../api/api-endpoints';
import CONFIG from '../config';
import { Card } from '../components';

const SettingsScreen = ({ navigation }) => {
  const [userName, setUserName] = useState('');
  const [userRole, setUserRole] = useState('');
  const [currentLanguage, setCurrentLanguage] = useState('fr');
  const [pushEnabled, setPushEnabled] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    // Load user data
    const name = await StorageUtils.getItem(CONFIG.STORAGE_KEYS.USER_FULL_NAME);
    const role = await StorageUtils.getItem(CONFIG.STORAGE_KEYS.USER_ROLE);

    setUserName(name || '');
    setUserRole(role || '');
    setCurrentLanguage(getCurrentLanguage());

    // TODO: Load push notification preference when implemented
  };

  const handleLanguageChange = async (lang) => {
    const success = await changeLanguage(lang);
    if (success) {
      setCurrentLanguage(lang);
      // Show alert that app will reload
      Alert.alert(
        t('Language changed'),
        t('App restart required'),
        [
          {
            text: t('OK'),
            onPress: () => {
              // TODO: Force app reload/navigation reset
              // For now, just update the state
            },
          },
        ]
      );
    }
  };

  const handleLogout = async () => {
    Alert.alert(
      t('Confirm Logout'),
      t('Are you sure you want to logout?'),
      [
        {
          text: t('cancel'),
          style: 'cancel',
        },
        {
          text: t('logout'),
          style: 'destructive',
          onPress: async () => {
            try {
              // Call logout API
              await logout();
            } catch (error) {
              console.error('Logout error:', error);
            } finally {
              // Clear local storage regardless of API result
              await StorageUtils.clearUserData();
              // Navigation will automatically switch to auth flow
            }
          },
        },
      ]
    );
  };

  return (
    <ScrollView style={styles.container}>
      {/* User Profile Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('profile')}</Text>
        <Card>
          <Text style={styles.profileName}>{userName}</Text>
          <Text style={styles.profileRole}>{userRole}</Text>
        </Card>
      </View>

      {/* Language Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('language')}</Text>
        <Card>
          <TouchableOpacity
            style={styles.settingRow}
            onPress={() => handleLanguageChange('en')}
          >
            <Text style={styles.settingLabel}>English</Text>
            {currentLanguage === 'en' && <Text style={styles.checkmark}>✓</Text>}
          </TouchableOpacity>
          <View style={styles.separator} />
          <TouchableOpacity
            style={styles.settingRow}
            onPress={() => handleLanguageChange('fr')}
          >
            <Text style={styles.settingLabel}>Français</Text>
            {currentLanguage === 'fr' && <Text style={styles.checkmark}>✓</Text>}
          </TouchableOpacity>
        </Card>
      </View>

      {/* Notifications Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('Notifications')}</Text>
        <Card>
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>{t('Push Notifications')}</Text>
            <Switch
              value={pushEnabled}
              onValueChange={setPushEnabled}
              trackColor={{ false: '#E5E5EA', true: '#34C759' }}
            />
          </View>
        </Card>
        <Text style={styles.settingHelp}>
          {t('Receive notifications about activities')}
        </Text>
      </View>

      {/* App Info Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('App Info')}</Text>
        <Card>
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>{t('Version')}</Text>
            <Text style={styles.settingValue}>{CONFIG.APP.VERSION}</Text>
          </View>
          <View style={styles.separator} />
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>{t('Build')}</Text>
            <Text style={styles.settingValue}>{CONFIG.APP.BUILD_NUMBER}</Text>
          </View>
        </Card>
      </View>

      {/* Account Actions */}
      <View style={styles.section}>
        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
          <Text style={styles.logoutButtonText}>{t('logout')}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          {t('Made with')} ❤️ {t('for Scouts')}
        </Text>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  section: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#8E8E93',
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  profileName: {
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 4,
  },
  profileRole: {
    fontSize: 14,
    color: '#666',
    textTransform: 'capitalize',
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    minHeight: CONFIG.UI.TOUCH_TARGET_SIZE,
  },
  settingLabel: {
    fontSize: 16,
    color: '#333',
  },
  settingValue: {
    fontSize: 16,
    color: '#8E8E93',
  },
  checkmark: {
    fontSize: 20,
    color: '#007AFF',
    fontWeight: 'bold',
  },
  separator: {
    height: 1,
    backgroundColor: '#E5E5EA',
  },
  settingHelp: {
    fontSize: 13,
    color: '#8E8E93',
    marginTop: 8,
    marginHorizontal: 16,
  },
  logoutButton: {
    backgroundColor: '#FF3B30',
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
    minHeight: CONFIG.UI.TOUCH_TARGET_SIZE,
    justifyContent: 'center',
  },
  logoutButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  footer: {
    padding: 32,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 14,
    color: '#8E8E93',
  },
});

export default SettingsScreen;
