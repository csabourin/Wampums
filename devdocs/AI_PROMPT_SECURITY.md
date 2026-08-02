# AI prompt trust boundary

Requests to `POST /api/v1/ai/text` contain untrusted application data. Values
such as names, vocabulary, activity descriptions, and text to rewrite must
never be interpolated into a system-role model message.

The route validates each request with `utils/aiPayloadValidation.js`. Validation
applies mode-specific schemas, length and collection limits, locale/tone
allowlists, and copies known properties into a new plain object. Unknown client
properties—including proposed prompt instructions or constraints—are discarded.

`services/openai.js` uses static system messages. Normalized request data is
serialized as JSON only in a user-role message, and the static system policy
explicitly directs the model to treat all JSON values as data rather than
instructions. This separation applies to meeting plans, activity plans,
rewrites, translations, and risk suggestions.

When adding an AI mode:

1. Add a bounded schema to the validator.
2. Keep the complete system-role content static.
3. Put normalized application data in a user-role message.
4. Add a regression case to `test/ai-prompt-security.test.js` using an injection
   sentinel and assert that it cannot appear in any system message.
