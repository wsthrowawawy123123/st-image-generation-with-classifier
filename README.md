# ST Image Auto Generation

A **SillyTavern extension** that automatically generates images during roleplay conversations.

The extension detects when an image should be generated and then calls SillyTavern’s image generation pipeline (e.g. Stable Diffusion) to create and insert the image into chat.

It supports multiple insertion styles and optional LLM-powered scene analysis.

---

# Core Idea

The extension works by analyzing assistant replies and converting visually important moments into actual generated images.

Typical flow:

1. A new assistant reply arrives
2. The extension analyzes whether the reply is visually important
3. It builds a concise image prompt from the scene
4. The prompt is sent to the image generation system
5. The generated image is inserted into the conversation

---

# Image Insertion Modes

The extension supports several ways to insert generated images.

### Inline

The image is inserted directly inside the current message.

### Replace

The current message is updated inline with the generated image.

### New Message

The image is generated as a separate chat message.

### Disabled

Image generation is turned off.

---

# Feature Branch: Scene Probability (Experimental)

The `feat/sceneProbability` branch introduces an experimental **LLM-driven scene analysis system**.

The extension can analyze each reply and determine whether the scene is visually important enough to generate an image.

This reduces spam images and improves scene continuity.

## Scene Classification

Each assistant reply is analyzed and categorized.

Example output:

```json
{
  "generate": true,
  "category": "pose_change",
  "weight": 0.72
}
```

Possible categories include:

* nsfw_action
* selfie_request
* location_change
* pose_change
* physical_interaction
* food_or_object_focus
* ambient_scene
* dialogue_only

Pure dialogue usually results in:

```text
generate: false
weight: 0
```

---

## Scene Memory

The experimental branch introduces **persistent scene memory** so that images stay visually consistent across messages.

Tracked attributes include:

* location
* environment
* assistant pose
* assistant clothing
* assistant expression
* interaction
* props
* lighting
* mood

Each reply can produce a **scene patch** that updates the current memory.

Location changes automatically reset environment context.

---

## LLM Image Prompt Generation

The extension can generate prompts automatically.

The system:

1. Analyzes the assistant reply
2. Reads the current scene memory
3. Selects the most visually representative moment
4. Produces a concise visual prompt

Example generated prompt:

```text
1girl, sitting at cafe table, sunlight through window, coffee mug, relaxed smile
```

---

## Separate Classifier Backend

Scene classification can run on a **separate LLM backend**.

Supported backends include:

* KoboldCPP
* RunPod
* OpenAI-compatible APIs

This allows you to run lightweight classification models separately from your main RP model.

---

# Configuration

The extension exposes settings for:

### Image generation

* insert mode

### Scene analysis (experimental branch)

* enable scene analysis
* classifier backend
* API endpoint
* model name
* temperature
* token limits

---

# Requirements

* SillyTavern
* An image generation backend (Stable Diffusion or compatible)
* Optional: an LLM endpoint for scene analysis

---

# Status

Core image generation is stable.

The **scene probability system is experimental** and may change as the feature is developed.

---

# License

Same license as the upstream project.
