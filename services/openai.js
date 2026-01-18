const OpenAI = require("openai");
const { checkAndReserveBudget, recordUsage, releaseBudget } = require("./ai-budget");

// Initialize OpenAI client
// NOTE: OPENAI_API_KEY must be in .env
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

// Configure Pricing (gpt-4o-mini)
// $0.150 / 1M input tokens
// $0.600 / 1M output tokens
const PRICE_INPUT_PER_1M = 0.15;
const PRICE_OUTPUT_PER_1M = 0.60;
const MODEL = "gpt-4o-mini";

// Estimated tokens for reservation (to be safe)
const EST_INPUT_TOKENS = 1000;
const EST_OUTPUT_TOKENS = 2000;
const SAFETY_MARGIN_USD = 0.005; // $0.005 buffer per request reservation

/**
 * Calculates estimated cost based on token counts
 */
function calculateCost(inputTokens, outputTokens) {
    return (
        (inputTokens / 1_000_000) * PRICE_INPUT_PER_1M +
        (outputTokens / 1_000_000) * PRICE_OUTPUT_PER_1M
    );
}

/**
 * Generic handler for OpenAI text generation with budget enforcement
 */
async function generateText(mode, payload, userContext) {
    // 1. Estimate Reservation Cost (Upper bound / worst case)
    // For simplicity, we reserve a small fixed amount + margin
    // 3000 tokens total is roughly $0.002, so $0.005 is safe for gpt-4o-mini
    const reservationAmount = SAFETY_MARGIN_USD;

    // 2. Check & Reserve Budget
    const isReserved = await checkAndReserveBudget(reservationAmount);
    if (!isReserved) {
        throw { code: "AI_BUDGET_EXCEEDED", message: "Monthly AI budget cap reached." };
    }

    let finalCost = 0;
    let usage = { prompt_tokens: 0, completion_tokens: 0 };
    let success = false;
    let errorCode = null;

    try {
        // 3. Prepare System Prompt & Messages based on Mode
        const messages = buildMessages(mode, payload);

        // 4. Call OpenAI
        const completion = await openai.chat.completions.create({
            model: MODEL,
            messages: messages,
            response_format: { type: "json_object" }, // Enforce JSON
            temperature: 0.7,
            max_tokens: 2000,
        });

        usage = completion.usage || { prompt_tokens: 0, completion_tokens: 0 };
        const content = completion.choices[0].message.content;

        // 5. Calculate Actual Cost
        finalCost = calculateCost(usage.prompt_tokens, usage.completion_tokens);
        success = true;

        // 6. Return Data
        return {
            data: JSON.parse(content),
            usage: {
                provider: "openai",
                model: MODEL,
                cost: finalCost
            }
        };

    } catch (error) {
        errorCode = error.error?.code || "UNKNOWN_ERROR";
        console.error("OpenAI Error:", error);
        throw error;
    } finally {
        // 7. Reconcile Budget & Log
        // If actual cost < reserved, release the difference.
        // If request failed (cost=0), release full reservation.
        const amountToRelease = success
            ? Math.max(0, reservationAmount - finalCost)
            : reservationAmount;

        await releaseBudget(amountToRelease);

        await recordUsage({
            organization_id: userContext.organizationId,
            user_id: userContext.userId,
            provider: "openai",
            feature: mode,
            model: MODEL,
            input_tokens: usage.prompt_tokens,
            output_tokens: usage.completion_tokens,
            estimated_cost_usd: success ? finalCost : 0,
            success,
            error_code: errorCode
        });
    }
}

function buildMessages(mode, payload) {
    const systemBase = "You are a helpful assistant for a Scout management platform.";

    switch (mode) {
        case "meeting_plan":
            return [
                {
                    role: "system", content: `${systemBase} Create a detailed scout meeting plan in JSON format.
Output structure:
{
  "title": "string",
  "overview": "string",
  "timeline": [{ "minuteStart": number, "minuteEnd": number, "name": "string", "objective": "string", "materials": ["string"], "instructions": ["string"], "safety": ["string"] }],
  "materialsMasterList": ["string"],
  "badgeMapping": [{ "badge": "string", "requirement": "string", "coveredBy": ["string"] }],
  "backupPlan": { "ifWeatherBad": "string", "ifTimeRunsShort": "string" }
}` },
                {
                    role: "user", content: `Create a ${payload.durationMinutes}-minute meeting for ${payload.participantsCount} scouts.
Focus Badge: ${payload.badgeFocus}.
Constraints: ${payload.constraints ? payload.constraints.join(", ") : "none"}.
Notes: ${payload.notes || "none"}.`
                }
            ];

        case "risk_suggest":
            return [
                {
                    role: "system", content: `${systemBase} Analyze activity risks and suggest mitigations in JSON format.
Output structure:
{
  "risks": [{ "hazard": "string", "whoMightBeHarmed": ["string"], "likelihood": "low"|"medium"|"high", "severity": "low"|"medium"|"high", "mitigations": ["string"], "requiredEquipment": ["string"], "leaderNotes": "string" }],
  "generalMitigations": ["string"],
  "emergencyNotes": ["string"]
}` },
                {
                    role: "user", content: `Analyze this activity:
Title: ${payload.activityTitle}
Description: ${payload.activityDescription}
Age Range: ${payload.participantsAgeRange}
Environment: ${payload.environment ? payload.environment.join(", ") : "unknown"}
Equipment: ${payload.equipment ? payload.equipment.join(", ") : "unknown"}`
                }
            ];

        case "rewrite":
            return [
                { role: "system", content: `${systemBase} Rewrite the following text to match the requested tone. Return JSON: { "text": "rewritten text here" }` },
                { role: "user", content: `Tone: ${payload.tone}\nText: ${payload.text}` }
            ];

        case "translate":
            return [
                { role: "system", content: `${systemBase} Translate the text from ${payload.from} to ${payload.to}. Return JSON: { "text": "translated text here" }` },
                { role: "user", content: `Text: ${payload.text}` }
            ];

        default:
            throw new Error(`Unknown AI mode: ${mode}`);
    }
}

module.exports = { generateText };
