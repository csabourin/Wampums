/**
 * DynamicFormRenderer
 *
 * Mirrors spa/JSONFormRenderer.js functionality for React Native
 * Renders dynamic forms based on JSON form structure from backend
 * Supports all field types: text, textarea, select, checkbox, radio, date, email, tel
 * Handles field dependencies (dependsOn) and conditional display
 *
 * @module components/DynamicFormRenderer
 */

import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { translate as t } from '../i18n';
import { FormField, Checkbox, RadioGroup, Select } from './';
import theme from '../theme';
import { debugLog, debugWarn, debugError } from '../utils/DebugUtils';

/**
 * DynamicFormRenderer Component
 *
 * @param {Object} props
 * @param {Object} props.formStructure - JSON form structure from backend
 * @param {Object} props.formData - Current form data (controlled)
 * @param {Function} props.onFieldChange - Callback when field value changes (fieldName, value)
 * @param {boolean} props.disabled - Disable all fields
 * @returns {JSX.Element}
 */
const DynamicFormRenderer = ({ formStructure, formData = {}, onFieldChange, disabled = false }) => {
  const [dependencyMap, setDependencyMap] = useState({});

  // Parse form structure if it's a string
  const parsedStructure = useMemo(() => {
    if (typeof formStructure === 'string') {
      try {
        return JSON.parse(formStructure);
      } catch (e) {
        debugError('Error parsing form structure:', e);
        return null;
      }
    }
    return formStructure;
  }, [formStructure]);

  // Build dependency map for conditional fields
  useEffect(() => {
    if (!parsedStructure?.fields) return;

    const depMap = {};
    parsedStructure.fields.forEach((field) => {
      if (field.dependsOn) {
        const { field: parentField, value: requiredValue } = field.dependsOn;
        if (!depMap[parentField]) {
          depMap[parentField] = [];
        }
        depMap[parentField].push({
          fieldName: field.name,
          requiredValue,
        });
      }
    });
    setDependencyMap(depMap);
  }, [parsedStructure]);

  // Check if a field should be visible based on dependencies
  const isFieldVisible = (field) => {
    if (!field.dependsOn) return true;

    const { field: parentField, value: requiredValue } = field.dependsOn;
    const parentValue = formData[parentField];

    // Support both string and array of values
    if (Array.isArray(requiredValue)) {
      return requiredValue.includes(parentValue);
    }
    return parentValue === requiredValue;
  };

  // Handle field value change
  const handleChange = (fieldName, value) => {
    if (onFieldChange) {
      onFieldChange(fieldName, value);
    }

    // Check if this field controls other fields (dependencies)
    if (dependencyMap[fieldName]) {
      dependencyMap[fieldName].forEach(({ fieldName: dependentField }) => {
        // Clear dependent field values when parent changes
        if (onFieldChange) {
          onFieldChange(dependentField, '');
        }
      });
    }
  };

  // Format date value for display
  const formatDateValue = (value) => {
    if (!value) return '';

    try {
      // Handle ISO format dates
      if (value.includes('T') || value.includes(':')) {
        const date = new Date(value);
        if (!isNaN(date.getTime())) {
          // Return YYYY-MM-DD format for HTML5 date inputs
          return date.toISOString().split('T')[0];
        }
      }
      return value;
    } catch (e) {
      debugWarn('Error formatting date value:', value, e);
      return value;
    }
  };

  // Render individual field based on type
  const renderField = (field, index) => {
    const {
      type = 'text',
      name,
      label,
      required = false,
      placeholder,
      options = [],
      help_text,
      infoText,
      dependsOn,
    } = field;

    // Check if field should be visible
    const visible = isFieldVisible(field);
    if (!visible) return null;

    const value = formData[name] || '';
    const isDisabled = disabled || (dependsOn && !isFieldVisible(field));
    const helpText = help_text || infoText;

    // Info text only (not a field)
    if (type === 'infoText') {
      return (
        <View key={`info-${index}`} style={styles.infoText}>
          <Text style={styles.infoTextContent}>{t(infoText || label || '')}</Text>
        </View>
      );
    }

    // Render based on field type
    switch (type) {
      case 'text':
      case 'email':
      case 'tel':
      case 'number':
        return (
          <FormField
            key={name}
            label={t(label || name)}
            value={value}
            onChangeText={(val) => handleChange(name, val)}
            placeholder={t(placeholder || '')}
            keyboardType={
              type === 'email'
                ? 'email-address'
                : type === 'tel'
                ? 'phone-pad'
                : type === 'number'
                ? 'numeric'
                : 'default'
            }
            autoCapitalize={type === 'email' ? 'none' : 'sentences'}
            required={required}
            disabled={isDisabled}
            helpText={t(helpText || '')}
          />
        );

      case 'textarea':
        return (
          <FormField
            key={name}
            label={t(label || name)}
            value={value}
            onChangeText={(val) => handleChange(name, val)}
            placeholder={t(placeholder || '')}
            multiline
            numberOfLines={4}
            required={required}
            disabled={isDisabled}
            helpText={t(helpText || '')}
          />
        );

      case 'date':
        return (
          <FormField
            key={name}
            label={t(label || name)}
            value={formatDateValue(value)}
            onChangeText={(val) => handleChange(name, val)}
            placeholder={t(placeholder || 'YYYY-MM-DD')}
            type="date"
            required={required}
            disabled={isDisabled}
            helpText={t(helpText || '')}
          />
        );

      case 'select':
        const selectOptions = options.map((opt) => ({
          value: opt.value,
          label: t(opt.label || opt.value),
        }));
        return (
          <FormField
            key={name}
            label={t(label || name)}
            value={value}
            onChangeText={(val) => handleChange(name, val)}
            type="select"
            options={selectOptions}
            required={required}
            disabled={isDisabled}
            helpText={t(helpText || '')}
          />
        );

      case 'checkbox':
        return (
          <Checkbox
            key={name}
            label={t(label || name)}
            checked={value === true || value === '1' || value === 'true' || value === 'on'}
            onPress={() => {
              const newValue = !(value === true || value === '1' || value === 'true' || value === 'on');
              handleChange(name, newValue);
            }}
            disabled={isDisabled}
            style={styles.checkbox}
          />
        );

      case 'radio':
        const radioOptions = options.map((opt) => ({
          value: opt.value,
          label: t(opt.label || opt.value),
        }));
        return (
          <RadioGroup
            key={name}
            label={t(label || name)}
            options={radioOptions}
            value={value}
            onChange={(val) => handleChange(name, val)}
            disabled={isDisabled}
            required={required}
            helpText={t(helpText || '')}
          />
        );

      default:
        debugWarn(`Unknown field type: ${type} for field ${name}`);
        return (
          <FormField
            key={name}
            label={t(label || name)}
            value={value}
            onChangeText={(val) => handleChange(name, val)}
            placeholder={t(placeholder || '')}
            required={required}
            disabled={isDisabled}
            helpText={t(helpText || '')}
          />
        );
    }
  };

  // Validate form structure
  if (!parsedStructure) {
    return (
      <View style={styles.error}>
        <Text style={styles.errorText}>{t('invalid_form_structure')}</Text>
      </View>
    );
  }

  if (!parsedStructure.fields || !Array.isArray(parsedStructure.fields)) {
    return (
      <View style={styles.error}>
        <Text style={styles.errorText}>{t('no_form_fields_found')}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {parsedStructure.fields.map((field, index) => renderField(field, index))}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  infoText: {
    backgroundColor: theme.colors.background.info || '#E3F2FD',
    padding: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
    marginBottom: theme.spacing.md,
    borderLeftWidth: 4,
    borderLeftColor: theme.colors.primary,
  },
  infoTextContent: {
    fontSize: 14,
    color: theme.colors.text.primary,
    lineHeight: 20,
  },
  checkbox: {
    marginBottom: theme.spacing.md,
  },
  error: {
    padding: theme.spacing.lg,
    alignItems: 'center',
  },
  errorText: {
    fontSize: 14,
    color: theme.colors.error,
    textAlign: 'center',
  },
});

export default DynamicFormRenderer;
