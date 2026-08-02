#!/usr/bin/env node

/**
 * Prepare a local PostgreSQL database with the Wampums schema, catalogs, and
 * tenant context required to run the application.
 */

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const babel = require("@babel/core");
const { Pool } = require("pg");
const { ROLES } = require("../config/role-constants");
const { applyBaseMigrations } = require("./run-base-migrations");

const projectRoot = path.resolve(__dirname, "..");
const connectionString = process.env.DATABASE_URL
    || "postgresql:///wampums?host=/var/run/postgresql";
const registrationPassword = process.env.LOCAL_REGISTRATION_PASSWORD;

/** Load the browser role catalog through Babel so this seed stays in sync. */
function loadRoleBundles() {
    const sourcePath = path.join(projectRoot, "config", "roles.js");
    const source = fs.readFileSync(sourcePath, "utf8");
    const transformed = babel.transformSync(source, {
        presets: [["@babel/preset-env", { targets: { node: "current" }, modules: "commonjs" }]],
        filename: sourcePath,
    });
    const roleModule = { exports: {} };
    const evaluate = new Function("module", "exports", "require", transformed.code);
    evaluate(roleModule, roleModule.exports, require);
    return roleModule.exports.ROLE_BUNDLES;
}

/** Find permission checks enforced by backend routes. */
function findRequiredRoutePermissions() {
    const permissionKeys = new Set();
    const routesDir = path.join(projectRoot, "routes");
    const permissionPattern = /requirePermission\(["']([^"']+)["']\)/g;

    for (const fileName of fs.readdirSync(routesDir)) {
        if (!fileName.endsWith(".js")) continue;
        const source = fs.readFileSync(path.join(routesDir, fileName), "utf8");
        for (const match of source.matchAll(permissionPattern)) {
            permissionKeys.add(match[1]);
        }
    }

    return permissionKeys;
}

/** Return Scout Canada's current September-to-August program year. */
function getCurrentScoutYear() {
    const today = new Date();
    const currentYear = today.getUTCFullYear();
    const startYear = today.getUTCMonth() >= 8 ? currentYear : currentYear - 1;
    return {
        label: `${startYear}-${startYear + 1}`,
        startDate: `${startYear}-09-01`,
        endDate: `${startYear + 1}-08-31`,
    };
}

async function main() {
    if (!registrationPassword) {
        throw new Error("LOCAL_REGISTRATION_PASSWORD must be set in .env");
    }

    const pool = new Pool({ connectionString, ssl: false, max: 2 });
    const client = await pool.connect();
    let setupStage = "starting transaction";

    try {
        await client.query("BEGIN");

        setupStage = "importing database schema";
        const tableCount = await client.query(
            `SELECT COUNT(*)::int AS count
             FROM information_schema.tables
             WHERE table_schema = 'public'`,
        );
        if (tableCount.rows[0].count === 0) {
            const schema = fs.readFileSync(
                path.join(projectRoot, "attached_assets", "Full_Database_schema.sql"),
                "utf8",
            )
                .replace(/^\\restrict .*$/gm, "")
                .replace(/^\\unrestrict .*$/gm, "")
                .replace(/^SET transaction_timeout = .*$/gm, "");
            await client.query(schema);
        }
        await client.query("SET search_path TO public");

        setupStage = "seeding permission catalog";
        const permissionCount = await client.query("SELECT COUNT(*)::int AS count FROM permissions");
        if (permissionCount.rows[0].count === 0) {
            const permissionsSeed = fs.readFileSync(
                path.join(projectRoot, "attached_assets", "permissions_list.sql"),
                "utf8",
            );
            await client.query(permissionsSeed);
        }
        await client.query(
            `SELECT setval(
               pg_get_serial_sequence('permissions', 'id'),
               COALESCE((SELECT MAX(id) FROM permissions), 1),
               true
             )`,
        );

        const roleBundles = loadRoleBundles();
        const requiredPermissionKeys = findRequiredRoutePermissions();
        for (const bundle of Object.values(roleBundles)) {
            for (const permissionKey of bundle.permissions || []) {
                requiredPermissionKeys.add(permissionKey);
            }
        }

        setupStage = "adding required permissions";
        for (const permissionKey of requiredPermissionKeys) {
            const category = permissionKey.split(".")[0];
            await client.query(
                `INSERT INTO permissions (permission_key, permission_name, category, description)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (permission_key) DO NOTHING`,
                [permissionKey, permissionKey, category, "Seeded for local development"],
            );
        }

        setupStage = "seeding roles";
        const roleNames = new Set([
            ...Object.values(ROLES),
            ...Object.keys(roleBundles),
        ]);
        for (const roleName of roleNames) {
            const bundle = roleBundles[roleName];
            await client.query(
                `INSERT INTO roles
                   (role_name, display_name, description, is_system_role, data_scope)
                 VALUES ($1, $2, $3, true, $4)
                 ON CONFLICT (role_name) DO UPDATE SET
                   display_name = EXCLUDED.display_name,
                   description = EXCLUDED.description,
                   is_system_role = true,
                   data_scope = EXCLUDED.data_scope`,
                [
                    roleName,
                    bundle?.displayName || roleName,
                    bundle?.description || `Legacy ${roleName} role`,
                    bundle?.scope === "self" ? "linked" : "organization",
                ],
            );
        }

        setupStage = "assigning role permissions";
        const permissionAliases = {
            admin: "unitadmin",
            animation: "leader",
        };
        for (const roleName of roleNames) {
            const canonicalName = permissionAliases[roleName] || roleName;
            const bundle = roleBundles[canonicalName];
            const rolePermissions = roleName === ROLES.DISTRICT
                ? [...requiredPermissionKeys]
                : (bundle?.permissions || []);

            for (const permissionKey of rolePermissions) {
                await client.query(
                    `INSERT INTO role_permissions (role_id, permission_id)
                     SELECT r.id, p.id
                     FROM roles r, permissions p
                     WHERE r.role_name = $1 AND p.permission_key = $2
                     ON CONFLICT DO NOTHING`,
                    [roleName, permissionKey],
                );
            }
        }

        setupStage = "creating local organization";
        const organizationResult = await client.query(
            `SELECT id FROM organizations WHERE name = 'Wampums local' ORDER BY id LIMIT 1`,
        );
        const organizationId = organizationResult.rows[0]?.id
            || (await client.query(
                `INSERT INTO organizations (name, program_section, default_language)
                 VALUES ('Wampums local', 'general', 'fr') RETURNING id`,
            )).rows[0].id;

        await client.query(
            `INSERT INTO organization_program_sections
               (organization_id, section_key, display_name)
             VALUES ($1, 'general', 'Général')
             ON CONFLICT (organization_id, section_key)
             DO UPDATE SET display_name = EXCLUDED.display_name, updated_at = NOW()`,
            [organizationId],
        );

        setupStage = "registering local domains";
        for (const domain of ["localhost", "127.0.0.1"]) {
            await client.query(
                `INSERT INTO organization_domains (organization_id, domain)
                 SELECT $1::int, $2::varchar
                 WHERE NOT EXISTS (
                   SELECT 1 FROM organization_domains
                   WHERE organization_id = $1::int AND domain = $2::varchar
                 )`,
                [organizationId, domain],
            );
        }

        setupStage = "seeding organization settings";
        const settings = {
            organization_info: { name: "Wampums local" },
            registration_password: registrationPassword,
            default_email_language: "fr",
        };
        for (const [settingKey, settingValue] of Object.entries(settings)) {
            await client.query(
                `INSERT INTO organization_settings (organization_id, setting_key, setting_value)
                 VALUES ($1, $2, $3::jsonb)
                 ON CONFLICT (organization_id, setting_key)
                 DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = NOW()`,
                [organizationId, settingKey, JSON.stringify(settingValue)],
            );
        }

        setupStage = "applying base database migrations";
        await applyBaseMigrations(client, { organizationIds: [organizationId] });

        setupStage = "creating active scout year";
        const scoutYear = getCurrentScoutYear();
        await client.query(
            `INSERT INTO scout_years
               (organization_id, label, start_date, end_date, status)
             VALUES ($1, $2, $3, $4, 'active')
             ON CONFLICT (organization_id, label)
             DO UPDATE SET status = 'active', start_date = EXCLUDED.start_date,
                           end_date = EXCLUDED.end_date, updated_at = NOW()`,
            [organizationId, scoutYear.label, scoutYear.startDate, scoutYear.endDate],
        );

        await client.query("COMMIT");
        process.stdout.write(`Local Wampums database ready (organization ${organizationId}).\n`);
    } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(`${setupStage}: ${error.message}`, { cause: error });
    } finally {
        client.release();
        await pool.end();
    }
}

main().catch((error) => {
    process.stderr.write(`Local database setup failed: ${error.message}\n`);
    process.exitCode = 1;
});
