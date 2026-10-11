# Built-in LoRA prompt review

NEXT: Approved prompt improvements are verified; commit and push main, then leave the rebuilt app open for review.

Scope: inspected all 16 built-in templates in src/types/index.ts, shared extra options, promptBuilder.ts, AiPanel.tsx selection and trigger handling, and lm_studio.rs image request construction. No product code or dataset captions changed.

## Priority findings

1. Extra options are appended regardless of preset. Camera details explicitly demands guessed camera, aperture, shutter speed and ISO; this contradicts visible-only captioning. Omit fixed attributes still explicitly asks for changeable hair style, conflicting with fixed character hair. Aesthetic quality, vulgar language and rating labels conflict with neutral character prose. Preset exclusions need clear priority and incompatible options should be flagged or prevented.
2. Signature Outfit says recurring outfit and alternate outfit without supplying a known signature outfit or dataset context. Backend sends one image per caption request, including batch processing. Add user-provided signature outfit context or explicit fixed appearance instructions rather than relying on the model to infer recurrence from one image. Omission is a captioning strategy, not a guaranteed identity binding mechanism.
3. Original Character LoRA bans studio-lighting language even for visibly applicable lighting and lacks the newer explicit visible-expression and crop-framing checks. Replace the blanket lighting ban with no unsupported inference, retain real visible conditions, and carry the newer accuracy constraints across presets.
4. Descriptive is the default and asks only for a long detailed description. Built-in Prose covers appearance and medium generically. Neither communicates a specific learned concept or excludes fixed features. They should be clearly general-purpose and receive visible-only/output constraints.
5. Stable Diffusion Prompt and MidJourney ask for generation prompts, not faithful training captions; likely decorative language and platform syntax should not be encouraged in training presets. Art Critic, Product Listing and Social Media likewise serve separate writing tasks and should be labeled/grouped accordingly.
6. Danbooru/e621/Rule34 presets request artist, copyright and character labels without preventing guessed identities. Booru-Like is underspecified. All tag presets need visible evidence, no invented names, consistent format and exclusions appropriate to character/outfit/style training goals. Built-in tag presets are clearer about output format but lack learned-concept exclusions.
7. Caption length substitutes {length} only; built-in presets do not use that placeholder, so selecting length alone does not alter their instructions. Word-count limit is appended and does work. The separate character-name option likewise needs {name} or the refer-name extra; it is not automatically applied everywhere.

## Useful additions, in priority order

- Style LoRA: caption changing depicted content; avoid repeatedly naming the intended style or guessing artist attribution; choose what style information to retain according to the training goal.
- Outfit / Armor LoRA: learn one outfit across wearers, keeping changing wearer, pose, setting and props described. Different purpose from Character plus Signature Outfit.
- Object / Product LoRA: learn a specific object/design while captioning view, placement, interactions, lighting and surroundings; no advertising claims.
- Creature / Species LoRA: distinguish a recurring species design from an individual character; define invariant traits explicitly and caption changing individual and scene attributes.
- Pose / Action LoRA: identify the intended learned pose/action and caption changing subjects, clothing and settings; requires explicit target context.
- LoRA-focused tag variants: character with variable outfit and character with fixed outfit for tag-based workflows.

Model and trainer expectations matter; natural prose versus tag format should follow the target workflow, not be inferred from the fact that it is a LoRA. Reference: Hugging Face Diffusers FLUX DreamBooth trainer and README, and Ostris AI Toolkit trigger/caption documentation.

Recommendations only. Do not bulk rewrite users' custom templates or existing captions as part of this review.

User approved the recommendations. Implement the three priority training presets, explicit target context, preset-specific extra-instruction exclusions, working caption length, accuracy improvements and clearly separated writing presets. Preserve edited prompts and custom templates during default refresh. Apply the same prompt rules to single-image and batch captioning.

## Implementation and verification

Added Style LoRA for art-style datasets, Outfit / Armor LoRA, and Object / Product LoRA. Signature Outfit, Outfit and Object require explicit reference descriptions before single or batch captioning. Context is stored separately per template and copied when saving a custom preset; users are reminded to update it when changing datasets. Training presets exclude conflicting extra options even if older settings still contain those selections. The UI shows unavailable instructions and groups writing helpers separately. Caption length now works without placeholders. Updated literal-caption constraints and attribution safeguards; no guessed camera settings. Defaults refresh only by built-in IDs and only refresh untouched active prompt text, preserving custom templates even if their names match a built-in.

User specifically confirmed needing an art-style LoRA preset while this work was underway; Style LoRA is included and explains its content-captioning purpose.

Verified all 201 frontend tests before final persistence refinement; full-suite invocation initially hit an existing Node 25 localStorage stub issue. Running with NODE_OPTIONS=--no-experimental-webstorage lets jsdom supply working storage and the suite passes without changing unrelated test infrastructure. Built frontend and native desktop successfully. Browser UI verification covered grouping, separate persisted descriptions, length, excluded extras, saving custom presets and writing-helper guidance. Native single and batch caption paths sent identical final prompts to a controlled local HTTP test service, rejected missing target context, and wrote captions only to a disposable dataset. This verifies prompt delivery, not AI caption quality.

Final validation after preserving same-name custom templates: all 202 frontend tests passed, production and desktop builds passed, focused lint and git diff --check passed, and the UI checks passed again. The original user dataset and its captions were not modified by this implementation or verification.
