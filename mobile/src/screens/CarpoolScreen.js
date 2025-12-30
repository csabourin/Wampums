/**
 * CarpoolScreen
 *
 * Comprehensive carpool coordination screen
 * Faithfully mirrors spa/carpool_dashboard.js functionality
 *
 * Features:
 * - View all carpool offers for an activity
 * - Create/edit/cancel carpool offers
 * - Assign participants to carpools
 * - Remove assignments
 * - View current assignments
 * - Different UI for parents vs staff
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
  Modal,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import { Picker } from '@react-native-picker/picker';
import {
  getActivity,
  getActivityParticipants,
  getCarpoolOffers,
  createCarpoolOffer,
  updateCarpoolOffer,
  cancelCarpoolOffer,
  assignParticipantToCarpool,
  removeAssignment,
  getUnassignedParticipants,
} from '../api/api-endpoints';
import { translate as t } from '../i18n';
import DateUtils from '../utils/DateUtils';
import { hasPermission } from '../utils/PermissionUtils';
import StorageUtils from '../utils/StorageUtils';
import SecurityUtils from '../utils/SecurityUtils';
import theme, { commonStyles } from '../theme';
import {
  Button,
  Card,
  LoadingState,
  ErrorState,
  EmptyState,
} from '../components';
import { debugLog, debugError } from '../utils/DebugUtils';
import CONFIG from '../config';

const CarpoolScreen = () => {
  const navigation = useNavigation();
  const route = useRoute();
  const activityId = parseInt(route.params?.activityId);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  // Data state
  const [activity, setActivity] = useState(null);
  const [carpoolOffers, setCarpoolOffers] = useState([]);
  const [participants, setParticipants] = useState([]);
  const [unassignedParticipants, setUnassignedParticipants] = useState([]);
  const [userPermissions, setUserPermissions] = useState([]);
  const [userId, setUserId] = useState(null);

  // Modal state
  const [showOfferModal, setShowOfferModal] = useState(false);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [editingOffer, setEditingOffer] = useState(null);
  const [selectedOfferId, setSelectedOfferId] = useState(null);
  const [selectedParticipantId, setSelectedParticipantId] = useState(null);

  // Offer form state
  const [offerForm, setOfferForm] = useState({
    vehicle_make: '',
    vehicle_color: '',
    total_seats_available: 3,
    trip_direction: 'both',
    notes: '',
  });

  // Assignment form state
  const [assignmentForm, setAssignmentForm] = useState({
    participant_id: '',
    carpool_offer_id: '',
    trip_direction: 'both',
  });

  // Permissions
  const isStaff = hasPermission('carpools.manage', userPermissions);
  const hasCarpoolAccess = hasPermission('carpools.view', userPermissions) || isStaff;

  // Validate activityId - show error if missing or invalid
  const isInvalidActivityId = !route.params?.activityId || isNaN(activityId);

  useEffect(() => {
    loadUserData();
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (hasCarpoolAccess && !isInvalidActivityId) {
        loadData();
      }
    }, [hasCarpoolAccess, isInvalidActivityId])
  );

  const loadUserData = async () => {
    try {
      const permissions = await StorageUtils.getItem(CONFIG.STORAGE_KEYS.USER_PERMISSIONS);
      setUserPermissions(permissions || []);

      const storedUserId = await StorageUtils.getItem(CONFIG.STORAGE_KEYS.USER_ID);
      setUserId(storedUserId);
    } catch (err) {
      debugError('Error loading user data:', err);
    }
  };

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Load activity, offers, and participants in parallel
      const [activityResponse, offersResponse, participantsResponse] = await Promise.all([
        getActivity(activityId),
        getCarpoolOffers(activityId),
        getActivityParticipants(activityId),
      ]);

      if (activityResponse.success && activityResponse.data) {
        setActivity(activityResponse.data);
      } else {
        throw new Error(activityResponse.message || t('error_loading_activity'));
      }

      if (offersResponse.success) {
        setCarpoolOffers(offersResponse.data || []);
      }

      if (participantsResponse.success) {
        setParticipants(participantsResponse.data || []);
      }

      // Load unassigned participants if staff
      if (isStaff) {
        const unassignedResponse = await getUnassignedParticipants(activityId);
        if (unassignedResponse.success) {
          setUnassignedParticipants(unassignedResponse.data || []);
        }
      }
    } catch (err) {
      debugError('Error loading carpool data:', err);
      setError(err.message || t('error_loading_data'));
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const handleOfferFieldChange = (field, value) => {
    setOfferForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleAssignmentFieldChange = (field, value) => {
    setAssignmentForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const openOfferModal = (offer = null) => {
    if (offer) {
      setEditingOffer(offer);
      setOfferForm({
        vehicle_make: offer.vehicle_make || '',
        vehicle_color: offer.vehicle_color || '',
        total_seats_available: offer.total_seats_available || 3,
        trip_direction: offer.trip_direction || 'both',
        notes: offer.notes || '',
      });
    } else {
      setEditingOffer(null);
      setOfferForm({
        vehicle_make: '',
        vehicle_color: '',
        total_seats_available: 3,
        trip_direction: 'both',
        notes: '',
      });
    }
    setShowOfferModal(true);
  };

  const closeOfferModal = () => {
    setShowOfferModal(false);
    setEditingOffer(null);
  };

  const handleSaveOffer = async () => {
    // Validation
    if (!offerForm.vehicle_make.trim()) {
      Alert.alert(t('error'), t('vehicle_make') + ' ' + t('is_required'));
      return;
    }
    if (!offerForm.vehicle_color.trim()) {
      Alert.alert(t('error'), t('vehicle_color') + ' ' + t('is_required'));
      return;
    }
    if (offerForm.total_seats_available < 1 || offerForm.total_seats_available > 8) {
      Alert.alert(t('error'), t('seats_available_help'));
      return;
    }

    try {
      setSaving(true);

      const data = {
        activity_id: activityId,
        vehicle_make: SecurityUtils.sanitizeInput(offerForm.vehicle_make.trim()),
        vehicle_color: SecurityUtils.sanitizeInput(offerForm.vehicle_color.trim()),
        total_seats_available: parseInt(offerForm.total_seats_available),
        trip_direction: offerForm.trip_direction,
        notes: offerForm.notes ? SecurityUtils.sanitizeInput(offerForm.notes.trim()) : null,
      };

      let response;
      if (editingOffer) {
        response = await updateCarpoolOffer(editingOffer.id, data);
      } else {
        response = await createCarpoolOffer(data);
      }

      if (response.success) {
        Alert.alert(
          t('success'),
          editingOffer ? t('ride_offer_updated') : t('ride_offer_created')
        );
        closeOfferModal();
        await loadData();
      } else {
        throw new Error(response.message || t('error_saving_data'));
      }
    } catch (err) {
      debugError('Error saving offer:', err);
      Alert.alert(t('error'), err.message || t('error_saving_data'));
    } finally {
      setSaving(false);
    }
  };

  const handleCancelOffer = async (offer) => {
    const hasAssignments = offer.assignments && offer.assignments.length > 0;

    if (hasAssignments) {
      Alert.prompt(
        t('confirm_cancel_ride'),
        t('cancel_ride_with_assignments_prompt'),
        [
          {
            text: t('cancel'),
            style: 'cancel',
          },
          {
            text: t('confirm'),
            style: 'destructive',
            onPress: async (reason) => {
              await performCancelOffer(offer.id, reason);
            },
          },
        ],
        'plain-text'
      );
    } else {
      Alert.alert(
        t('confirm_cancel_ride'),
        t('are_you_sure'),
        [
          {
            text: t('cancel'),
            style: 'cancel',
          },
          {
            text: t('confirm'),
            style: 'destructive',
            onPress: async () => {
              await performCancelOffer(offer.id, '');
            },
          },
        ]
      );
    }
  };

  const performCancelOffer = async (offerId, reason) => {
    try {
      setSaving(true);
      const response = await cancelCarpoolOffer(offerId, reason);

      if (response.success) {
        Alert.alert(t('success'), t('ride_cancelled_success'));
        await loadData();
      } else {
        throw new Error(response.message || t('error_cancelling_ride'));
      }
    } catch (err) {
      debugError('Error cancelling offer:', err);
      Alert.alert(t('error'), err.message || t('error_cancelling_ride'));
    } finally {
      setSaving(false);
    }
  };

  const openAssignModal = (offerId = null, participantId = null) => {
    setSelectedOfferId(offerId);
    setSelectedParticipantId(participantId);
    setAssignmentForm({
      participant_id: participantId ? String(participantId) : '',
      carpool_offer_id: offerId ? String(offerId) : '',
      trip_direction: 'both',
    });
    setShowAssignModal(true);
  };

  const closeAssignModal = () => {
    setShowAssignModal(false);
    setSelectedOfferId(null);
    setSelectedParticipantId(null);
  };

  const handleAssignParticipant = async () => {
    if (!assignmentForm.participant_id || !assignmentForm.carpool_offer_id) {
      Alert.alert(t('error'), t('please_select_all_fields'));
      return;
    }

    try {
      setSaving(true);

      const data = {
        participant_id: parseInt(assignmentForm.participant_id),
        carpool_offer_id: parseInt(assignmentForm.carpool_offer_id),
        trip_direction: assignmentForm.trip_direction,
      };

      const response = await assignParticipantToCarpool(data);

      if (response.success) {
        Alert.alert(t('success'), t('participant_assigned_success'));
        closeAssignModal();
        await loadData();
      } else {
        throw new Error(response.message || t('error_assigning_participant'));
      }
    } catch (err) {
      debugError('Error assigning participant:', err);
      Alert.alert(t('error'), err.message || t('error_assigning_participant'));
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveAssignment = async (assignmentId) => {
    Alert.alert(
      t('confirm_remove_assignment'),
      t('are_you_sure'),
      [
        {
          text: t('cancel'),
          style: 'cancel',
        },
        {
          text: t('remove'),
          style: 'destructive',
          onPress: async () => {
            try {
              setSaving(true);
              const response = await removeAssignment(assignmentId);

              if (response.success) {
                Alert.alert(t('success'), t('assignment_removed_success'));
                await loadData();
              } else {
                throw new Error(response.message || t('error_removing_assignment'));
              }
            } catch (err) {
              debugError('Error removing assignment:', err);
              Alert.alert(t('error'), err.message || t('error_removing_assignment'));
            } finally {
              setSaving(false);
            }
          },
        },
      ]
    );
  };

  const renderOfferCard = (offer) => {
    const assignments = offer.assignments || [];
    const seatsUsedGoing = offer.seats_used_going || 0;
    const seatsUsedReturn = offer.seats_used_return || 0;
    const totalSeats = offer.total_seats_available;

    const showGoing = ['both', 'to_activity'].includes(offer.trip_direction);
    const showReturn = ['both', 'from_activity'].includes(offer.trip_direction);

    const isOwner = offer.user_id === userId;
    const canEdit = isOwner || isStaff;

    return (
      <Card key={offer.id} style={styles.offerCard}>
        <View style={styles.offerHeader}>
          <View style={styles.driverInfo}>
            <Text style={styles.driverName}>🚗 {offer.driver_name}</Text>
            {isOwner && <Text style={styles.youBadge}>{t('you')}</Text>}
          </View>

          {canEdit && (
            <View style={styles.offerActions}>
              <TouchableOpacity onPress={() => openOfferModal(offer)} style={styles.iconButton}>
                <Text style={styles.iconText}>✏️</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => handleCancelOffer(offer)} style={styles.iconButton}>
                <Text style={styles.iconText}>🗑️</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        <Text style={styles.vehicleInfo}>
          {offer.vehicle_color} {offer.vehicle_make}
        </Text>

        {offer.notes && (
          <Text style={styles.notes}>{offer.notes}</Text>
        )}

        {/* Capacity indicators */}
        {showGoing && (
          <View style={styles.capacitySection}>
            <Text style={styles.capacityLabel}>{t('going')}:</Text>
            <View style={styles.capacityBar}>
              <View
                style={[
                  styles.capacityFill,
                  { width: `${(seatsUsedGoing / totalSeats) * 100}%` },
                ]}
              />
            </View>
            <Text style={styles.capacityText}>
              {seatsUsedGoing}/{totalSeats} {t('seats')}
            </Text>
          </View>
        )}

        {showReturn && (
          <View style={styles.capacitySection}>
            <Text style={styles.capacityLabel}>{t('returning')}:</Text>
            <View style={styles.capacityBar}>
              <View
                style={[
                  styles.capacityFill,
                  { width: `${(seatsUsedReturn / totalSeats) * 100}%` },
                ]}
              />
            </View>
            <Text style={styles.capacityText}>
              {seatsUsedReturn}/{totalSeats} {t('seats')}
            </Text>
          </View>
        )}

        {/* Passengers list */}
        {assignments.length > 0 && (
          <View style={styles.passengerSection}>
            <Text style={styles.passengerTitle}>
              {t('passengers')} ({assignments.length})
            </Text>
            {assignments.map((a) => (
              <View key={a.assignment_id} style={styles.passengerItem}>
                <Text style={styles.passengerName}>{a.participant_name}</Text>
                <Text style={styles.directionBadge}>{t(a.trip_direction)}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Assign button */}
        {(seatsUsedGoing < totalSeats || seatsUsedReturn < totalSeats) && (
          <Button
            title={t('assign_participant')}
            onPress={() => openAssignModal(offer.id)}
            variant="primary"
            style={styles.assignButton}
          />
        )}
      </Card>
    );
  };

  const renderAssignments = () => {
    const allAssignments = [];

    carpoolOffers.forEach((offer) => {
      if (offer.assignments && offer.assignments.length > 0) {
        offer.assignments.forEach((assignment) => {
          allAssignments.push({
            ...assignment,
            driver_name: offer.driver_name,
            vehicle_make: offer.vehicle_make,
            vehicle_color: offer.vehicle_color,
            offer_id: offer.id,
          });
        });
      }
    });

    if (allAssignments.length === 0) {
      return (
        <EmptyState
          icon="📋"
          title={t('no_assignments_yet')}
          message={t('assign_participants_to_carpools')}
        />
      );
    }

    // Group by participant
    const groupedByParticipant = allAssignments.reduce((acc, assignment) => {
      if (!acc[assignment.participant_id]) {
        acc[assignment.participant_id] = [];
      }
      acc[assignment.participant_id].push(assignment);
      return acc;
    }, {});

    return (
      <View>
        {Object.entries(groupedByParticipant).map(([participantId, assignments]) => {
          const firstAssignment = assignments[0];
          const canRemove = isStaff || firstAssignment.assigned_by === userId;

          return (
            <Card key={participantId} style={styles.assignmentCard}>
              <Text style={styles.assignmentParticipant}>
                {firstAssignment.participant_name}
              </Text>
              {assignments.map((a) => (
                <View key={a.assignment_id} style={styles.assignmentRide}>
                  <View style={styles.assignmentDetails}>
                    <Text style={styles.assignmentDriver}>
                      🚗 {a.driver_name}
                    </Text>
                    <Text style={styles.assignmentVehicle}>
                      {a.vehicle_color} {a.vehicle_make}
                    </Text>
                    <Text style={styles.assignmentDirection}>
                      {t(a.trip_direction)}
                    </Text>
                  </View>
                  {canRemove && (
                    <TouchableOpacity
                      onPress={() => handleRemoveAssignment(a.assignment_id)}
                      style={styles.removeButton}
                    >
                      <Text style={styles.removeButtonText}>{t('remove')}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ))}
            </Card>
          );
        })}
      </View>
    );
  };

  // Invalid activity ID - show error and redirect
  if (isInvalidActivityId) {
    return (
      <View style={commonStyles.container}>
        <EmptyState
          icon="⚠️"
          title={t('invalid_activity')}
          message={t('please_select_activity_from_list')}
          actionLabel={t('go_to_activities')}
          onAction={() => navigation.navigate('Activities')}
        />
      </View>
    );
  }

  // Loading state
  if (loading) {
    return <LoadingState message={t('loading_carpool_data')} />;
  }

  // Error state
  if (error) {
    return <ErrorState message={error} onRetry={loadData} />;
  }

  // No access
  if (!hasCarpoolAccess) {
    return (
      <EmptyState
        icon="🔒"
        title={t('access_denied')}
        message={t('no_carpool_access')}
        actionLabel={t('go_back')}
        onAction={() => navigation.goBack()}
      />
    );
  }

  // Activity not found
  if (!activity) {
    return (
      <ErrorState
        message={t('activity_not_found')}
        onRetry={() => navigation.goBack()}
      />
    );
  }

  const activityDate = DateUtils.formatDate(activity.date || activity.activity_date);
  const hasReturnTrip = activity.meeting_location_return;

  return (
    <View style={commonStyles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Activity Info */}
        <Card style={styles.activityCard}>
          <Text style={styles.activityName}>{activity.name}</Text>
          <Text style={styles.activityDate}>📅 {activityDate}</Text>

          {activity.meeting_time_going && (
            <View style={styles.meetingInfo}>
              <Text style={styles.meetingTitle}>{t('going')}:</Text>
              <Text style={styles.meetingDetail}>
                {t('meeting')}: {activity.meeting_time_going} @ {activity.meeting_location_going}
              </Text>
            </View>
          )}

          {hasReturnTrip && activity.meeting_time_return && (
            <View style={styles.meetingInfo}>
              <Text style={styles.meetingTitle}>{t('returning')}:</Text>
              <Text style={styles.meetingDetail}>
                {t('meeting')}: {activity.meeting_time_return} @ {activity.meeting_location_return}
              </Text>
            </View>
          )}
        </Card>

        {/* Action Buttons */}
        <View style={styles.actionButtons}>
          <Button
            title={t('offer_a_ride')}
            onPress={() => openOfferModal()}
            variant="primary"
            style={styles.actionButton}
          />
        </View>

        {/* Unassigned Participants (Staff Only) */}
        {isStaff && unassignedParticipants.length > 0 && (
          <Card style={styles.warningCard}>
            <Text style={styles.warningTitle}>
              ⚠️ {unassignedParticipants.length} {t('participants_need_rides')}
            </Text>
            {unassignedParticipants.map((p) => (
              <View key={p.id} style={styles.unassignedItem}>
                <View style={styles.unassignedInfo}>
                  <Text style={styles.unassignedName}>
                    {p.first_name} {p.last_name}
                  </Text>
                  <View style={styles.unassignedStatus}>
                    {!p.has_ride_going && (
                      <Text style={styles.needsRideBadge}>{t('needs_ride_going')}</Text>
                    )}
                    {!p.has_ride_return && hasReturnTrip && (
                      <Text style={styles.needsRideBadge}>{t('needs_ride_return')}</Text>
                    )}
                  </View>
                </View>
                <TouchableOpacity
                  onPress={() => openAssignModal(null, p.id)}
                  style={styles.quickAssignButton}
                >
                  <Text style={styles.quickAssignText}>{t('assign')}</Text>
                </TouchableOpacity>
              </View>
            ))}
          </Card>
        )}

        {/* Available Rides */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('available_rides')}</Text>
          {carpoolOffers.length === 0 ? (
            <EmptyState
              icon="🚗"
              title={t('no_rides_offered_yet')}
              message={t('be_first_to_offer_ride')}
            />
          ) : (
            carpoolOffers.map((offer) => renderOfferCard(offer))
          )}
        </View>

        {/* Current Assignments */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('current_assignments')}</Text>
          {renderAssignments()}
        </View>
      </ScrollView>

      {/* Offer Ride Modal */}
      <Modal
        visible={showOfferModal}
        animationType="slide"
        transparent={false}
        onRequestClose={closeOfferModal}
      >
        <View style={commonStyles.container}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={closeOfferModal}>
              <Text style={styles.modalClose}>✕</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>
              {editingOffer ? t('edit_ride_offer') : t('offer_a_ride')}
            </Text>
            <View style={styles.modalClose} />
          </View>

          <ScrollView style={styles.modalContent}>
            <Card style={styles.infoBox}>
              <Text style={styles.infoBoxTitle}>{t('important')}:</Text>
              <Text style={styles.infoBoxText}>• {t('front_seat_notice')}</Text>
              <Text style={styles.infoBoxText}>• {t('adult_child_ratio_notice')}</Text>
            </Card>

            <Text style={styles.label}>{t('vehicle_make')} *</Text>
            <TextInput
              style={commonStyles.input}
              value={offerForm.vehicle_make}
              onChangeText={(value) => handleOfferFieldChange('vehicle_make', value)}
              placeholder={t('vehicle_make_placeholder')}
            />

            <Text style={styles.label}>{t('vehicle_color')} *</Text>
            <TextInput
              style={commonStyles.input}
              value={offerForm.vehicle_color}
              onChangeText={(value) => handleOfferFieldChange('vehicle_color', value)}
              placeholder={t('vehicle_color_placeholder')}
            />

            <Text style={styles.label}>{t('seats_available')} *</Text>
            <TextInput
              style={commonStyles.input}
              value={String(offerForm.total_seats_available)}
              onChangeText={(value) =>
                handleOfferFieldChange('total_seats_available', value)
              }
              keyboardType="number-pad"
              placeholder="3"
            />
            <Text style={styles.helpText}>{t('seats_available_help')}</Text>

            <Text style={styles.label}>{t('trip_direction')} *</Text>
            <Picker
              selectedValue={offerForm.trip_direction}
              onValueChange={(value) => handleOfferFieldChange('trip_direction', value)}
              style={styles.picker}
            >
              <Picker.Item label={t('round_trip')} value="both" />
              <Picker.Item label={t('to_activity_only')} value="to_activity" />
              {hasReturnTrip && (
                <Picker.Item label={t('from_activity_only')} value="from_activity" />
              )}
            </Picker>

            <Text style={styles.label}>{t('additional_notes')}</Text>
            <TextInput
              style={[commonStyles.input, styles.textArea]}
              value={offerForm.notes}
              onChangeText={(value) => handleOfferFieldChange('notes', value)}
              placeholder={t('notes_placeholder')}
              multiline
              numberOfLines={3}
            />

            <View style={styles.modalActions}>
              <Button
                title={t('cancel')}
                onPress={closeOfferModal}
                variant="secondary"
                style={styles.modalButton}
              />
              <Button
                title={editingOffer ? t('save_changes') : t('offer_ride')}
                onPress={handleSaveOffer}
                variant="primary"
                disabled={saving}
                style={styles.modalButton}
              />
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* Assignment Modal */}
      <Modal
        visible={showAssignModal}
        animationType="slide"
        transparent={false}
        onRequestClose={closeAssignModal}
      >
        <View style={commonStyles.container}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={closeAssignModal}>
              <Text style={styles.modalClose}>✕</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>{t('assign_to_carpool')}</Text>
            <View style={styles.modalClose} />
          </View>

          <ScrollView style={styles.modalContent}>
            <Text style={styles.label}>{t('participant')} *</Text>
            <Picker
              selectedValue={assignmentForm.participant_id}
              onValueChange={(value) => handleAssignmentFieldChange('participant_id', value)}
              style={styles.picker}
              enabled={!selectedParticipantId}
            >
              <Picker.Item label={t('select_participant')} value="" />
              {participants.map((p) => (
                <Picker.Item
                  key={p.id}
                  label={`${p.first_name} ${p.last_name}`}
                  value={String(p.id)}
                />
              ))}
            </Picker>

            <Text style={styles.label}>{t('vehicle')} *</Text>
            <Picker
              selectedValue={assignmentForm.carpool_offer_id}
              onValueChange={(value) => handleAssignmentFieldChange('carpool_offer_id', value)}
              style={styles.picker}
              enabled={!selectedOfferId}
            >
              <Picker.Item label={t('select_vehicle')} value="" />
              {carpoolOffers
                .filter((o) => {
                  const seatsUsedGoing = o.seats_used_going || 0;
                  const seatsUsedReturn = o.seats_used_return || 0;
                  return (
                    seatsUsedGoing < o.total_seats_available ||
                    seatsUsedReturn < o.total_seats_available
                  );
                })
                .map((o) => (
                  <Picker.Item
                    key={o.id}
                    label={`${o.driver_name} - ${o.vehicle_color} ${o.vehicle_make} (${t(
                      o.trip_direction
                    )})`}
                    value={String(o.id)}
                  />
                ))}
            </Picker>

            <Text style={styles.label}>{t('trip_direction')} *</Text>
            <Picker
              selectedValue={assignmentForm.trip_direction}
              onValueChange={(value) => handleAssignmentFieldChange('trip_direction', value)}
              style={styles.picker}
            >
              <Picker.Item label={t('round_trip')} value="both" />
              <Picker.Item label={t('to_activity_only')} value="to_activity" />
              {hasReturnTrip && (
                <Picker.Item label={t('from_activity_only')} value="from_activity" />
              )}
            </Picker>

            <View style={styles.modalActions}>
              <Button
                title={t('cancel')}
                onPress={closeAssignModal}
                variant="secondary"
                style={styles.modalButton}
              />
              <Button
                title={t('assign')}
                onPress={handleAssignParticipant}
                variant="primary"
                disabled={saving}
                style={styles.modalButton}
              />
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* Loading overlay */}
      {saving && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: theme.spacing.md,
  },
  activityCard: {
    marginBottom: theme.spacing.md,
  },
  activityName: {
    fontSize: 20,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.text.primary,
    marginBottom: theme.spacing.xs,
  },
  activityDate: {
    fontSize: 16,
    color: theme.colors.text.secondary,
    marginBottom: theme.spacing.md,
  },
  meetingInfo: {
    marginTop: theme.spacing.sm,
  },
  meetingTitle: {
    fontSize: 14,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.text.primary,
    marginBottom: theme.spacing.xs,
  },
  meetingDetail: {
    fontSize: 14,
    color: theme.colors.text.secondary,
  },
  actionButtons: {
    marginBottom: theme.spacing.md,
  },
  actionButton: {
    marginBottom: theme.spacing.sm,
  },
  warningCard: {
    backgroundColor: theme.colors.warning + '10',
    borderLeftWidth: 4,
    borderLeftColor: theme.colors.warning,
    marginBottom: theme.spacing.md,
  },
  warningTitle: {
    fontSize: 16,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.warning,
    marginBottom: theme.spacing.md,
  },
  unassignedItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: theme.spacing.sm,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  unassignedInfo: {
    flex: 1,
  },
  unassignedName: {
    fontSize: 16,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.text.primary,
    marginBottom: theme.spacing.xs,
  },
  unassignedStatus: {
    flexDirection: 'row',
    gap: theme.spacing.xs,
  },
  needsRideBadge: {
    fontSize: 12,
    color: theme.colors.warning,
    backgroundColor: theme.colors.warning + '20',
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 2,
    borderRadius: theme.borderRadius.sm,
  },
  quickAssignButton: {
    backgroundColor: theme.colors.primary,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.borderRadius.md,
  },
  quickAssignText: {
    color: theme.colors.white,
    fontSize: 14,
    fontWeight: theme.fontWeight.semibold,
  },
  section: {
    marginBottom: theme.spacing.lg,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.text.primary,
    marginBottom: theme.spacing.md,
  },
  offerCard: {
    marginBottom: theme.spacing.md,
  },
  offerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.sm,
  },
  driverInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  driverName: {
    fontSize: 16,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.text.primary,
  },
  youBadge: {
    fontSize: 12,
    color: theme.colors.primary,
    backgroundColor: theme.colors.primary + '20',
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 2,
    borderRadius: theme.borderRadius.sm,
  },
  offerActions: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  iconButton: {
    padding: theme.spacing.xs,
  },
  iconText: {
    fontSize: 18,
  },
  vehicleInfo: {
    fontSize: 14,
    color: theme.colors.text.secondary,
    marginBottom: theme.spacing.sm,
  },
  notes: {
    fontSize: 14,
    color: theme.colors.text.secondary,
    fontStyle: 'italic',
    marginBottom: theme.spacing.sm,
  },
  capacitySection: {
    marginTop: theme.spacing.sm,
  },
  capacityLabel: {
    fontSize: 14,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.text.primary,
    marginBottom: theme.spacing.xs,
  },
  capacityBar: {
    height: 8,
    backgroundColor: theme.colors.background.secondary,
    borderRadius: theme.borderRadius.sm,
    overflow: 'hidden',
    marginBottom: theme.spacing.xs,
  },
  capacityFill: {
    height: '100%',
    backgroundColor: theme.colors.primary,
  },
  capacityText: {
    fontSize: 12,
    color: theme.colors.text.secondary,
  },
  passengerSection: {
    marginTop: theme.spacing.md,
    paddingTop: theme.spacing.md,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  passengerTitle: {
    fontSize: 14,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.text.primary,
    marginBottom: theme.spacing.sm,
  },
  passengerItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: theme.spacing.xs,
  },
  passengerName: {
    fontSize: 14,
    color: theme.colors.text.primary,
  },
  directionBadge: {
    fontSize: 12,
    color: theme.colors.primary,
    backgroundColor: theme.colors.primary + '20',
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 2,
    borderRadius: theme.borderRadius.sm,
  },
  assignButton: {
    marginTop: theme.spacing.md,
  },
  assignmentCard: {
    marginBottom: theme.spacing.md,
  },
  assignmentParticipant: {
    fontSize: 16,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.text.primary,
    marginBottom: theme.spacing.sm,
  },
  assignmentRide: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: theme.spacing.sm,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  assignmentDetails: {
    flex: 1,
  },
  assignmentDriver: {
    fontSize: 14,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.text.primary,
  },
  assignmentVehicle: {
    fontSize: 14,
    color: theme.colors.text.secondary,
  },
  assignmentDirection: {
    fontSize: 12,
    color: theme.colors.primary,
    marginTop: theme.spacing.xs,
  },
  removeButton: {
    backgroundColor: theme.colors.danger,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.borderRadius.md,
  },
  removeButtonText: {
    color: theme.colors.white,
    fontSize: 14,
    fontWeight: theme.fontWeight.semibold,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.background.primary,
  },
  modalClose: {
    fontSize: 24,
    color: theme.colors.text.primary,
    width: 30,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.text.primary,
  },
  modalContent: {
    flex: 1,
    padding: theme.spacing.md,
  },
  infoBox: {
    backgroundColor: theme.colors.warning + '10',
    borderLeftWidth: 4,
    borderLeftColor: theme.colors.warning,
    marginBottom: theme.spacing.lg,
  },
  infoBoxTitle: {
    fontSize: 14,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.warning,
    marginBottom: theme.spacing.sm,
  },
  infoBoxText: {
    fontSize: 14,
    color: theme.colors.text.secondary,
    marginBottom: theme.spacing.xs,
  },
  label: {
    fontSize: 14,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.text.primary,
    marginTop: theme.spacing.md,
    marginBottom: theme.spacing.xs,
  },
  helpText: {
    fontSize: 12,
    color: theme.colors.text.secondary,
    marginTop: -theme.spacing.xs,
    marginBottom: theme.spacing.sm,
  },
  picker: {
    marginBottom: theme.spacing.sm,
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  modalActions: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.lg,
    marginBottom: theme.spacing.xl,
  },
  modalButton: {
    flex: 1,
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default CarpoolScreen;
