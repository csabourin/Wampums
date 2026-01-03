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
import { Picker } from '@react-native-picker/picker';
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
import CONFIG from '../config';
import StorageUtils from '../utils/StorageUtils';
import { debugLog, debugError } from '../utils/DebugUtils';

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
      debugError('Error checking permissions:', err);
      setLoading(false);
    }
  };

  const loadData = async () => {
    try {
      const response = await getEquipment();

      if (response.success && response.data) {
        const equipmentData = response.data.equipment || response.data || [];
        
        // DEBUG: Log equipment data to see photo_url
        debugLog('Equipment data loaded:', equipmentData.length, 'items');
        equipmentData.forEach((item, index) => {
          debugLog(`Item ${index}:`, {
            id: item.id,
            name: item.name,
            photo_url: item.photo_url,
            hasPhoto: !!item.photo_url
          });
        });
        
        setEquipment(equipmentData);
      }
    } catch (err) {
      debugError('Error loading equipment:', err);
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
      const response = await fetch(`${CONFIG.API.BASE_URL}/v1/resources/equipment`, {
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
      debugError('Error adding equipment:', err);
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
        `${CONFIG.API.BASE_URL}/v1/resources/equipment/${editingItem.id}`,
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
      debugError('Error updating equipment:', err);
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
                `${CONFIG.API.BASE_URL}/v1/resources/equipment/${item.id}`,
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
              debugError('Error deleting equipment:', err);
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
      <ScrollView style={styles.formContainer} showsVerticalScrollIndicator={false}>
      {/* Image Picker Section */}
      <View style={styles.imageSection}>
        {selectedImage ? (
        <View style={styles.imagePreviewContainer}>
          <Image
          source={{
            uri: selectedImage,
            cache: 'force-cache',
          }}
          style={styles.imagePreview}
          resizeMode="cover"
          onError={(e) => debugError('Preview error:', e.nativeEvent.error)}
          />
          <TouchableOpacity
          style={styles.changePhotoButton}
          onPress={pickImage}
          >
          <Text style={styles.changePhotoText}>📷 {t('change_photo')}</Text>
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

      <View style={styles.row}>
        <View style={styles.halfWidth}>
        <FormField
          label={t('equipment_category')}
          value={formData.category}
          onChangeText={(value) => setFormData({ ...formData, category: value })}
          placeholder={t('equipment_category')}
        />
        </View>
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
      </View>

      <View style={styles.row}>
        <View style={styles.halfWidth}>
        <FormField
          label={t('equipment_item_value') + ' ($)'}
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

      <View>
        <Text style={styles.label}>{t('equipment_location_type')}</Text>
        <Picker
        selectedValue={formData.location_type}
        onValueChange={(value) =>
          setFormData({ ...formData, location_type: value })
        }
        >
        {LOCATION_TYPES.map((type) => (
          <Picker.Item key={type.value} label={type.label()} value={type.value} />
        ))}
        </Picker>
      </View>

      <FormField
        label={t('equipment_location_details')}
        value={formData.location_details}
        onChangeText={(value) =>
        setFormData({ ...formData, location_details: value })
        }
        placeholder={t('equipment_location_details_placeholder')}
      />

      <View>
        <Text style={styles.label}>{t('equipment_condition')}</Text>
        <Picker
        selectedValue={formData.condition_note}
        onValueChange={(value) =>
          setFormData({ ...formData, condition_note: value })
        }
        >
        <Picker.Item label={t('condition_excellent')} value="excellent" />
        <Picker.Item label={t('condition_good')} value="good" />
        <Picker.Item label={t('condition_fair')} value="fair" />
        <Picker.Item label={t('condition_poor')} value="poor" />
        </Picker>
      </View>

      <FormField
        label={t('equipment_description')}
        value={formData.description}
        onChangeText={(value) =>
        setFormData({ ...formData, description: value })
        }
        placeholder={t('equipment_description')}
        multiline
        numberOfLines={2}
      />
      </ScrollView>
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
        {equipment.map((item) => {
          const available = item.quantity_available ?? (item.quantity_total - (item.reserved_quantity ?? 0));
          const total = item.quantity_total ?? 0;
          const reserved = item.reserved_quantity ?? 0;

          return (
            <TouchableOpacity
              key={item.id}
              onPress={() => canManageInventory() && openEditModal(item)}
              activeOpacity={0.8}
              disabled={!canManageInventory()}
            >
              <Card style={styles.galleryCard}>
                {/* Large Image */}
                {item.photo_url ? (
                  <Image
                    source={{ uri: item.photo_url, cache: 'force-cache' }}
                    style={styles.galleryImage}
                    resizeMode="cover"
                    onError={(e) => debugError('Gallery image error:', e.nativeEvent.error)}
                  />
                ) : (
                  <View style={styles.galleryImagePlaceholder}>
                    <Text style={styles.galleryImagePlaceholderIcon}>📦</Text>
                  </View>
                )}

                {/* Equipment Info Overlay */}
                <View style={styles.galleryInfo}>
                  <Text style={styles.galleryName} numberOfLines={2}>{item.name}</Text>

                  {item.category && (
                    <View style={styles.galleryCategoryBadge}>
                      <Text style={styles.galleryCategoryText}>{item.category}</Text>
                    </View>
                  )}

                  {/* Key Stats */}
                  <View style={styles.galleryStats}>
                    <View style={styles.galleryStat}>
                      <Text style={styles.galleryStatValue}>{total}</Text>
                      <Text style={styles.galleryStatLabel}>{t('total')}</Text>
                    </View>
                    <View style={styles.galleryStatDivider} />
                    <View style={styles.galleryStat}>
                      <Text style={styles.galleryStatValue}>{available}</Text>
                      <Text style={styles.galleryStatLabel}>{t('available')}</Text>
                    </View>
                    <View style={styles.galleryStatDivider} />
                    <View style={styles.galleryStat}>
                      <Text style={styles.galleryStatValue}>{reserved}</Text>
                      <Text style={styles.galleryStatLabel}>{t('reserved')}</Text>
                    </View>
                  </View>

                  {/* Location */}
                  <View style={styles.galleryLocation}>
                    <Text style={styles.galleryLocationIcon}>📍</Text>
                    <Text style={styles.galleryLocationText} numberOfLines={1}>
                      {formatLocation(item)}
                    </Text>
                  </View>
                </View>

                {/* Delete button for manage permission */}
                {canManageInventory() && (
                  <TouchableOpacity
                    style={styles.galleryDeleteButton}
                    onPress={() => handleDelete(item)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.galleryDeleteIcon}>🗑️</Text>
                  </TouchableOpacity>
                )}
              </Card>
            </TouchableOpacity>
          );
        })}
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
      <View style={styles.tableContainer}>
        {equipment.map((item) => {
          const available = item.quantity_available ?? (item.quantity_total - (item.reserved_quantity ?? 0));
          const total = item.quantity_total ?? 0;
          const reserved = item.reserved_quantity ?? 0;

          return (
            <TouchableOpacity
              key={item.id}
              onPress={() => canManageInventory() && openEditModal(item)}
              activeOpacity={0.7}
              disabled={!canManageInventory()}
            >
              <Card style={styles.tableRow}>
                {/* Square Thumbnail */}
                {item.photo_url ? (
                  <Image
                    source={{ uri: item.photo_url, cache: 'force-cache' }}
                    style={styles.tableThumbnail}
                    resizeMode="cover"
                    onError={(e) => debugError('Table thumbnail error:', e.nativeEvent.error)}
                  />
                ) : (
                  <View style={styles.tableThumbnailPlaceholder}>
                    <Text style={styles.tableThumbnailIcon}>📦</Text>
                  </View>
                )}

                {/* Equipment Details */}
                <View style={styles.tableContent}>
                  <View style={styles.tableHeader}>
                    <Text style={styles.tableName} numberOfLines={1}>{item.name}</Text>
                    {item.category && (
                      <View style={styles.tableCategoryBadge}>
                        <Text style={styles.tableCategoryText} numberOfLines={1}>{item.category}</Text>
                      </View>
                    )}
                  </View>

                  {/* Compact Info Grid */}
                  <View style={styles.tableInfoGrid}>
                    <View style={styles.tableInfoItem}>
                      <Text style={styles.tableInfoLabel}>{t('total')}:</Text>
                      <Text style={styles.tableInfoValue}>{total}</Text>
                    </View>
                    <View style={styles.tableInfoItem}>
                      <Text style={styles.tableInfoLabel}>{t('reserved')}:</Text>
                      <Text style={styles.tableInfoValue}>{reserved}</Text>
                    </View>
                    <View style={styles.tableInfoItem}>
                      <Text style={styles.tableInfoLabel}>{t('value')}:</Text>
                      <Text style={styles.tableInfoValue}>{formatCurrency(item.item_value)}</Text>
                    </View>
                  </View>

                  <View style={styles.tableInfoGrid}>
                    <View style={styles.tableInfoItem}>
                      <Text style={styles.tableInfoLabel}>{t('date')}:</Text>
                      <Text style={styles.tableInfoValue}>{formatDate(item.acquisition_date)}</Text>
                    </View>
                    <View style={[styles.tableInfoItem, styles.tableInfoItemWide]}>
                      <Text style={styles.tableInfoLabel}>📍</Text>
                      <Text style={styles.tableInfoValue} numberOfLines={1}>
                        {formatLocation(item)}
                      </Text>
                    </View>
                  </View>
                </View>

                {/* Delete button */}
                {canManageInventory() && (
                  <TouchableOpacity
                    style={styles.tableDeleteButton}
                    onPress={() => handleDelete(item)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.tableDeleteIcon}>🗑️</Text>
                  </TouchableOpacity>
                )}
              </Card>
            </TouchableOpacity>
          );
        })}
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
    color: theme.colors.text.primary,
    marginBottom: theme.spacing.sm,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: theme.fontSize.base,
    color: theme.colors.text.tertiary,
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
    color: theme.colors.text.tertiary,
  },
  viewToggleTextActive: {
    color: theme.colors.primary,
    fontWeight: theme.fontWeight.semibold,
  },

  // ===== GALLERY VIEW STYLES =====
  galleryContainer: {
    gap: theme.spacing.md,
  },
  galleryCard: {
    padding: 0,
    overflow: 'hidden',
    marginBottom: theme.spacing.md,
  },
  galleryImage: {
    width: '100%',
    height: 220,
    backgroundColor: theme.colors.background.secondary,
  },
  galleryImagePlaceholder: {
    width: '100%',
    height: 220,
    backgroundColor: theme.colors.background.secondary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  galleryImagePlaceholderIcon: {
    fontSize: 64,
    opacity: 0.3,
  },
  galleryInfo: {
    padding: theme.spacing.md,
  },
  galleryName: {
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.text.primary,
    marginBottom: theme.spacing.sm,
  },
  galleryCategoryBadge: {
    alignSelf: 'flex-start',
    backgroundColor: theme.colors.secondary,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.borderRadius.sm,
    marginBottom: theme.spacing.md,
  },
  galleryCategoryText: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.primary,
    textTransform: 'uppercase',
  },
  galleryStats: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingVertical: theme.spacing.md,
    marginBottom: theme.spacing.sm,
    backgroundColor: theme.colors.background.secondary,
    borderRadius: theme.borderRadius.md,
  },
  galleryStat: {
    alignItems: 'center',
    flex: 1,
  },
  galleryStatValue: {
    fontSize: theme.fontSize.xl,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.primary,
    marginBottom: theme.spacing.xs,
  },
  galleryStatLabel: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.text.secondary,
    textTransform: 'uppercase',
  },
  galleryStatDivider: {
    width: 1,
    height: 32,
    backgroundColor: theme.colors.border,
  },
  galleryLocation: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
  },
  galleryLocationIcon: {
    fontSize: theme.fontSize.base,
  },
  galleryLocationText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.text.secondary,
    flex: 1,
  },
  galleryDeleteButton: {
    position: 'absolute',
    top: theme.spacing.sm,
    right: theme.spacing.sm,
    backgroundColor: 'rgba(154, 63, 56, 0.9)',
    width: 40,
    height: 40,
    borderRadius: theme.borderRadius.full,
    justifyContent: 'center',
    alignItems: 'center',
    ...theme.shadows.md,
  },
  galleryDeleteIcon: {
    fontSize: 20,
  },

  // ===== TABLE VIEW STYLES =====
  tableContainer: {
    gap: theme.spacing.sm,
  },
  tableRow: {
    flexDirection: 'row',
    padding: theme.spacing.sm,
    gap: theme.spacing.sm,
    alignItems: 'flex-start',
    marginBottom: theme.spacing.xs,
  },
  tableThumbnail: {
    width: 80,
    height: 80,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.background.secondary,
  },
  tableThumbnailPlaceholder: {
    width: 80,
    height: 80,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.background.secondary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tableThumbnailIcon: {
    fontSize: 32,
    opacity: 0.3,
  },
  tableContent: {
    flex: 1,
    gap: theme.spacing.xs,
  },
  tableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.xs,
  },
  tableName: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.text.primary,
    flex: 1,
  },
  tableCategoryBadge: {
    backgroundColor: theme.colors.secondary,
    paddingHorizontal: theme.spacing.xs,
    paddingVertical: 2,
    borderRadius: theme.borderRadius.sm,
  },
  tableCategoryText: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.primary,
    textTransform: 'uppercase',
  },
  tableInfoGrid: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  tableInfoItem: {
    flex: 1,
    flexDirection: 'row',
    gap: theme.spacing.xs,
    alignItems: 'baseline',
  },
  tableInfoItemWide: {
    flex: 2,
  },
  tableInfoLabel: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.text.secondary,
  },
  tableInfoValue: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.text.primary,
    flex: 1,
  },
  tableDeleteButton: {
    padding: theme.spacing.xs,
    minWidth: theme.touchTarget.min,
    minHeight: theme.touchTarget.min,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tableDeleteIcon: {
    fontSize: 20,
  },

  // ===== FORM/MODAL STYLES =====
  formContainer: {
    gap: theme.spacing.sm,
    paddingBottom: theme.spacing.md,
  },
  row: {
    flexDirection: 'row',
    gap: theme.spacing.md,
  },
  halfWidth: {
    flex: 1,
  },
  modalContent: {
    flex: 1,
  },
  modalActions: {
    flexDirection: 'column',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.md,
    paddingTop: theme.spacing.md,
    borderTopWidth: 1,
    borderTopColor: theme.colors.borderLight,
  },
  cancelButton: {
    backgroundColor: theme.colors.text.tertiary,
  },

  // Image styles
  imageSection: {
    marginBottom: theme.spacing.sm,
  },
  label: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.text.primary,
    marginBottom: theme.spacing.xs,
  },
  imagePreviewContainer: {
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  imagePreview: {
    width: '100%',
    height: 180,
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
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    backgroundColor: theme.colors.borderLight,
    borderRadius: theme.borderRadius.md,
    borderWidth: 2,
    borderColor: theme.colors.border,
    borderStyle: 'dashed',
    alignItems: 'center',
    minHeight: 60,
  },
  addPhotoText: {
    color: theme.colors.text.tertiary,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
});

export default InventoryScreen;
