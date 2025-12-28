import React from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import theme, { commonStyles } from '../theme';

/**
 * FormField Component
 *
 * Reusable form field component with label, input, error message, and help text.
 *
 * @param {Object} props
 * @param {string} props.label - Field label
 * @param {string} props.value - Field value
 * @param {function} props.onChangeText - Change handler
 * @param {string} props.placeholder - Placeholder text
 * @param {string} props.error - Error message
 * @param {string} props.helpText - Help/hint text
 * @param {boolean} props.required - Whether the field is required
 * @param {string} props.keyboardType - Keyboard type (default, email-address, numeric, etc.)
 * @param {boolean} props.secureTextEntry - Whether to obscure text (for passwords)
 * @param {boolean} props.multiline - Whether to allow multiple lines
 * @param {number} props.numberOfLines - Number of lines for multiline input
 * @param {Object} props.style - Additional custom styles
 */
const FormField = ({
  label,
  value,
  onChangeText,
  placeholder,
  error,
  helpText,
  required,
  keyboardType = 'default',
  secureTextEntry,
  multiline,
  numberOfLines = 4,
  style,
}) => {
  return (
    <View style={[commonStyles.formGroup, style]}>
      {label && (
        <Text style={commonStyles.inputLabel}>
          {label}
          {required && <Text style={styles.required}> *</Text>}
        </Text>
      )}

      <TextInput
        style={[
          commonStyles.input,
          error && styles.inputError,
          multiline && { height: numberOfLines * 24, textAlignVertical: 'top' },
        ]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.textMuted}
        keyboardType={keyboardType}
        secureTextEntry={secureTextEntry}
        multiline={multiline}
        numberOfLines={multiline ? numberOfLines : 1}
      />

      {error && <Text style={commonStyles.formError}>{error}</Text>}
      {helpText && !error && <Text style={commonStyles.formHelp}>{helpText}</Text>}
    </View>
  );
};

/**
 * Checkbox Component
 *
 * Reusable checkbox input with label.
 */
export const Checkbox = ({ label, checked, onPress, style }) => {
  return (
    <TouchableOpacity
      style={[styles.checkboxContainer, style]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={[commonStyles.checkbox, checked && commonStyles.checkboxChecked]}>
        {checked && <Text style={styles.checkmark}>✓</Text>}
      </View>
      {label && <Text style={styles.checkboxLabel}>{label}</Text>}
    </TouchableOpacity>
  );
};

/**
 * RadioButton Component
 *
 * Reusable radio button input with label.
 */
export const RadioButton = ({ label, selected, onPress, style }) => {
  return (
    <TouchableOpacity
      style={[styles.radioContainer, style]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={[commonStyles.radioButton, selected && commonStyles.radioButtonChecked]}>
        {selected && <View style={commonStyles.radioButtonInner} />}
      </View>
      {label && <Text style={styles.radioLabel}>{label}</Text>}
    </TouchableOpacity>
  );
};

/**
 * RadioGroup Component
 *
 * Group of radio buttons for single selection.
 */
export const RadioGroup = ({ label, options, value, onChange, error, style }) => {
  return (
    <View style={[commonStyles.formGroup, style]}>
      {label && <Text style={commonStyles.inputLabel}>{label}</Text>}

      <View style={styles.radioGroupContainer}>
        {options.map((option, index) => (
          <RadioButton
            key={option.value || index}
            label={option.label}
            selected={value === option.value}
            onPress={() => onChange(option.value)}
          />
        ))}
      </View>

      {error && <Text style={commonStyles.formError}>{error}</Text>}
    </View>
  );
};

/**
 * Select Component
 *
 * Dropdown/picker component (uses TouchableOpacity + Modal for simplicity).
 * For production, consider using @react-native-picker/picker
 */
export const Select = ({ label, value, options, onChange, placeholder, error, style }) => {
  const [isOpen, setIsOpen] = React.useState(false);
  const selectedOption = options.find(opt => opt.value === value);

  return (
    <View style={[commonStyles.formGroup, style]}>
      {label && <Text style={commonStyles.inputLabel}>{label}</Text>}

      <TouchableOpacity
        style={[commonStyles.input, styles.selectButton, error && styles.inputError]}
        onPress={() => setIsOpen(!isOpen)}
        activeOpacity={0.7}
      >
        <Text style={selectedOption ? styles.selectText : styles.selectPlaceholder}>
          {selectedOption ? selectedOption.label : placeholder || 'Select...'}
        </Text>
        <Text style={styles.selectArrow}>{isOpen ? '▲' : '▼'}</Text>
      </TouchableOpacity>

      {isOpen && (
        <View style={styles.selectOptions}>
          {options.map((option, index) => (
            <TouchableOpacity
              key={option.value || index}
              style={styles.selectOption}
              onPress={() => {
                onChange(option.value);
                setIsOpen(false);
              }}
              activeOpacity={0.7}
            >
              <Text style={styles.selectOptionText}>{option.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {error && <Text style={commonStyles.formError}>{error}</Text>}
    </View>
  );
};

const styles = StyleSheet.create({
  required: {
    color: theme.colors.error,
  },
  inputError: {
    borderColor: theme.colors.error,
    borderWidth: 2,
  },
  checkboxContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: theme.spacing.sm,
    minHeight: theme.touchTarget.min,
  },
  checkmark: {
    color: theme.colors.selectedText,
    fontSize: 16,
    fontWeight: theme.fontWeight.bold,
  },
  checkboxLabel: {
    marginLeft: theme.spacing.sm,
    fontSize: theme.fontSize.base,
    color: theme.colors.text,
    flex: 1,
  },
  radioContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: theme.spacing.sm,
    minHeight: theme.touchTarget.min,
  },
  radioLabel: {
    marginLeft: theme.spacing.sm,
    fontSize: theme.fontSize.base,
    color: theme.colors.text,
    flex: 1,
  },
  radioGroupContainer: {
    gap: theme.spacing.xs,
  },
  selectButton: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  selectText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.text,
    flex: 1,
  },
  selectPlaceholder: {
    fontSize: theme.fontSize.base,
    color: theme.colors.textMuted,
    flex: 1,
  },
  selectArrow: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
  },
  selectOptions: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.md,
    marginTop: theme.spacing.xs,
    borderWidth: 1,
    borderColor: theme.colors.border,
    ...theme.shadows.md,
  },
  selectOption: {
    padding: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.borderLight,
    minHeight: theme.touchTarget.min,
    justifyContent: 'center',
  },
  selectOptionText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.text,
  },
});

export default FormField;
