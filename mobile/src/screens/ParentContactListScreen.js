/**
 * Parent Contact List Screen
 *
 * Mirrors spa/parent_contact_list.js functionality
 * Shows participants grouped alphabetically with parent/guardian contact information
 * For leaders and admins to view contact details
 */

import React, { useEffect } from 'react';
import { useSafeState } from '../hooks/useSafeState';
import {
  View,
  Text,
  SectionList,
  StyleSheet,
  RefreshControl,
  Linking,
  TouchableOpacity,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { getParentContactList } from '../api/api-endpoints';
import { translate as t } from '../i18n';
import theme, { commonStyles } from '../theme';
import {
  LoadingSpinner,
  ErrorMessage,
  Card,
  EmptyState,
  FilterBar,
  useToast,
} from '../components';
import { canSendCommunications, canViewParticipants } from '../utils/PermissionUtils';
import { debugLog, debugError } from '../utils/DebugUtils';
import { formatPhoneNumber } from '../utils/PhoneUtils';

const ParentContactListScreen = () => {
  const navigation = useNavigation();
  const toast = useToast();
  const [loading, setLoading] = useSafeState(true);
  const [refreshing, setRefreshing] = useSafeState(false);
  const [error, setError] = useSafeState('');
  const [children, setChildren] = useSafeState({});
  const [sections, setSections] = useSafeState([]);
  const [searchQuery, setSearchQuery] = useSafeState('');

  useEffect(() => {
    // Check permissions
    const checkPermissions = async () => {
      debugLog('[ParentContactList] Checking permissions...');
      const hasSendComms = await canSendCommunications();
      const hasViewParticipants = await canViewParticipants();
      debugLog('[ParentContactList] Permissions:', { hasSendComms, hasViewParticipants });
      
      if (!hasSendComms && !hasViewParticipants) {
        debugError('[ParentContactList] No permissions, going back');
        toast.show(t('error_permission_denied'), 'error');
        setTimeout(() => navigation.goBack(), 100);
        return;
      }

      loadData();
    };

    checkPermissions();
  }, []);

  useEffect(() => {
    filterAndGroupChildren();
  }, [searchQuery, children]);

  const loadData = async () => {
    try {
      setError('');
      const response = await getParentContactList();
      const rows = response.contacts || response;

      // Transform flat SQL rows into nested structure
      const childrenMap = {};

      for (const row of rows) {
        const participantId = row.participant_id;

        // Initialize child entry if not exists
        if (!childrenMap[participantId]) {
          childrenMap[participantId] = {
            id: participantId,
            name: `${row.first_name} ${row.last_name}`,
            groups: new Set(),
            contacts: [],
          };
        }

        // Add group if exists
        if (row.group_name) {
          childrenMap[participantId].groups.add(row.group_name);
        }

        // Add guardian/contact if exists and not already added
        if (
          row.guardian_id &&
          !childrenMap[participantId].contacts.find((c) => c.id === row.guardian_id)
        ) {
          childrenMap[participantId].contacts.push({
            id: row.guardian_id,
            name: `${row.prenom} ${row.nom}`,
            relationship: row.lien,
            email: row.courriel,
            phone_home: row.telephone_residence,
            phone_work: row.telephone_travail,
            phone_cell: row.telephone_cellulaire,
            is_emergency: row.is_emergency_contact,
            is_primary: row.is_primary,
          });
        }
      }

      // Convert groups Set to Array
      for (const child of Object.values(childrenMap)) {
        child.groups = Array.from(child.groups);
      }

      setChildren(childrenMap);
    } catch (err) {
      setError(err.message || t('error_loading_data'));
    } finally {
      setLoading(false);
    }
  };

  const filterAndGroupChildren = () => {
    // Sort children by first name
    let sortedChildren = Object.values(children).sort((a, b) => {
      const aFirstName = a.name.split(' ')[0];
      const bFirstName = b.name.split(' ')[0];
      return aFirstName.localeCompare(bFirstName);
    });

    // Apply search filter
    if (searchQuery.trim()) {
      const filterLower = searchQuery.toLowerCase();
      sortedChildren = sortedChildren.filter((child) => {
        // Check if child name matches
        if (child.name.toLowerCase().includes(filterLower)) {
          return true;
        }
        // Check if any contact name matches
        return child.contacts.some((contact) =>
          contact.name.toLowerCase().includes(filterLower)
        );
      });
    }

    // Group by first letter of first name
    const groupedByLetter = {};
    for (const child of sortedChildren) {
      const firstLetter = child.name[0].toUpperCase();
      if (!groupedByLetter[firstLetter]) {
        groupedByLetter[firstLetter] = [];
      }
      groupedByLetter[firstLetter].push(child);
    }

    // Convert to sections format
    const sectionsData = Object.keys(groupedByLetter)
      .sort()
      .map((letter) => ({
        title: letter,
        data: groupedByLetter[letter],
      }));

    setSections(sectionsData);
  };

  const handleCall = (phone) => {
    if (phone) {
      Linking.openURL(`tel:${phone}`);
    }
  };

  const handleEmail = (email) => {
    if (email) {
      Linking.openURL(`mailto:${email}`);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const renderContact = (contact) => (
    <View key={contact.id} style={styles.contactCard}>
      <View style={styles.contactHeader}>
        <Text style={styles.contactName}>{contact.name}</Text>
        {contact.is_primary && (
          <View style={styles.primaryBadge}>
            <Text style={styles.primaryBadgeText}>{t('primary')}</Text>
          </View>
        )}
        {contact.is_emergency && (
          <View style={styles.emergencyBadge}>
            <Text style={styles.emergencyBadgeText}>{t('emergency')}</Text>
          </View>
        )}
      </View>

      {contact.relationship && (
        <Text style={styles.contactDetail}>
          {t('relationship')}: {contact.relationship}
        </Text>
      )}

      {contact.email && (
        <TouchableOpacity
          onPress={() => handleEmail(contact.email)}
          style={styles.contactLinkRow}
          activeOpacity={0.7}
        >
          <Text style={styles.contactLabel}>{t('email')}:</Text>
          <Text style={styles.contactLink}>{contact.email}</Text>
        </TouchableOpacity>
      )}

      {(contact.phone_home || contact.phone_work || contact.phone_cell) && (
        <View style={styles.phonesContainer}>
          {contact.phone_home && (
            <TouchableOpacity
              onPress={() => handleCall(contact.phone_home)}
              style={styles.contactLinkRow}
              activeOpacity={0.7}
            >
              <Text style={styles.contactLabel}>{t('phone_home')}:</Text>
              <Text style={styles.contactLink}>{formatPhoneNumber(contact.phone_home)}</Text>
            </TouchableOpacity>
          )}
          {contact.phone_work && (
            <TouchableOpacity
              onPress={() => handleCall(contact.phone_work)}
              style={styles.contactLinkRow}
              activeOpacity={0.7}
            >
              <Text style={styles.contactLabel}>{t('phone_work')}:</Text>
              <Text style={styles.contactLink}>{formatPhoneNumber(contact.phone_work)}</Text>
            </TouchableOpacity>
          )}
          {contact.phone_cell && (
            <TouchableOpacity
              onPress={() => handleCall(contact.phone_cell)}
              style={styles.contactLinkRow}
              activeOpacity={0.7}
            >
              <Text style={styles.contactLabel}>{t('phone_cell')}:</Text>
              <Text style={styles.contactLink}>{formatPhoneNumber(contact.phone_cell)}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );

  const renderChild = ({ item }) => (
    <Card style={styles.childCard}>
      <Text style={styles.childName}>{item.name}</Text>
      {item.groups.length > 0 && (
        <View style={styles.groupsContainer}>
          {item.groups.map((group, index) => (
            <View key={index} style={styles.groupBadge}>
              <Text style={styles.groupBadgeText}>{group}</Text>
            </View>
          ))}
        </View>
      )}
      <View style={styles.contactsContainer}>
        {item.contacts.map((contact) => renderContact(contact))}
        {item.contacts.length === 0 && (
          <Text style={styles.noContactsText}>{t('no_contacts')}</Text>
        )}
      </View>
    </Card>
  );

  const renderSectionHeader = ({ section: { title } }) => (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionHeaderText}>{title}</Text>
    </View>
  );

  if (loading && !refreshing) {
    return <LoadingSpinner message={t('loading')} />;
  }

  if (error && !loading) {
    return <ErrorMessage message={error} onRetry={loadData} />;
  }

  return (
    <View style={commonStyles.container}>
      {/* Filter Bar */}
      <FilterBar
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder={t('search_participants')}
        showFilters={false}
      />

      {/* Contact List */}
      <SectionList
        sections={sections}
        renderItem={renderChild}
        renderSectionHeader={renderSectionHeader}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={styles.listContainer}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        ListEmptyComponent={
          <EmptyState
            icon="📇"
            title={t('no_contacts')}
            message={t('no_parent_contacts_found')}
          />
        }
      />
    </View>
  );
};

const styles = StyleSheet.create({
  listContainer: {
    padding: theme.spacing.md,
  },
  sectionHeader: {
    backgroundColor: theme.colors.secondary,
    padding: theme.spacing.sm,
    borderRadius: theme.borderRadius.sm,
    marginBottom: theme.spacing.sm,
  },
  sectionHeaderText: {
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.primary,
  },
  childCard: {
    marginBottom: theme.spacing.md,
  },
  childName: {
    fontSize: theme.fontSize.xl,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.primary,
    marginBottom: theme.spacing.sm,
  },
  groupsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.xs,
    marginBottom: theme.spacing.sm,
  },
  groupBadge: {
    ...commonStyles.badgeSecondary,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
  },
  groupBadgeText: {
    ...commonStyles.badgeTextSecondary,
    fontSize: theme.fontSize.sm,
  },
  contactsContainer: {
    gap: theme.spacing.md,
    marginTop: theme.spacing.sm,
  },
  contactCard: {
    backgroundColor: theme.colors.secondary,
    padding: theme.spacing.md,
    borderRadius: theme.borderRadius.sm,
  },
  contactHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: theme.spacing.xs,
    marginBottom: theme.spacing.sm,
  },
  contactName: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.text,
  },
  primaryBadge: {
    ...commonStyles.badgePrimary,
    paddingHorizontal: theme.spacing.xs,
    paddingVertical: 2,
  },
  primaryBadgeText: {
    ...commonStyles.badgeText,
    fontSize: theme.fontSize.xs,
  },
  emergencyBadge: {
    ...commonStyles.badgeError,
    paddingHorizontal: theme.spacing.xs,
    paddingVertical: 2,
  },
  emergencyBadgeText: {
    ...commonStyles.badgeText,
    fontSize: theme.fontSize.xs,
  },
  contactDetail: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
    marginBottom: theme.spacing.xs,
  },
  contactLinkRow: {
    flexDirection: 'row',
    paddingVertical: theme.spacing.xs,
    minHeight: theme.touchTarget.min,
    alignItems: 'center',
  },
  contactLabel: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
    marginRight: theme.spacing.xs,
    minWidth: 80,
  },
  contactLink: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.info,
    textDecorationLine: 'underline',
    flex: 1,
  },
  phonesContainer: {
    gap: theme.spacing.xs,
  },
  noContactsText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
    fontStyle: 'italic',
  },
});

export default ParentContactListScreen;