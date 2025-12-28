/**
 * Groups Screen
 *
 * Mirrors spa/manage_groups.js functionality
 * Manage participant groups with CRUD operations
 * For admin and leader users
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
  Alert,
} from 'react-native';
import {
  getGroups,
  addGroup,
  removeGroup,
  updateGroupName,
} from '../api/api-endpoints';
import { translate as t } from '../i18n';
import theme, { commonStyles } from '../theme';
import {
  LoadingSpinner,
  ErrorMessage,
  Card,
  EmptyState,
  FormField,
  Modal,
  ConfirmModal,
  Toast,
  useToast,
} from '../components';
import { canViewGroups } from '../utils/PermissionUtils';

const GroupsScreen = ({ navigation }) => {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [groups, setGroups] = useState([]);
  const [newGroupName, setNewGroupName] = useState('');
  const [editingGroup, setEditingGroup] = useState(null);
  const [editGroupName, setEditGroupName] = useState('');
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [deleteConfirmVisible, setDeleteConfirmVisible] = useState(false);
  const [groupToDelete, setGroupToDelete] = useState(null);
  const toast = useToast();

  useEffect(() => {
    // Check permissions
    const checkPermissions = async () => {
      if (!(await canViewGroups())) {
        navigation.navigate('Dashboard');
        return;
      }

      loadData();
    };

    checkPermissions();
  }, []);

  const loadData = async () => {
    try {
      setError('');
      const response = await getGroups();

      if (response.success) {
        setGroups(response.data || response.groups || []);
      }
    } catch (err) {
      setError(err.message || t('error_loading_data'));
    } finally {
      setLoading(false);
    }
  };

  const handleAddGroup = async () => {
    if (!newGroupName.trim()) {
      toast.show(t('group_name_required'), 'warning');
      return;
    }

    try {
      setLoading(true);
      const result = await addGroup(newGroupName.trim());

      if (result.success) {
        toast.show(t('group_added_successfully'), 'success');
        setNewGroupName('');
        setAddModalVisible(false);
        await loadData();
      } else {
        toast.show(result.message || t('error_adding_group'), 'error');
      }
    } catch (err) {
      toast.show(err.message || t('error_adding_group'), 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleEditGroup = async () => {
    if (!editGroupName.trim()) {
      toast.show(t('group_name_required'), 'warning');
      return;
    }

    try {
      setLoading(true);
      const result = await updateGroupName(editingGroup.id, editGroupName.trim());

      if (result.success) {
        toast.show(t('group_updated_successfully'), 'success');
        setEditModalVisible(false);
        setEditingGroup(null);
        setEditGroupName('');
        await loadData();
      } else {
        toast.show(result.message || t('error_updating_group'), 'error');
      }
    } catch (err) {
      toast.show(err.message || t('error_updating_group'), 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteGroup = async () => {
    if (!groupToDelete) return;

    try {
      setLoading(true);
      const result = await removeGroup(groupToDelete.id);

      if (result.success) {
        toast.show(t('group_removed_successfully'), 'success');
        setDeleteConfirmVisible(false);
        setGroupToDelete(null);
        await loadData();
      } else {
        toast.show(result.message || t('error_removing_group'), 'error');
      }
    } catch (err) {
      toast.show(err.message || t('error_removing_group'), 'error');
    } finally {
      setLoading(false);
    }
  };

  const openEditModal = (group) => {
    setEditingGroup(group);
    setEditGroupName(group.name);
    setEditModalVisible(true);
  };

  const openDeleteConfirm = (group) => {
    setGroupToDelete(group);
    setDeleteConfirmVisible(true);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const renderGroup = ({ item }) => (
    <Card style={styles.groupCard}>
      <View style={styles.groupRow}>
        <Text style={styles.groupName}>{item.name}</Text>
        <View style={styles.groupActions}>
          <TouchableOpacity
            style={[styles.actionButton, styles.editButton]}
            onPress={() => openEditModal(item)}
            activeOpacity={0.7}
          >
            <Text style={styles.actionButtonText}>{t('edit')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, styles.deleteButton]}
            onPress={() => openDeleteConfirm(item)}
            activeOpacity={0.7}
          >
            <Text style={styles.actionButtonText}>{t('delete')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Card>
  );

  if (loading && !refreshing && groups.length === 0) {
    return <LoadingSpinner message={t('loading')} />;
  }

  if (error && !loading) {
    return <ErrorMessage message={error} onRetry={loadData} />;
  }

  return (
    <View style={commonStyles.container}>
      {/* Groups List */}
      <FlatList
        data={groups}
        renderItem={renderGroup}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={styles.listContainer}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        ListEmptyComponent={
          <EmptyState
            icon="👥"
            title={t('no_groups')}
            message={t('no_groups_message')}
            actionLabel={t('add_group')}
            onAction={() => setAddModalVisible(true)}
          />
        }
      />

      {/* FAB - Add Group */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => setAddModalVisible(true)}
        activeOpacity={0.7}
      >
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>

      {/* Add Group Modal */}
      <Modal
        visible={addModalVisible}
        onClose={() => {
          setAddModalVisible(false);
          setNewGroupName('');
        }}
        title={t('add_group')}
        footer={
          <View style={styles.modalFooter}>
            <TouchableOpacity
              style={commonStyles.buttonSecondary}
              onPress={() => {
                setAddModalVisible(false);
                setNewGroupName('');
              }}
              activeOpacity={0.7}
            >
              <Text style={commonStyles.buttonSecondaryText}>{t('cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={commonStyles.button}
              onPress={handleAddGroup}
              activeOpacity={0.7}
            >
              <Text style={commonStyles.buttonText}>{t('add')}</Text>
            </TouchableOpacity>
          </View>
        }
      >
        <FormField
          label={t('group_name')}
          value={newGroupName}
          onChangeText={setNewGroupName}
          placeholder={t('enter_group_name')}
          required
        />
      </Modal>

      {/* Edit Group Modal */}
      <Modal
        visible={editModalVisible}
        onClose={() => {
          setEditModalVisible(false);
          setEditingGroup(null);
          setEditGroupName('');
        }}
        title={t('edit_group')}
        footer={
          <View style={styles.modalFooter}>
            <TouchableOpacity
              style={commonStyles.buttonSecondary}
              onPress={() => {
                setEditModalVisible(false);
                setEditingGroup(null);
                setEditGroupName('');
              }}
              activeOpacity={0.7}
            >
              <Text style={commonStyles.buttonSecondaryText}>{t('cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={commonStyles.button}
              onPress={handleEditGroup}
              activeOpacity={0.7}
            >
              <Text style={commonStyles.buttonText}>{t('save')}</Text>
            </TouchableOpacity>
          </View>
        }
      >
        <FormField
          label={t('group_name')}
          value={editGroupName}
          onChangeText={setEditGroupName}
          placeholder={t('enter_group_name')}
          required
        />
      </Modal>

      {/* Delete Confirmation */}
      <ConfirmModal
        visible={deleteConfirmVisible}
        onClose={() => {
          setDeleteConfirmVisible(false);
          setGroupToDelete(null);
        }}
        onConfirm={handleDeleteGroup}
        title={t('confirm_delete')}
        message={t('confirm_delete_group_message', {
          groupName: groupToDelete?.name || '',
        })}
        confirmText={t('delete')}
        confirmStyle="danger"
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
  listContainer: {
    padding: theme.spacing.md,
  },
  groupCard: {
    marginBottom: theme.spacing.sm,
  },
  groupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  groupName: {
    flex: 1,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.text,
  },
  groupActions: {
    flexDirection: 'row',
    gap: theme.spacing.xs,
  },
  actionButton: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.borderRadius.sm,
    minHeight: theme.touchTarget.min,
    justifyContent: 'center',
  },
  editButton: {
    backgroundColor: theme.colors.info,
  },
  deleteButton: {
    backgroundColor: theme.colors.error,
  },
  actionButtonText: {
    color: theme.colors.selectedText,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
  },
  fab: {
    position: 'absolute',
    right: theme.spacing.lg,
    bottom: theme.spacing.lg,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: theme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...theme.shadows.lg,
  },
  fabText: {
    fontSize: 32,
    color: theme.colors.selectedText,
    fontWeight: '300',
  },
  modalFooter: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    justifyContent: 'flex-end',
  },
});

export default GroupsScreen;
