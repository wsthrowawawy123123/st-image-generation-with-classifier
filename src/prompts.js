export function buildRouterPrompt(chatLog) {
    return `You are a content router for a scene tagging system.

Classify the text and decide which extractor should handle it.

Return exactly:
Content:
Route:
Reason:

Content labels:
sfw, suggestive, explicit, mixed, unknown

Route labels:
sfw, nsfw, unknown

Definitions:
- sfw = no sexual or intimate content
- suggestive = flirting, kissing, teasing, sensual tone, or non-explicit intimacy
- explicit = sexual acts, exposed sexual body parts, or sexual contact
- mixed = both ordinary scene content and sexual content are important
- unknown = unclear content

Routing rules:
- Route sfw only when content is clearly sfw.
- Route suggestive, explicit, and mixed to nsfw.
- Route unknown to unknown.

Rules:
- Return only the three fields.
- Use lowercase only.
- Do not explain beyond the fields.
- Keep Reason under 12 words.

Text:
${chatLog}`;
}

export function buildSfwExtractorPrompt(chatLog) {
    return `You are an sfw scene extraction tool.

Extract only details directly stated in the text.
Do not infer missing details.

Return exactly:
Actions:
Poses:
Location:
Attire:
Setting:

Rules:
- Use short lowercase phrases.
- Use comma-separated values only when multiple details are clearly stated.
- Do not include emotions.
- Do not include dialogue.
- Do not include metaphors.
- If unknown, write unknown.

Text:
${chatLog}`;
}

export function buildNsfwExtractorPrompt(chatLog) {
    return `You are an nsfw scene extraction tool.

Extract only details directly stated in the text.
Do not infer missing details.
Do not censor taxonomy labels.
Do not generate erotic prose.

Return exactly:
Actions:
Poses:
Body contact:
Exposure:
Location:
Attire:
Setting:

Rules:
- Use short lowercase phrases.
- Use comma-separated values only when multiple details are clearly stated.
- Do not include emotions.
- Do not include dialogue.
- Do not include metaphors.
- Do not add details not in the text.
- If unknown, write unknown.

Text:
${chatLog}`;
}

export function buildNormalizerPrompt(routerResult, rawExtractionText) {
    return `You are a label normalizer for a scene tagging system.

Convert the extracted scene details into exactly one label per field.

Return exactly:
Content:
Action group:
Action:
Pose:
Exposure:
Contact:
State:
Appearance detail:
Fluid:
Fluid location:
Location:
Attire:
Clothing state:
Setting:

Content labels:
sfw, suggestive, explicit, mixed, unknown

Action group labels:
sfw, sensual, oral, manual, penetrative, dynamic, unknown

SFW action labels:
conversation, walking, running, sitting, standing, eating, drinking, reading, sleeping, working, studying, cooking, cleaning, driving, traveling, shopping, fighting, dancing, hugging, crying, laughing, arguing, unknown

NSFW action labels:
flirting, kissing, touching, fondling, undressing, posing, grinding, handjob, blowjob, cunnilingus, oral sex, vaginal sex, anal sex, intercourse, masturbation, mutual masturbation, fingering, restraint, aftercare, unknown

Pose labels:
standing, sitting, kneeling, lying, straddling, bending, leaning, spread legs, restrained, unknown

Exposure labels:
none, chest, buttocks, genitals, full nudity, unknown

Contact labels:
none, mouth, hands, body, genitals, unknown

State labels:
none, wet, aroused, messy, after sex, unknown

Appearance detail labels:
none, wet, messy, sweaty, flushed, disheveled, unknown

Fluid labels:
none, semen, saliva, sweat, lubricant, mixed fluids, unknown

Fluid location labels:
none, mouth, face, chest, hands, thighs, genitals, body, clothing, surface, unknown

Attire labels:
clothed, partial clothing, underwear, lingerie, shirt, pants, dress, nudity, costume, unknown

Clothing state labels:
normal, removed, partial, ripped, torn, open, pulled down, pulled up, unbuttoned, unzipped, disheveled, stained, wet, unknown

Rules:
- Return only the listed fields.
- Use lowercase only.
- Choose exactly one value per field.
- Use only the allowed labels for normalized fields.
- Location and Setting may be extracted from the text.
- If a field is unclear, write unknown.
- If Content is sfw, set Exposure to none and Contact to none unless stated otherwise.
- If route is sfw, prefer SFW action labels.
- If route is nsfw, prefer NSFW action labels.
- If explicit sexual action is directly stated, choose the most specific explicit action label.
- If multiple actions apply, choose the central action.
- If multiple poses apply, choose the pose tied to the central action.
- State describes body or scene condition, not action.
- Appearance detail describes visible presentation.
- Fluid describes visible or stated fluids.
- Fluid location describes where the fluid is visible or described.
- Clothing state describes the condition or position of clothing.
- If no fluid is stated, use fluid: none and fluid location: none.
- If clothing condition is normal or not relevant, use clothing state: normal.
- Do not use descriptor fields as actions.
- Do not explain.

Router result:
${JSON.stringify(routerResult)}

Raw extraction:
${rawExtractionText}`;
}

export function buildSafetyPrompt(chatLog, normalizedTags) {
    return `You are a safety classifier for scene metadata.

Classify only safety/compliance metadata.
Do not rewrite the scene.
Do not generate erotic prose.

Return exactly:
Age:
Consent:
Risk:
Reason:

Age labels:
adult, age unclear, minor, unknown

Consent labels:
consensual, roleplay, coercive, nonconsensual, unclear, unknown

Risk labels:
none, violence, incest, bestiality, self harm, illegal, unknown

Rules:
- Use only the allowed labels.
- Return one label per field.
- Keep Reason under 12 words.
- If age is not clearly adult, use age unclear.
- If consent is not clear, use unclear.
- Do not explain beyond the fields.

Text:
${chatLog}

Normalized tags:
${JSON.stringify(normalizedTags)}`;
}

export function buildContinuityMemoryPrompt(chatChunk, currentState, normalizedTags) {
    return `You are a continuity memory extractor.

Extract only facts needed to keep the next response consistent.

Return exactly:
Scene summary:
Location:
Setting:
User state:
Character state:
Last action:
Continuity facts:
Open threads:

Rules:
- Keep values short.
- Do not write prose.
- Do not invent details.
- Preserve location, pose, clothing, clothing state, recent action, and unresolved scene state.
- Use comma-separated values only for facts and open threads.
- Unknown values must be written as unknown.
- Use lowercase only.
- Do not include image-model tags.
- Do not include safety labels unless they are needed for continuity.
- Do not output JSON.
- Do not output extra fields.

Text:
${chatChunk}

Existing current state:
${JSON.stringify(currentState || {})}

Scene tags:
${JSON.stringify(normalizedTags || {})}`;
}
