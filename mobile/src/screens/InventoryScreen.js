/**
 * Inventory Screen
 *
 * Mirrors spa/inventory.js functionality
 * Equipment inventory management with photo upload, gallery/table views
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
  Image,
  Alert,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { translate as t } from '../i18n';
import theme, { commonStyles } from '../theme';
import {
  LoadingSpinner,
  Card,
  EmptyState,
  FormField,
  Select,
  Modal,
  Toast,
  useToast,
} from '../components';
import { canViewInventory, canManageInventory } from '../utils/PermissionUtils';
import { getEquipment } from '../api/api-endpoints';
import StorageUtils from '../utils/StorageUtils';

const LOCATION_TYPES = [
  { label: () => t('location_type_local_scout_hall'), value: 'local_scout_hall' },
  { label: () => t('location_type_warehouse'), value: 'warehouse' },
  { label: () => t('location_type_leader_home'), value: 'leader_home' },
  { label: () => t('location_type_other'), value: 'other' },
];

const InventoryScreen = ({ navigation }) => {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [equipment, setEquipment] = useState([]);
  const [viewMode, setViewMode] = useState('gallery'); // 'gallery' or 'list'

  // Modal states
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingItem, setEditingItem] = useState(null);

  // Form data
  const [formData, setFormData] = useState({
    name: '',
    category: '',
    description: '',
    quantity_total: '1',
    quantity_available: '',
    condition_note: '',
    item_value: '',
    acquisition_date: '',
    location_type: 'local_scout_hall',
    location_details: '',
    share_with_local_group: true,
    photo_url: '',
  });
  const [selectedImage, setSelectedImage] = useState(null); // Local image before upload

  const [submitting, setSubmitting] = useState(false);
  const toast = useToast();

  useEffect(() => {
    checkPermissionsAndLoad();
  }, []);

  const checkPermissionsAndLoad = async () => {
    try {
      if (!canViewInventory()) {
        Alert.alert(
          t('access_denied'),
          t('no_permission_to_view_inventory'),
          [
            {
              text: t('OK'),
              onPress: () => navigation.goBack(),
            },
          ]
        );
        return;
      }

      await loadData();
    } catch (err) {
      console.error('Error checking permissions:', err);
      setLoading(false);
    }
  };

  const loadData = async () => {
    try {
      const response = await getEquipment();

      if (response.success && response.data) {
        setEquipment(response.data.equipment || response.data || []);
      }
    } catch (err) {
      console.error('Error loading equipment:', err);
      toast.show(t('error_loading_data'), 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
  };

  const resetForm = () => {
    setFormData({
      name: '',
      category: '',
      description: '',
      quantity_total: '1',
      quantity_available: '',
      condition_note: '',
      item_value: '',
      acquisition_date: '',
      location_type: 'local_scout_hall',
      location_details: '',
      share_with_local_group: true,
      photo_url: '',
    });
    setSelectedImage(null);
  };

  // Image picker function
  const pickImage = async () => {
    try {
      // Request permission
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        toast.show(t('photo_permission_required'), 'warning');
        return;
      }

      // Launch picker
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.8,
      });

      if (!result.canceled && result.assets && result.assets[0]) {
        const imageUri = result.assets[0].uri;
        setSelectedImage(imageUri);
        setFormData({ ...formData, photo_url: imageUri });
      }
    } catch (error) {
      debugError('Error picking image:', error);
      toast.show(t('error_picking_image'), 'error');
    }
  };

  const handleAdd = async () => {
    if (!canManageInventory()) {
      toast.show(t('no_permission_to_manage_inventory'), 'error');
      return;
    }

    if (!formData.name) {
      toast.show(t('fill_required_fields'), 'warning');
      return;
    }

    try {
      setSubmitting(true);

      const payload = {
        name: formData.name.trim(),
        category: formData.category?.trim() || null,
        description: formData.description?.trim() || null,
        quantity_total: parseInt(formData.quantity_total, 10) || 1,
        quantity_available: formData.quantity_available
          ? parseInt(formData.quantity_available, 10)
          : null,
        condition_note: formData.condition_note?.trim() || null,
        item_value: formData.item_value ? parseFloat(formData.item_value) : null,
        acquisition_date: formData.acquisition_date || null,
        location_type: formData.location_type || 'local_scout_hall',
        location_details: formData.location_details?.trim() || null,
        share_with_local_group: formData.share_with_local_group,
        photo_url: formData.photo_url?.trim() || null,
      };

      const token = await StorageUtils.getJWT();
      const response = await fetch(`${API.baseURL}/v1/resources/equipment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const result = await response.json();

      if (result.success || response.ok) {
        toast.show(t('inventory_saved'), 'success');
        setShowAddModal(false);
        resetForm();
        await loadData();
      } else {
        toast.show(result.message || t('error_saving_equipment'), 'error');
      }
    } catch (err) {
      console.error('Error adding equipment:', err);
      toast.show(err.message || t('error_saving_equipment'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = async () => {
    if (!canManageInventory()) {
      toast.show(t('no_permission_to_manage_inventory'), 'error');
      return;
    }

    if (!formData.name) {
      toast.show(t('fill_required_fields'), 'warning');
      return;
    }

    try {
      setSubmitting(true);

      const payload = {
        name: formData.name.trim(),
        category: formData.category?.trim() || null,
        description: formData.description?.trim() || null,
        quantity_total: parseInt(formData.quantity_total, 10) || 1,
        quantity_available: formData.quantity_available
          ? parseInt(formData.quantity_available, 10)
          : null,
        condition_note: formData.condition_note?.trim() || null,
        item_value: formData.item_value ? parseFloat(formData.item_value) : null,
        acquisition_date: formData.acquisition_date || null,
        location_type: formData.location_type || 'local_scout_hall',
        location_details: formData.location_details?.trim() || null,
        photo_url: formData.photo_url?.trim() || null,
      };

      const token = await StorageUtils.getJWT();
      const response = await fetch(
        `${API.baseURL}/v1/resources/equipment/${editingItem.id}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        }
      );

      const result = await response.json();

      if (result.success || response.ok) {
        toast.show(t('equipment_updated'), 'success');
        setShowEditModal(false);
        setEditingItem(null);
        resetForm();
        await loadData();
      } else {
        toast.show(result.message || t('error_updating_equipment'), 'error');
      }
    } catch (err) {
      console.error('Error updating equipment:', err);
      toast.show(err.message || t('error_updating_equipment'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (item) => {
    if (!canManageInventory()) {
      toast.show(t('no_permission_to_manage_inventory'), 'error');
      return;
    }

    Alert.alert(
      t('equipment_delete_confirm_title'),
      t('equipment_delete_confirm_message').replace('{name}', item.name),
      [
        {
          text: t('cancel'),
          style: 'cancel',
        },
        {
          text: t('delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              const token = await StorageUtils.getJWT();
              const response = await fetch(
                `${API.baseURL}/v1/resources/equipment/${item.id}`,
                {
                  method: 'DELETE',
                  headers: { Authorization: `Bearer ${token}` },
                }
              );

              if (response.ok) {
                toast.show(t('equipment_deleted'), 'success');
                await loadData();
              } else {
                toast.show(t('error_deleting_equipment'), 'error');
              }
            } catch (err) {
              console.error('Error deleting equipment:', err);
              toast.show(t('error_deleting_equipment'), 'error');
            }
          },
        },
      ]
    );
  };

  const openEditModal = (item) => {
    setEditingItem(item);
    setFormData({
      name: item.name || '',
      category: item.category || '',
      description: item.description || '',
      quantity_total: String(item.quantity_total || 1),
      quantity_available: item.quantity_available ? String(item.quantity_available) : '',
      condition_note: item.condition_note || '',
      item_value: item.item_value ? String(item.item_value) : '',
      acquisition_date: item.acquisition_date ? item.acquisition_date.slice(0, 10) : '',
      location_type: item.location_type || 'local_scout_hall',
      location_details: item.location_details || '',
      share_with_local_group: item.share_with_local_group ?? true,
      photo_url: item.photo_url || '',
    });
    setSelectedImage(item.photo_url || null);
    setShowEditModal(true);
  };

  const formatLocation = (item) => {
    const typeObj = LOCATION_TYPES.find((t) => t.value === item.location_type);
    const typeLabel = typeObj ? typeObj.label() : t('location_type_local_scout_hall');
    const details = item.location_details?.trim();
    return details ? `${typeLabel} — ${details}` : typeLabel;
  };

  const formatCurrency = (value) => {
    if (!value) return '-';
    return new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency: 'CAD',
    }).format(value);
  };

  const formatDate = (dateString) => {
    if (!dateString) return '-';
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-CA');
    } catch {
      return '-';
    }
  };

  const renderEquipmentForm = () => {
    return (
      <View style={styles.formContainer}>
        {/* Image Picker Section */}
        <View style={styles.imageSection}>
          <Text style={styles.label}>{t('equipment_photo')}</Text>
          {selectedImage ? (
            <View style={styles.imagePreviewContainer}>
              <Image
                source={{ uri: selectedImage }}
                style={styles.imagePreview}
                resizeMode="cover"
              />
              <TouchableOpacity
                style={styles.changePhotoButton}
                onPress={pickImage}
              >
                <Text style={styles.changePhotoText}>{t('change_photo')}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity style={styles.addPhotoButton} onPress={pickImage}>
              <Text style={styles.addPhotoText}>📷 {t('add_photo')}</Text>
            </TouchableOpacity>
          )}
        </View>

        <FormField
          label={t('equipment_name')}
          value={formData.name}
          onChangeText={(value) => setFormData({ ...formData, name: value })}
          placeholder={t('equipment_name')}
          required
        />

        <FormField
          label={t('equipment_category')}
          value={formData.category}
          onChangeText={(value) => setFormData({ ...formData, category: value })}
          placeholder={t('equipment_category')}
        />

        <View style={styles.row}>
          <View style={styles.halfWidth}>
            <FormField
              label={t('equipment_quantity_total')}
              value={formData.quantity_total}
              onChangeText={(value) =>
                setFormData({ ...formData, quantity_total: value })
              }
              keyboardType="numeric"
              placeholder="1"
            />
          </View>
          <View style={styles.halfWidth}>
            <FormField
              label={t('equipment_available')}
              value={formData.quantity_available}
              onChangeText={(value) =>
                setFormData({ ...formData, quantity_available: value })
              }
              keyboardType="numeric"
              placeholder="0"
            />
          </View>
        </View>

        <View style={styles.row}>
          <View style={styles.halfWidth}>
            <FormField
              label={t('equipment_item_value')}
              value={formData.item_value}
              onChangeText={(value) =>
                setFormData({ ...formData, item_value: value })
              }
              keyboardType="decimal-pad"
              placeholder="0.00"
            />
          </View>
          <View style={styles.halfWidth}>
            <FormField
              label={t('equipment_acquisition_date')}
              value={formData.acquisition_date}
              onChangeText={(value) =>
                setFormData({ ...formData, acquisition_date: value })
              }
              placeholder="YYYY-MM-DD"
            />
          </View>
        </View>

        <Select
          label={t('equipment_location_type')}
          value={formData.location_type}
          onValueChange={(value) =>
            setFormData({ ...formData, location_type: value })
          }
          options={LOCATION_TYPES.map((type) => ({
            label: type.label(),
            value: type.value,
          }))}
        />

        <FormField
          label={t('equipment_location_details')}
          value={formData.location_details}
          onChangeText={(value) =>
            setFormData({ ...formData, location_details: value })
          }
          placeholder={t('equipment_location_details_placeholder')}
        />

        <FormField
          label={t('equipment_condition')}
          value={formData.condition_note}
          onChangeText={(value) =>
            setFormData({ ...formData, condition_note: value })
          }
          placeholder={t('equipment_condition')}
        />

        <FormField
          label={t('equipment_description')}
          value={formData.description}
          onChangeText={(value) =>
            setFormData({ ...formData, description: value })
          }
          placeholder={t('equipment_description')}
          multiline
          numberOfLines={3}
        />
      </View>
    );
  };

  const renderGalleryView = () => {
    if (equipment.length === 0) {
      return (
        <EmptyState
          icon="📦"
          message={t('no_data_available')}
          description={t('add_equipment_first')}
        />
      );
    }

    return (
      <View style={styles.galleryContainer}>
        {equipment.map((item) => (
          <Card key={item.id} style={styles.equipmentCard}>
            <View style={styles.equipmentCardHeader}>
              <Text style={styles.equipmentName}>{item.name}</Text>
              {item.category && (
                <Text style={styles.equipmentCategory}>{item.category}</Text>
              )}
            </View>

            <View style={styles.equipmentDetails}>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>{t('equipment_quantity_total')}:</Text>
                <Text style={styles.detailValue}>{item.quantity_total ?? 0}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>{t('equipment_reserved')}:</Text>
                <Text style={styles.detailValue}>{item.reserved_quantity ?? 0}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>{t('equipment_item_value')}:</Text>
                <Text style={styles.detailValue}>{formatCurrency(item.item_value)}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>{t('equipment_acquisition_date')}:</Text>
                <Text style={styles.detailValue}>{formatDate(item.acquisition_date)}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>{t('equipment_location')}:</Text>
                <Text style={styles.detailValue}>{formatLocation(item)}</Text>
              </View>
            </View>

            {canManageInventory() && (
              <View style={styles.cardActions}>
                <TouchableOpacity
                  style={[commonStyles.button, styles.editButton]}
                  onPress={() => openEditModal(item)}
                  activeOpacity={0.7}
                >
                  <Text style={commonStyles.buttonText}>{t('edit')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[commonStyles.button, styles.deleteButton]}
                  onPress={() => handleDelete(item)}
                  activeOpacity={0.7}
                >
                  <Text style={commonStyles.buttonText}>{t('delete')}</Text>
                </TouchableOpacity>
              </View>
            )}
          </Card>
        ))}
      </View>
    );
  };

  const renderListView = () => {
    if (equipment.length === 0) {
      return (
        <EmptyState
          icon="📦"
          message={t('no_data_available')}
          description={t('add_equipment_first')}
        />
      );
    }

    return (
      <View style={styles.listContainer}>
        {equipment.map((item) => (
          <Card key={item.id} style={styles.listItem}>
            <TouchableOpacity
              onPress={() => openEditModal(item)}
              activeOpacity={0.7}
              disabled={!canManageInventory()}
            >
              {/* Equipment Image */}
              {item.photo_url && (
                <Image
                  source={{ uri: item.photo_url }}
                  style={styles.equipmentImage}
                  resizeMode="cover"
                />
              )}
              
              <View style={styles.listItemHeader}>
                <Text style={styles.listItemName}>{item.name}</Text>
                <Text style={styles.listItemQuantity}>
                  {item.quantity_total ?? 0} {t('total')}
                </Text>
              </View>
              {item.category && (
                <Text style={styles.listItemCategory}>{item.category}</Text>
              )}
              <Text style={styles.listItemLocation}>{formatLocation(item)}</Text>
            </TouchableOpacity>
            {canManageInventory() && (
              <TouchableOpacity
                style={styles.deleteIconButton}
                onPress={() => handleDelete(item)}
                activeOpacity={0.7}
              >
                <Text style={styles.deleteIcon}>🗑️</Text>
              </TouchableOpacity>
            )}
          </Card>
        ))}
      </View>
    );
  };

  if (loading && !refreshing) {
    return <LoadingSpinner message={t('loading')} />;
  }

  return (
    <View style={commonStyles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContainer}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Header */}
        <Card style={styles.headerCard}>
          <Text style={styles.kicker}>{t('inventory')}</Text>
          <Text style={styles.title}>{t('inventory_title')}</Text>
          <Text style={styles.subtitle}>{t('inventory_description')}</Text>
        </Card>

        {/* Add Button */}
        {canManageInventory() && (
          <TouchableOpacity
            style={[commonStyles.button, styles.addButton]}
            onPress={() => {
              resetForm();
              setShowAddModal(true);
            }}
            activeOpacity={0.7}
          >
            <Text style={commonStyles.buttonText}>{t('equipment_add_new')}</Text>
          </TouchableOpacity>
        )}

        {/* View Toggle */}
        <View style={styles.viewToggle}>
          <TouchableOpacity
            style={[
              styles.viewToggleButton,
              viewMode === 'gallery' && styles.viewToggleButtonActive,
            ]}
            onPress={() => setViewMode('gallery')}
            activeOpacity={0.7}
          >
            <Text
              style={[
                styles.viewToggleText,
                viewMode === 'gallery' && styles.viewToggleTextActive,
              ]}
            >
              ▦ {t('equipment_gallery_view')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.viewToggleButton,
              viewMode === 'list' && styles.viewToggleButtonActive,
            ]}
            onPress={() => setViewMode('list')}
            activeOpacity={0.7}
          >
            <Text
              style={[
                styles.viewToggleText,
                viewMode === 'list' && styles.viewToggleTextActive,
              ]}
            >
              ☰ {t('equipment_table_view')}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Equipment Display */}
        {viewMode === 'gallery' ? renderGalleryView() : renderListView()}
      </ScrollView>

      {/* Add Equipment Modal */}
      <Modal
        visible={showAddModal}
        onClose={() => {
          setShowAddModal(false);
          resetForm();
        }}
        title={t('equipment_add_new')}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalContent}
        >
          <ScrollView>
            {renderEquipmentForm()}
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[commonStyles.button, submitting && commonStyles.buttonDisabled]}
                onPress={handleAdd}
                disabled={submitting}
                activeOpacity={0.7}
              >
                <Text style={commonStyles.buttonText}>
                  {submitting ? t('saving') : t('save_equipment')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[commonStyles.button, styles.cancelButton]}
                onPress={() => {
                  setShowAddModal(false);
                  resetForm();
                }}
                activeOpacity={0.7}
              >
                <Text style={commonStyles.buttonText}>{t('cancel')}</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      {/* Edit Equipment Modal */}
      <Modal
        visible={showEditModal}
        onClose={() => {
          setShowEditModal(false);
          setEditingItem(null);
          resetForm();
        }}
        title={t('equipment_edit')}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalContent}
        >
          <ScrollView>
            {renderEquipmentForm()}
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[commonStyles.button, submitting && commonStyles.buttonDisabled]}
                onPress={handleEdit}
                disabled={submitting}
                activeOpacity={0.7}
              >
                <Text style={commonStyles.buttonText}>
                  {submitting ? t('saving') : t('save_changes')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[commonStyles.button, styles.cancelButton]}
                onPress={() => {
                  setShowEditModal(false);
                  setEditingItem(null);
                  resetForm();
                }}
                activeOpacity={0.7}
              >
                <Text style={commonStyles.buttonText}>{t('cancel')}</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

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
    marginBottom: theme.spacing.lg,
    alignItems: 'center',
  },
  kicker: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.primary,
    textTransform: 'uppercase',
    marginBottom: theme.spacing.xs,
  },
  title: {
    fontSize: theme.fontSize.xxl,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.text,
    marginBottom: theme.spacing.sm,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: theme.fontSize.base,
    color: theme.colors.textMuted,
    textAlign: 'center',
  },
  addButton: {
    marginBottom: theme.spacing.lg,
  },
  viewToggle: {
    flexDirection: 'row',
    backgroundColor: theme.colors.borderLight,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.xs,
    marginBottom: theme.spacing.lg,
    gap: theme.spacing.xs,
  },
  viewToggleButton: {
    flex: 1,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.borderRadius.sm,
    alignItems: 'center',
    minHeight: theme.touchTarget.min,
    justifyContent: 'center',
  },
  viewToggleButtonActive: {
    backgroundColor: theme.colors.surface,
  },
  viewToggleText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.textMuted,
  },
  viewToggleTextActive: {
    color: theme.colors.primary,
    fontWeight: theme.fontWeight.semibold,
  },
  galleryContainer: {
    gap: theme.spacing.md,
  },
  equipmentCard: {
    marginBottom: theme.spacing.sm,
  },
  equipmentCardHeader: {
    marginBottom: theme.spacing.md,
  },
  equipmentName: {
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.text,
    marginBottom: theme.spacing.xs,
  },
  equipmentCategory: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
  },
  equipmentDetails: {
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.md,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  detailLabel: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
  },
  detailValue: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.text,
  },
  cardActions: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.md,
  },
  editButton: {
    flex: 1,
  },
  deleteButton: {
    flex: 1,
    backgroundColor: theme.colors.danger,
  },
  listContainer: {
    gap: theme.spacing.sm,
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  listItemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.xs,
  },
  listItemName: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.text,
    flex: 1,
  },
  listItemQuantity: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.primary,
  },
  listItemCategory: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
    marginBottom: theme.spacing.xs,
  },
  listItemLocation: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
  },
  deleteIconButton: {
    padding: theme.spacing.sm,
    minHeight: theme.touchTarget.min,
    minWidth: theme.touchTarget.min,
    justifyContent: 'center',
    alignItems: 'center',
  },
  deleteIcon: {
    fontSize: theme.fontSize.xl,
  },
  formContainer: {
    gap: theme.spacing.md,
  },
  row: {
    flexDirection: 'row',
    gap: theme.spacing.md,
  },
  halfWidth: {
    flex: 1,
  },
  modalContent: {
    maxHeight: '80%',
  },
  modalActions: {
    flexDirection: 'column',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.lg,
  },
  cancelButton: {
    backgroundColor: theme.colors.textMuted,
  },
  // Image styles
  imageSection: {
    marginBottom: theme.spacing.md,
  },
  label: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.text,
    marginBottom: theme.spacing.xs,
  },
  imagePreviewContainer: {
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  imagePreview: {
    width: '100%',
    height: 200,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.borderLight,
  },
  changePhotoButton: {
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    backgroundColor: theme.colors.primary,
    borderRadius: theme.borderRadius.md,
    minHeight: theme.touchTarget.min,
  },
  changePhotoText: {
    color: theme.colors.surface,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
  },
  addPhotoButton: {
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
    backgroundColor: theme.colors.borderLight,
    borderRadius: theme.borderRadius.md,
    borderWidth: 2,
    borderColor: theme.colors.border,
    borderStyle: 'dashed',
    alignItems: 'center',
    minHeight: theme.touchTarget.min,
  },
  addPhotoText: {
    color: theme.colors.textMuted,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  equipmentImage: {
    width: '100%',
    height: 150,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.borderLight,
    marginBottom: theme.spacing.sm,
  },
});

export default InventoryScreen;
