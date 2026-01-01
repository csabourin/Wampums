/**
 * SearchBar Component
 *
 * Reusable search input for filtering lists/tables.
 * Simple standalone search input without filter UI.
 */

import React from 'react';
import { View, TextInput, StyleSheet } from 'react-native';
import theme, { commonStyles } from '../theme';

/**
 * SearchBar Component
 *
 * @param {Object} props
 * @param {string} props.value - Current search value
 * @param {function} props.onChangeText - Search change handler
 * @param {string} props.placeholder - Placeholder text for search input
 * @param {Object} props.style - Additional custom styles
 */
const SearchBar = ({
  value = '',
  onChangeText,
  placeholder = 'Search...',
  style,
  ...rest
}) => {
  return (
    <View style={[styles.container, style]}>
      <TextInput
        style={commonStyles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.textMuted}
        returnKeyType="search"
        autoCapitalize="none"
        autoCorrect={false}
        {...rest}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: theme.spacing.sm,
  },
});

export default SearchBar;
