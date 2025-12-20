/**
 * Ensure WhatsApp Baileys auth state is stored in the database.
 *
 * Creates the whatsapp_baileys_connections table when missing and
 * backfills required columns/indexes for environments that already
 * created the table manually.
 *
 * The table stores connection status plus the serialized Baileys
 * credentials/keys used by services/whatsapp-database-auth.js.
 */
exports.up = (pgm) => {
  pgm.createTable(
    'whatsapp_baileys_connections',
    {
      id: 'id',
      organization_id: {
        type: 'integer',
        notNull: true,
        unique: true,
        references: 'organizations',
        onDelete: 'CASCADE',
      },
      is_connected: {
        type: 'boolean',
        default: false,
      },
      connected_phone_number: {
        type: 'varchar(20)',
      },
      session_data: {
        type: 'text',
      },
      auth_creds: {
        type: 'jsonb',
        default: pgm.func("'{}'::jsonb"),
      },
      auth_keys: {
        type: 'jsonb',
        default: pgm.func("'{}'::jsonb"),
      },
      last_connected_at: {
        type: 'timestamp',
      },
      last_disconnected_at: {
        type: 'timestamp',
      },
      created_at: {
        type: 'timestamp',
        default: pgm.func('now()'),
      },
      updated_at: {
        type: 'timestamp',
        default: pgm.func('now()'),
      },
    },
    { ifNotExists: true }
  );

  pgm.addColumns(
    'whatsapp_baileys_connections',
    {
      is_connected: {
        type: 'boolean',
        default: false,
      },
      connected_phone_number: {
        type: 'varchar(20)',
      },
      session_data: {
        type: 'text',
      },
      auth_creds: {
        type: 'jsonb',
        default: pgm.func("'{}'::jsonb"),
      },
      auth_keys: {
        type: 'jsonb',
        default: pgm.func("'{}'::jsonb"),
      },
      last_connected_at: {
        type: 'timestamp',
      },
      last_disconnected_at: {
        type: 'timestamp',
      },
      created_at: {
        type: 'timestamp',
        default: pgm.func('now()'),
      },
      updated_at: {
        type: 'timestamp',
        default: pgm.func('now()'),
      },
    },
    { ifNotExists: true }
  );

  pgm.createIndex('whatsapp_baileys_connections', 'organization_id', {
    name: 'idx_whatsapp_baileys_org_id',
    unique: true,
    ifNotExists: true,
  });

  pgm.createIndex('whatsapp_baileys_connections', ['organization_id', 'is_connected'], {
    name: 'idx_whatsapp_baileys_connected',
    where: 'is_connected = TRUE',
    ifNotExists: true,
  });

  pgm.sql(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE constraint_name = 'whatsapp_baileys_connections_organization_id_fkey'
      ) THEN
        ALTER TABLE whatsapp_baileys_connections
        ADD CONSTRAINT whatsapp_baileys_connections_organization_id_fkey
        FOREIGN KEY (organization_id)
        REFERENCES organizations(id)
        ON DELETE CASCADE;
      END IF;
    END$$;
  `);
};

exports.down = (pgm) => {
  pgm.dropIndex('whatsapp_baileys_connections', ['organization_id', 'is_connected'], {
    name: 'idx_whatsapp_baileys_connected',
    ifExists: true,
  });

  pgm.dropIndex('whatsapp_baileys_connections', 'organization_id', {
    name: 'idx_whatsapp_baileys_org_id',
    ifExists: true,
  });

  pgm.dropTable('whatsapp_baileys_connections', { ifExists: true, cascade: true });
};
