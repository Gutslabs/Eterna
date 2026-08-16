const VISION_MODEL_PATTERN =
  /(gpt-(?:4o|4-turbo|4-vision|5)|claude|gemini|grok|vision|multimodal|qwen[^/]*vl|llava|pixtral)/i;

/** Conservative capability fallback for providers without model metadata. */
export function modelSupportsVision(model: string | undefined): boolean {
  return !!model && VISION_MODEL_PATTERN.test(model);
}
