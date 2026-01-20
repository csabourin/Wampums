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
            // Build template structure if provided
            let templateContext = "";
            if (payload.activityTemplates && payload.activityTemplates.length > 0) {
                payload.activityTemplates.forEach(t => {
                    templateContext += `- ${t.time} (${t.duration}): ${t.activity} [${t.type}]\n`;
                });
                templateContext += "\nUse these as a base structure, but adapt the activities based on the user's focus.";
            }

            // Add recent honor context if provided
            let honorContext = "";
            if (payload.recentHonor) {
                honorContext = `\n\nMost recent honor to mention: ${payload.recentHonor.name} received ${payload.recentHonor.honor} on ${payload.recentHonor.date}.`;
            }

            return [
                {
                    role: "system", content: `${systemBase} Create a scout meeting plan in JSON format IN FRENCH.
Output structure:
{
  "theme": "string (meeting theme in French)",
  "goals": "string (meeting objectives in French)",
  "materials": ["string (list of materials needed in French)"],
  "timeline": [{ 
    "time": "HH:MM", 
    "duration": "HH:MM", 
    "activity": "string (activity name in French)",
    "responsable": "string (optional: name of leader responsible for this activity)",
    "materiel": "string (optional: specific materials needed for this activity)"
  }]
}

Important context:
- "Loup d'honneur" is a brief formality at the start of meetings (5-10 minutes), not a ceremony
- "Trève de l'eau" is a water break that typically comes after active games
- "Accueil des louveteaux" is the welcome/opening activity
- Activities should be practical, age-appropriate scout activities
- Use French terminology for scout activities
- Include 'responsable' for activities when a specific leader should handle it
- Include 'materiel' for activities that need specific equipment${templateContext}${honorContext}`
                },
                {
                    role: "user", content: `Create a ${payload.duration} meeting plan for ${payload.section} scouts on ${payload.date}.
Focus: ${payload.focus}.
Generate 5-7 activities with realistic times and durations.
For each activity, if relevant, suggest which leader (responsable) should handle it and what specific materials (materiel) are needed.
RESPOND IN FRENCH.`
                }
            ];

        case "risk_suggest":
            return [
                {
                    role: "system", content: `${systemBase} Analyze activity risks and suggest mitigations in JSON format.
Output structure:
{
  "risks": ["string (brief risk description)"],
  "mitigation": ["string (brief mitigation strategy)"]
}` },
                {
                    role: "user", content: `Analyze these scout activities for safety risks:
${payload.activityDescription}

Provide 3-5 key risks and corresponding mitigation strategies.`
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
