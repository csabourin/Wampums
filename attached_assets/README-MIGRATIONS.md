# Database Migrations

This project uses [node-pg-migrate](https://salsita.github.io/node-pg-migrate/) for database schema management.

## Setup

Migrations require a `DATABASE_URL` environment variable:

```bash
export DATABASE_URL=postgresql://user:password@host:port/database
# Or use from .env
export DATABASE_URL="${SB_URL}"
```

## Common Commands

### Create a new migration

```bash
npm run migrate create <migration-name>

# Example:
npm run migrate create add-notifications-table
```

### Run all pending migrations

```bash
npm run migrate up
```

### Rollback the last migration

```bash
npm run migrate down
```

### Check migration status

```bash
npm run migrate status
```

## Migration Examples

### Creating a table

```javascript
exports.up = (pgm) => {
  pgm.createTable('notifications', {
    id: 'id',
    user_id: {
      type: 'integer',
      notNull: true,
      references: 'users'
    },
    title: {
      type: 'varchar(255)',
      notNull: true
    },
    message: {
      type: 'text'
    },
    read: {
      type: 'boolean',
      default: false
    },
    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp')
    }
  });

  pgm.createIndex('notifications', 'user_id');
};

exports.down = (pgm) => {
  pgm.dropTable('notifications');
};
```

### Adding a column

```javascript
exports.up = (pgm) => {
  pgm.addColumns('participants', {
    email: {
      type: 'varchar(255)',
      unique: true
    },
    phone: {
      type: 'varchar(20)'
    }
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('participants', ['email', 'phone']);
};
```

### Modifying a column

```javascript
exports.up = (pgm) => {
  pgm.alterColumn('participants', 'first_name', {
    type: 'varchar(100)',
    notNull: true
  });
};

exports.down = (pgm) => {
  pgm.alterColumn('participants', 'first_name', {
    type: 'varchar(255)',
    notNull: false
  });
};
```

## Best Practices

1. **Always write down migrations** - If it can be rolled back, write the down migration
2. **Test migrations locally** - Before running in production
3. **Keep migrations atomic** - One logical change per migration
4. **Never edit applied migrations** - Create a new migration instead
5. **Use transactions** - Migrations run in transactions by default
6. **Document complex changes** - Add comments to explain why

## Production Deployment

```bash
# 1. Pull latest code
git pull origin main

# 2. Run migrations
npm run migrate up

# 3. Start/restart application
pm2 restart wampums
```

## Troubleshooting

### Migration failed mid-way

```bash
# Check status
npm run migrate status

# If needed, manually fix database then mark as run
npm run migrate mark <migration-name>
```

### Need to redo a migration

```bash
# Roll back
npm run migrate down

# Fix the migration file

# Rerun
npm run migrate up
```

## Migration File Location

All migrations are stored in the `migrations/` directory and are run in order based on their timestamp prefix.
