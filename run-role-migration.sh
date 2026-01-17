#!/bin/bash

# Script to run the role refactoring migration
# This removes legacy single-role columns and updates the system to use role_ids only

echo "========================================="
echo "Role Refactoring Migration"
echo "========================================="
echo ""
echo "This migration will:"
echo "  - Remove user_organizations.role column"
echo "  - Remove users.role column"
echo "  - Update user_role_permissions_summary view"
echo ""
echo "⚠️  WARNING: This is a destructive operation!"
echo "   Make sure you have a backup before proceeding."
echo ""
read -p "Do you want to continue? (yes/no): " confirm

if [ "$confirm" != "yes" ]; then
    echo "Migration cancelled."
    exit 0
fi

echo ""
echo "Running migration..."
echo ""

# Run the migration
node run-migration.js migrations/010_remove_legacy_role_columns.sql

echo ""
echo "========================================="
echo "Migration complete!"
echo "========================================="
echo ""
echo "Please verify the migration succeeded by checking:"
echo "  1. The legacy columns are removed"
echo "  2. The application still works correctly"
echo "  3. User roles are displayed properly"
echo ""
