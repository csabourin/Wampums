const crypto = require('crypto');
const bcrypt = require('bcryptjs');

// Mock Database
const db = {
    users: [
        {
            id: 1,
            email: 'user@example.com',
            password: 'oldpassword',
            reset_token: null,
            reset_token_expiry: null
        }
    ]
};

async function query(sql, params) {
    console.log(`DB Query: ${sql.trim().split('\n')[0]}... [Params: ${params}]`);

    if (sql.includes('UPDATE users SET reset_token')) {
        db.users[0].reset_token = params[0];
        db.users[0].reset_token_expiry = params[1];
        return { rows: [db.users[0]] };
    }

    if (sql.includes('SELECT id FROM users')) {
        const user = db.users[0];
        if (user.reset_token === params[0] && user.reset_token_expiry > new Date()) {
            return { rows: [{ id: user.id }] };
        }
        return { rows: [] };
    }

    if (sql.includes('UPDATE users SET password')) {
        db.users[0].password = params[0];
        db.users[0].reset_token = null;
        db.users[0].reset_token_expiry = null;
        return { rows: [] };
    }
}

async function requestReset(email) {
    const rawToken = 'test-token-123';
    const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiry = new Date(Date.now() + 3600000);

    await query('UPDATE users SET reset_token = $1, reset_token_expiry = $2 WHERE email = $3', [hashedToken, expiry, email]);
    return rawToken;
}

async function resetPassword(token, newPassword) {
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    const tokenResult = await query('SELECT id FROM users WHERE reset_token = $1 AND reset_token_expiry > NOW()', [hashedToken]);

    if (tokenResult.rows.length === 0) {
        return { success: false, message: 'invalid_or_expired_token' };
    }

    const userId = tokenResult.rows[0].id;
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await query('UPDATE users SET password = $1, reset_token = NULL, reset_token_expiry = NULL WHERE id = $2', [hashedPassword, userId]);
    return { success: true };
}

// Simulate User Interaction
async function runReproduction() {
    console.log("--- Step 1: Request Reset ---");
    const rawToken = await requestReset('user@example.com');
    console.log(`Link: /reset-password?token=${rawToken}`);

    console.log("\n--- Step 2: Attempt with mismatch (Client Side) ---");
    console.log("Client logic: if (pass1 !== pass2) return;");
    console.log("(No request sent to server)");

    console.log("\n--- Step 3: Attempt again with correct passwords (Match) ---");
    const result = await resetPassword(rawToken, 'NewStrongPassword123');
    console.log("Result:", result);

    if (result.success) {
        console.log("PASSED: Token worked on second attempt.");
    } else {
        console.log("FAILED: Token failed on second attempt.");
    }
}

runReproduction();
