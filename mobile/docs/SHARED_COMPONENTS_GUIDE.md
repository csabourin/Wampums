# Shared Components Usage Guide

This guide demonstrates how to use the high-priority shared components in your screens.

## Component Overview

All components are exported from `mobile/src/components/index.js`:

```javascript
import {
  Table, TableRow, TableHeader, TableCell, TableHeaderCell, ListItem,
  FilterBar, SearchBar, SortButton,
  Modal, ConfirmModal,
  Toast, useToast,
  FormField, Checkbox, RadioButton, RadioGroup, Select,
  EmptyState, NoResults, NoData, LoadingState, ErrorState,
} from '../components';
```

---

## 1. Table Components

### Table with TableRow/TableCell

Use for structured data on larger screens:

```javascript
import { Table, TableHeader, TableRow, TableCell } from '../components';

function ParticipantsTable({ participants, onSelectParticipant }) {
  const columns = [
    { key: 'name', label: 'Name', width: 2 },
    { key: 'group', label: 'Group', width: 1 },
    { key: 'age', label: 'Age', width: 1, align: 'center' },
  ];

  return (
    <Table>
      <TableHeader columns={columns} />
      
      {participants.map((participant) => (
        <TableRow
          key={participant.id}
          onPress={() => onSelectParticipant(participant)}
        >
          <TableCell width={2} bold>
            {participant.firstName} {participant.lastName}
          </TableCell>
          <TableCell width={1}>
            {participant.groupName}
          </TableCell>
          <TableCell width={1} align="center">
            {participant.age}
          </TableCell>
        </TableRow>
      ))}
    </Table>
  );
}
```

### ListItem (Mobile-Optimized)

Use for better mobile experience - stacks information vertically:

```javascript
import { ListItem } from '../components';

function ParticipantsList({ participants, onSelectParticipant }) {
  return (
    <View>
      {participants.map((participant) => (
        <ListItem
          key={participant.id}
          title={`${participant.firstName} ${participant.lastName}`}
          subtitle={`${participant.groupName} • ${participant.age} years`}
          rightText={`${participant.points} pts`}
          leftIcon="👤"
          onPress={() => onSelectParticipant(participant)}
        />
      ))}
    </View>
  );
}
```

---

## 2. FilterBar & SearchBar

### FilterBar with filters and sorting

```javascript
import { FilterBar } from '../components';
import { useState } from 'react';

function ParticipantsScreen() {
  const [activeFilter, setActiveFilter] = useState('all');
  const [sortBy, setSortBy] = useState('name');
  const [sortOrder, setSortOrder] = useState('asc');

  const filters = [
    { key: 'all', label: 'All', count: 45 },
    { key: 'active', label: 'Active', count: 42 },
    { key: 'archived', label: 'Archived', count: 3 },
  ];

  const sortOptions = [
    { key: 'name', label: 'Name' },
    { key: 'age', label: 'Age' },
    { key: 'points', label: 'Points' },
  ];

  return (
    <View>
      <FilterBar
        filters={filters}
        activeFilter={activeFilter}
        onFilterChange={setActiveFilter}
        sortOptions={sortOptions}
        sortBy={sortBy}
        sortOrder={sortOrder}
        onSortChange={(field, order) => {
          setSortBy(field);
          setSortOrder(order);
        }}
      />
      
      {/* Your list content */}
    </View>
  );
}
```

### SearchBar

```javascript
import { SearchBar } from '../components';

function ParticipantsScreen() {
  const [searchQuery, setSearchQuery] = useState('');

  return (
    <View>
      <SearchBar
        value={searchQuery}
        onChangeText={setSearchQuery}
        placeholder="Search participants..."
      />
      
      {/* Filtered results */}
    </View>
  );
}
```

---

## 3. Modal Components

### Basic Modal

```javascript
import { Modal } from '../components';
import { useState } from 'react';

function MyScreen() {
  const [showModal, setShowModal] = useState(false);

  return (
    <View>
      <Button onPress={() => setShowModal(true)} title="Open Modal" />
      
      <Modal
        visible={showModal}
        onClose={() => setShowModal(false)}
        title="Participant Details"
        footer={
          <Button onPress={() => setShowModal(false)} title="Close" />
        }
      >
        <Text>Modal content goes here</Text>
      </Modal>
    </View>
  );
}
```

### ConfirmModal

```javascript
import { ConfirmModal } from '../components';

function DeleteParticipant({ participant }) {
  const [showConfirm, setShowConfirm] = useState(false);

  const handleDelete = async () => {
    await deleteParticipant(participant.id);
    setShowConfirm(false);
  };

  return (
    <>
      <Button onPress={() => setShowConfirm(true)} title="Delete" />
      
      <ConfirmModal
        visible={showConfirm}
        onClose={() => setShowConfirm(false)}
        onConfirm={handleDelete}
        title="Delete Participant?"
        message={`Are you sure you want to delete ${participant.name}? This action cannot be undone.`}
        confirmText="Delete"
        cancelText="Cancel"
        confirmStyle="danger"
      />
    </>
  );
}
```

---

## 4. Toast Notifications

### Using Toast with useToast hook

```javascript
import { useToast } from '../components';

function MyScreen() {
  const { showToast, ToastComponent } = useToast();

  const handleSave = async () => {
    try {
      await saveData();
      showToast('Saved successfully!', 'success');
    } catch (error) {
      showToast('Failed to save', 'error');
    }
  };

  return (
    <View>
      {ToastComponent}
      
      <Button onPress={handleSave} title="Save" />
    </View>
  );
}
```

### Toast types

```javascript
showToast('Information message', 'info');      // Blue
showToast('Success!', 'success');              // Green
showToast('Warning', 'warning');               // Orange
showToast('Error occurred', 'error');          // Red
```

---

## 5. Form Components

### FormField (Text Input)

```javascript
import { FormField } from '../components';

function ParticipantForm() {
  const [firstName, setFirstName] = useState('');
  const [errors, setErrors] = useState({});

  return (
    <ScrollView>
      <FormField
        label="First Name"
        value={firstName}
        onChangeText={setFirstName}
        placeholder="Enter first name"
        required
        error={errors.firstName}
        helpText="As it appears on official documents"
      />
      
      <FormField
        label="Email"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        placeholder="email@example.com"
      />
      
      <FormField
        label="Notes"
        value={notes}
        onChangeText={setNotes}
        multiline
        numberOfLines={4}
        placeholder="Additional notes..."
      />
    </ScrollView>
  );
}
```

### Checkbox

```javascript
import { Checkbox } from '../components';

function PermissionsForm() {
  const [canSwim, setCanSwim] = useState(false);
  const [hasAllergies, setHasAllergies] = useState(false);

  return (
    <View>
      <Checkbox
        label="Can swim without supervision"
        checked={canSwim}
        onPress={() => setCanSwim(!canSwim)}
      />
      
      <Checkbox
        label="Has known allergies"
        checked={hasAllergies}
        onPress={() => setHasAllergies(!hasAllergies)}
      />
    </View>
  );
}
```

### RadioGroup

```javascript
import { RadioGroup } from '../components';

function ParticipantForm() {
  const [gender, setGender] = useState('');

  const genderOptions = [
    { value: 'male', label: 'Male' },
    { value: 'female', label: 'Female' },
    { value: 'other', label: 'Other' },
  ];

  return (
    <RadioGroup
      label="Gender"
      options={genderOptions}
      value={gender}
      onChange={setGender}
    />
  );
}
```

### Select (Dropdown)

```javascript
import { Select } from '../components';

function ParticipantForm() {
  const [groupId, setGroupId] = useState('');

  const groupOptions = [
    { value: '1', label: 'Castors' },
    { value: '2', label: 'Hirondelles' },
    { value: '3', label: 'Louveteaux' },
  ];

  return (
    <Select
      label="Group"
      value={groupId}
      options={groupOptions}
      onChange={setGroupId}
      placeholder="Select a group..."
    />
  );
}
```

---

## 6. Empty State Components

### EmptyState (Custom)

```javascript
import { EmptyState } from '../components';

function ParticipantsScreen({ participants, onAddParticipant }) {
  if (participants.length === 0) {
    return (
      <EmptyState
        icon="👥"
        title="No Participants Yet"
        message="Get started by adding your first participant to the group."
        actionLabel="Add Participant"
        onAction={onAddParticipant}
      />
    );
  }

  return <ParticipantsList participants={participants} />;
}
```

### NoResults (Search/Filter)

```javascript
import { NoResults } from '../components';

function SearchResults({ results, searchQuery, onClearSearch }) {
  if (results.length === 0) {
    return (
      <NoResults
        searchTerm={searchQuery}
        onClear={onClearSearch}
      />
    );
  }

  return <ResultsList results={results} />;
}
```

### NoData (Empty List)

```javascript
import { NoData } from '../components';

function ActivitiesList({ activities, onAddActivity }) {
  if (activities.length === 0) {
    return (
      <NoData
        resourceName="activities"
        onAdd={onAddActivity}
        addLabel="Create Activity"
      />
    );
  }

  return <ActivityList activities={activities} />;
}
```

### LoadingState

```javascript
import { LoadingState } from '../components';

function MyScreen() {
  const [loading, setLoading] = useState(true);

  if (loading) {
    return <LoadingState message="Loading participants..." />;
  }

  return <Content />;
}
```

### ErrorState

```javascript
import { ErrorState } from '../components';

function MyScreen() {
  const [error, setError] = useState(null);

  if (error) {
    return (
      <ErrorState
        message={error.message}
        onRetry={loadData}
      />
    );
  }

  return <Content />;
}
```

### OfflineState

```javascript
import { OfflineState } from '../components';

function MyScreen() {
  const [isOffline, setIsOffline] = useState(false);

  if (isOffline) {
    return <OfflineState onRetry={retryConnection} />;
  }

  return <Content />;
}
```

---

## Complete Screen Example

Putting it all together in a real screen:

```javascript
import React, { useState, useEffect } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import {
  SearchBar,
  FilterBar,
  ListItem,
  EmptyState,
  NoResults,
  LoadingState,
  ErrorState,
  useToast,
  ConfirmModal,
} from '../components';
import { getParticipants, deleteParticipant } from '../api/api-endpoints';
import theme from '../theme';

function ParticipantsScreen({ navigation }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState('all');
  const [sortBy, setSortBy] = useState('name');
  const [sortOrder, setSortOrder] = useState('asc');
  const [deleteTarget, setDeleteTarget] = useState(null);
  
  const { showToast, ToastComponent } = useToast();

  useEffect(() => {
    loadParticipants();
  }, []);

  const loadParticipants = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await getParticipants();
      if (response.success) {
        setParticipants(response.data);
      }
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    try {
      await deleteParticipant(deleteTarget.id);
      setParticipants(prev => prev.filter(p => p.id !== deleteTarget.id));
      showToast('Participant deleted', 'success');
    } catch (err) {
      showToast('Failed to delete', 'error');
    } finally {
      setDeleteTarget(null);
    }
  };

  // Filter and sort logic
  const filteredParticipants = participants
    .filter(p => {
      // Filter by active filter
      if (activeFilter === 'active' && !p.active) return false;
      if (activeFilter === 'archived' && p.active) return false;
      
      // Filter by search query
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        return (
          p.firstName.toLowerCase().includes(query) ||
          p.lastName.toLowerCase().includes(query)
        );
      }
      
      return true;
    })
    .sort((a, b) => {
      // Sort logic
      let aVal = a[sortBy];
      let bVal = b[sortBy];
      
      if (sortOrder === 'desc') [aVal, bVal] = [bVal, aVal];
      
      return aVal > bVal ? 1 : -1;
    });

  // Loading state
  if (loading) {
    return <LoadingState message="Loading participants..." />;
  }

  // Error state
  if (error) {
    return <ErrorState message={error.message} onRetry={loadParticipants} />;
  }

  // Empty state
  if (participants.length === 0) {
    return (
      <EmptyState
        icon="👥"
        title="No Participants"
        message="Add your first participant to get started."
        actionLabel="Add Participant"
        onAction={() => navigation.navigate('AddParticipant')}
      />
    );
  }

  return (
    <View style={styles.container}>
      {ToastComponent}
      
      <SearchBar
        value={searchQuery}
        onChangeText={setSearchQuery}
        placeholder="Search participants..."
      />
      
      <FilterBar
        filters={[
          { key: 'all', label: 'All', count: participants.length },
          { key: 'active', label: 'Active' },
          { key: 'archived', label: 'Archived' },
        ]}
        activeFilter={activeFilter}
        onFilterChange={setActiveFilter}
        sortOptions={[
          { key: 'name', label: 'Name' },
          { key: 'age', label: 'Age' },
          { key: 'points', label: 'Points' },
        ]}
        sortBy={sortBy}
        sortOrder={sortOrder}
        onSortChange={(field, order) => {
          setSortBy(field);
          setSortOrder(order);
        }}
      />

      {filteredParticipants.length === 0 ? (
        <NoResults
          searchTerm={searchQuery}
          onClear={() => setSearchQuery('')}
        />
      ) : (
        <ScrollView>
          {filteredParticipants.map((participant) => (
            <ListItem
              key={participant.id}
              title={`${participant.firstName} ${participant.lastName}`}
              subtitle={`${participant.groupName} • ${participant.age} years`}
              rightText={`${participant.points} pts`}
              leftIcon="👤"
              onPress={() => navigation.navigate('ParticipantDetail', { id: participant.id })}
            />
          ))}
        </ScrollView>
      )}

      <ConfirmModal
        visible={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete Participant?"
        message={`Are you sure you want to delete ${deleteTarget?.firstName}?`}
        confirmStyle="danger"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
});

export default ParticipantsScreen;
```

---

## Best Practices

### 1. Always use shared components
❌ Don't create custom table/list components
✅ Use `Table`, `ListItem` from shared components

### 2. Consistent empty states
❌ Don't show blank screens
✅ Always show helpful `EmptyState`, `NoResults`, or `LoadingState`

### 3. Form validation
❌ Don't inline error messages
✅ Use `FormField` with `error` prop for consistent styling

### 4. Mobile-first approach
❌ Don't use complex tables on mobile
✅ Use `ListItem` for better mobile UX, fall back to `Table` for tablets

### 5. Toast for feedback
❌ Don't use `Alert.alert()` for success messages
✅ Use `Toast` for non-blocking notifications

### 6. Confirm destructive actions
❌ Don't delete without confirmation
✅ Use `ConfirmModal` with `confirmStyle="danger"`

---

## Component Checklist

When building a new screen, ensure you're using:

- [ ] `SearchBar` or `FilterBar` for lists with 10+ items
- [ ] `ListItem` or `Table` for data display
- [ ] `EmptyState`, `NoResults`, or `NoData` for empty states
- [ ] `LoadingState` for loading states
- [ ] `ErrorState` for error states
- [ ] `Toast` for success/error notifications
- [ ] `Modal` or `ConfirmModal` for dialogs
- [ ] `FormField`, `Checkbox`, `RadioGroup`, `Select` for forms

This ensures consistency and reduces code duplication across the app!
